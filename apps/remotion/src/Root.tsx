import { Composition } from 'remotion'
import { ClubPost, ClubPostPropsSchema } from './ClubPost'

// Paket 013: displayFont/bodyFont/logoUrl haben zwar Zod-Defaults, aber Composition typisiert
// defaultProps gegen die AUFGELOESTE Ausgabeform des Schemas (Defaults bereits angewandt) --
// deshalb hier explizit statt implizit ueber den Zod-Default.
const DEFAULT_BRAND_PROPS = {
  displayFont: { kind: 'curated', key: 'manrope' },
  bodyFont: { kind: 'curated', key: 'dm_sans' },
  logoUrl: null,
} as const

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="ClubStory"
        component={ClubPost}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        schema={ClubPostPropsSchema}
        defaultProps={{
          ...DEFAULT_BRAND_PROPS,
          clubName: 'SV Nordstadt',
          eyebrow: 'Heimspiel',
          headline: 'Samstag wird laut.',
          detail: 'Anpfiff um 15:30 Uhr. Wir sehen uns am Sportplatz.',
          primaryColor: '#142C24',
          accentColor: '#C7FF4A',
          layoutFamily: 'photo_moment',
        }}
      />
      <Composition
        id="ClubFeed"
        component={ClubPost}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={ClubPostPropsSchema}
        defaultProps={{
          ...DEFAULT_BRAND_PROPS,
          clubName: 'SV Nordstadt',
          eyebrow: 'Ergebnis',
          headline: 'Drei Punkte. Ein Team.',
          detail: 'Ein starker Auftritt vor heimischem Publikum.',
          primaryColor: '#142C24',
          accentColor: '#C7FF4A',
          layoutFamily: 'result',
        }}
      />
      <Composition id="TrainingFeed" component={ClubPost} durationInFrames={1} fps={30} width={1080} height={1350} schema={ClubPostPropsSchema} defaultProps={{ ...DEFAULT_BRAND_PROPS, clubName: 'SV Nordstadt', eyebrow: 'Ballschule', headline: 'Werfen, Balancieren, gemeinsam lernen.', detail: 'Heute stand Bewegung im Mittelpunkt.', primaryColor: '#142C24', accentColor: '#C7FF4A', layoutFamily: 'training' }} />
      <Composition id="ThankYouStory" component={ClubPost} durationInFrames={150} fps={30} width={1080} height={1920} schema={ClubPostPropsSchema} defaultProps={{ ...DEFAULT_BRAND_PROPS, clubName: 'SV Nordstadt', eyebrow: 'Danke', headline: 'Ohne euch geht es nicht.', detail: 'Ein ehrlicher Dank an unser Ehrenamt.', primaryColor: '#142C24', accentColor: '#C7FF4A', layoutFamily: 'thanks' }} />
      <Composition id="InvitationStory" component={ClubPost} durationInFrames={150} fps={30} width={1080} height={1920} schema={ClubPostPropsSchema} defaultProps={{ ...DEFAULT_BRAND_PROPS, clubName: 'SV Nordstadt', eyebrow: 'Einladung', headline: 'Kommt zum Sommerfest.', detail: 'Ein Tag für den ganzen Verein.', primaryColor: '#142C24', accentColor: '#C7FF4A', layoutFamily: 'invitation' }} />
    </>
  )
}
