// CDP driver for scripts/linux-smoke.mjs: real input events only (mouse,
// keyboard, drag-and-drop through Input.dispatch*), plus page evaluation for
// reading state. Nothing here clicks by calling into the page.
import WebSocket from 'ws';
import fs from 'node:fs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

/** Wait for a page target whose URL contains `match` (and is not DevTools). */
export async function waitForTarget(port, match, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    try {
      last = await listTargets(port);
      const target = last.find((t) => t.type === 'page' && !String(t.url).startsWith('devtools')
        && (typeof match === 'function' ? match(t) : String(t.url).includes(match)));
      if (target) return target;
    } catch { /* the debugging port is not up yet */ }
    await sleep(250);
  }
  throw new Error(`no page target matching ${match} after ${timeoutMs}ms; saw: ${last.map((t) => `${t.type}:${t.url}`).join(' | ')}`);
}

const KEY_CODES = {
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27, Tab: 9,
  Backspace: 8, Delete: 46, ' ': 32, F11: 122,
};

export async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  let next = 0;
  const pending = new Map();
  const consoleLines = [];
  const dialogs = [];
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`[${message.params.type}] ${text}`.slice(0, 600));
      if (consoleLines.length > 4000) consoleLines.splice(0, 1000);
      return;
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      // alert()/confirm() from the page: note what it said and let it go on.
      dialogs.push({ type: message.params.type, message: message.params.message, at: Date.now() });
      consoleLines.push(`[dialog:${message.params.type}] ${message.params.message}`.slice(0, 600));
      setTimeout(() => { send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }, 300);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      consoleLines.push(`[exception] ${details?.exception?.description || details?.text || ''}`.slice(0, 600));
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(message.error)}`));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}, timeoutMs = 60000) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      method,
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');

  const modifiers = (o) => (o?.alt ? 1 : 0) | (o?.ctrl ? 2 : 0) | (o?.meta ? 4 : 0) | (o?.shift ? 8 : 0);
  const api = {
    send, consoleLines, dialogs, url: target.url,
    /** Evaluate an expression in the page; promises are awaited. */
    async eval(expression, timeoutMs = 60000) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
      if (result.exceptionDetails) {
        const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(`page exception: ${String(text).slice(0, 800)}`);
      }
      return result.result?.value;
    },
    async mouse(type, x, y, o = {}) {
      await send('Input.dispatchMouseEvent', {
        type, x, y,
        button: o.button ?? (type === 'mouseMoved' && !o.down ? 'none' : 'left'),
        buttons: type === 'mouseReleased' ? 0 : (o.down || type === 'mousePressed' ? 1 : 0),
        clickCount: o.clickCount ?? (type === 'mouseMoved' ? 0 : 1),
        modifiers: modifiers(o), pointerType: 'mouse',
      });
    },
    async click(x, y, o = {}) {
      await api.mouse('mouseMoved', x, y, o);
      await api.mouse('mousePressed', x, y, o);
      await api.mouse('mouseReleased', x, y, o);
      await sleep(o.wait ?? 150);
    },
    async drag(x0, y0, x1, y1, o = {}) {
      const steps = o.steps ?? 8;
      await api.mouse('mouseMoved', x0, y0, o);
      await api.mouse('mousePressed', x0, y0, o);
      for (let i = 1; i <= steps; i++) {
        await api.mouse('mouseMoved', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { ...o, down: true });
        await sleep(o.stepWait ?? 25);
      }
      await api.mouse('mouseReleased', x1, y1, o);
      await sleep(o.wait ?? 200);
    },
    async key(key, o = {}) {
      const code = KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0);
      const base = {
        key, code: o.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key),
        windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: modifiers(o),
      };
      const text = key === 'Enter' ? '\r' : (key.length === 1 && !o.ctrl && !o.meta && !o.alt ? key : undefined);
      await send('Input.dispatchKeyEvent', {
        type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}),
        ...(o.commands ? { commands: o.commands } : {}),
      });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(o.wait ?? 80);
    },
    async type(text) { await send('Input.insertText', { text }); await sleep(80); },
    /** Centre of the element a page-side expression returns, scrolled into view. */
    async center(elementExpression) {
      const read = `(()=>{const el=${elementExpression}; if(!el) return null; const b=el.getBoundingClientRect();`
        + ' return {x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height,l:b.left,t:b.top};})()';
      const first = await api.eval(`(()=>{const el=${elementExpression}; if(!el) return null; el.scrollIntoView({block:'center'}); return true;})()`);
      if (!first) throw new Error(`element not found: ${elementExpression}`);
      await sleep(120);
      return api.eval(read);
    },
    async clickElement(elementExpression, o) {
      const c = await api.center(elementExpression);
      if (!(c.w > 0 && c.h > 0)) throw new Error(`element has no size: ${elementExpression}`);
      await api.click(c.x, c.y, o);
      return c;
    },
    async exists(elementExpression) { return api.eval(`!!(${elementExpression})`); },
    /** Poll a page expression until it returns something truthy. */
    async waitFor(expression, timeoutMs = 20000, label = expression) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        try { last = await api.eval(expression); if (last) return last; } catch (error) { last = String(error); }
        await sleep(250);
      }
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${String(label).slice(0, 200)} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
    },
    async screenshot(file) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return file;
    },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
  return api;
}

/** Page-side expressions for finding elements by their visible text. */
export const el = {
  button: (text, scope = 'document') => `[...${scope}.querySelectorAll('button')].find(b=>(b.textContent||'').trim()===${JSON.stringify(text)}&&b.getBoundingClientRect().width>0)`,
  buttonStarting: (text, scope = 'document') => `[...${scope}.querySelectorAll('button')].find(b=>(b.textContent||'').trim().startsWith(${JSON.stringify(text)})&&b.getBoundingClientRect().width>0)`,
  byAriaLabel: (label) => `document.querySelector('[aria-label=${JSON.stringify(label)}]')`,
  byTitle: (title) => `document.querySelector('[title=${JSON.stringify(title)}]')`,
};
