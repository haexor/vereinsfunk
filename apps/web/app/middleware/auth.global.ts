// /einladung ist bewusst oeffentlich: die Seite selbst entscheidet je nach Session, ob sie
// sofort annimmt oder zu /registrieren bzw. /anmelden weiterleitet (siehe pages/einladung.vue).
// /plattform-admin-einladung ist aus demselben Grund oeffentlich (siehe
// pages/plattform-admin-einladung.vue): die eingeladene Person ist vor der Annahme weder
// Vereinsmitglied noch Plattform-Admin und muss die Seite erreichen, bevor der
// Onboarding-Redirect unten oder die Plattform-Admin-Weiche (Zeile 34) greift.
// Paket 020: /impressum und /datenschutz sind die Rechtstexte von Vereinsfunk als Produkt --
// exakter Pfad, damit /datenschutz/anfragen (die authentifizierte Betroffenenanfragen-Seite)
// weiterhin geschuetzt bleibt.
const publicPaths = new Set(['/anmelden', '/registrieren', '/passwort-vergessen', '/passwort-neu', '/auth/callback', '/einladung', '/plattform-admin-einladung', '/impressum', '/datenschutz'])
// Paket 015: /einwilligung/[token] und /einwilligung/widerruf/[token] haben kein Vereinskonto als
// Zielgruppe (Erziehungsberechtigte) -- Praefix statt exaktem Pfad, weil das Token Teil der Route ist.
// Mit Schraegstrich, sonst trifft das Praefix auch /einwilligungen (die authentifizierte
// Verwaltungsseite, gefunden im Code-Review). Paket 020: /impressum/[organizationId] ist das
// oeffentliche Impressum eines einzelnen Vereins, verlinkt aus dessen Instagram-/Facebook-Bio --
// ebenfalls ohne Vereinskonto als Zielgruppe.
const publicPathPrefixes = ['/einwilligung/', '/impressum/']

export default defineNuxtRouteMiddleware(async (to) => {
  if (publicPaths.has(to.path) || publicPathPrefixes.some((prefix) => to.path.startsWith(prefix))) return

  // Nur ein Hinweis, keine Sicherheitspruefung -- siehe supabase.client.ts. Echte
  // Durchsetzung liegt in RLS und in der Fastify-API.
  const hasSessionHint = useCookie<boolean | null>('sb-session').value
  if (!hasSessionHint) return navigateTo({ path: '/anmelden', query: { redirect: to.fullPath } })

  // Die eigentliche Sitzung existiert nur clientseitig (supabase.client.ts). Serverseitig
  // verlaesst sich die Middleware ausschliesslich auf den Cookie-Hinweis oben.
  if (import.meta.server) return

  const session = await useSession()
  if (!session.value) return navigateTo({ path: '/anmelden', query: { redirect: to.fullPath } })

  // Der Plattform-Admin ist der Betreiber, kein Vereinsnutzer: sein Konto kann seit
  // 2026080602_platform_admin_separation.sql ueberhaupt keine Vereinsmitgliedschaft mehr
  // halten. Damit hat es weder in der Vereinsoberflaeche noch im Onboarding-Wizard etwas
  // verloren -- der gesamte Vereinsteil der App liegt hinter dieser Weiche.
  if (session.value.isPlatformAdmin) {
    if (!to.path.startsWith('/plattform-admin')) return navigateTo('/plattform-admin')
    return
  }
  if (to.path.startsWith('/plattform-admin')) return navigateTo('/')

  if (to.path !== '/onboarding' && session.value.scopes.length === 0) return navigateTo('/onboarding')
})
