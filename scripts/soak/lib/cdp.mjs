// Chrome DevTools Protocol client for the soak runner. Like the Show
// Runner's, plus: console warnings, crash and navigation events, Performance
// metrics (heap, DOM nodes, listeners) and native dialogs answered so a stray
// alert() can never stall a run.
import WebSocket from 'ws';

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  return res.json();
}

export async function waitForTarget(port, match, timeoutMs = 60000, isAlive = () => true) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!isAlive()) throw new Error('the app exited while starting');
    try {
      const target = (await listTargets(port)).find((t) => t.type === 'page' && match(t));
      if (target) return target;
    } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no matching page on debug port ${port} within ${Math.round(timeoutMs / 1000)} s`);
}

export class PageSession {
  constructor(target, { onConsole, onEvent } = {}) {
    this.target = target;
    this.nextId = 0;
    this.waits = new Map();
    this.onConsole = onConsole ?? (() => {});
    this.onEvent = onEvent ?? (() => {});
    this.closed = false;
    this.crashed = false;
    this.reloads = 0;
  }

  async connect() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('close', () => {
      this.closed = true;
      for (const [, w] of this.waits) w({ error: { message: 'connection closed' } });
      this.waits.clear();
      this.onEvent({ kind: 'closed' });
    });
    this.ws.on('error', () => { /* close follows */ });
    this.ws.on('message', (data) => this.#message(data));
    await this.call('Runtime.enable');
    await this.call('Page.enable');
    await this.call('Log.enable').catch(() => {});
    await this.call('Performance.enable').catch(() => {});
    return this;
  }

  #message(data) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.id && this.waits.has(msg.id)) {
      this.waits.get(msg.id)(msg);
      this.waits.delete(msg.id);
      return;
    }
    const p = msg.params ?? {};
    switch (msg.method) {
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails ?? {};
        const where = d.url ? ` (${d.url.replace(/^.*\/(src|assets)\//, '$1/')}:${d.lineNumber ?? '?'})` : '';
        this.onConsole({ level: 'exception', text: `${d.exception?.description || d.text || 'exception'}${where}` });
        break;
      }
      case 'Runtime.consoleAPICalled':
        if (p.type === 'error' || p.type === 'warning' || p.type === 'assert') {
          const text = (p.args ?? []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
          this.onConsole({ level: p.type === 'warning' ? 'warning' : 'error', text });
        }
        break;
      case 'Log.entryAdded':
        if (p.entry && (p.entry.level === 'error' || p.entry.level === 'warning')) {
          this.onConsole({ level: p.entry.level, text: `[${p.entry.source}] ${p.entry.text}${p.entry.url ? ` ${p.entry.url}` : ''}` });
        }
        break;
      case 'Inspector.targetCrashed':
        this.crashed = true;
        this.onEvent({ kind: 'crashed' });
        break;
      case 'Page.javascriptDialogOpening':
        // Never let a native dialog stall the run: note it and dismiss it.
        this.onEvent({ kind: 'dialog', type: p.type, message: p.message });
        this.call('Page.handleJavaScriptDialog', { accept: p.type !== 'beforeunload' ? false : true }).catch(() => {});
        break;
      case 'Page.frameNavigated':
        if (!p.frame?.parentId) { this.reloads++; this.onEvent({ kind: 'navigated', url: p.frame?.url }); }
        break;
      default:
        break;
    }
  }

  call(method, params = {}, timeoutMs = 60000) {
    if (this.closed) return Promise.reject(new Error('connection closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.waits.delete(id); reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
      this.waits.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch (err) { clearTimeout(timer); this.waits.delete(id); reject(err); }
    });
  }

  /** Evaluate an expression (awaited) in the page and return its value. */
  async eval(expression, timeoutMs = 60000) {
    const r = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }, timeoutMs + 2000);
    if (r?.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluation failed').split('\n')[0]);
    }
    return r?.result?.value;
  }

  async metrics() {
    const r = await this.call('Performance.getMetrics', {}, 10000);
    const out = {};
    for (const m of r?.metrics ?? []) out[m.name] = m.value;
    return out;
  }

  async screenshot({ quality = 60, maxWidth = 1280 } = {}) {
    const size = await this.eval('({ w: innerWidth, h: innerHeight })', 5000).catch(() => null);
    const scale = size && size.w > maxWidth ? maxWidth / size.w : 1;
    const params = { format: 'jpeg', quality };
    if (size && scale < 1) params.clip = { x: 0, y: 0, width: size.w, height: size.h, scale };
    const r = await this.call('Page.captureScreenshot', params, 20000);
    return Buffer.from(r.data, 'base64');
  }

  async mouse(type, x, y, extra = {}) {
    return this.call('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, ...extra });
  }

  async click(x, y) {
    await this.mouse('mouseMoved', x, y);
    await this.mouse('mousePressed', x, y, { buttons: 1 });
    await this.mouse('mouseReleased', x, y);
  }

  async drag(x0, y0, x1, y1, steps = 6) {
    await this.mouse('mouseMoved', x0, y0);
    await this.mouse('mousePressed', x0, y0, { buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.mouse('mouseMoved', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, { button: 'left', buttons: 1 });
    }
    await this.mouse('mouseReleased', x1, y1);
  }

  async key(key, { code, keyCode = 0, modifiers = 0, text } = {}) {
    await this.call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: code ?? key, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
    await this.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code ?? key, windowsVirtualKeyCode: keyCode, modifiers });
  }

  /** Drop real files on the element `elementExpr` (page JS) returns. */
  async dropFiles(elementExpr, files) {
    const rect = await this.eval(`(() => {
      const el = (${elementExpr});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!rect) throw new Error(`nothing to drop on: ${elementExpr}`);
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await this.call('Input.dispatchDragEvent', { type, x: rect.x, y: rect.y, data });
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* gone */ }
  }
}

/** The page-level browser connection (window bounds). */
export async function browserCall(port, method, params = {}) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10000);
      ws.on('message', (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.id === 1) { clearTimeout(timer); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
      });
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally { ws.close(); }
}
