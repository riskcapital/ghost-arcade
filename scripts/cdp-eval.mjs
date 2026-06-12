// Dev/debug helper: evaluate a JS expression in a running Electron
// window via CDP (--remote-debugging-port). Not shipped; used for
// driving verification sessions (e.g. atlas sender slices) headlessly.
//
//   node scripts/cdp-eval.mjs <url-substring> <expression|@file.js> [port]
//
// The expression is evaluated with awaitPromise; result printed as JSON.
import WebSocket from 'ws';
import fs from 'fs';

const [, , match, exprArg, portArg] = process.argv;
const port = Number(portArg || 9234);
if (!match || !exprArg) {
  console.error('usage: node scripts/cdp-eval.mjs <url-substring> <expression|@file.js> [port]');
  process.exit(2);
}
const expression = exprArg.startsWith('@') ? fs.readFileSync(exprArg.slice(1), 'utf8') : exprArg;

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && (t.url || '').includes(match));
if (!target) {
  console.error('No target matching', JSON.stringify(match), '— targets:');
  for (const t of targets) console.error(` - [${t.type}] ${t.url}`);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

const result = await new Promise((res, rej) => {
  const id = 1;
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id === id) res(msg);
  });
  ws.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
  setTimeout(() => rej(new Error('CDP evaluate timeout (30s)')), 30000);
});
ws.close();

if (result.result?.exceptionDetails) {
  console.error('EXCEPTION:', JSON.stringify(result.result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result.result?.result?.value ?? null, null, 2));
