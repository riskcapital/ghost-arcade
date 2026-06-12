// Dev/debug helper: capture a screenshot of a running Electron window
// via CDP. node scripts/cdp-shot.mjs <url-substring> <out.png> [port]
import WebSocket from 'ws';
import fs from 'fs';

const [, , match, outPath, portArg] = process.argv;
const port = Number(portArg || 9234);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && (t.url || '').includes(match));
if (!target) { console.error('No target matching', match); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

const send = (id, method, params = {}) => new Promise((res, rej) => {
  const onMsg = (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id === id) { ws.off('message', onMsg); res(msg); }
  };
  ws.on('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => rej(new Error(`timeout: ${method}`)), 30000);
});

const shot = await send(2, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
ws.close();
if (!shot.result?.data) { console.error('no data:', JSON.stringify(shot).slice(0, 500)); process.exit(1); }
fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', outPath);
