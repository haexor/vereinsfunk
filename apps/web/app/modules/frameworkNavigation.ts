import { BookUser, Blocks, Building2, CreditCard, Palette, Plug, Scale, Settings, ShieldCheck, UserSearch, Users } from '@lucide/vue'
import type { Permission } from '@vereinsfunk/authorization'
import type { AppModule } from '@vereinsfunk/contracts'
import type { Component } from 'vue'

// Paket 056: "Verein verwalten" in der Seitenleiste. Ein Eintrag erscheint nur, wenn die Person auf
// der Seite etwas sehen oder tun kann -- dieselben Rechte, die die Seite selbst prueft. Ausgewertet
// wie die Module (Paket 055) auf den Ebenen, auf denen die Person eine Rolle hat. Komfort, keine
// Sicherheit: API und RLS setzen die Rechte durch, die Seiten zeigen bei Direktaufruf einen Hinweis.

export interface FrameworkNavItem {
  label: string
  to: string
  icon: Component
  // Eines dieser Rechte genuegt.
  permissions: readonly Permission[]
  // Seite gehoert fachlich zu einem Modul und erscheint nur, wenn es fuer die Person sichtbar ist.
  module?: AppModule
  // Nur im Arbeitsbereich "Verein" (Vertrag und Datenschutz des ganzen Vereins).
  organizationOnly?: boolean
}

const STRUCTURE_MANAGE: readonly Permission[] = ['organization.manage', 'department.manage', 'team.manage']

export const frameworkNavigation: readonly FrameworkNavItem[] = [
  { label: 'Marke', to: '/marke', icon: Palette, permissions: ['brand.manage'] },
  { label: 'Struktur', to: '/struktur', icon: Building2, permissions: STRUCTURE_MANAGE },
  { label: 'Mitglieder', to: '/mitglieder', icon: Users, permissions: ['member.invite', 'member.remove', ...STRUCTURE_MANAGE] },
  { label: 'Verzeichnis', to: '/verzeichnis', icon: BookUser, permissions: ['directory.read'] },
  { label: 'Einwilligungen', to: '/einwilligungen', icon: ShieldCheck, permissions: ['consent.manage'] },
  { label: 'Integrationen', to: '/integrationen', icon: Plug, permissions: ['integration.manage'] },
  // Module abwaehlen darf, wer die Ebene verwaltet (POLICY_MANAGE_PERMISSION in der API).
  { label: 'Module', to: '/einstellungen/module', icon: Blocks, permissions: STRUCTURE_MANAGE },
  // Richtlinien fuer Beitraege (Themen, Hashtags, Freigaben) -- fachlich Social Media (Plan 051).
  { label: 'Einstellungen', to: '/einstellungen', icon: Settings, permissions: STRUCTURE_MANAGE, module: 'social_media' },
  { label: 'Tarif', to: '/einstellungen/tarif', icon: CreditCard, permissions: ['billing.manage', 'organization.manage'], organizationOnly: true },
  { label: 'Recht & Datenschutz', to: '/einstellungen/recht', icon: Scale, permissions: ['organization.manage'], organizationOnly: true },
  { label: 'Betroffenenanfragen', to: '/datenschutz/anfragen', icon: UserSearch, permissions: ['organization.manage'], organizationOnly: true },
]

/** Die Eintraege, die die Person im aktuellen Arbeitsbereich sinnvoll nutzen kann. */
export function visibleFrameworkNavigation(
  items: readonly FrameworkNavItem[],
  context: { inDepartment: boolean; canUse: (permission: Permission) => boolean; isModuleVisible: (module: AppModule) => boolean },
): FrameworkNavItem[] {
  return items.filter((item) =>
    (!item.organizationOnly || !context.inDepartment)
    && (!item.module || context.isModuleVisible(item.module))
    && item.permissions.some((permission) => context.canUse(permission)))
}
