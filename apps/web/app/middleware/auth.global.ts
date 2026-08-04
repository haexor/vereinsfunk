const publicPaths = new Set(['/anmelden', '/registrieren', '/passwort-vergessen', '/passwort-neu', '/auth/callback'])

export default defineNuxtRouteMiddleware(async (to) => {
  if (publicPaths.has(to.path)) return

  // Nur ein Hinweis, keine Sicherheitspruefung -- siehe supabase.client.ts. Echte
  // Durchsetzung liegt in RLS und in der Fastify-API.
  const hasSessionHint = useCookie<boolean | null>('sb-session').value
  if (!hasSessionHint) return navigateTo({ path: '/anmelden', query: { redirect: to.fullPath } })

  // Die eigentliche Sitzung existiert nur clientseitig (supabase.client.ts). Serverseitig
  // verlaesst sich die Middleware ausschliesslich auf den Cookie-Hinweis oben.
  if (import.meta.server) return

  const session = await useSession()
  if (!session.value) return navigateTo({ path: '/anmelden', query: { redirect: to.fullPath } })
  if (to.path !== '/onboarding' && session.value.scopes.length === 0) return navigateTo('/onboarding')
})
