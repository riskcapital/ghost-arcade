/**
 * Pages that play inside the editor window, kept away from it.
 *
 * Every three.js / p5.js page the editor itself plays (a layer when the
 * native core is not drawing, a thumbnail, an import preview, the check
 * before a sketch is saved) runs in an iframe with `sandbox="allow-scripts"`
 * and nothing else. The page gets an opaque origin of its own: it cannot
 * reach `parent.electronAPI`, the app's storage or anything else in the
 * editor, and Chromium runs it in a process of its own, so a page stuck in a
 * loop does not stop the editor.
 *
 * Nothing crosses but messages. The page's side (pageRuntimeScript) sends
 * its uncaught errors and pictures of its canvas (ImageBitmaps, transferred,
 * one at a time and only when the editor has taken the last one) and takes
 * the show's audio and slider values. Everything the page needs to start
 * (p5, p5.sound, three) is inside its document: an opaque origin cannot load
 * the app's own files.
 */
import { bytesToBase64 } from '../p5sketch/files';

/** The bundled libraries a page may ask for, as text. Empty when unavailable. */
export interface PageLibraries {
  p5: string;
  p5Sound: string;
  /** three.module.min.js and the core it imports, as data: URLs for the import map. */
  threeModuleUrl: string;
  threeCoreUrl: string;
}

export const NO_LIBRARIES: PageLibraries = { p5: '', p5Sound: '', threeModuleUrl: '', threeCoreUrl: '' };

/** The specifier three.module.min.js reaches its core by, once its relative import is renamed. */
export const THREE_CORE_SPECIFIER = 'ghost-arcade:three-core';

function libraryUrl(file: string): string {
  const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : (typeof window !== 'undefined' ? window.location.href : '');
  return new URL(`lib/${file}`, base).href;
}

async function fetchText(file: string): Promise<string> {
  try {
    const response = await fetch(libraryUrl(file));
    return response.ok ? await response.text() : '';
  } catch {
    return '';
  }
}

function moduleDataUrl(code: string): string {
  return code ? `data:text/javascript;base64,${bytesToBase64(new TextEncoder().encode(code))}` : '';
}

/** three's module imports its core by a relative path, which a data: URL cannot resolve. */
export function renameThreeCoreImport(code: string): string {
  return code.replace(/(["'])\.\/three\.core(?:\.min)?\.js\1/g, `"${THREE_CORE_SPECIFIER}"`);
}

let libraries: Promise<PageLibraries> | null = null;

/** The bundled libraries, fetched once from the app's own files. */
export function loadPageLibraries(): Promise<PageLibraries> {
  libraries ??= Promise.all([
    fetchText('p5.min.js'),
    fetchText('p5.sound.min.js'),
    fetchText('three.module.min.js'),
    fetchText('three.core.min.js'),
  ]).then(([p5, p5Sound, threeModule, threeCore]) => {
    const loaded = {
      p5,
      p5Sound,
      threeModuleUrl: moduleDataUrl(renameThreeCoreImport(threeModule)),
      threeCoreUrl: moduleDataUrl(threeCore),
    };
    // A failed fetch is tried again next time instead of being kept.
    if (!p5 || !threeModule) libraries = null;
    return loaded;
  });
  return libraries;
}

/** Code as the text of an inline <script>: nothing in it may close the element. */
export function inlineScriptText(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1');
}

export interface PageRuntimeOptions {
  /** Stamped on every message, so the editor can tell this run from an earlier one in the same frame. */
  nonce: string;
  /** Keep the page silent: Web Audio and media elements play to nothing. */
  muted?: boolean;
  /** Say "still here" every 250 ms, so a check can tell a page that stopped responding. */
  heartbeat?: boolean;
  /** The silent audio reading the page starts with. */
  silentAudio: Record<string, number | boolean>;
}

/**
 * Plays to a gain of 0 instead of the speakers, so analysers still hear the
 * sound and the page cannot be heard. Media elements stay muted.
 */
const MUTE_SHIM = 'var AN=window.AudioNode,AD=window.AudioDestinationNode;'
  + 'if(AN&&AD){var con=AN.prototype.connect,dis=AN.prototype.disconnect,sinks=new WeakMap();'
  + 'var sink=function(d){var g=sinks.get(d);if(!g){g=d.context.createGain();g.gain.value=0;con.call(g,d);sinks.set(d,g);}return g;};'
  + 'AN.prototype.connect=function(t){if(t instanceof AD){var a=Array.prototype.slice.call(arguments);a[0]=sink(t);return con.apply(this,a);}return con.apply(this,arguments);};'
  + 'AN.prototype.disconnect=function(t){if(t instanceof AD){var a=Array.prototype.slice.call(arguments);a[0]=sink(t);return dis.apply(this,a);}return dis.apply(this,arguments);};}'
  + 'var ME=window.HTMLMediaElement;if(ME){var play=ME.prototype.play,md=Object.getOwnPropertyDescriptor(ME.prototype,"muted");'
  + 'if(md&&md.set&&md.configurable)Object.defineProperty(ME.prototype,"muted",{configurable:true,enumerable:md.enumerable,get:md.get,set:function(){md.set.call(this,true);}});'
  + 'ME.prototype.play=function(){try{md&&md.set?md.set.call(this,true):(this.muted=true);}catch(e){}return play.apply(this,arguments);};}';

/**
 * The page's half of the exchange, as one line of script. Runs first in the
 * page, before any library or the author's code.
 */
export function pageRuntimeScript(options: PageRuntimeOptions): string {
  const body = [
    `var N=${JSON.stringify(options.nonce)},P=window.parent;`,
    'function post(m,t){m.ghost=N;try{P.postMessage(m,"*",t||[]);}catch(e){}}',
    // The canvas is sampled at 1x; the page draws at 1x too.
    'try{Object.defineProperty(window,"devicePixelRatio",{value:1,configurable:true});}catch(e){}',
    // An opaque origin has no storage; sketches that keep values get some that lasts as long as the page.
    'var mem=function(){var d=Object.create(null);return{getItem:function(k){k=String(k);return k in d?d[k]:null;},setItem:function(k,v){d[String(k)]=String(v);},'
      + 'removeItem:function(k){delete d[String(k)];},clear:function(){d=Object.create(null);},key:function(i){var k=Object.keys(d);return i<k.length?k[i]:null;},get length(){return Object.keys(d).length;}};};',
    '["localStorage","sessionStorage"].forEach(function(n){try{window[n].length;}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(e2){}}});',
    // Pictures of a WebGL canvas are taken between frames, so its drawing buffer has to last until then.
    'var gc=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,attrs){'
      + 'if(/^(?:webgl2?|experimental-webgl)$/.test(String(type))){var a={};if(attrs&&typeof attrs==="object")for(var k in attrs)a[k]=attrs[k];a.preserveDrawingBuffer=true;return gc.call(this,type,a);}'
      + 'return gc.apply(this,arguments);};',
    options.muted ? MUTE_SHIM : '',
    // Uncaught errors (and promise rejections: p5 runs setup() inside one),
    // with the lines of the page on their stack, innermost first; the editor
    // keeps the first one that is the author's.
    'var list=window.__ghostSketchErrors=[];',
    'function stackLines(err,first){var out=[];if(first>0)out.push(first);var st=err&&typeof err.stack==="string"?err.stack:"";'
      + 'var re=/blob:[^\\s)]*?:(\\d+):\\d+/g,m;while((m=re.exec(st))&&out.length<10){var n=+m[1];if(out.indexOf(n)<0)out.push(n);}return out;}',
    'function report(m,lines){var line=lines.length?lines[0]:null;'
      + 'for(var i=0;i<list.length;i++){if(list[i].message===m&&list[i].line===line){list[i].count++;post({type:"error",message:m,line:line,lines:lines});return;}}'
      + 'if(list.length<12){list.push({message:m,line:line,count:1});post({type:"error",message:m,line:line,lines:lines});}}',
    'addEventListener("error",function(e){var inPage=typeof e.filename==="string"&&e.filename.indexOf("blob:")===0;'
      + 'report(String(e.message||"Error"),stackLines(e.error,inPage?e.lineno:0));});',
    'addEventListener("unhandledrejection",function(e){var r=e.reason;'
      + 'report("Uncaught (in promise) "+(r&&typeof r==="object"&&"message" in r?String(r.name||"Error")+": "+String(r.message):String(r)),stackLines(r,0));});',
    // The show's audio and the slider values, from the editor.
    `window.ghostAudio=${JSON.stringify(options.silentAudio)};`,
    'var pending={},loaded=false;function applyParams(v){var sp=window.shaderParams;if(sp&&typeof sp==="object")for(var k in v)sp[k]=v[k];}',
    'addEventListener("load",function(){loaded=true;applyParams(pending);pending={};post({type:"loaded"});});',
    // Pictures of the canvas: a stream while the editor wants one, a still on request.
    'var stream=false,inflight=false,last=-1e9,interval=1000/60;',
    'function canvas(){return document.querySelector("canvas[data-ghost-canvas]")||document.querySelector("canvas");}',
    'function capture(kind,w,h){var c=canvas();if(!c||!(c.width>0)||!(c.height>0))return false;'
      + 'var done=function(b){post({type:kind,bitmap:b,width:b.width,height:b.height},[b]);},'
      + 'fail=function(){if(kind==="frame")inflight=false;else post({type:kind});};'
      + 'try{(w>0&&h>0?createImageBitmap(c,{resizeWidth:w,resizeHeight:h,resizeQuality:"medium"}):createImageBitmap(c)).then(done,fail);}catch(e){fail();}return true;}',
    'function tick(t){requestAnimationFrame(tick);if(!stream||inflight||t-last<interval-2)return;inflight=true;last=t;if(!capture("frame"))inflight=false;}',
    'requestAnimationFrame(tick);',
    'addEventListener("message",function(e){if(e.source!==P)return;var d=e.data;if(!d||d.ghost!==N)return;'
      + 'if(d.type==="params"&&d.values&&typeof d.values==="object"){if(loaded)applyParams(d.values);else for(var k in d.values)pending[k]=d.values[k];}'
      + 'else if(d.type==="audio"&&d.value&&typeof d.value==="object")window.ghostAudio=d.value;'
      + 'else if(d.type==="frames"){stream=!!d.on;if(d.fps>0)interval=1000/d.fps;}'
      + 'else if(d.type==="ack")inflight=false;'
      + 'else if(d.type==="still"){if(!capture("still",d.width,d.height))post({type:"still"});}},true);',
    options.heartbeat ? 'setInterval(function(){post({type:"alive"});},250);' : '',
    'post({type:"hello"});',
  ];
  return `(function(){${body.join('')}})();`;
}

/**
 * Hidden, but not so hidden that Chromium stops drawing it: a page out of
 * the viewport, fully transparent or covered gets no animation frames, so
 * the frame sits on top, scaled to a speck, nearly transparent, and takes no
 * clicks.
 */
export function createSandboxedFrame(width: number, height: number): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;margin:0;padding:0;`
    + 'opacity:0.01;transform:scale(0.001);transform-origin:0 0;pointer-events:none;z-index:2147483647;';
  return iframe;
}

export interface PageMessage {
  type: string;
  ghost?: string;
  [key: string]: unknown;
}

type Listener = (data: PageMessage) => void;
const listeners = new Map<HTMLIFrameElement, Listener>();
/** The window the one message listener is on. */
let listeningOn: Window | null = null;

function onMessage(event: MessageEvent): void {
  const data = event.data as PageMessage | null;
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
  for (const [iframe, listener] of listeners) {
    if (event.source && event.source === iframe.contentWindow) {
      listener(data);
      return;
    }
  }
}

/** Messages from one frame's page, until the returned function is called. */
export function listenToFrame(iframe: HTMLIFrameElement, listener: Listener): () => void {
  if (typeof window !== 'undefined' && listeningOn !== window && typeof window.addEventListener === 'function') {
    window.addEventListener('message', onMessage);
    listeningOn = window;
  }
  listeners.set(iframe, listener);
  return () => {
    if (listeners.get(iframe) === listener) listeners.delete(iframe);
  };
}

/** Sends a message to the page now in a frame. */
export function postToFrame(iframe: HTMLIFrameElement, nonce: string, message: PageMessage): void {
  try {
    iframe.contentWindow?.postMessage({ ...message, ghost: nonce }, '*');
  } catch {
    /* the frame is gone */
  }
}

let serial = 0;

export function newNonce(): string {
  serial += 1;
  const random = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
    ? Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join('')
    : Math.random().toString(36).slice(2);
  return `${serial.toString(36)}-${random}`;
}
