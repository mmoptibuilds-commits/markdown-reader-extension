/**
 * True when CSS text could make the browser fetch something. Used for user CSS and for
 * styles inside diagram SVG. Escapes are refused outright because they can spell any
 * function or at-rule; only local `url(#id)` references (SVG markers, gradients) pass.
 */
export function cssCanFetch(css: string): boolean {
  if (/\\/u.test(css)) return true;
  if (/@(?!(?:keyframes|-webkit-keyframes|media)\b)/iu.test(css)) return true;
  if (/(?:^|[^\w-])(?:-webkit-)?(?:image|image-set|src|cross-fade|expression|element)\s*\(/iu.test(css)) return true;
  if (/javascript\s*:|data\s*:/iu.test(css)) return true;
  for (const match of css.matchAll(/url\s*\(\s*(["']?)([^"')]*)/giu)) {
    if (!(match[2] ?? '').trim().startsWith('#')) return true;
  }
  return false;
}
