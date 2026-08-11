<script setup lang="ts">
const scope = await useScope()
const posts = ref<{ id: string; status: string; created_at: string; current_version_id: string | null }[]>([])
const loading = ref(true)
const errorMessage = ref<string | null>(null)
if (scope.value?.organizationId) {
  const query = useSupabaseClient().from('posts').select('id, status, created_at, current_version_id').eq('organization_id', scope.value.organizationId).order('created_at', { ascending: false })
  if (scope.value.departmentId) query.eq('department_id', scope.value.departmentId)
  const result = await query
  if (result.error) errorMessage.value = 'Beiträge konnten nicht geladen werden. Bitte versuche es erneut.'
  else { posts.value = result.data; errorMessage.value = null }
}
loading.value = false
</script>
<template>
  <div class="mx-auto max-w-[1080px] px-5 py-8 sm:px-10"><header class="mb-8 flex items-end justify-between"><div><div class="eyebrow mb-3">Content</div><h1 class="font-display text-3xl font-extrabold">Beiträge</h1><p class="mt-2 text-sm text-[#727a75]">Entwürfe und ihre aktuellen Versionen.</p></div><NuxtLink to="/erstellen" class="rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white">Beitrag erstellen</NuxtLink></header><div class="card divide-y"><p v-if="loading" class="p-8 text-sm text-[#727a75]">Lade Beiträge …</p><p v-else-if="errorMessage" class="p-8 text-sm text-red-700">{{ errorMessage }}</p><NuxtLink v-for="post in posts" :key="post.id" :to="post.current_version_id ? `/freigaben?postVersionId=${post.current_version_id}` : '/erstellen'" class="block p-5 hover:bg-[#fafaf7]"><strong class="text-sm">Entwurf</strong><span class="ml-3 text-xs text-[#737a75]">{{ post.status }}</span><time class="ml-3 text-xs text-[#737a75]">{{ new Date(post.created_at).toLocaleDateString('de-DE') }}</time></NuxtLink><p v-if="!loading && !errorMessage && !posts.length" class="p-12 text-center text-sm text-[#7b827d]">Noch keine Beiträge. Starte in der Textwerkstatt.</p></div></div>
</template>
