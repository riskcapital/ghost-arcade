'use strict';
// Hosts the renderer may reach through the CORS-free HTTP proxy
// (http_fetch, http_fetch_stream, http_fetch_binary, http_put_binary).
// A host matches itself and its subdomains. Anything else is refused.
const ALLOWED_PROXY_HOSTS = [
  'api.anthropic.com', 'generativelanguage.googleapis.com',
  // Luma: the API, and the CDN its finished videos download from.
  'api.lumalabs.ai', 'lumalabs.ai', 'luma.ai', 'cdn-luma.com',
  'replicate.com', 'api.replicate.com', 'replicate.delivery',
  'storage.googleapis.com', 'pbxt.replicate.delivery',
  'ghostarcade.live', 'ghostarcade.app',
  // Local services (Spout bridges, a Director server under development).
  '127.0.0.1', 'localhost',
];

function validateProxyUrl(urlStr) {
  let parsed;
  try { parsed = new URL(urlStr); } catch { throw new Error('Invalid URL'); }
  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs allowed');
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const isAllowed = ALLOWED_PROXY_HOSTS.some(h => host === h || host.endsWith('.' + h));
  if (!isAllowed) {
    console.warn('[Proxy] Blocked host:', host);
    throw new Error(`Host not allowed: ${host}`);
  }
  return parsed;
}

module.exports = { validateProxyUrl, ALLOWED_PROXY_HOSTS };
