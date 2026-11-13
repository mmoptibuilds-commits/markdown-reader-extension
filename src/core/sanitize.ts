import DOMPurify from 'dompurify';
import { cssCanFetch } from './css-safety';

/*
 * Sanitizing needs a real DOM, so it runs on the page. Rendering (src/core/markdown.ts)
 * produces unsanitized HTML and may run in a worker.
 */

const documentPurifyConfig = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|(?:[^a-z+.-]|[a-z+.-]+(?:[^a-z+.\-:]|$)))/iu,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  ADD_ATTR: ['referrerpolicy'],
};

/** Sanitizes one rendered slice as HTML text. */
export function sanitizeBlock(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, documentPurifyConfig);
}

/** Sanitizes one rendered slice into nodes ready to append, without parsing the HTML twice. */
export function sanitizeBlockToFragment(rawHtml: string): DocumentFragment {
  return DOMPurify.sanitize(rawHtml, { ...documentPurifyConfig, RETURN_DOM_FRAGMENT: true });
}

/**
 * Sanitizes diagram SVG and returns the parsed root, ready to insert without reparsing.
 * Event handlers, scripts, foreign content, external references, and any CSS that could
 * fetch a resource are removed.
 */
export function sanitizeSvgElement(svg: string): SVGSVGElement | undefined {
  if (svg.length > 4_000_000) return undefined;
  const safeSvg = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
  });
  const parsed = new DOMParser().parseFromString(safeSvg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) return undefined;

  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const externalReference = (name === 'href' || name.endsWith(':href')) && value !== '' && !value.startsWith('#');
      if (name === 'xml:base' || externalReference || ((name === 'style' || /url\s*\(/iu.test(value)) && cssCanFetch(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const style of root.querySelectorAll('style')) {
    if (cssCanFetch(style.textContent ?? '')) style.remove();
  }
  return root as unknown as SVGSVGElement;
}

export function sanitizeSvg(svg: string): string {
  const element = sanitizeSvgElement(svg);
  return element ? new XMLSerializer().serializeToString(element) : '';
}
