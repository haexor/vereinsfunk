import { OAuthPlatformSchema, PublicationExecuteResultSchema, PublicationSchema, SchedulePublicationRequestSchema, UuidSchema } from '@vereinsfunk/contracts'
import { MetaPublishError } from '@vereinsfunk/publishing'
import type { Platform, PublicationInput, PublicationMedia, SocialPublisher, ValidationResult } from '@vereinsfunk/publishing'
import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { byteaToBuffer, createSecretBoxFromEnvironment } from '../secretBox.js'
import { computeMediaGateBlockersForPostVersion, HARD_PUBLISH_BLOCKERS } from '../services/mediaGate.js'
import type { ApiRouteContext } from './context.js'
import { checkRateLimit, computeRuleEntry, createAuditRecorder, fetchPolicyRuleRows } from './shared.js'

export function registerPublishingRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePermission, supabaseClients, environment, createPublisherForConnection } = context
  const recordAuditEvent = createAuditRecorder(supabaseClients)

  // Zwei bewusst getrennte Sperren: der Deployment-Modus stellt sicher, dass dieser Container
  // überhaupt keine externen Provider ansprechen kann; die persistierte Einstellung ist der
  // sofort wirksame SaaS-Admin-Not-Aus. Fehlt die Zeile (z.B. vor einer Migration), fail closed.
  async function publishingIsAvailable(): Promise<boolean> {
    if (environment.NODE_ENV !== 'production') return environment.PUBLISHING_MODE !== 'disabled'
    if (environment.PUBLISHING_MODE !== 'live') return false
    const setting = await supabaseClients.forService().from('platform_settings').select('value').eq('key', 'publishing_enabled').maybeSingle()
    if (setting.error) throw setting.error
    return setting.data?.value === true
  }

  app.post('/v1/post-versions/:id/schedule', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await publishingIsAvailable())) return reply.code(503).send({ error: 'publishing_disabled', correlationId: request.id })
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = SchedulePublicationRequestSchema.parse(request.body)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const rpc = await client.rpc('schedule_publication', {
      target_post_version_id: params.id, target_social_connection_id: input.socialConnectionId, target_scheduled_for: input.scheduledFor,
    })
    if (rpc.error) {
      if (rpc.error.message.includes('insufficient_permission')) return reply.code(403).send({ error: 'forbidden', correlationId: request.id })
      if (rpc.error.message.includes('not_found')) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
      if (rpc.error.message.includes('invalid_status')) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })
      if (rpc.error.message.includes('channel_not_allowed')) return reply.code(422).send({ error: 'channel_not_allowed', correlationId: request.id })
      // Plan 039: ein Blog-Kanal ist noch kein Veroeffentlichungsziel -- publications_platform_check
      // laesst 'website' bewusst nicht zu, bis das Auslieferungspaket ihn bespielen kann. Ohne
      // diese Zeile meldete genau diese absichtliche Absage einen 500 (Review dieses PRs). Die
      // Constraint bleibt die Sperre; hier wird sie nur uebersetzt, denn schedule_publication ist
      // per grant execute direkt aufrufbar und darf sich nicht auf einen TS-Riegel verlassen.
      if (rpc.error.message.includes('publications_platform_check')) return reply.code(422).send({ error: 'channel_not_allowed', correlationId: request.id })
      // Plan 021: beide vor dem bestehenden quota_exceeded-Zweig, weil "content_quota_exceeded"
      // die Teilzeichenkette "quota_exceeded" selbst enthaelt -- in der bisherigen Reihenfolge
      // waere der neue Fehler faelschlich als der alte, vereinsweite channel_quotas-Fehler
      // gemeldet worden.
      if (rpc.error.message.includes('content_quota_exceeded')) return reply.code(409).send({ error: 'content_quota_exceeded', detail: rpc.error.message, correlationId: request.id })
      if (rpc.error.message.includes('content_duration_exceeded')) return reply.code(409).send({ error: 'content_duration_exceeded', detail: rpc.error.message, correlationId: request.id })
      if (rpc.error.message.includes('quota_exceeded')) return reply.code(409).send({ error: 'quota_exceeded', detail: rpc.error.message, correlationId: request.id })
      // Paket 002: schedule_publication wirft 'media_gate_blocked: <blocker>,<blocker>'. Ohne diese
      // Zeile faellt genau der neue Gate-Fehler in throw rpc.error -- der Aufrufer bekaeme 500
      // ("interner Fehler") fuer eine fachlich voellig korrekte Absage und erfuehre nicht, welches
      // Medium sie ausgeloest hat (gefunden im Code-Review). Dieselbe Antwortform wie
      // POST /v1/publications/:id/execute, damit die Oberflaeche nur einen Fall kennt.
      if (rpc.error.message.includes('media_gate_blocked')) {
        return reply.code(409).send({
          error: 'media_gate_blocked',
          blockers: (rpc.error.message.split('media_gate_blocked:')[1] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
          correlationId: request.id,
        })
      }
      throw rpc.error
    }
    return reply.code(201).send(
      PublicationSchema.parse({
        id: rpc.data.id, postVersionId: rpc.data.post_version_id, socialConnectionId: rpc.data.social_connection_id,
        platform: rpc.data.platform, status: rpc.data.status, scheduledFor: rpc.data.scheduled_for,
      }),
    )
  })

  // Paket 025: schedule_publication (oben) legt nur die Zeile an -- kein Code rief bisher
  // SocialPublisher.publish() ueberhaupt auf (plans/025, Ausgangslage). Kein Hatchet-Cron
  // verfuegbar (Paket 004 weiterhin "in Arbeit") -- dieser Endpunkt fuehrt eine FAELLIGE
  // Veroeffentlichung explizit und synchron aus, plant nichts automatisch zu einem kuenftigen
  // Zeitpunkt (dasselbe Muster wie POST /v1/integration-sources/:id/sync).
  app.post('/v1/publications/:id/execute', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await publishingIsAvailable())) return reply.code(503).send({ error: 'publishing_disabled', correlationId: request.id })
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const publication = await client
      .from('publications')
      .select('id, organization_id, post_version_id, social_connection_id, platform, status, scheduled_for, idempotency_key')
      .eq('id', params.id)
      .maybeSingle()
    if (publication.error) throw publication.error
    if (!publication.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const version = await client.from('post_versions').select('id, post_id, caption').eq('id', publication.data.post_version_id as string).maybeSingle()
    if (version.error) throw version.error
    if (!version.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const post = await client.from('posts').select('id, department_id').eq('id', version.data.post_id as string).maybeSingle()
    if (post.error) throw post.error
    if (!post.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    if (!(await requirePermission(request, reply, 'post.publish', { organizationId: publication.data.organization_id as string, departmentId: post.data.department_id as string }))) return

    const scheduledFor = publication.data.scheduled_for as string | null
    if (scheduledFor !== null && new Date(scheduledFor).getTime() > Date.now()) {
      return reply.code(409).send({ error: 'not_due_yet', correlationId: request.id })
    }

    // Paket 002: schedule_publication (2026081107) hat denselben konservativen Kern bereits beim
    // Einplanen durchgesetzt, aber Consent kann danach widerrufen worden sein (Pflichtszenario 5)
    // -- der Snapshot wird hier vor jedem externen I/O erneut geladen und geprueft.
    //
    // Bewusst der Service-Client, nicht der Nutzer-Client (gefunden im Code-Review): directory_people
    // ist per RLS nur mit 'directory.read' lesbar (2026080703), und die Organisationsrolle
    // social_manager -- der typische Veroeffentlichende -- hat genau dieses Recht NICHT. Ueber den
    // Nutzer-Client kaeme die Verzeichnisperson leer zurueck, computeMediaGateBlockersForPostVersion
    // leitet daraus subjectIsMinor=false und personLeft=false ab und die Pruefung faellt still
    // offen -- ausgerechnet fuer die beiden Faelle, die zwischen Freigabe und Ausfuehrung neu
    // entstehen koennen (Minderjaehrige ohne Guardian, ausgetretene Person bei
    // consentExpiresOnLeave). requirePermission oben hat den Aufrufer bereits autorisiert, und nach
    // aussen geht nur die Liste der Blocker-Namen, keine Verzeichnisdaten -- dasselbe Muster wie das
    // Lesen von guardian_email/social_connection_secrets ueber den Service-Client.
    const service = supabaseClients.forService()
    const policyRows = await fetchPolicyRuleRows(service, publication.data.organization_id as string)
    const policy = { consentExpiresOnLeave: computeRuleEntry(policyRows, 'department', post.data.department_id as string, null).config.policies.consentExpiresOnLeave }
    const gateBlockers = await computeMediaGateBlockersForPostVersion(service, version.data.id as string, post.data.department_id as string, policy)
    const hardBlockers = gateBlockers.filter((blocker) => HARD_PUBLISH_BLOCKERS.includes(blocker))
    if (hardBlockers.length > 0) {
      return reply.code(409).send({ error: 'media_gate_blocked', blockers: hardBlockers, correlationId: request.id })
    }

    // Dieselbe Compare-and-Set-Lehre wie bei consent_records' superseded_by (Paket 015): trifft das
    // update keine Zeile, hat ein gleichzeitiger Aufruf bereits gewonnen -- kein automatischer
    // Retry hier, ein fehlgeschlagener/bereits laufender Versuch braucht eine bewusste
    // Neuveroeffentlichung (aus Scope, siehe plans/025).
    const claim = await service.from('publications').update({ status: 'uploading' }).eq('id', params.id).eq('status', 'queued').select('id').maybeSingle()
    if (claim.error) throw claim.error
    if (!claim.data) return reply.code(409).send({ error: 'invalid_status', correlationId: request.id })

    // Nach dem CAS ist die Zeile beansprucht -- jeder Abbruch vor publisher.publish() muss sie
    // wieder freigeben, sonst haengt sie dauerhaft in 'uploading' und ist per CAS nie wieder
    // erreichbar (Code-Review zu PR #25).
    const releaseClaim = async (): Promise<void> => {
      const release = await service.from('publications').update({ status: 'queued' }).eq('id', params.id).eq('status', 'uploading')
      if (release.error) request.log.error({ err: release.error, correlationId: request.id }, 'publication claim release failed')
    }
    // Jeder erzeugte Grant bliebe sonst die volle TTL abrufbar, auch nach einem laengst
    // abgeschlossenen Veroeffentlichungsversuch -- Medien sind per Vorgabe standardmaessig privat
    // (Code-Review zu PR #25, plans/025 Abschnitt 2).
    const revokeGrants = async (): Promise<void> => {
      const revoke = await service.from('publication_media_grants').update({ revoked_at: new Date().toISOString() }).eq('publication_id', params.id).is('revoked_at', null)
      if (revoke.error) request.log.error({ err: revoke.error, correlationId: request.id }, 'publication_media_grants revoke failed')
    }

    let publicationInput: PublicationInput
    let publisher: SocialPublisher
    let validation: ValidationResult
    let nextAttemptNumber: number
    try {
      const connection = await service.from('social_connections').select('external_account_id').eq('id', publication.data.social_connection_id as string).maybeSingle()
      if (connection.error) throw connection.error
      if (!connection.data) { await releaseClaim(); return reply.code(404).send({ error: 'not_found', correlationId: request.id }) }
      const secretRow = await service.from('social_connection_secrets').select('token_ciphertext, token_key_version').eq('social_connection_id', publication.data.social_connection_id as string).maybeSingle()
      if (secretRow.error) throw secretRow.error
      if (!secretRow.data) { await releaseClaim(); return reply.code(404).send({ error: 'not_found', correlationId: request.id }) }
      const accessToken = createSecretBoxFromEnvironment(environment).open(
        byteaToBuffer(secretRow.data.token_ciphertext as string), secretRow.data.token_key_version as string, publication.data.social_connection_id as string,
      )

      // Ohne die Upload-/Freigabepipeline (Plaene 002/003) hat jede aus Plan 025 entstehende
      // post_version keine post_media-Zeilen -- media bleibt dann []. Nur Instagram lehnt das in
      // validate() unten unconditional ab (technische Plattformgrenze); Facebook/Twitter/LinkedIn
      // erlauben seit Paket 045 einen Text-only-Beitrag (FakePublisher/MetaPublisher, packages/publishing).
      const mediaRows = await service.from('post_media').select('position, media_derivative_id').eq('post_version_id', version.data.id as string).order('position')
      if (mediaRows.error) throw mediaRows.error
      // Ohne diese Basis-URL entstuende eine unbrauchbare Grant-URL (`undefined/v1/media-grants/...`);
      // FakePublisher.validate() prueft grantUrl nicht, der Fehler bliebe sonst bis zum echten
      // Provider unsichtbar (Code-Review zu PR #25).
      if (mediaRows.data.length > 0 && !environment.API_PUBLIC_BASE_URL) {
        await releaseClaim()
        return reply.code(503).send({ error: 'api_public_base_url_not_configured', correlationId: request.id })
      }
      // Vorab in einer Abfrage laden statt je Zeile: ein Karussell mit zehn Bildern erzeugte sonst
      // zehn sequentielle media_derivatives-Abfragen im Anfrage-Thread (Nitpick im Code-Review
      // dieses Pakets). Die Grants sammeln wir ebenso und schreiben sie als ein Batch-Insert.
      const derivativeIds = mediaRows.data.map((row) => row.media_derivative_id as string)
      const derivativeRows = derivativeIds.length > 0
        ? await service.from('media_derivatives').select('id, sha256, mime_type, status').in('id', derivativeIds)
        : { data: [] as { id: string; sha256: string; mime_type: string; status: string }[], error: null as null }
      if (derivativeRows.error) throw derivativeRows.error
      const derivativeById = new Map(derivativeRows.data.map((row) => [row.id as string, row]))

      const media: PublicationMedia[] = []
      const grantRows: { organization_id: string; media_derivative_id: string; publication_id: string; token_hash: string; expires_at: string }[] = []
      for (const row of mediaRows.data) {
        const derivative = derivativeById.get(row.media_derivative_id as string)
        if (!derivative || derivative.status !== 'ready') continue
        const token = randomBytes(32).toString('base64url')
        grantRows.push({
          organization_id: publication.data.organization_id, media_derivative_id: derivative.id, publication_id: params.id,
          token_hash: createHash('sha256').update(token).digest('hex'), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        media.push({
          derivativeId: derivative.id as string, sha256: derivative.sha256 as string, mimeType: derivative.mime_type as string,
          grantUrl: `${environment.API_PUBLIC_BASE_URL}/v1/media-grants/${token}`, role: row.position === 0 ? 'primary' : 'slide',
        })
      }
      if (grantRows.length > 0) {
        const grantInsert = await service.from('publication_media_grants').insert(grantRows)
        if (grantInsert.error) throw grantInsert.error
      }

      publicationInput = {
        publicationId: params.id, postVersionId: version.data.id as string, socialConnectionId: publication.data.social_connection_id as string,
        platform: OAuthPlatformSchema.parse(publication.data.platform) as Platform, caption: version.data.caption as string, media,
        idempotencyKey: publication.data.idempotency_key as string,
      }
      publisher = await createPublisherForConnection(publicationInput.platform, accessToken, connection.data.external_account_id as string)
      validation = await publisher.validate(publicationInput)

      // unique(publication_id, attempt_number) auf publication_attempts -- ein hartkodierter Wert 1
      // wuerde jeden erneuten Versuch derselben Publication an dieser Constraint scheitern lassen
      // (Code-Review zu PR #25).
      const previousAttempt = await service.from('publication_attempts').select('attempt_number').eq('publication_id', params.id).order('attempt_number', { ascending: false }).limit(1).maybeSingle()
      if (previousAttempt.error) throw previousAttempt.error
      nextAttemptNumber = ((previousAttempt.data?.attempt_number as number | undefined) ?? 0) + 1
    } catch (err) {
      await releaseClaim()
      await revokeGrants()
      throw err
    }

    if (!validation.valid) {
      await revokeGrants()
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: 'failed', error_class: 'validation', response_summary: { errors: validation.errors },
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      const markFailed = await service.from('publications').update({ status: 'failed' }).eq('id', params.id)
      if (markFailed.error) request.log.error({ err: markFailed.error, correlationId: request.id }, 'publications status update failed')
      return reply.code(422).send({ error: 'validation_failed', detail: validation.errors, correlationId: request.id })
    }

    try {
      const result = await publisher.publish(publicationInput)
      const markPublished = await service.from('publications').update({ status: result.status, provider_publication_id: result.externalId }).eq('id', params.id)
      if (markPublished.error) request.log.error({ err: markPublished.error, correlationId: request.id }, 'publications status update failed')
      // Auch ein geglueckter Mehrfoto-Ablauf hat mehr erzeugt als die eine externalId: die
      // Facebook-Fotos bleiben eigene, adressierbare Objekte auf der Seite, und die
      // Instagram-Container sind der einzige Beleg, wie der Beitrag zusammengesetzt wurde. Ohne sie
      // im Versuchsdatensatz waere nur das Endergebnis auditiert, nicht die ausgefuehrten Schritte
      // (AGENTS.md: "Externe Aktionen sind idempotent und werden auditiert"). Einstufige Publishes
      // liefern completedSteps nicht -- dort ist die externalId schon der ganze Ablauf.
      const publishedSteps = result.completedSteps ?? []
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: result.status, provider_container_id: result.externalId,
        response_summary: { ...(result.permalink ? { permalink: result.permalink } : {}), ...(publishedSteps.length > 0 ? { completedSteps: publishedSteps } : {}) },
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      await recordAuditEvent(request, {
        organizationId: publication.data.organization_id as string, action: 'post.published', entityType: 'publications', entityId: params.id,
        metadata: {
          platform: publicationInput.platform, status: result.status,
          ...(publishedSteps.length > 0 ? { completedExternalIds: publishedSteps.map((step) => step.externalId) } : {}),
        },
      })
      await revokeGrants()
      return reply.code(200).send(PublicationExecuteResultSchema.parse({ id: params.id, status: result.status, externalId: result.externalId, permalink: result.permalink }))
    } catch (err) {
      // Klassifikation nach Plan 004: MetaPublisher kodiert den HTTP-Status im Fehlertext
      // ("... (404)"), da SocialPublisher.publish() keinen strukturierten Fehler liefert -- ein
      // 4xx vom Provider ist nicht retry-faehig (falsche Eingabe/Berechtigung), 5xx/Netzwerk schon,
      // ein nicht einordbarer Fehler bleibt unbekannt. Dokumentierte Grenze: haengt am
      // Nachrichtenformat von MetaPublisher, kein strukturierter Fehlertyp ueber SocialPublisher
      // (siehe plans/025, Abschnitt "Umsetzung: Ergebnis und Abweichungen vom Plan").
      const httpStatus = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined
      // Der Mehrfoto-Fluss (Plan 047, PR 2) macht N+2 Graph-Aufrufe statt einem. Scheitert einer
      // davon, existieren die Objekte der Schritte davor trotzdem bei Meta -- ihre IDs stehen nur
      // in diesem Fehler und waeren danach unwiederbringlich weg. Sie gehoeren in den
      // Versuchsdatensatz, sonst ist nach einem Abbruch nicht mehr feststellbar, was drueben liegt
      // (AGENTS.md: "Externe Aktionen sind idempotent und werden auditiert"). Ein automatischer
      // Retry entsteht dadurch nicht -- der CAS oben laesst nur eine bewusste Neuveroeffentlichung zu.
      const completedSteps = err instanceof MetaPublishError ? err.completedSteps : []
      const classification: { errorClass: 'non_retryable' | 'retryable' | 'unknown'; status: 'failed' | 'action_required' } =
        httpStatus && Number(httpStatus) >= 400 && Number(httpStatus) < 500 ? { errorClass: 'non_retryable', status: 'failed' }
        : httpStatus && Number(httpStatus) >= 500 ? { errorClass: 'retryable', status: 'action_required' }
        : { errorClass: 'unknown', status: 'action_required' }
      const markStatus = await service.from('publications').update({ status: classification.status }).eq('id', params.id)
      if (markStatus.error) request.log.error({ err: markStatus.error, correlationId: request.id }, 'publications status update failed')
      const attemptInsert = await service.from('publication_attempts').insert({
        organization_id: publication.data.organization_id, publication_id: params.id, attempt_number: nextAttemptNumber,
        status: 'failed', error_class: classification.errorClass,
        response_summary: { message: err instanceof Error ? err.message : 'unknown_error', ...(completedSteps.length > 0 ? { completedSteps } : {}) },
      })
      if (attemptInsert.error) request.log.error({ err: attemptInsert.error, correlationId: request.id }, 'publication_attempts insert failed')
      await recordAuditEvent(request, {
        organizationId: publication.data.organization_id as string,
        action: 'post.publish_failed',
        entityType: 'publications',
        entityId: params.id,
        metadata: {
          platform: publicationInput.platform, outcome: classification.errorClass, status: classification.status,
          ...(completedSteps.length > 0 ? { completedExternalIds: completedSteps.map((step) => step.externalId) } : {}),
        },
      })
      await revokeGrants()
      return reply.code(502).send({ error: 'publish_failed', correlationId: request.id })
    }
  })

  // Kein requireAuth: Meta ruft diese URL serverseitig ab (Plan 006, Abschnitt "Sichere
  // Medienuebergabe"). Nach demselben Muster wie die oeffentlichen Einwilligungs-Token-Seiten aus
  // Paket 015 -- Service Role fuer den Lookup, Hash- statt Rohtoken-Vergleich, keine Unterscheidung
  // zwischen ungueltig/abgelaufen/bereits widerrufen.
  app.get('/v1/media-grants/:token', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow')
    // Wie die oeffentlichen Einwilligungs-Token-Seiten aus Paket 015 (checkRateLimit, weiter unten
    // in derselben Funktion definiert, aber zur Aufrufzeit laengst initialisiert): ohne Limit loest
    // jeder Aufruf eine unauthentifizierte DB-Abfrage und potenziell einen Storage-Download aus.
    if (!checkRateLimit(`media-grant:${request.ip}`, 60, 60_000)) {
      return reply.code(429).send({ error: 'rate_limited', correlationId: request.id })
    }
    const params = z.object({ token: z.string().min(1) }).parse(request.params)
    const service = supabaseClients.forService()
    const tokenHash = createHash('sha256').update(params.token).digest('hex')
    const grant = await service.from('publication_media_grants').select('media_derivative_id, expires_at, revoked_at').eq('token_hash', tokenHash).maybeSingle()
    if (grant.error) throw grant.error
    if (!grant.data || grant.data.revoked_at !== null || new Date(grant.data.expires_at as string).getTime() < Date.now()) {
      return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    }
    const derivative = await service.from('media_derivatives').select('bucket_id, object_path, mime_type, status').eq('id', grant.data.media_derivative_id as string).maybeSingle()
    if (derivative.error) throw derivative.error
    if (!derivative.data || derivative.data.status !== 'ready') return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const download = await service.storage.from(derivative.data.bucket_id as string).download(derivative.data.object_path as string)
    if (download.error || !download.data) return reply.code(404).send({ error: 'not_found', correlationId: request.id })
    const markAccessed = await service.from('publication_media_grants').update({ accessed_at: new Date().toISOString() }).eq('token_hash', tokenHash)
    if (markAccessed.error) request.log.error({ err: markAccessed.error, correlationId: request.id }, 'publication_media_grants accessed_at update failed')
    const bytes = Buffer.from(await download.data.arrayBuffer())
    return reply
      .header('content-type', derivative.data.mime_type as string)
      .header('content-length', bytes.byteLength)
      .header('x-content-type-options', 'nosniff')
      .send(bytes)
  })
}
