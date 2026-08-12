import { z } from 'zod'

// Kleine Bausteine, die mehrere Fachmodule teilen. Bewusst NICHT im Barrel: sie waren im
// urspruenglichen index.ts modul-privat und sollen es nach der Aufteilung bleiben.
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/)
