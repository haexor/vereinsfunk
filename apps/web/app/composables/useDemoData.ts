export interface DraftItem {
  id: string
  title: string
  type: string
  department: string
  status: 'Entwurf' | 'Freigabe' | 'Geplant' | 'Veröffentlicht'
  date: string
  time?: string
  platforms: readonly ('instagram' | 'facebook')[]
  color: string
}

const drafts: DraftItem[] = [
  { id: '1', title: 'Derbysieg der Ersten', type: 'Spielergebnis', department: 'Fußball', status: 'Freigabe', date: 'Heute', platforms: ['instagram', 'facebook'], color: '#bbec51' },
  { id: '2', title: 'Neue Jugendtrainerin', type: 'Menschen im Fokus', department: 'Handball', status: 'Entwurf', date: 'Heute', platforms: ['instagram'], color: '#ff8a73' },
  { id: '3', title: 'Heimspiel gegen TSV Süd', type: 'Spielankündigung', department: 'Fußball', status: 'Geplant', date: 'Sa., 8. Aug.', time: '10:00', platforms: ['instagram', 'facebook'], color: '#7dd3fc' },
  { id: '4', title: 'Sommerfest im Vereinsheim', type: 'Veranstaltung', department: 'Gesamtverein', status: 'Geplant', date: 'Mo., 10. Aug.', time: '18:30', platforms: ['facebook'], color: '#c4b5fd' },
]

export function useDemoData() {
  return {
    organization: { name: 'SV Nordstadt 1921', initials: 'SN' },
    department: ref('Gesamtverein'),
    departments: ['Gesamtverein', 'Fußball', 'Handball', 'Leichtathletik'],
    drafts: ref(drafts),
  }
}
