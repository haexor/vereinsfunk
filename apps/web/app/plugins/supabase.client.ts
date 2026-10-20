import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const supabase = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey, {
    auth: { persistSession: true, detectSessionInUrl: true },
  })

  // Kein Sicherheitsmechanismus, nur ein Hinweis fuer die serverseitige Middleware-Vorpruefung.
  // Die Sitzung selbst liegt dauerhaft im localStorage. Als Sitzungs-Cookie ohne maxAge ginge der
  // Hinweis beim Browser-Neustart verloren und die Middleware schickte eine weiterhin angemeldete
  // Person serverseitig auf /anmelden. Refresh-Tokens laufen ohne Session-Timebox
  // (supabase/config.toml) nicht ab, deshalb gilt der Hinweis so lange, wie Browser ein Cookie
  // hoechstens halten (400 Tage); refresh verlaengert ihn bei jedem Auth-Ereignis.
  const sessionMarker = useCookie<boolean | null>('sb-session', {
    sameSite: 'lax',
    secure: window.location.protocol === 'https:',
    maxAge: 400 * 24 * 60 * 60,
    refresh: true,
    default: () => null,
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    sessionMarker.value = session ? true : null
  })

  return { provide: { supabase } }
})

declare module '#app' {
  interface NuxtApp {
    $supabase: SupabaseClient
  }
}
