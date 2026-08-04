import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const supabase = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey, {
    auth: { persistSession: true, detectSessionInUrl: true },
  })

  // Kein Sicherheitsmechanismus, nur ein Hinweis fuer die serverseitige Middleware-Vorpruefung.
  const sessionMarker = useCookie<boolean | null>('sb-session', { sameSite: 'lax', default: () => null })
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
