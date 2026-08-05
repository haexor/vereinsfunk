import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

export class SvgTooComplexError extends Error {}
export class SvgRejectedError extends Error {}

export interface SanitizeSvgResult {
  sanitized: string
  modified: boolean
}

const MAX_BYTES = 2_000_000
const MAX_TAG_COUNT = 5_000
const MAX_NESTING_DEPTH = 60
const MAX_ATTRIBUTE_LENGTH = 4_000

// Allowlist per plans/009-onboarding-verein-anlegen.md: only what a static logo needs.
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'symbol',
  'use', 'text', 'tspan',
])

const ALLOWED_ATTRIBUTES = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'opacity', 'transform',
  'viewbox', 'd', 'gradientunits', 'gradienttransform', 'spreadmethod', 'offset', 'stop-color',
  'stop-opacity', 'clip-path', 'mask', 'id', 'class', 'preserveaspectratio', 'font-family',
  'font-size', 'font-weight', 'text-anchor', 'xmlns', 'xmlns:xlink', 'version', 'style',
])

const STYLE_PROPERTY_ALLOWLIST = new Set([
  'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity',
])

function guardRawInput(raw: string): void {
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    throw new SvgTooComplexError('SVG exceeds the maximum allowed byte size')
  }
  if (/<!entity/i.test(raw) || /<!doctype/i.test(raw)) {
    throw new SvgRejectedError('SVG must not declare a DOCTYPE or a custom entity')
  }
  if (/<\?(?!xml\s)/i.test(raw)) {
    throw new SvgRejectedError('SVG must not contain processing instructions other than the XML declaration')
  }

  const tagCount = (raw.match(/</g) ?? []).length
  if (tagCount > MAX_TAG_COUNT) throw new SvgTooComplexError('SVG has too many nodes')

  let depth = 0
  let maxDepth = 0
  for (const match of raw.matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
    const tag = match[0]
    if (tag.startsWith('</')) depth = Math.max(0, depth - 1)
    else if (!tag.endsWith('/>')) {
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
    }
  }
  if (maxDepth > MAX_NESTING_DEPTH) throw new SvgTooComplexError('SVG nesting is too deep')
}

function sanitizeStyleAttribute(value: string): string | null {
  const declarations = value.split(';').map((part) => part.trim()).filter(Boolean)
  const kept: string[] = []
  for (const declaration of declarations) {
    const separatorIndex = declaration.indexOf(':')
    if (separatorIndex === -1) continue
    const property = declaration.slice(0, separatorIndex).trim().toLowerCase()
    const propertyValue = declaration.slice(separatorIndex + 1).trim()
    if (!property || !propertyValue) continue
    if (!STYLE_PROPERTY_ALLOWLIST.has(property)) continue
    if (/url\(|@import|expression\(|behavior\s*:/i.test(propertyValue)) continue
    kept.push(`${property}: ${propertyValue}`)
  }
  return kept.length ? kept.join('; ') : null
}

function isSafeFragmentHref(value: string): boolean {
  return /^#[A-Za-z0-9_.:-]+$/.test(value.trim())
}

// A url(...) reference in a presentation attribute (fill="url(#grad)") must stay local. An
// absolute target would make a server-side renderer (Remotion) fetch attacker-controlled URLs,
// the same SSRF class the plan calls out for <use href>.
function hasOnlyLocalUrlReferences(value: string): boolean {
  const matches = value.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)
  let found = false
  for (const match of matches) {
    found = true
    if (!match[2] || !match[2].trim().startsWith('#')) return false
  }
  return found
}

function sanitizeElementTree(element: Element): boolean {
  let modified = false
  const tagName = element.tagName.toLowerCase()
  if (!ALLOWED_ELEMENTS.has(tagName)) {
    element.remove()
    return true
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value

    if (name === 'href' || name === 'xlink:href') {
      if (!isSafeFragmentHref(value)) {
        element.removeAttribute(attribute.name)
        modified = true
      }
      continue
    }
    if (name === 'style') {
      const cleaned = sanitizeStyleAttribute(value)
      if (cleaned === null) {
        element.removeAttribute(attribute.name)
        modified = true
      } else if (cleaned !== value) {
        element.setAttribute(attribute.name, cleaned)
        modified = true
      }
      continue
    }
    if (name.startsWith('on') || value.length > MAX_ATTRIBUTE_LENGTH || !ALLOWED_ATTRIBUTES.has(name)) {
      element.removeAttribute(attribute.name)
      modified = true
      continue
    }
    if (/javascript:/i.test(value) || (/url\(/i.test(value) && !hasOnlyLocalUrlReferences(value))) {
      element.removeAttribute(attribute.name)
      modified = true
    }
  }

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 8 /* COMMENT_NODE */ || child.nodeType === 7 /* PROCESSING_INSTRUCTION_NODE */) {
      child.parentNode?.removeChild(child)
      modified = true
      continue
    }
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      if (sanitizeElementTree(child as Element)) modified = true
    }
  }

  return modified
}

/**
 * Parses, allowlist-filters and re-serializes an untrusted SVG document. The result is the
 * only representation ever safe to store or serve; the original stays private and unsent.
 */
export function sanitizeSvg(raw: string): SanitizeSvgResult {
  guardRawInput(raw)

  const dom = new JSDOM('', { contentType: 'text/html' })
  const window = dom.window as unknown as Window & typeof globalThis
  const DOMPurify = createDOMPurify(window)

  // DOMPurify enforces our own element/attribute allowlist directly (its stock svg profile
  // drops <use> outright, which is too strict for a logo that references a local gradient or
  // shape by id). The second pass below narrows attribute *values* -- href, style -- which a
  // name-only allowlist cannot express.
  const purifiedRoot = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: Array.from(ALLOWED_ELEMENTS),
    ALLOWED_ATTR: Array.from(ALLOWED_ATTRIBUTES).concat(['href', 'xlink:href']),
    RETURN_DOM: true,
    WHOLE_DOCUMENT: false,
  }) as unknown as DocumentFragment
  // DOMPurify always reports the synthetic <body> wrapper it parses fragments into as
  // "removed" when unwrapping back to the fragment; that artifact is not real SVG content.
  const purifiedByDomPurify = DOMPurify.removed.some(
    (entry) => (entry as { element?: Element }).element?.tagName !== 'BODY',
  )

  const root = purifiedRoot.firstElementChild
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    throw new SvgRejectedError('SVG must have a single root <svg> element')
  }

  const modifiedByAllowlist = sanitizeElementTree(root)
  const serialized = new dom.window.XMLSerializer().serializeToString(root)

  return { sanitized: serialized, modified: purifiedByDomPurify || modifiedByAllowlist }
}
