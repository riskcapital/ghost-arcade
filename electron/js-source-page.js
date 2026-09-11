/**
 * The page a three.js / p5.js source host serves (see js-source-host.js).
 *
 * Kept free of Electron imports so it can be unit tested.
 */

// Runs before any page script. `ghostHost` is exposed by js-source-preload.cjs.
export const HOST_BRIDGE_SCRIPT = `(function () {
  var audio = { level: 0, bass: 0, mid: 0, treble: 0, high: 0, beat: 0, beatPhase: 0, bpm: 0, centroid: 0, kick: 0, snare: 0, active: false };
  window.ghostAudio = audio;
  var host = window.ghostHost;
  if (!host) return;
  host.onParams(function (values) {
    if (!values || typeof values !== 'object') return;
    if (!window.shaderParams || typeof window.shaderParams !== 'object') window.shaderParams = {};
    Object.assign(window.shaderParams, values);
  });
  host.onAudio(function (values) {
    if (values && typeof values === 'object') Object.assign(audio, values);
  });
})();`;

// three, its addons (`three/addons/...`, the old `three/examples/jsm/...`
// spelling too) and the WebGPU/TSL entry points all resolve to the app's own
// copy of the package, so imports work offline and always match one version.
export const THREE_IMPORT_MAP = {
  imports: {
    three: '/lib/three.module.min.js',
    'three/webgpu': '/lib/three.webgpu.min.js',
    'three/tsl': '/lib/three.tsl.min.js',
    'three/addons/': '/lib/addons/',
    'three/examples/jsm/': '/lib/examples/jsm/',
    'three/': '/lib/',
  },
};

/**
 * The page as the host serves it: bundled three and p5 instead of CDN copies,
 * a pixel ratio of 1, a black unpadded body, and the host bridge. Shims go
 * first in <head> so they run before any of the page's own scripts.
 */
export function buildHostHtml(html) {
  const source = String(html ?? '');
  const wantsP5 = /p5\.(min\.)?js|new\s+p5\s*\(/i.test(source);
  // Pages written to run standalone load p5 from a CDN. Loading the bundled
  // copy as well would start a second global-mode sketch, so remote p5 tags
  // give way to the local one.
  const page = wantsP5
    ? source.replace(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*\/p5(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, '')
    : source;
  const shims = [
    '<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}</style>',
    '<script>(function(){try{Object.defineProperty(window,"devicePixelRatio",{value:1,configurable:true});}catch(e){}})();</script>',
    `<script type="importmap">${JSON.stringify(THREE_IMPORT_MAP)}</script>`,
    `<script>${HOST_BRIDGE_SCRIPT}</script>`,
    wantsP5 ? '<script src="/lib/p5.min.js"></script>' : '',
  ].filter(Boolean).join('\n');
  if (/<head[^>]*>/i.test(page)) return page.replace(/<head[^>]*>/i, (m) => `${m}\n${shims}`);
  if (/<body[^>]*>/i.test(page)) return page.replace(/<body[^>]*>/i, (m) => `${m}\n${shims}`);
  return `${shims}\n${page}`;
}
