import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Bildstil photo workshop', () => {
  it('uses the photo workshop instead of the legacy canvas editor', () => {
    const page = readFileSync(join(import.meta.dirname, 'bildstil.vue'), 'utf8')

    expect(page).toContain('<PhotoImageWorkshop')
    expect(page).toContain(':frame-assets="workshopFrameAssets"')
    expect(page).toContain('selectableFrameAssets.value.filter((asset) => asset.signedUrl)')
    expect(page).toContain('selectableLogoAssets.value.filter((asset) => asset.signedUrl)')
    expect(page).toContain('@save="acceptWorkshopFile"')
    expect(page).not.toContain('<ImageStyleCanvasEditor')
  })

  it('keeps the accepted preview unchanged until the workshop saves', () => {
    const page = readFileSync(join(import.meta.dirname, 'bildstil.vue'), 'utf8')
    const openWorkshop = page.match(/function openPhotoWorkshop[\s\S]*?\n}/)?.[0]

    expect(openWorkshop).toContain('workshopFile.value = file')
    expect(openWorkshop).not.toContain('workshopResultFile.value')
    expect(openWorkshop).not.toContain('updateWorkshopPreview')
  })
})
