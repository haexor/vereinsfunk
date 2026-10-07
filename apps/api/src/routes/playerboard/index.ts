import type { FastifyInstance } from 'fastify'
import type { ApiRouteContext } from '../context.js'
import { registerPlayerboardCategoryRoutes } from './categories.js'
import { registerPlayerboardPhotoRoutes } from './photos.js'
import { registerPlayerboardPlayerRoutes } from './players.js'
import { registerPlayerboardPublicRoutes } from './public.js'
import { registerPlayerboardSettingsRoutes } from './settings.js'
import { registerPlayerboardTrainingRoutes } from './trainings.js'

// Paket 052: Modul PlayerBoard. Jede Permission dieser Routen gehoert dem Modul 'playerboard'
// (permissionModule) -- requirePermission antwortet bei abgeschaltetem Modul mit 403 module_disabled.
export function registerPlayerboardRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  registerPlayerboardPlayerRoutes(app, context)
  registerPlayerboardCategoryRoutes(app, context)
  registerPlayerboardTrainingRoutes(app, context)
  registerPlayerboardSettingsRoutes(app, context)
  registerPlayerboardPhotoRoutes(app, context)
  registerPlayerboardPublicRoutes(app, context)
}
