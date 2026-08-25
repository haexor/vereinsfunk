import type { ImageStyleLogoPosition } from '@vereinsfunk/contracts'

export interface LogoHandleRect {
  left: number
  top: number
  width: number
  height: number
}

export interface LogoHandleFields {
  logoPosition: ImageStyleLogoPosition
  logoSizePercent: number
  logoMarginPercent: number
}

const TOP_ALIGNED: ReadonlySet<ImageStyleLogoPosition> = new Set(['top_left', 'top_right'])
const LEFT_ALIGNED: ReadonlySet<ImageStyleLogoPosition> = new Set(['top_left', 'bottom_left'])

// Der mittlere Bereich, in dem ein Rechteck-Mittelpunkt als 'center' statt als Ecke gilt --
// symmetrisch um die Bildmitte, je 40% der jeweiligen Kante (0.3..0.7).
const CENTRAL_BAND_MIN = 0.3
const CENTRAL_BAND_MAX = 0.7

// Ohne geladenes Logo (Asset noch nicht ausgewaehlt/geladen) ein plausibler Platzhalter, damit der
// Griff ueberhaupt eine sinnvolle Hoehe hat, statt fast die gesamte Bildhoehe einzunehmen.
const DEFAULT_ASPECT_RATIO = 1

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Spiegelbild von applyLogoWatermark (apps/api/src/imageStyle.ts): margin/boxWidth/boxHeight sind
// dieselbe Rechnung wie dort. Wichtig -- und der Grund fuer den aspectRatio-Parameter: der Server
// positioniert bei Ecken/Kanten NICHT anhand von boxWidth/boxHeight, sondern anhand der tatsaechlich
// nach fit:'inside' seitenverhaeltnis-erhaltend verkleinerten Logo-Masse (logoActualWidth/Height).
// Da boxHeight praktisch immer die gesamte Bildhoehe minus Rand ist, waere ein Griff, der die BOX
// statt der tatsaechlichen Logo-Masse abbildet, oben/unten nicht unterscheidbar -- genau der Fehler,
// den ein erster Entwurf hatte (siehe Test "round-trips top_left/top_right"). aspectRatio ist
// height/width des geladenen Logo-Bildes; ohne geladenes Logo faellt der Griff auf ein Quadrat
// zurueck (siehe DEFAULT_ASPECT_RATIO).
export function logoFieldsToPixelRect(
  fields: LogoHandleFields,
  canvasWidth: number,
  canvasHeight: number,
  logoAspectRatio = DEFAULT_ASPECT_RATIO,
): LogoHandleRect {
  const margin = Math.round((Math.min(canvasWidth, canvasHeight) * fields.logoMarginPercent) / 100)
  const boxWidth = Math.max(
    1,
    Math.min(Math.round((canvasWidth * fields.logoSizePercent) / 100), canvasWidth - 2 * margin),
  )
  const boxHeight = Math.max(1, canvasHeight - 2 * margin)

  // fit:'inside': die Achse, die zuerst an ihre Box-Grenze stoesst, bestimmt die Skalierung.
  const actualWidth = Math.max(1, Math.round(Math.min(boxWidth, boxHeight / logoAspectRatio)))
  const actualHeight = Math.max(1, Math.round(actualWidth * logoAspectRatio))

  if (fields.logoPosition === 'center') {
    return {
      left: (canvasWidth - actualWidth) / 2,
      top: (canvasHeight - actualHeight) / 2,
      width: actualWidth,
      height: actualHeight,
    }
  }
  const top = TOP_ALIGNED.has(fields.logoPosition) ? margin : canvasHeight - actualHeight - margin
  const left = LEFT_ALIGNED.has(fields.logoPosition) ? margin : canvasWidth - actualWidth - margin
  return { left, top, width: actualWidth, height: actualHeight }
}

// Rueckrichtung: aus einem gezogenen/skalierten Rechteck (der tatsaechlichen Logo-Flaeche, nicht
// der Box) die naechstliegende Enum-Zone plus Groesse/Rand ableiten. logoSizePercent bezieht sich
// auf die Bildbreite (wie beim Server), nicht auf die kuerzere Kante -- und nimmt an, dass die
// Breite die begrenzende Achse ist (bei realistischen Logo-Seitenverhaeltnissen praktisch immer der
// Fall, da boxHeight fast die gesamte Bildhoehe umfasst). Der Rand wird aus dem kleineren der beiden
// Kanten-Insets abgeleitet -- der Server wendet ohnehin nur EINEN gemeinsamen marginPercent auf alle
// vier Seiten an.
export function pixelRectToLogoFields(
  rect: LogoHandleRect,
  canvasWidth: number,
  canvasHeight: number,
  // Vorheriger Randwert: fuer 'center' ist kein Rand aus dem Rechteck ableitbar (ein zentriertes
  // Logo hat grosse, aber durch das Zentrieren selbst bedingte Insets, die nichts mit
  // logoMarginPercent zu tun haben) -- 'center' ist deshalb laut Plan nur skalierbar, nicht ziehbar,
  // und behaelt seinen bisherigen Randwert unveraendert bei.
  previousMarginPercent: number,
): LogoHandleFields {
  const logoSizePercent = clamp(Math.round((rect.width / canvasWidth) * 100), 4, 30)

  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const inCentralBand =
    centerX > canvasWidth * CENTRAL_BAND_MIN &&
    centerX < canvasWidth * CENTRAL_BAND_MAX &&
    centerY > canvasHeight * CENTRAL_BAND_MIN &&
    centerY < canvasHeight * CENTRAL_BAND_MAX
  const logoPosition: ImageStyleLogoPosition = inCentralBand
    ? 'center'
    : (`${centerY < canvasHeight / 2 ? 'top' : 'bottom'}_${centerX < canvasWidth / 2 ? 'left' : 'right'}` as ImageStyleLogoPosition)

  if (logoPosition === 'center') {
    return { logoPosition, logoSizePercent, logoMarginPercent: clamp(previousMarginPercent, 0, 15) }
  }
  const horizontalInset = Math.min(rect.left, canvasWidth - rect.left - rect.width)
  const verticalInset = Math.min(rect.top, canvasHeight - rect.top - rect.height)
  const logoMarginPercent = clamp(
    Math.round((Math.min(horizontalInset, verticalInset) / Math.min(canvasWidth, canvasHeight)) * 100),
    0,
    15,
  )

  return { logoPosition, logoSizePercent, logoMarginPercent }
}
