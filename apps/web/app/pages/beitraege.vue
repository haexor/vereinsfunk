<script setup lang="ts">
import { MediaAssetSummarySchema, TextWorkshopDraftRowSchema, type MediaAssetSummary } from '@vereinsfunk/contracts'
import { z } from 'zod'
const api = useApiClient()
const { organizationId: activeOrganizationId, departmentId: activeDepartmentId } = await useActiveScope()
const posts = ref<{ id: string; status: string; created_at: string; current_version_id: string | null }[]>([])
const workshopDrafts = ref<z.infer<typeof TextWorkshopDraftRowSchema>[]>([])
const postsLoading = ref(true)
const workshopDraftsLoading = ref(false)
const postsError = ref<string | null>(null)
const workshopDraftsError = ref<string | null>(null)
const mediaAssets = ref<MediaAssetSummary[]>([])
const mediaLoading = ref(false)
const mediaError = ref<string | null>(null)
const onlyMyMedia = ref(false)
// Die Sidebar wechselt Verein/Abteilung ohne Remount dieser Seite. Nur der zuletzt gestartete Lauf
// darf schreiben -- sonst standen Beitraege des vorigen Bereichs neben Medien des neuen.
const mediaRuns = useLatestRequest()
async function loadMedia() {
  const organizationId = activeOrganizationId.value
  if (!organizationId) return
  const isLatest = mediaRuns.begin()
  mediaLoading.value = true
  mediaError.value = null
  try {
    const assets = await api.request('/v1/media-assets', {
      query: { organizationId, departmentId: activeDepartmentId.value ?? undefined, createdBy: onlyMyMedia.value ? 'me' : undefined },
    }, z.array(MediaAssetSummarySchema))
    if (isLatest()) mediaAssets.value = assets
  } catch {
    if (isLatest()) mediaError.value = 'Medien konnten nicht geladen werden. Bitte versuche es erneut.'
  } finally {
    if (isLatest()) mediaLoading.value = false
  }
}
watch(onlyMyMedia, () => void loadMedia())
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
const { ready } = useScopedLoad(() => `${activeOrganizationId.value}:${activeDepartmentId.value}`, async (_key, isLatest) => {
  const organizationId = activeOrganizationId.value
  const departmentId = activeDepartmentId.value
  // Auch laufende Medien-Anfragen des vorigen Bereichs verwerfen, bevor loadMedia() unten startet.
  mediaRuns.begin()
  posts.value = []; workshopDrafts.value = []; mediaAssets.value = []
  postsError.value = null; workshopDraftsError.value = null; mediaError.value = null
  workshopDraftsLoading.value = false; mediaLoading.value = false
  if (!organizationId) { postsLoading.value = false; return }
  postsLoading.value = true
  const query = useSupabaseClient().from('posts').select('id, status, created_at, current_version_id').eq('organization_id', organizationId).order('created_at', { ascending: false })
  if (departmentId) query.eq('department_id', departmentId)
  const result = await query
  if (!isLatest()) return
  if (result.error) postsError.value = 'Beiträge konnten nicht geladen werden. Bitte versuche es erneut.'
  else posts.value = result.data
  postsLoading.value = false
  workshopDraftsLoading.value = true
  try {
    const result = await api.request('/v1/text-workshop/drafts', { query: { organizationId, departmentId: departmentId ?? undefined } }, z.object({ drafts: z.array(TextWorkshopDraftRowSchema) }))
    if (!isLatest()) return
    workshopDrafts.value = result.drafts
  } catch { if (isLatest()) workshopDraftsError.value = 'Entwürfe konnten nicht geladen werden. Bitte versuche es erneut.' }
  finally { if (isLatest()) workshopDraftsLoading.value = false }
  if (!isLatest()) return
  await loadMedia()
})
await ready

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

    <div class="mt-8 flex items-center justify-between">
      <h2 class="font-display text-xl font-extrabold">Medien</h2>
      <label class="flex items-center gap-2 text-xs font-semibold text-[#435047]">
        <input v-model="onlyMyMedia" type="checkbox" class="rounded border-[#dfe2da]" /> Nur meine
      </label>
    </div>
    <p class="mt-1 text-sm text-[#727a75]">Bereits erzeugte Fotos und Videos. Bilder lassen sich in einem neuen Beitrag wiederverwenden.</p>
    <div class="card mt-4 p-5">
      <p v-if="mediaLoading" class="text-sm text-[#727a75]">Lade Medien …</p>
      <p v-else-if="mediaError" class="text-sm text-red-700">{{ mediaError }}</p>
      <p v-else-if="!mediaAssets.length" class="text-sm text-[#7b827d]">Noch keine Medien vorhanden.</p>
      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <div v-for="asset in mediaAssets" :key="asset.id" class="group relative aspect-square overflow-hidden rounded-xl border border-[#e1e2db]">
          <img v-if="asset.signedUrl" :src="asset.signedUrl" class="h-full w-full object-cover" alt="" />
          <span v-else class="grid h-full w-full place-items-center bg-[#f2f4ee] text-[#727a75]"><component :is="iconForMimeType(asset.mimeType)" :size="24" /></span>
          <NuxtLink
            v-if="asset.mimeType.startsWith('image/') && asset.peopleReviewedAt" :to="`/erstellen?mediaAssetId=${asset.id}`"
            class="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1.5 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100"
          >
            In neuem Beitrag verwenden
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
