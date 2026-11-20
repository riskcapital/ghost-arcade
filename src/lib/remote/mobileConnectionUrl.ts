/** No link exists until LAN discovery completes (file:// has no hostname). */
export function mobileConnectionUrl(host: string, port: string | number, token: string, wsPort: number): string {
  if (!host.trim()) return '';
  try {
    const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    const url = new URL(`http://${authority}:${port}/`);
    if (token) url.searchParams.set('pair', token);
    if (wsPort !== 9001) url.searchParams.set('ws', String(wsPort));
    url.hash = '/mobile';
    return url.toString();
  } catch {
    return '';
  }
}

/** The website page a Mobile Control QR points at. The iPhone app opens these links itself. */
export const MOBILE_CONTROL_PAGE = 'https://ghostarcade.live/connect';

/** The iPhone app on the App Store. */
export const IPHONE_APP_STORE_URL = 'https://apps.apple.com/app/ghost-arcade/id6783072881';

/**
 * Mobile Control's QR link: https://ghostarcade.live/connect#host=<ip:port>&pair=<code>[&ws=<port>].
 * A phone with the Ghost Arcade app opens the app straight into pairing; any other phone opens the
 * page, which sends the browser on to the LAN link. The desktop's details are in the fragment, which
 * a browser never sends, so the pairing code never reaches the website.
 */
export function mobileControlAppLink(lanUrl: string): string {
  if (!lanUrl) return '';
  try {
    const lan = new URL(lanUrl);
    const token = lan.searchParams.get('pair') || '';
    if (lan.protocol !== 'http:' || !lan.host || !token) return '';
    // ':' and brackets are fine in a fragment; leaving them keeps the QR smaller.
    const part = (value: string) => encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%5B/gi, '[').replace(/%5D/gi, ']');
    let fragment = `host=${part(lan.host)}&pair=${part(token)}`;
    const ws = lan.searchParams.get('ws');
    if (ws) fragment += `&ws=${part(ws)}`;
    return `${MOBILE_CONTROL_PAGE}#${fragment}`;
  } catch {
    return '';
  }
}
