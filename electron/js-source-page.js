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
 * A page asks for a see-through background with
 * <meta name="ghost-arcade-background" content="transparent">. Its host
 * window is then transparent and the alpha it draws reaches the layer, so a
 * sketch can draw its marks over whatever is below it.
 */
export function wantsTransparentBackground(html) {
  return /<meta\b[^>]*\bname\s*=\s*["']ghost-arcade-background["'][^>]*\bcontent\s*=\s*["']transparent["']/i.test(String(html ?? ''));
}

/**
 * The page as the host serves it: bundled three and p5 instead of CDN copies,
 * a pixel ratio of 1, a black unpadded body, and the host bridge. Shims go
 * first in <head> so they run before any of the page's own scripts. Tags
 * that go keep their line breaks, and `layout` says where the shims went, so
 * a line of the served page can be traced back to the page as given
 * (hostLineToPageLine).
 */
export function buildHostPage(html, { extraShims = [] } = {}) {
  const source = String(html ?? '');
  const wantsP5 = /p5\.(min\.)?js|new\s+p5\s*\(/i.test(source);
  const breaks = (tag) => tag.replace(/[^\n]/g, '');
  // Pages written to run standalone load p5 from a CDN. Loading the bundled
  // copy as well would start a second global-mode sketch, so remote p5 tags
  // give way to the local one, and a p5.sound tag loads the bundled add-on.
  const page = wantsP5
    ? source
      .replace(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']*\/p5(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, breaks)
      .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*\bp5\.sound(?:\.min)?\.js["'][^>]*>\s*<\/script>/gi, (tag) => `<script src="/lib/p5.sound.min.js"></script>${breaks(tag)}`)
    : source;
  const transparent = wantsTransparentBackground(source);
  const shims = [
    ...extraShims,
    transparent
      ? '<style>html,body{margin:0;padding:0;background:transparent!important;overflow:hidden}</style>'
      : '<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}</style>',
    '<script>(function(){try{Object.defineProperty(window,"devicePixelRatio",{value:1,configurable:true});}catch(e){}})();</script>',
    `<script type="importmap">${JSON.stringify(THREE_IMPORT_MAP)}</script>`,
    `<script>${HOST_BRIDGE_SCRIPT}</script>`,
    wantsP5 ? '<script src="/lib/p5.min.js"></script>' : '',
  ].filter(Boolean).join('\n');
  const shimLines = shims.split('\n').length;
  for (const tag of [/<head[^>]*>/i, /<body[^>]*>/i]) {
    const match = tag.exec(page);
    if (!match) continue;
    const at = match.index + match[0].length;
    return {
      html: `${page.slice(0, at)}\n${shims}${page.slice(at)}`,
      layout: { afterLine: page.slice(0, at).split('\n').length, shimLines },
    };
  }
  return { html: `${shims}\n${page}`, layout: { afterLine: 0, shimLines } };
}

export function buildHostHtml(html) {
  return buildHostPage(html).html;
}

/** The line of the page as given behind a line of the served page, or null for a line the host added. */
export function hostLineToPageLine(layout, line) {
  if (typeof line !== 'number' || !(line >= 1)) return null;
  const { afterLine, shimLines } = layout;
  if (afterLine === 0) return line > shimLines ? line - shimLines : null;
  if (line <= afterLine) return line;
  if (line === afterLine + shimLines) return afterLine;
  return line < afterLine + shimLines ? null : line - shimLines;
}

/**
 * Reads an uncaught error from a page console message: the message itself
 * for an uncaught exception or promise rejection (p5 runs setup() inside a
 * promise), or null for anything else (logs, warnings).
 */
export function uncaughtErrorMessage(message) {
  const text = String(message ?? '');
  return /^Uncaught\b/.test(text) ? text : null;
}
