import type { Ref } from 'vue'
import 'photoswipe/style.css'

// Vollbildansicht mit Wischen fuer Fotolisten (PhotoSwipe). Die Liste traegt Links auf das grosse
// Bild mit data-pswp; PhotoSwipe selbst wird erst beim ersten Oeffnen geladen.
//
// Die API kennt die Bildmasse nicht. Deshalb kommen sie vom bereits geladenen Vorschaubild im Link;
// fehlen sie (Vorschau noch nicht geladen), korrigiert loadComplete die Groesse, sobald das Bild in
// der Vollansicht da ist.
const FALLBACK_WIDTH = 1200
const FALLBACK_HEIGHT = 900

/**
 * Haengt eine PhotoSwipe-Vollbildansicht an alle Links mit data-pswp innerhalb von gallery. Die
 * Liste darf spaeter erscheinen oder wechseln (v-if nach dem Laden): die Ansicht folgt dem Element.
 */
export function usePhotoSwipe(gallery: Ref<HTMLElement | null>) {
  let lightbox: { destroy: () => void } | null = null
  let generation = 0

  /** Entfernt die Ansicht vom bisherigen Element. */
  function teardown() {
    lightbox?.destroy()
    lightbox = null
  }

  /** Richtet die Ansicht fuer element ein; ueberholte Aufrufe (Element schon wieder weg) verfallen. */
  async function setup(element: HTMLElement) {
    const run = ++generation
    const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox')
    if (run !== generation) return
    const instance = new PhotoSwipeLightbox({
      gallery: element,
      children: 'a[data-pswp]',
      pswpModule: () => import('photoswipe'),
      bgOpacity: 1,
      showHideAnimationType: 'fade',
      closeTitle: 'Schließen',
      zoomTitle: 'Vergrößern',
      arrowPrevTitle: 'Vorheriges Foto',
      arrowNextTitle: 'Nächstes Foto',
      errorMsg: 'Das Foto konnte nicht geladen werden.',
      indexIndicatorSep: ' von ',
    })
    instance.addFilter('itemData', (itemData) => {
      const preview = itemData.element?.querySelector('img')
      const width = preview?.naturalWidth || FALLBACK_WIDTH
      const height = preview?.naturalHeight || FALLBACK_HEIGHT
      return { ...itemData, src: itemData.element?.getAttribute('href') ?? itemData.src, width, height, alt: preview?.alt ?? '' }
    })
    instance.on('loadComplete', ({ content, slide }) => {
      const image = content.element as HTMLImageElement | undefined
      if (!image?.naturalWidth || (content.width === image.naturalWidth && content.height === image.naturalHeight)) return
      content.width = image.naturalWidth
      content.height = image.naturalHeight
      if (!slide) return
      slide.width = image.naturalWidth
      slide.height = image.naturalHeight
      slide.calculateSize()
      slide.updateContentSize(true)
      slide.zoomAndPanToInitial()
      slide.applyCurrentZoomPan()
    })
    instance.init()
    lightbox = instance
  }

  watch(gallery, (element) => {
    teardown()
    generation += 1
    if (element && import.meta.client) void setup(element)
  }, { flush: 'post', immediate: true })

  onBeforeUnmount(() => {
    generation += 1
    teardown()
  })
}
