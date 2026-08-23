import { z } from 'zod'
import { UuidSchema } from './content.js'
import { CountryCodeSchema } from './primitives.js'

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const LegalFormSchema = z.enum(['e_v', 'gmbh', 'gugmbh', 'ggmbh', 'nicht_eingetragen', 'sonstige'])

// Oeffentlich, ohne Anmeldung abrufbar (GET /v1/organizations/:id/imprint) -- ein Verein kann
// diese URL aus seiner Instagram-/Facebook-Bio verlinken, ohne eine eigene Website zu betreiben.
// Traegt nur, was auf einem Impressum stehen darf: keine Profil-ID, keine E-Mail einer
// verantwortlichen Person ausser der offiziellen Vereinskontaktadresse.
export const PublicOrganizationImprintSchema = z.object({
  organizationName: z.string(),
  legalName: z.string().nullable(),
  legalForm: LegalFormSchema.nullable(),
  registerCourt: z.string().nullable(),
  registerNumber: z.string().nullable(),
  street: z.string().nullable(),
  houseNumber: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  countryCode: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  responsiblePersonName: z.string().nullable(),
})
// Muss mit packages/domain/src/fonts.ts (curatedFonts) Schritt halten -- Contracts bleibt
// absichtlich ohne Laufzeitabhaengigkeit auf Domain (siehe packages/contracts/package.json),
// deshalb dieselbe Duplizierung wie bei den Permission-Listen (TS/SQL).
export const CuratedFontKeySchema = z.enum(['manrope', 'dm_sans', 'space_grotesk', 'karla'])
// Rejects garbage before it ever reaches organizations.timezone -- an invalid IANA zone
// would otherwise only fail later, as a RangeError inside Intl.DateTimeFormat calls that
// format every date and scheduling deadline in the organization's timezone.
const IanaTimezoneSchema = z.string().min(1).max(64).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}, { message: 'must be a valid IANA time zone' })

export const CreateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  firstDepartmentName: z.string().trim().min(1).max(120),
  timezone: IanaTimezoneSchema.default('Europe/Berlin'),
})
export const CreateOrganizationResponseSchema = z.object({ organizationId: UuidSchema, slug: z.string().min(1) })

const OrganizationProfileFieldsSchema = z.object({
  legalName: z.string().trim().min(1).max(160).nullable().optional(),
  legalForm: LegalFormSchema.nullable().optional(),
  registerCourt: z.string().trim().min(1).max(160).nullable().optional(),
  registerNumber: z.string().trim().min(1).max(80).nullable().optional(),
  street: z.string().trim().min(1).max(160).nullable().optional(),
  houseNumber: z.string().trim().min(1).max(20).nullable().optional(),
  postalCode: z.string().trim().min(1).max(20).nullable().optional(),
  city: z.string().trim().min(1).max(120).nullable().optional(),
  countryCode: CountryCodeSchema.optional(),
  contactEmail: z.string().trim().toLowerCase().pipe(z.email()).nullable().optional(),
  contactPhone: z.string().trim().min(1).max(40).nullable().optional(),
  websiteUrl: z.url().nullable().optional(),
  foundedYear: z.int().min(1800).max(2100).nullable().optional(),
  responsiblePersonProfileId: UuidSchema.nullable().optional(),
  // Ausdrueckliche Freigabe fuer GET /v1/organizations/:id/imprint (oeffentlich, ohne Anmeldung) --
  // ohne dieses Feld wuerden Kontakt-/Adress-/Registerangaben, die nur zur internen Verwaltung
  // eingetragen wurden, ungefragt veroeffentlicht (adversariale Pruefung). Default false.
  imprintPublished: z.boolean().optional(),
})
export const OrganizationProfileUpdateSchema = OrganizationProfileFieldsSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: 'at least one field must be provided' },
)
export const OrganizationProfileSchema = OrganizationProfileFieldsSchema.extend({
  organizationId: UuidSchema,
  countryCode: CountryCodeSchema,
  imprintPublished: z.boolean(),
})

// Nur Felder, die eine Abteilung/Mannschaft ueberhaupt selbst setzen kann (siehe
// BrandOverrideFieldsSchema unten, die Spalten von department_brand_profiles/team_brand_profiles
// und BRAND_LOCKABLE_FIELDS in packages/domain als TS-Gegenstueck). Ohne diese Begrenzung liess
// sich ein Tippfehler ('primary_colour') speichern, der dann nichts sperrt -- und die Oberflaeche
// bot Sperren fuer Felder an, die unterhalb des Vereins ohnehin niemand setzen kann.
export const BrandLockableFieldSchema = z.enum([
  'primaryColor', 'accentColor', 'logoAssetId', 'displayFontAssetId', 'bodyFontAssetId',
])
const LockedFieldsSchema = z.array(BrandLockableFieldSchema).max(6)

export const OrganizationBrandUpdateSchema = z.object({
  primaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  textColor: HexColorSchema,
  onPrimaryColor: HexColorSchema,
  displayFontKey: CuratedFontKeySchema,
  bodyFontKey: CuratedFontKeySchema,
  displayFontAssetId: UuidSchema.nullable().optional(),
  bodyFontAssetId: UuidSchema.nullable().optional(),
  logoAssetId: UuidSchema.nullable().optional(),
  allowDepartmentOverrides: z.boolean().optional(),
  lockedFields: LockedFieldsSchema.optional(),
})
export const OrganizationBrandSchema = z.object({
  organizationId: UuidSchema,
  primaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  textColor: HexColorSchema,
  onPrimaryColor: HexColorSchema,
  displayFontKey: CuratedFontKeySchema,
  bodyFontKey: CuratedFontKeySchema,
  displayFontAssetId: UuidSchema.nullable(),
  bodyFontAssetId: UuidSchema.nullable(),
  logoAssetId: UuidSchema.nullable(),
  allowDepartmentOverrides: z.boolean(),
  lockedFields: z.array(BrandLockableFieldSchema),
})

// Paket 013: Branding-Assets (Logovarianten, Wasserzeichen, eigene Schriften) auf Vereins-,
// Abteilungs- und Mannschaftsebene. 'frame' (Plan 045): eigene Rahmengrafik fuer Bildstil-Presets.
export const BrandAssetKindSchema = z.enum(['logo_primary', 'logo_light', 'logo_dark', 'logo_mark', 'wordmark', 'watermark', 'font', 'frame'])
export const BrandAssetStatusSchema = z.enum(['processing', 'ready', 'rejected', 'replaced', 'deleted'])
export const FontStyleSchema = z.enum(['normal', 'italic'])

export const BrandAssetSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
  kind: BrandAssetKindSchema,
  objectPath: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.int().positive(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  fontFamily: z.string().nullable(),
  fontWeight: z.int().min(100).max(900).nullable(),
  fontStyle: FontStyleSchema.nullable(),
  licenseHolder: z.string().nullable(),
  licenseNote: z.string().nullable(),
  licenseConfirmedAt: z.iso.datetime({ offset: true }).nullable(),
  status: BrandAssetStatusSchema,
  rejectionReason: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})

// Antwortform von POST /v1/brand/assets: dieselbe brand_assets-Zeile wie BrandAssetSchema, plus
// `sanitized` -- eine einmalige Nebeninformation dieser Antwort (kein persistiertes Feld), die den
// Hinweis "SVG enthielt nicht unterstuetzte Elemente" traegt.
export const CreateBrandAssetResponseSchema = BrandAssetSchema.extend({
  sanitized: z.boolean(),
})
export type CreateBrandAssetResponse = z.infer<typeof CreateBrandAssetResponseSchema>

// Aus den multipart-Feldern eines POST /v1/brand/assets gelesen -- die Datei selbst kommt als
// eigener Teil des multipart-Streams, nicht durch dieses Schema.
export const CreateBrandAssetRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
  teamId: UuidSchema.optional(),
  kind: BrandAssetKindSchema,
}).refine((value) => value.teamId === undefined || value.departmentId !== undefined, {
  message: 'teamId requires departmentId',
})

export const ConfirmBrandAssetLicenseRequestSchema = z.object({
  licenseHolder: z.string().trim().min(1).max(200),
  licenseNote: z.string().trim().max(1000).optional(),
  confirmed: z.literal(true),
})

// Paket 048: KI-gestuetzte Markenerkennung aus der Vereins-Homepage. websiteUrl ist bewusst ein
// eigenes, ad-hoc uebergebenes Feld -- unabhaengig vom Impressum-websiteUrl in
// OrganizationProfileFieldsSchema, damit diese Funktion ohne einen Umweg ueber die
// Rechtseinstellungen benutzbar ist.
export const StartBrandWebsiteAnalysisRequestSchema = z.object({ websiteUrl: z.url() })
export const BrandWebsiteAnalysisStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed'])
// suggestedFontPairingKey bewusst ein loses string statt eines Enums der beiden kuratierten Paare:
// die eigentliche Pruefung "ist das ueberhaupt eines der beiden kuratierten Paare" passiert bereits
// serverseitig im Vision-Adapter (packages/content-engine/visionAnalysis.ts, parsePairingKey) --
// ein zweites, hier dupliziertes Enum wuerde nur auseinanderlaufen koennen, ohne einen eigenen
// Sicherheitsgewinn zu haben.
export const BrandWebsiteAnalysisLogoCandidateSchema = z.object({ signedUrl: z.url(), mimeType: z.string().min(1) })
export const BrandWebsiteAnalysisResultSchema = z.object({
  primaryColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  textColor: HexColorSchema,
  onPrimaryColor: HexColorSchema,
  suggestedFontPairingKey: z.string().nullable(),
  detectedFontFamily: z.string().nullable(),
  // Deprecated: bleibt fuer bereits ausgerollte Clients waehrend der Umstellung erhalten. Neue
  // Clients verwenden logoCandidates; die API setzt dieses Feld auf den ersten Vorschlag.
  logoCandidate: BrandWebsiteAnalysisLogoCandidateSchema.nullable(),
  // Ein Verein kann mehrere echte Logos/Wortmarken fuehren -- die Uebernahme jedes einzelnen
  // Vorschlags bleibt eine manuelle Entscheidung (marke.vue), kein automatisches Ranking hier.
  // Der Default akzeptiert gespeicherte Antworten aus der Vor-Migration, in denen das additive
  // Feld noch nicht vorhanden war.
  logoCandidates: BrandWebsiteAnalysisLogoCandidateSchema.array().max(8).default([]),
})
export const BrandWebsiteAnalysisStatusResponseSchema = z.object({
  status: BrandWebsiteAnalysisStatusSchema,
  result: BrandWebsiteAnalysisResultSchema.nullable(),
  errorReason: z.string().nullable(),
})

const BrandOverrideFieldsSchema = z.object({
  primaryColor: HexColorSchema.nullable().optional(),
  accentColor: HexColorSchema.nullable().optional(),
  logoAssetId: UuidSchema.nullable().optional(),
  displayFontAssetId: UuidSchema.nullable().optional(),
  bodyFontAssetId: UuidSchema.nullable().optional(),
})

export const UpdateDepartmentBrandRequestSchema = BrandOverrideFieldsSchema.extend({
  allowTeamOverrides: z.boolean().optional(),
  lockedFields: LockedFieldsSchema.optional(),
})
export const DepartmentBrandSchema = UpdateDepartmentBrandRequestSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
})

export const UpdateTeamBrandRequestSchema = BrandOverrideFieldsSchema
export const TeamBrandSchema = UpdateTeamBrandRequestSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema,
  teamId: UuidSchema,
})

export const OnboardingStepSchema = z.enum(['branding', 'responsible_person'])
export const OnboardingStateSchema = z.object({
  completedSteps: z.array(OnboardingStepSchema),
  dismissedAt: z.iso.datetime({ offset: true }).nullable(),
})

export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequestSchema>
export type OrganizationProfileUpdate = z.infer<typeof OrganizationProfileUpdateSchema>
export type OrganizationProfile = z.infer<typeof OrganizationProfileSchema>
export type OrganizationBrandUpdate = z.infer<typeof OrganizationBrandUpdateSchema>
export type OrganizationBrand = z.infer<typeof OrganizationBrandSchema>
export type BrandAssetKind = z.infer<typeof BrandAssetKindSchema>
export type BrandAssetStatus = z.infer<typeof BrandAssetStatusSchema>
export type BrandAsset = z.infer<typeof BrandAssetSchema>
export type CreateBrandAssetRequest = z.infer<typeof CreateBrandAssetRequestSchema>
export type ConfirmBrandAssetLicenseRequest = z.infer<typeof ConfirmBrandAssetLicenseRequestSchema>
export type StartBrandWebsiteAnalysisRequest = z.infer<typeof StartBrandWebsiteAnalysisRequestSchema>
export type BrandWebsiteAnalysisStatus = z.infer<typeof BrandWebsiteAnalysisStatusSchema>
export type BrandWebsiteAnalysisLogoCandidate = z.infer<typeof BrandWebsiteAnalysisLogoCandidateSchema>
export type BrandWebsiteAnalysisResult = z.infer<typeof BrandWebsiteAnalysisResultSchema>
export type BrandWebsiteAnalysisStatusResponse = z.infer<typeof BrandWebsiteAnalysisStatusResponseSchema>
export type UpdateDepartmentBrandRequest = z.infer<typeof UpdateDepartmentBrandRequestSchema>
export type DepartmentBrand = z.infer<typeof DepartmentBrandSchema>
export type UpdateTeamBrandRequest = z.infer<typeof UpdateTeamBrandRequestSchema>
export type TeamBrand = z.infer<typeof TeamBrandSchema>
export type CuratedFontKey = z.infer<typeof CuratedFontKeySchema>
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>
export type OnboardingState = z.infer<typeof OnboardingStateSchema>
export type PublicOrganizationImprint = z.infer<typeof PublicOrganizationImprintSchema>
