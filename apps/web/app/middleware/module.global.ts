import { moduleForPath } from '../modules/registry'

// Paket 051, PR 3: eine Route eines im aktiven Arbeitsbereich abgeschalteten Moduls fuehrt auf
// eine erklaerende Seite statt auf einen leeren Bildschirm oder eine Kette von 403-Fehlern.
// Laeuft nach auth.global.ts (alphabetisch) und nur im Browser, wo Sitzung und Arbeitsbereich
// existieren. Komfort, keine Sicherheit -- durchgesetzt wird in der API.
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  const module = moduleForPath(to.path)
  if (!module) return
  // Vor dem ersten await starten: useScopeModules() greift synchron auf den Nuxt-Zustand zu, der
  // nach einem await in einer Middleware nicht mehr sicher erreichbar ist (NUXT_E1001).
  const scopeModules = useScopeModules()
  const session = await useSession()
  if (!session.value || session.value.isPlatformAdmin || session.value.scopes.length === 0) return

  const { ensureLoaded, isEnabled } = await scopeModules
  await ensureLoaded()
  if (isEnabled(module)) return
  return navigateTo({ path: '/modul-inaktiv', query: { modul: module, von: to.fullPath } })
})
