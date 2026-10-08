import type { WorkflowPayload } from '@vereinsfunk/contracts'
import type { EmailSender } from '@vereinsfunk/mailer'
import type { SecretBox } from '@vereinsfunk/secrets'
import {
  exchangeSessionCookieForToken,
  fetchPlayerStats,
  fetchTeamStats,
  listMatches,
  VeoError,
  type FetchLike,
  type VeoMatch,
  type VeoPlayerStats,
  type VeoTeamStat,
} from '@vereinsfunk/veo-client'

// Paket 053, PR 2: Veo-Abgleich einer Mannschaft im Worker ('sync-integration-source').
//
// Der Lauf (integration_sync_runs) ist schon belegt, wenn der Auftrag ankommt; der Auftrag traegt
// nur dessen ID. Je Spiel werden erst Mannschafts- und Spielerwerte abgerufen und dann alles in
// einer Transaktion geschrieben (playerboard_veo_apply_match) -- scheitert ein Abruf, bleibt das
// Spiel in diesem Lauf ganz weg (alles oder nichts, playerboard 004). Ein abgelaufenes Cookie oder
// eine geaenderte Antwortform beenden den ganzen Lauf, weil jedes weitere Spiel ebenso scheitern
// wuerde. Fachliche Fehler beenden den Lauf als 'failed', ohne den Workflow scheitern zu lassen:
// eine Wiederholung durch Hatchet aendert an einem abgelaufenen Cookie nichts.

export type VeoApplyResult = 'created' | 'updated' | 'conflict' | 'ignored'

export interface VeoMatchWrite {
  veoMatchId: string
  veoTeamId: string
  start: string
  opponentName: string
  isHome: boolean
  ownScore: number | null
  opponentScore: number | null
  teamStats: Omit<VeoTeamStat, 'veoMatchId'>[]
  players: VeoPlayerStats[]
}

export interface VeoSyncSource {
  teamId: string
  teamName: string
  veoClubSlug: string
  veoTeamSlug: string
  secret: { ciphertext: Buffer; keyVersion: string } | null
}

export interface VeoSyncFinish {
  status: 'succeeded' | 'failed'
  errorClass: string | null
  created: number
  updated: number
  skipped: number
  conflicts: number
}

export interface VeoSyncRepository {
  loadRun(runId: string, organizationId: string): Promise<{ sourceId: string; status: string } | null>
  loadSource(sourceId: string): Promise<VeoSyncSource | null>
  applyMatch(runId: string, match: VeoMatchWrite): Promise<VeoApplyResult>
  finish(runId: string, outcome: VeoSyncFinish): Promise<{ teamId: string; notify: boolean } | null>
  failureRecipients(teamId: string): Promise<string[]>
}

export interface VeoSyncOptions {
  repository: VeoSyncRepository
  // Wartezeit vor dem zweiten Versuch eines Spiels; Tests setzen 0.
  retryDelayMs?: number
  secretBox: SecretBox
  emailSender: EmailSender
  fetch: FetchLike
  webBaseUrl?: string | undefined
  log: (fields: Record<string, unknown>, message: string) => void
}

const RUN_ABORTING_CODES = new Set(['auth_expired', 'upstream_changed'])

/** HTTP-Status eines Veo-Fehlers fuers Log; nie Inhalte der Antwort. */
function errorStatus(error: unknown): number | undefined {
  return error instanceof VeoError ? error.status : undefined
}

/** Text des Hinweises an den Trainer, je nach Grund der Fehlerserie. */
export function failureMailText(teamName: string, errorClass: string | null, webBaseUrl: string | undefined): { subject: string; text: string } {
  const reason = errorClass === 'auth_expired'
    ? 'Veo nimmt die gespeicherte Anmeldung nicht mehr an. Bitte verbinde Veo im PlayerBoard neu; bis dahin werden keine neuen Spiele abgeholt.'
    : errorClass === 'upstream_changed'
      ? 'Veo hat seine Schnittstelle geändert, deshalb können die Werte gerade nicht gelesen werden. Wir kümmern uns darum; du musst nichts tun.'
      : 'Veo war nicht erreichbar oder hat mit einem Fehler geantwortet. Der nächste Abgleich versucht es automatisch erneut.'
  const link = webBaseUrl ? `\n\nZur Veo-Verbindung: ${new URL('/playerboard/veo', webBaseUrl).toString()}` : ''
  return {
    subject: `Veo-Abgleich für ${teamName} schlägt fehl`,
    text: `Hallo,\n\nder automatische Abgleich mit Veo für die Mannschaft ${teamName} ist dreimal hintereinander fehlgeschlagen.\n\n${reason}${link}\n\nDiese Nachricht kommt nur einmal, bis ein Abgleich wieder klappt.\n\nVereinsfunk`,
  }
}

/** Baut die Schreibdaten eines Spiels aus Liste, Mannschafts- und Spielerwerten. */
export function toMatchWrite(match: VeoMatch, teamStats: readonly VeoTeamStat[], players: VeoPlayerStats[]): VeoMatchWrite {
  return {
    veoMatchId: match.veoMatchId,
    veoTeamId: match.veoTeamId,
    start: match.start,
    opponentName: match.opponentName,
    isHome: match.homeOrAway === 'home',
    ownScore: match.score?.own ?? null,
    opponentScore: match.score?.opponent ?? null,
    teamStats: teamStats
      .filter((stat) => stat.veoMatchId === match.veoMatchId)
      .map((stat) => ({ teamAssociation: stat.teamAssociation, statType: stat.statType, category: stat.category, value: stat.value, periodValues: stat.periodValues })),
    players,
  }
}

export class VeoSyncExecutor {
  constructor(private readonly options: VeoSyncOptions) {}

  /** Fuehrt einen eingereihten Lauf aus; ein schon beendeter oder abgebrochener Lauf wird uebersprungen. */
  async execute(payload: WorkflowPayload): Promise<void> {
    const { repository } = this.options
    const runId = payload.entityId
    const run = await repository.loadRun(runId, payload.organizationId)
    if (!run || run.status !== 'running') return
    const source = await repository.loadSource(run.sourceId)
    if (!source?.secret) {
      await this.finish(runId, null, { status: 'failed', errorClass: 'veo_link_missing', created: 0, updated: 0, skipped: 0, conflicts: 0 })
      return
    }

    let cookie: string
    try {
      cookie = this.options.secretBox.open(source.secret.ciphertext, source.secret.keyVersion, `integration-source:${run.sourceId}`)
    } catch {
      await this.finish(runId, source, { status: 'failed', errorClass: 'secret_unreadable', created: 0, updated: 0, skipped: 0, conflicts: 0 })
      return
    }

    const outcome: VeoSyncFinish = { status: 'succeeded', errorClass: null, created: 0, updated: 0, skipped: 0, conflicts: 0 }
    const http = { fetch: this.options.fetch }
    try {
      const { accessToken } = await exchangeSessionCookieForToken(cookie, http)
      const matches = await listMatches(accessToken, { veoClubSlug: source.veoClubSlug, veoTeamSlug: source.veoTeamSlug }, http)
      for (const match of matches) {
        // Ohne fertige Analyse und Endstand gibt es nichts zu zeigen (playerboard 003 FR-007).
        if (!match.hasAnalytics || !match.score) {
          outcome.skipped += 1
          continue
        }
        try {
          const { teamStats, players } = await this.withRetry(runId, async () => ({
            teamStats: await fetchTeamStats(accessToken, { veoTeamId: match.veoTeamId, veoMatchIds: [match.veoMatchId] }, http),
            players: await fetchPlayerStats(accessToken, { veoTeamId: match.veoTeamId, veoMatchId: match.veoMatchId }, http),
          }))
          const result = await repository.applyMatch(runId, toMatchWrite(match, teamStats, players))
          if (result === 'created') outcome.created += 1
          else if (result === 'updated') outcome.updated += 1
          else if (result === 'conflict') outcome.conflicts += 1
          else outcome.skipped += 1
        } catch (error) {
          if (error instanceof VeoError && RUN_ABORTING_CODES.has(error.code)) throw error
          outcome.skipped += 1
          outcome.status = 'failed'
          outcome.errorClass ??= error instanceof VeoError ? error.code : 'apply_failed'
          this.options.log({ runId, errorClass: outcome.errorClass, status: errorStatus(error), errorName: error instanceof Error ? error.name : 'unknown' }, 'veo match skipped')
        }
      }
    } catch (error) {
      outcome.status = 'failed'
      outcome.errorClass = error instanceof VeoError ? error.code : 'internal_error'
      this.options.log({ runId, errorClass: outcome.errorClass, status: errorStatus(error), errorName: error instanceof Error ? error.name : 'unknown' }, 'veo sync failed')
    }
    await this.finish(runId, source, outcome)
  }

  /**
   * Ein zweiter Versuch nach kurzer Pause, nur bei upstream_error: Veo antwortet beim Abruf einzelner
   * Spiele gelegentlich mit einem Serverfehler, der beim naechsten Aufruf weg ist (live gesehen am
   * 2026-10-08). Ohne Wiederholung endete fast jeder Lauf als fehlgeschlagen.
   */
  private async withRetry<T>(runId: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt()
    } catch (error) {
      if (!(error instanceof VeoError) || error.code !== 'upstream_error') throw error
      this.options.log({ runId, status: error.status }, 'veo match request retried')
      await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs ?? 2_000))
      return attempt()
    }
  }

  /** Schliesst den Lauf ab und benachrichtigt die Trainer beim dritten Fehllauf in Folge. */
  private async finish(runId: string, source: VeoSyncSource | null, outcome: VeoSyncFinish): Promise<void> {
    const finished = await this.options.repository.finish(runId, outcome)
    if (!finished?.notify || !source) return
    const recipients = await this.options.repository.failureRecipients(finished.teamId)
    const mail = failureMailText(source.teamName, outcome.errorClass, this.options.webBaseUrl)
    for (const to of recipients) {
      try {
        await this.options.emailSender.send({ to, ...mail })
      } catch (error) {
        // Der Lauf ist schon abgeschlossen; ein Mailfehler darf ihn nicht wiederholen lassen.
        this.options.log({ runId, errorName: error instanceof Error ? error.name : 'unknown' }, 'veo failure notification not sent')
      }
    }
  }
}
