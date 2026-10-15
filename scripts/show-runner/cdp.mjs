// Minimal Chrome DevTools Protocol client for the Show Runner: one
// connection per page, evaluate with await, screenshots, drag-and-drop of
// real files and a log of console errors.
import WebSocket from 'ws';

export async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}

export async function waitForPage(port, match, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const page = (await listPages(port)).find(match);
      if (page) return page;
    } catch { /* app still starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('page did not appear in time');
}

export class PageSession {
  constructor(target) {
    this.target = target;
    this.nextId = 0;
    this.waits = new Map();
    this.errors = [];
  }

  async connect() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
    await new Promise((resolve, reject) => { this.ws.on('open', resolve); this.ws.on('error', reject); });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.waits.has(msg.id)) {
        this.waits.get(msg.id)(msg);
        this.waits.delete(msg.id);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push({ at: Date.now(), text: d.exception?.description || d.text });
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push({ at: Date.now(), text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
      }
    });
    await this.call('Runtime.enable');
    return this;
  }

  call(method, params = {}, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.waits.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.waits.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression (awaited) and return its value. */
  async eval(expression, timeoutMs) {
    const msg = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    const r = msg.result;
    if (r?.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r?.result?.value;
  }

  async screenshot() {
    const msg = await this.call('Page.captureScreenshot', { format: 'jpeg', quality: 75 });
    return Buffer.from(msg.result.data, 'base64');
  }

  /** Drop real files on the element that `elementExpr` (page JS) returns. */
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
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      const res = await this.call('Input.dispatchDragEvent', { type, x: rect.x, y: rect.y, data });
      if (res.error) throw new Error(`drag ${type}: ${res.error.message}`);
    }
  }

  close() {
    try { this.ws?.close(); } catch { /* already gone */ }
  }
}
