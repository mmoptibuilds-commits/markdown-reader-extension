/**
 * The host pattern used to request, check, and remove access for a web origin. Browsers
 * match host patterns on any port, and Firefox reports a pattern that names a port as not
 * granted even when its host is, so the pattern never includes the port.
 */
export function hostPattern(origin: string | URL): string {
  const url = typeof origin === 'string' ? new URL(origin) : origin;
  return `${url.protocol}//${url.hostname}/*`;
}
