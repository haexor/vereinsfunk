import { z } from 'zod'
import { UuidSchema } from './content.js'
import { ScopeLevelSchema } from './structure.js'

// Paket 051: fachliche Module unter dem Rahmen. Gespiegelt in public.app_module, appModules
// (packages/domain) und permissionModule (packages/authorization).
export const AppModuleSchema = z.enum(['social_media', 'playerboard'])

// Wo ein Modul ausgeschlossen wurde -- 'plan' heisst, der Tarif enthaelt es nicht.
export const ModuleBlockSourceSchema = z.enum(['plan', 'organization', 'department', 'team'])

export const UniqueAppModulesSchema = z.array(AppModuleSchema)
  .refine((modules) => new Set(modules).size === modules.length, { message: 'modules must be unique' })

// Die Auswahl einer Ebene: null = erben, [] = kein Modul. Eigener Vertrag statt eines Felds in
// PolicyRuleValues, weil jene Regeln dem Modul social_media gehoeren -- die Modulauswahl selbst
// gehoert dem Rahmen und muss auch erreichbar sein, wenn social_media aus ist.
export const ModuleSelectionSchema = UniqueAppModulesSchema.nullable()

export const ModuleStateSchema = z.object({
  module: AppModuleSchema,
  enabled: z.boolean(),
  // null bei einem wirksamen Modul.
  blockedBy: ModuleBlockSourceSchema.nullable(),
})

export const ScopeModulesSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  name: z.string(),
  // Abteilung der Ebene: null beim Verein, die eigene ID bei einer Abteilung, die uebergeordnete
  // bei einer Mannschaft -- damit die Oberflaeche Mannschaften unter ihrer Abteilung zeigen kann.
  departmentId: UuidSchema.nullable(),
  own: ModuleSelectionSchema,
  modules: z.array(ModuleStateSchema),
  canEdit: z.boolean(),
})

export const UpdateScopeModulesRequestSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: UuidSchema,
  enabledModules: ModuleSelectionSchema,
})

// 409 module_has_active_publications: diese Veroeffentlichungen laufen noch oder sind eingeplant
// und verloeren durch die Aenderung social_media. Erst nach Abbruch oder Abschluss abschaltbar.
export const ModuleBlockingPublicationSchema = z.object({
  publicationId: UuidSchema,
  postId: UuidSchema,
})

export type AppModule = z.infer<typeof AppModuleSchema>
export type ModuleBlockSource = z.infer<typeof ModuleBlockSourceSchema>
export type ModuleState = z.infer<typeof ModuleStateSchema>
export type ScopeModules = z.infer<typeof ScopeModulesSchema>
export type UpdateScopeModulesRequest = z.infer<typeof UpdateScopeModulesRequestSchema>
export type ModuleBlockingPublication = z.infer<typeof ModuleBlockingPublicationSchema>
