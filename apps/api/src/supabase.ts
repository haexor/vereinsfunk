import type { ApiEnvironment } from '@vereinsfunk/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function createUserClient(environment: ApiEnvironment, accessToken: string): SupabaseClient {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required to create a user client')
  }
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// RLS-umgehender Zugriff. Jeder Aufruf muss einen eigenen Audit-Eintrag erzeugen.
export function createServiceClient(environment: ApiEnvironment): SupabaseClient {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to create a service client')
  }
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
