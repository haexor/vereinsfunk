<script setup lang="ts">
import { TextWorkshopDraftRowSchema } from '@vereinsfunk/contracts'
import { z } from 'zod'
const scope = await useScope()
const api = useApiClient()
const posts = ref<{ id: string; status: string; created_at: string; current_version_id: string | null }[]>([])
const workshopDrafts = ref<z.infer<typeof TextWorkshopDraftRowSchema>[]>([])
const postsLoading = ref(true)
const workshopDraftsLoading = ref(false)
const postsError = ref<string | null>(null)
const workshopDraftsError = ref<string | null>(null)
// draft_ready/changes_requested haben noch keine (gueltige) Freigabeanfrage laufen -- /freigaben
// zeigt nur, was gerade auf eine Entscheidung der aufrufenden Person wartet, und wertet
// postVersionId nicht aus. Fuer diese beiden Stati fuehrt der Weg zurueck in die Textwerkstatt,
// wo die Sitzung des Beitrags vorausgefuellt weitergefuehrt werden kann.
const RESUMABLE_IN_TEXTWORKSHOP = new Set(['draft_ready', 'changes_requested'])
// Deckungsgleich mit delete_post_if_deletable (Migration 2026082408): loeschbar ist nur, was noch
// keine Freigabeanfrage durchlaufen hat.
const DELETABLE_POST_STATUSES = new Set(['draft', 'facts_required', 'generating', 'draft_ready', 'changes_requested'])
function postHref(post: { id: string; status: string; current_version_id: string | null }) {
  if (RESUMABLE_IN_TEXTWORKSHOP.has(post.status)) return `/erstellen?postId=${post.id}`
  return post.current_version_id ? `/freigaben?postVersionId=${post.current_version_id}` : '/erstellen'
}
function draftLabel(draft: z.infer<typeof TextWorkshopDraftRowSchema>) {
  const firstFact = draft.payload.factsText.split('\n').find((line) => line.trim())
  return firstFact?.split(':').slice(1).join(':').trim() || draft.payload.observation.trim() || 'Textwerkstatt-Entwurf'
}
if (scope.value?.organizationId) {
  const query = useSupabaseClient().from('posts').select('id, status, created_at, current_version_id').eq('organization_id', scope.value.organizationId).order('created_at', { ascending: false })
  if (scope.value.departmentId) query.eq('department_id', scope.value.departmentId)
  const result = await query
  if (result.error) postsError.value = 'Beiträge konnten nicht geladen werden. Bitte versuche es erneut.'
  else { posts.value = result.data; postsError.value = null }
  postsLoading.value = false
  workshopDraftsLoading.value = true
  try {
    const result = await api.request('/v1/text-workshop/drafts', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId ?? undefined } }, z.object({ drafts: z.array(TextWorkshopDraftRowSchema) }))
    workshopDrafts.value = result.drafts
  } catch { workshopDraftsError.value = 'Entwürfe konnten nicht geladen werden. Bitte versuche es erneut.' }
  finally { workshopDraftsLoading.value = false }
} else postsLoading.value = false

const deletingId = ref<string | null>(null)
const deleteError = ref('')
async function deletePost(post: { id: string }) {
  if (!confirm('Entwurf wirklich löschen?')) return
  deletingId.value = post.id
  deleteError.value = ''
  try {
    await api.request(`/v1/posts/${post.id}`, { method: 'DELETE' })
    posts.value = posts.value.filter((p) => p.id !== post.id)
  } catch {
    deleteError.value = 'Der Entwurf konnte nicht gelöscht werden.'
  } finally {
    deletingId.value = null
  }
}
async function deleteWorkshopDraft(draft: z.infer<typeof TextWorkshopDraftRowSchema>) {
  if (!confirm(`"${draftLabel(draft)}" wirklich löschen?`)) return
  deletingId.value = draft.id
  deleteError.value = ''
  try {
    await api.request(`/v1/text-workshop/drafts/${draft.id}`, { method: 'DELETE' })
    workshopDrafts.value = workshopDrafts.value.filter((d) => d.id !== draft.id)
  } catch {
    deleteError.value = 'Der Entwurf konnte nicht gelöscht werden.'
  } finally {
    deletingId.value = null
  }
}
</script>
<template>
  <div>
    <header class="mb-8 flex items-end justify-between">
      <div>
        <div class="eyebrow mb-3">Content</div>
        <h1 class="font-display text-3xl font-extrabold">Beiträge</h1>
        <p class="mt-2 text-sm text-[#727a75]">Entwürfe und ihre aktuellen Versionen.</p>
      </div>
      <NuxtLink to="/erstellen" class="rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white">Beitrag erstellen</NuxtLink>
    </header>
    <p v-if="deleteError" class="mb-4 text-sm text-amber-800">{{ deleteError }}</p>
    <div class="card divide-y">
      <p v-if="postsLoading" class="p-8 text-sm text-[#727a75]">Lade Beiträge …</p>
      <p v-else-if="postsError" class="p-5 text-sm text-red-700">{{ postsError }}</p>
      <div v-for="post in posts" :key="post.id" class="flex items-center justify-between gap-3 p-5 hover:bg-[#fafaf7]">
        <NuxtLink :to="postHref(post)" class="min-w-0 flex-1">
          <strong class="text-sm">Entwurf</strong>
          <span class="ml-3 text-xs text-[#737a75]">{{ post.status }}</span>
          <time class="ml-3 text-xs text-[#737a75]">{{ new Date(post.created_at).toLocaleDateString('de-DE') }}</time>
        </NuxtLink>
        <button
          v-if="DELETABLE_POST_STATUSES.has(post.status)" type="button" :disabled="deletingId === post.id"
          class="focus-ring shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
          @click="deletePost(post)"
        >
          {{ deletingId === post.id ? 'Wird gelöscht …' : 'Löschen' }}
        </button>
      </div>
      <p v-if="workshopDraftsLoading" class="p-5 text-sm text-[#727a75]">Lade Entwürfe …</p>
      <p v-else-if="workshopDraftsError" class="p-5 text-sm text-red-700">{{ workshopDraftsError }}</p>
      <div v-for="draft in workshopDrafts" :key="`workshop-${draft.id}`" class="flex items-center justify-between gap-3 p-5 hover:bg-[#fafaf7]">
        <NuxtLink :to="`/erstellen?draftId=${draft.id}`" class="min-w-0 flex-1">
          <strong class="text-sm">{{ draftLabel(draft) }}</strong>
          <span class="ml-3 text-xs text-[#737a75]">Entwurf</span>
          <time class="ml-3 text-xs text-[#737a75]">{{ new Date(draft.updated_at).toLocaleDateString('de-DE') }}</time>
        </NuxtLink>
        <button
          type="button" :disabled="deletingId === draft.id"
          class="focus-ring shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
          @click="deleteWorkshopDraft(draft)"
        >
          {{ deletingId === draft.id ? 'Wird gelöscht …' : 'Löschen' }}
        </button>
      </div>
      <p v-if="!postsLoading && !workshopDraftsLoading && !postsError && !workshopDraftsError && !posts.length && !workshopDrafts.length" class="p-12 text-center text-sm text-[#7b827d]">Noch keine Beiträge. Starte in der Textwerkstatt.</p>
    </div>
  </div>
</template>
