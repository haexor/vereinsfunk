// Eigene Datei statt in ContentSignatureBlockForm.vue: Vue rät von benannten Exporten aus
// <script setup> ab (imageStylePresetDraft.ts folgt demselben Muster).
export interface ContentSignatureBlockDraft {
  name: string
  body: string
}

export function emptyContentSignatureBlockDraft(): ContentSignatureBlockDraft {
  return { name: '', body: '' }
}
