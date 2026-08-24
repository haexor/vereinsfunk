<script setup lang="ts">
import {
  AgentConversationDetailSchema,
  AgentConversationSchema,
  AgentActionProposalSchema,
  AgentWorkspaceSchema,
  type AgentActionProposal,
  type AgentConversation,
  type AgentMessage,
  type AgentWorkspace,
} from '@vereinsfunk/contracts'
import { ArrowUp, Bot, CalendarDays, CheckCircle2, FileText, LoaderCircle, Sparkles, UserPlus, X } from '@lucide/vue'
import { z } from 'zod'

const scope = await useScope()
const api = useApiClient()
const workspace = ref<AgentWorkspace | null>(null)
const conversation = ref<AgentConversation | null>(null)
const messages = ref<AgentMessage[]>([])
const proposals = ref<AgentActionProposal[]>([])
const prompt = ref('')
const loading = ref(true)
const sending = ref(false)
const actingProposalId = ref<string | null>(null)
const errorMessage = ref('')
const cachedConversation = useState<{ scopeKey: string; id: string } | null>('vf-agent-conversation', () => null)
let initializeRun = 0
let sendRun = 0

const scopeInput = computed(() => {
  if (!scope.value) return null
  return { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId }
})
const scopeLabel = computed(() => scope.value?.departmentId ? 'deiner Abteilung' : 'deinem Verein')
const scopeKey = computed(() => scopeInput.value ? `${scopeInput.value.organizationId}:${scopeInput.value.departmentId ?? ''}` : '')

async function initialize() {
  const run = ++initializeRun
  ++sendRun
  const input = scopeInput.value
  const expectedScopeKey = scopeKey.value
  const previousCachedConversation = cachedConversation.value
  workspace.value = null
  conversation.value = null
  messages.value = []
  proposals.value = []
  cachedConversation.value = null
  sending.value = false
  if (!input) { loading.value = false; return }
  loading.value = true
  errorMessage.value = ''
  const isCurrent = () => run === initializeRun && expectedScopeKey === scopeKey.value
  try {
    const loadedWorkspace = await api.request('/v1/agent/workspace', { query: input }, AgentWorkspaceSchema)
    if (!isCurrent()) return
    workspace.value = loadedWorkspace
    if (previousCachedConversation?.scopeKey === expectedScopeKey) {
      try {
        const detail = await api.request(`/v1/agent/conversations/${previousCachedConversation.id}`, {}, AgentConversationDetailSchema)
        if (!isCurrent()) return
        conversation.value = detail.conversation
        messages.value = detail.messages
        const loadedProposals = await api.request(`/v1/agent/conversations/${detail.conversation.id}/action-proposals`, {}, z.array(AgentActionProposalSchema))
        if (!isCurrent() || conversation.value?.id !== detail.conversation.id) return
        proposals.value = loadedProposals
        return
      } catch {
        if (!isCurrent()) return
        cachedConversation.value = null
      }
    }
    const createdConversation = await api.request('/v1/agent/conversations', { method: 'POST', body: input }, AgentConversationSchema)
    if (!isCurrent()) return
    conversation.value = createdConversation
    cachedConversation.value = { scopeKey: expectedScopeKey, id: createdConversation.id }
    messages.value = [{ id: `welcome-${createdConversation.id}`, conversationId: createdConversation.id, organizationId: createdConversation.organizationId, role: 'assistant', content: `Hallo! Ich habe den Überblick zu ${scopeLabel.value} geladen. Wobei soll ich dir helfen?`, createdAt: new Date().toISOString() }]
  } catch {
    if (!isCurrent()) return
    errorMessage.value = 'Der Assistent konnte nicht geladen werden. Bitte versuche es erneut.'
  } finally {
    if (isCurrent()) loading.value = false
  }
}

await initialize()
watch(scopeInput, () => void initialize(), { deep: true })

async function send() {
  const content = prompt.value.trim()
  if (!content || !conversation.value || sending.value) return
  const run = ++sendRun
  const expectedInitializeRun = initializeRun
  const expectedScopeKey = scopeKey.value
  const conversationId = conversation.value.id
  const isCurrent = () => run === sendRun
    && expectedInitializeRun === initializeRun
    && expectedScopeKey === scopeKey.value
    && conversation.value?.id === conversationId
  sending.value = true
  errorMessage.value = ''
  prompt.value = ''
  try {
    const detail = await api.request(
      `/v1/agent/conversations/${conversationId}/messages`,
      { method: 'POST', body: { content } },
      AgentConversationDetailSchema,
    )
    if (!isCurrent()) return
    conversation.value = detail.conversation
    messages.value = detail.messages
    const loadedProposals = await api.request(`/v1/agent/conversations/${conversationId}/action-proposals`, {}, z.array(AgentActionProposalSchema))
    if (!isCurrent()) return
    proposals.value = loadedProposals
    if (scopeInput.value) {
      const refreshedWorkspace = await api.request('/v1/agent/workspace', { query: scopeInput.value }, AgentWorkspaceSchema)
      if (!isCurrent()) return
      workspace.value = refreshedWorkspace
    }
  } catch {
    if (!isCurrent()) return
    prompt.value = content
    errorMessage.value = 'Die Nachricht konnte nicht verarbeitet werden. Es wurde keine Aktion ausgeführt.'
  } finally {
    if (isCurrent()) sending.value = false
  }
}

async function refreshActionProposals() {
  if (!conversation.value) return
  const conversationId = conversation.value.id
  const loadedProposals = await api.request(`/v1/agent/conversations/${conversationId}/action-proposals`, {}, z.array(AgentActionProposalSchema))
  if (conversation.value?.id !== conversationId) return
  proposals.value = loadedProposals
}

async function actOnProposal(proposal: AgentActionProposal, action: 'confirm' | 'cancel') {
  if (proposal.status !== 'pending' || actingProposalId.value) return
  actingProposalId.value = proposal.id
  errorMessage.value = ''
  try {
    await api.request(`/v1/agent/action-proposals/${proposal.id}/${action}`, { method: 'POST' }, AgentActionProposalSchema)
    await Promise.all([
      refreshActionProposals(),
      scopeInput.value ? api.request('/v1/agent/workspace', { query: scopeInput.value }, AgentWorkspaceSchema).then((value) => { workspace.value = value }) : Promise.resolve(),
    ])
  } catch {
    errorMessage.value = action === 'confirm' ? 'Die Aktion konnte nicht bestätigt werden. Es wurde nichts erneut ausgeführt.' : 'Der Vorschlag konnte nicht verworfen werden.'
  } finally {
    actingProposalId.value = null
  }
}

function proposalTitle(proposal: AgentActionProposal) {
  const input = proposal.input as { title?: string; email?: string; role?: string }
  return proposal.toolName === 'create_event'
    ? `Termin: ${input.title ?? 'Ohne Titel'}`
    : `Einladung: ${input.email ?? 'Unbekannte E-Mail'}`
}

function proposalDescription(proposal: AgentActionProposal) {
  const input = proposal.input as { startsAt?: string; role?: string }
  return proposal.toolName === 'create_event'
    ? `Beginn: ${formatDate(input.startsAt ?? null)}`
    : `Rolle: ${input.role ?? '—'} · Der Versand startet erst nach deiner Bestätigung.`
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Ohne Termin'
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="eyebrow mb-3">Arbeitsplatz</div>
        <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Vereinsassistent</h1>
        <p class="mt-2 text-sm text-[#727a75]">Organisiere deine Arbeit im Chat. Änderungen und Veröffentlichungen werden immer erst bestätigt.</p>
      </div>
      <span class="inline-flex items-center gap-2 rounded-full bg-[#edf1e8] px-3 py-1.5 text-xs font-semibold text-[#496052]"><Bot :size="15" /> Aktiver Bereich: {{ scopeLabel }}</span>
    </header>

    <p v-if="errorMessage" class="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{{ errorMessage }}</p>
    <div v-if="loading" class="card grid min-h-80 place-items-center text-sm text-[#727a75]"><LoaderCircle class="animate-spin" :size="20" /> <span class="mt-3">Assistent wird vorbereitet …</span></div>
    <div v-else-if="!scopeInput" class="card p-10 text-center text-sm text-[#727a75]">Wähle zuerst einen Verein oder eine Abteilung aus.</div>
    <div v-else class="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
      <section class="card flex min-h-[620px] flex-col overflow-hidden">
        <div class="flex items-center gap-3 border-b border-[#e7e8e1] px-5 py-4">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-forest text-white"><Sparkles :size="17" /></span>
          <div><h2 class="text-sm font-bold">Vereinsfunk-Assistent</h2><p class="text-xs text-[#727a75]">Bereitet Änderungen vor, die du anschließend bestätigst.</p></div>
        </div>
        <div class="flex-1 space-y-4 overflow-y-auto p-5">
          <article v-for="message in messages" :key="message.id" class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
            <div class="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6" :class="message.role === 'user' ? 'bg-forest text-white' : 'bg-[#f2f4ee] text-[#28372e]'">
              {{ message.content }}
            </div>
          </article>
          <div v-if="sending" class="flex items-center gap-2 text-xs text-[#727a75]"><LoaderCircle class="animate-spin" :size="15" /> Der Assistent prüft den Arbeitsbereich …</div>
        </div>
        <form class="border-t border-[#e7e8e1] p-4" @submit.prevent="send">
          <label class="sr-only" for="assistant-prompt">Nachricht an den Assistenten</label>
          <div class="flex items-end gap-2 rounded-2xl border border-[#dfe2da] bg-white p-2 focus-within:ring-2 focus-within:ring-forest/30">
            <textarea id="assistant-prompt" v-model="prompt" maxlength="4000" rows="2" class="min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm outline-none" placeholder="Zum Beispiel: Welche Freigaben sind offen?" @keydown.enter.exact.prevent="send" />
            <button type="submit" :disabled="!prompt.trim() || sending" class="focus-ring grid h-10 w-10 place-items-center rounded-xl bg-forest text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Nachricht senden"><ArrowUp :size="18" /></button>
          </div>
          <p class="mt-2 px-2 text-[11px] text-[#7a827c]">Termine und Einladungen werden als Karte vorbereitet und erst nach deiner Bestätigung ausgeführt.</p>
        </form>
      </section>

      <aside class="space-y-5">
        <section v-if="proposals.length" class="card p-5">
          <div class="mb-4 flex items-center gap-2"><UserPlus :size="17" class="text-forest" /><h2 class="font-display text-base font-bold">Vorgeschlagene Aktionen</h2></div>
          <div class="space-y-3">
            <article v-for="proposal in proposals" :key="proposal.id" class="rounded-xl border border-[#e2e5de] p-3">
              <p class="text-sm font-semibold">{{ proposalTitle(proposal) }}</p>
              <p class="mt-1 text-xs text-[#727a75]">{{ proposalDescription(proposal) }}</p>
              <p v-if="proposal.status === 'pending'" class="mt-2 text-[11px] text-[#7a827c]">Bestätigbar bis {{ formatDate(proposal.expiresAt) }}</p>
              <p v-else class="mt-2 text-[11px] capitalize text-[#7a827c]">{{ proposal.status.replaceAll('_', ' ') }}</p>
              <div v-if="proposal.status === 'pending'" class="mt-3 flex gap-2">
                <button class="focus-ring inline-flex items-center gap-1 rounded-lg bg-forest px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" :disabled="actingProposalId !== null" @click="actOnProposal(proposal, 'confirm')"><CheckCircle2 :size="14" /> Bestätigen</button>
                <button class="focus-ring inline-flex items-center gap-1 rounded-lg border border-[#dfe2da] px-2.5 py-1.5 text-xs font-semibold text-[#536056] disabled:opacity-50" :disabled="actingProposalId !== null" @click="actOnProposal(proposal, 'cancel')"><X :size="14" /> Verwerfen</button>
              </div>
            </article>
          </div>
        </section>
        <section class="card p-5">
          <div class="mb-4 flex items-center gap-2"><CheckCircle2 :size="17" class="text-forest" /><h2 class="font-display text-base font-bold">Deine offenen Freigaben</h2></div>
          <div v-if="workspace?.pendingApprovals.length" class="space-y-3">
            <NuxtLink v-for="item in workspace.pendingApprovals" :key="item.stageId" to="/freigaben" class="block rounded-xl border border-[#e2e5de] p-3 transition hover:bg-[#f6f8f3]">
              <p class="text-sm font-semibold">{{ item.title || item.label }}</p><p class="mt-1 text-xs text-[#727a75]">{{ item.label }} · {{ formatDate(item.deadlineAt) }}</p>
            </NuxtLink>
          </div>
          <p v-else class="text-sm text-[#727a75]">Keine Freigaben warten auf dich.</p>
        </section>
        <section class="card p-5">
          <div class="mb-4 flex items-center gap-2"><CalendarDays :size="17" class="text-forest" /><h2 class="font-display text-base font-bold">Kommende Termine</h2></div>
          <div v-if="workspace?.events.length" class="space-y-3">
            <NuxtLink v-for="event in workspace.events" :key="event.id" to="/kalender" class="block rounded-xl border border-[#e2e5de] p-3 transition hover:bg-[#f6f8f3]"><p class="text-sm font-semibold">{{ event.title }}</p><p class="mt-1 text-xs text-[#727a75]">{{ formatDate(event.startsAt) }}</p></NuxtLink>
          </div>
          <p v-else class="text-sm text-[#727a75]">Keine kommenden Termine im Bereich.</p>
        </section>
        <section class="card p-5">
          <div class="mb-4 flex items-center gap-2"><FileText :size="17" class="text-forest" /><h2 class="font-display text-base font-bold">Aktuelle Beiträge</h2></div>
          <div v-if="workspace?.posts.length" class="space-y-3">
            <NuxtLink v-for="post in workspace.posts" :key="post.id" to="/beitraege" class="block rounded-xl border border-[#e2e5de] p-3 transition hover:bg-[#f6f8f3]"><p class="text-sm font-semibold">{{ post.title || 'Ohne Titel' }}</p><p class="mt-1 text-xs capitalize text-[#727a75]">{{ post.status.replaceAll('_', ' ') }}</p></NuxtLink>
          </div>
          <p v-else class="text-sm text-[#727a75]">Noch keine Beiträge im Bereich.</p>
        </section>
      </aside>
    </div>
  </div>
</template>
