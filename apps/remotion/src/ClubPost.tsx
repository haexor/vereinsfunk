import { loadFont as loadCustomFont } from '@remotion/fonts'
import { useEffect, useState } from 'react'
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion'
import { z } from 'zod'

const CuratedFontKeySchema = z.enum(['manrope', 'dm_sans', 'space_grotesk', 'karla'])

// Genau eines von beiden: eine kuratierte Familie aus dem gebuendelten @remotion/google-fonts-
// Katalog, oder eine eigene Schrift ueber eine signierte, kurzlebige URL des zugehoerigen
// brand_assets-Eintrags (Plan 013, "Remotion").
const FontSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('curated'), key: CuratedFontKeySchema }),
  z.object({
    kind: z.literal('custom'),
    family: z.string().min(1).max(80),
    url: z.url(),
    weight: z.int().min(100).max(900).default(400),
    style: z.enum(['normal', 'italic']).default('normal'),
  }),
])

export const ClubPostPropsSchema = z.object({
  clubName: z.string().min(1).max(60),
  eyebrow: z.string().max(40),
  headline: z.string().min(1).max(80),
  detail: z.string().max(140),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  layoutFamily: z.enum(['photo_moment', 'training', 'quote', 'collage', 'invitation', 'thanks', 'result']).default('photo_moment'),
  // Paket 013: das aufgeloeste Markenprofil bringt Schrift und Logo mit, statt hartkodiert
  // Arial und kein Logo zu zeigen. Defaults halten bestehende Aufrufer (Tests, Compositions
  // ohne diese Felder) funktionsfaehig.
  displayFont: FontSpecSchema.default({ kind: 'curated', key: 'manrope' }),
  bodyFont: FontSpecSchema.default({ kind: 'curated', key: 'dm_sans' }),
  logoUrl: z.url().nullable().default(null),
})

export type ClubPostProps = z.infer<typeof ClubPostPropsSchema>
type FontSpec = z.infer<typeof FontSpecSchema>

// Jedes @remotion/google-fonts-Untermodul tippt loadFont() ueber ein leicht anderes Variants-
// Generic (z. B. je nachdem, ob die Familie Kursivschnitte kennt) -- als Union nicht mehr
// gemeinsam aufrufbar. Da hier immer ohne Argumente aufgerufen wird, genuegt die lose Signatur.
type CuratedFontModule = { loadFont: (...args: never[]) => { fontFamily: string; waitUntilDone: () => Promise<undefined> } }

const CURATED_FONT_MODULES: Record<z.infer<typeof CuratedFontKeySchema>, () => Promise<CuratedFontModule>> = {
  manrope: () => import('@remotion/google-fonts/Manrope'),
  dm_sans: () => import('@remotion/google-fonts/DMSans'),
  space_grotesk: () => import('@remotion/google-fonts/SpaceGrotesk'),
  karla: () => import('@remotion/google-fonts/Karla'),
}

// Registriert eine Schrift im Renderer, bevor eine Komposition zeichnet -- ohne Registrierung
// faellt Remotion stumm auf eine Ersatzschrift zurueck, und das Ergebnis weicht unbemerkt von
// der Vorschau ab (Plan 013, "Remotion"). Kuratierte Schriften kommen aus dem im npm-Paket
// gebuendelten Katalog (kein Netzwerkzugriff auf apps/web noetig); eigene Schriften laden ueber
// die uebergebene, kurzlebige signierte URL.
async function registerFont(spec: FontSpec): Promise<string> {
  if (spec.kind === 'curated') {
    const mod = await CURATED_FONT_MODULES[spec.key]()
    const loaded = mod.loadFont()
    await loaded.waitUntilDone()
    return loaded.fontFamily
  }
  await loadCustomFont({ family: spec.family, url: spec.url, weight: String(spec.weight), style: spec.style })
  return spec.family
}

const FALLBACK_FONT_FAMILY = 'Arial, sans-serif'

export function ClubPost(props: ClubPostProps) {
  const safeProps = ClubPostPropsSchema.parse(props)
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ fps, frame, config: { damping: 14, stiffness: 90 } })
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })

  const [fonts, setFonts] = useState<{ display: string; body: string } | null>(null)

  // Der Handle entsteht WAEHREND des Renderns, nicht erst im useEffect danach: sonst liegt
  // zwischen dem ersten Commit und dem delayRender ein Fenster, in dem der Renderer das Bild
  // bereits mit der Ersatzschrift aufnehmen kann -- genau der stumme Fallback, den Plan 013
  // ausschliessen will.
  const { delayRender, continueRender } = useDelayRender()
  const [handle] = useState(() => delayRender('ClubPost: Marken-Schriften laden'))

  useEffect(() => {
    let cancelled = false
    // allSettled statt all: schlaegt eine der beiden Schriften fehl (Netzwerk, abgelaufene
    // signierte URL), soll die andere trotzdem greifen. Mit Promise.all blieben beide auf der
    // Ersatzschrift stehen, und die Ablehnung liefe als unbehandelte Promise-Rejection weiter,
    // weil hier nur .finally() haengt.
    Promise.allSettled([registerFont(safeProps.displayFont), registerFont(safeProps.bodyFont)])
      .then(([display, body]) => {
        if (cancelled) return
        setFonts({
          display: display.status === 'fulfilled' ? display.value : FALLBACK_FONT_FAMILY,
          body: body.status === 'fulfilled' ? body.value : FALLBACK_FONT_FAMILY,
        })
      })
      .finally(() => continueRender(handle))
    return () => {
      cancelled = true
    }
    // Schriften haengen nur von den Font-Props ab, nicht von Frame/Zeit -- einmal pro Prop-Wechsel laden.
  }, [JSON.stringify(safeProps.displayFont), JSON.stringify(safeProps.bodyFont)])

  const displayFontFamily = fonts?.display ?? FALLBACK_FONT_FAMILY
  const bodyFontFamily = fonts?.body ?? FALLBACK_FONT_FAMILY

  return (
    <AbsoluteFill
      style={{
        backgroundColor: safeProps.primaryColor,
        color: '#fff',
        fontFamily: bodyFontFamily,
        padding: 88,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 740,
          height: 740,
          right: -260,
          top: -210,
          borderRadius: '50%',
          background: safeProps.accentColor,
          transform: `scale(${0.8 + enter * 0.2})`,
        }}
      />
      <div style={{ position: 'relative', opacity, transform: `translateY(${(1 - enter) * 60}px)` }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase' }}>
          {safeProps.layoutFamily === 'training' && !props.eyebrow ? 'TRAININGSMOMENT' : safeProps.eyebrow}
        </div>
        <h1 style={{ fontFamily: displayFontFamily, fontSize: 104, lineHeight: 0.95, maxWidth: 840, margin: '180px 0 52px' }}>
          {safeProps.headline}
        </h1>
        <p style={{ fontSize: 38, lineHeight: 1.35, maxWidth: 760 }}>{safeProps.detail}</p>
      </div>
      <div style={{ position: 'absolute', left: 88, right: 88, bottom: 78, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 28, fontWeight: 700 }}>
        <span>{safeProps.clubName}</span>
        {safeProps.logoUrl ? (
          <Img src={safeProps.logoUrl} style={{ height: 48, width: 'auto' }} />
        ) : (
          <span>#gemeinsamstark</span>
        )}
      </div>
    </AbsoluteFill>
  )
}
