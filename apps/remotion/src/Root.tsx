import { Composition } from 'remotion'
import { ClubPost, ClubPostPropsSchema } from './ClubPost'

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
          clubName: 'SV Nordstadt',
          eyebrow: 'Heimspiel',
          headline: 'Samstag wird laut.',
          detail: 'Anpfiff um 15:30 Uhr. Wir sehen uns am Sportplatz.',
          primaryColor: '#142C24',
          accentColor: '#C7FF4A',
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
          clubName: 'SV Nordstadt',
          eyebrow: 'Ergebnis',
          headline: 'Drei Punkte. Ein Team.',
          detail: 'Ein starker Auftritt vor heimischem Publikum.',
          primaryColor: '#142C24',
          accentColor: '#C7FF4A',
        }}
      />
    </>
  )
}
