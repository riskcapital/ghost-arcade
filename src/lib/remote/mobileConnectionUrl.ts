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
