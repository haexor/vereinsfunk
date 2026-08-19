<script setup lang="ts">
import { AddPlatformAdminRequestSchema, PlatformAdminInvitationSchema, PlatformAdminSchema, type PlatformAdmin, type PlatformAdminInvitation } from '@vereinsfunk/contracts'

definePageMeta({ layout: 'admin' })

const config = useRuntimeConfig()
const session = await useSession()
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const newEmail = ref('')
const admins = ref<PlatformAdmin[]>([])
const invitations = ref<PlatformAdminInvitation[]>([])

const INVITE_ERROR_MESSAGES: Record<string, string> = {
  member_cannot_become_platform_admin: 'Dieses Konto ist Mitglied in einem Verein. Betreiber- und Vereinskonten sind getrennt.',
  already_platform_admin: 'Diese Person ist bereits Plattform-Admin.',
  invitation_already_open: 'Für diese Adresse ist bereits eine Einladung offen.',
}

const RESEND_ERROR_MESSAGES: Record<string, string> = {
  resend_rate_limited: 'Diese Einladung wurde vor weniger als einer Stunde versendet. Bitte später erneut versuchen.',
  resend_limit_reached: 'Diese Einladung wurde bereits zehnmal versendet. Bitte die Einladung widerrufen und neu einladen.',
  not_found: 'Diese Einladung ist nicht mehr offen.',
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const [adminsResponse, invitationsResponse] = await Promise.all([
      $fetch(`${config.public.apiBase}/v1/platform-admins`, { headers }),
      $fetch(`${config.public.apiBase}/v1/platform-admin-invitations`, { headers }),
    ])
    admins.value = PlatformAdminSchema.array().parse(adminsResponse)
    invitations.value = PlatformAdminInvitationSchema.array().parse(invitationsResponse)
  } catch {
    errorMessage.value = 'Admins konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}
await load()

async function addAdmin() {
  if (!newEmail.value.trim()) return
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    const body = AddPlatformAdminRequestSchema.parse({ email: newEmail.value })
    await $fetch(`${config.public.apiBase}/v1/platform-admin-invitations`, { method: 'POST', headers, body })
    newEmail.value = ''
    await load()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    errorMessage.value = INVITE_ERROR_MESSAGES[code ?? ''] ?? 'Einladung konnte nicht versendet werden.'
  } finally {
    saving.value = false
  }
}

async function resendInvitation(id: string) {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/platform-admin-invitations/${id}/resend`, { method: 'POST', headers })
    await load()
  } catch (error) {
    const code = (error as { data?: { error?: string } })?.data?.error
    errorMessage.value = RESEND_ERROR_MESSAGES[code ?? ''] ?? 'Einladung konnte nicht erneut versendet werden.'
  } finally {
    saving.value = false
  }
}

async function revokeInvitation(id: string) {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/platform-admin-invitations/${id}/revoke`, { method: 'POST', headers })
    await load()
  } catch {
    errorMessage.value = 'Einladung konnte nicht widerrufen werden.'
  } finally {
    saving.value = false
  }
}

async function removeAdmin(userId: string) {
  saving.value = true
  errorMessage.value = ''
  try {
    const headers = await useAuthHeader()
    await $fetch(`${config.public.apiBase}/v1/platform-admins/${userId}`, { method: 'DELETE', headers })
    await load()
  } catch {
    errorMessage.value = 'Admin konnte nicht entfernt werden.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="mb-8">
      <div class="eyebrow mb-3">Plattform-Administration</div>
      <h1 class="font-display text-3xl font-extrabold tracking-[-.04em]">Plattform-Admins</h1>
      <p class="mt-2 text-sm text-[#727a75]">Nur der Default-Admin darf andere Admins entfernen.</p>
    </header>

    <div v-if="loading" class="p-8 text-center text-xs text-[#7b827d]">Wird geladen …</div>
    <template v-else>
      <section class="card mb-6 p-6">
        <h2 class="mb-4 font-display text-base font-bold">Admin einladen</h2>
        <form class="flex flex-wrap gap-3" @submit.prevent="addAdmin">
          <input
            v-model="newEmail"
            type="email"
            required
            placeholder="admin@verein-plattform.de"
            class="focus-ring flex-1 rounded-xl border border-[#dfe0d9] px-4 py-2.5 text-sm"
          />
          <button type="submit" class="focus-ring rounded-xl bg-forest px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60" :disabled="saving">
            Einladen
          </button>
        </form>
      </section>

      <section v-if="invitations.length" class="card mb-6 overflow-x-auto p-6">
        <h2 class="mb-4 font-display text-base font-bold">Offene Einladungen</h2>
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">E-Mail</th>
              <th class="pb-2 pr-4 font-semibold">Läuft ab am</th>
              <th class="pb-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="invitation in invitations" :key="invitation.id" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4">{{ invitation.email }}</td>
              <td class="py-2 pr-4">{{ new Date(invitation.expiresAt).toLocaleDateString('de-DE') }}</td>
              <td class="py-2 text-right">
                <button
                  class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-forest hover:bg-[#eef2ea]"
                  :disabled="saving"
                  @click="resendInvitation(invitation.id)"
                >
                  Erneut senden
                </button>
                <button
                  class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
                  :disabled="saving"
                  @click="revokeInvitation(invitation.id)"
                >
                  Widerrufen
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card overflow-x-auto p-6">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-[#7b827d]">
              <th class="pb-2 pr-4 font-semibold">Nutzer-ID</th>
              <th class="pb-2 pr-4 font-semibold">Rolle</th>
              <th class="pb-2 pr-4 font-semibold">Seit</th>
              <th class="pb-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="admin in admins" :key="admin.userId" class="border-t border-[#e9ebe4]">
              <td class="py-2 pr-4 font-mono">{{ admin.userId }}</td>
              <td class="py-2 pr-4">{{ admin.isDefaultAdmin ? 'Default-Admin' : 'Admin' }}</td>
              <td class="py-2 pr-4">{{ new Date(admin.createdAt).toLocaleDateString('de-DE') }}</td>
              <td class="py-2 text-right">
                <button
                  v-if="session?.isDefaultAdmin && !admin.isDefaultAdmin"
                  class="focus-ring rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
                  :disabled="saving"
                  @click="removeAdmin(admin.userId)"
                >
                  Entfernen
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <p v-if="errorMessage" class="mt-4 text-sm text-amber-800">{{ errorMessage }}</p>
    </template>
  </div>
</template>
