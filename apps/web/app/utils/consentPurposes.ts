// Der Zweck entscheidet, wofuer eine Einwilligung gilt: PlayerBoard veroeffentlicht Trainingsfotos
// nur mit dem Zweck "Website", der Beitragsgenerator braucht "Social Media".
export const CONSENT_PURPOSE_OPTIONS = [
  { value: 'social_media', label: 'Social Media' },
  { value: 'website', label: 'Vereinswebsite' },
  { value: 'print', label: 'Printmaterial' },
  { value: 'internal', label: 'Intern' },
] as const

export const PURPOSE_REQUIRED_MESSAGE = 'Bitte mindestens einen Zweck wählen.'
