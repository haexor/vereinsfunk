<script setup lang="ts">
import { z } from 'zod'
const scope = await useScope()
const api = useApiClient()
const posts = ref<{ id: string; status: string; created_at: string; current_version_id: string | null }[]>([])
const workshopDrafts = ref<{ id: string; created_at: string; updated_at: string; payload: { factsText: string; observation: string; quote: string } }[]>([])
const loading = ref(true)
const errorMessage = ref<string | null>(null)
// draft_ready/changes_requested haben noch keine (gueltige) Freigabeanfrage laufen -- /freigaben
// zeigt nur, was gerade auf eine Entscheidung der aufrufenden Person wartet, und wertet
// postVersionId nicht aus. Fuer diese beiden Stati fuehrt der Weg zurueck in die Textwerkstatt,
// wo die Sitzung des Beitrags vorausgefuellt weitergefuehrt werden kann.
const RESUMABLE_IN_TEXTWORKSHOP = new Set(['draft_ready', 'changes_requested'])
function postHref(post: { id: string; status: string; current_version_id: string | null }) {
  if (RESUMABLE_IN_TEXTWORKSHOP.has(post.status)) return `/erstellen?postId=${post.id}`
  return post.current_version_id ? `/freigaben?postVersionId=${post.current_version_id}` : '/erstellen'
}
function draftLabel(draft: { payload: { factsText: string; observation: string; quote: string } }) {
  const firstFact = draft.payload.factsText.split('\n').find((line) => line.trim())
  return firstFact?.split(':').slice(1).join(':').trim() || draft.payload.observation.trim() || draft.payload.quote.trim() || 'Textwerkstatt-Entwurf'
}
if (scope.value?.organizationId) {
  const query = useSupabaseClient().from('posts').select('id, status, created_at, current_version_id').eq('organization_id', scope.value.organizationId).order('created_at', { ascending: false })
  if (scope.value.departmentId) query.eq('department_id', scope.value.departmentId)
  const result = await query
  if (result.error) errorMessage.value = 'Beiträge konnten nicht geladen werden. Bitte versuche es erneut.'
  else { posts.value = result.data; errorMessage.value = null }
  if (scope.value.departmentId) {
    try {
      const result = await api.request('/v1/text-workshop/drafts', { query: { organizationId: scope.value.organizationId, departmentId: scope.value.departmentId } }, z.object({ drafts: z.array(z.object({ id: z.string(), created_at: z.string(), updated_at: z.string(), payload: z.object({ factsText: z.string(), observation: z.string(), quote: z.string() }) })) }))
      workshopDrafts.value = result.drafts
    } catch { errorMessage.value ??= 'Entwürfe konnten nicht vollständig geladen werden. Bitte versuche es erneut.' }
  }
}
loading.value = false
</script>
<template>
  <div><header class="mb-8 flex items-end justify-between"><div><div class="eyebrow mb-3">Content</div><h1 class="font-display text-3xl font-extrabold">Beiträge</h1><p class="mt-2 text-sm text-[#727a75]">Entwürfe und ihre aktuellen Versionen.</p></div><NuxtLink to="/erstellen" class="rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white">Beitrag erstellen</NuxtLink></header><div class="card divide-y"><p v-if="loading" class="p-8 text-sm text-[#727a75]">Lade Beiträge …</p><p v-else-if="errorMessage" class="p-8 text-sm text-red-700">{{ errorMessage }}</p><NuxtLink v-for="draft in workshopDrafts" :key="`workshop-${draft.id}`" :to="`/erstellen?draftId=${draft.id}`" class="block p-5 hover:bg-[#fafaf7]"><strong class="text-sm">{{ draftLabel(draft) }}</strong><span class="ml-3 text-xs text-[#737a75]">Entwurf</span><time class="ml-3 text-xs text-[#737a75]">{{ new Date(draft.updated_at).toLocaleDateString('de-DE') }}</time></NuxtLink><NuxtLink v-for="post in posts" :key="post.id" :to="postHref(post)" class="block p-5 hover:bg-[#fafaf7]"><strong class="text-sm">Entwurf</strong><span class="ml-3 text-xs text-[#737a75]">{{ post.status }}</span><time class="ml-3 text-xs text-[#737a75]">{{ new Date(post.created_at).toLocaleDateString('de-DE') }}</time></NuxtLink><p v-if="!loading && !errorMessage && !posts.length && !workshopDrafts.length" class="p-12 text-center text-sm text-[#7b827d]">Noch keine Beiträge. Starte in der Textwerkstatt.</p></div></div>
</template>
