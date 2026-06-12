// Dev/debug helper: stream console messages + exceptions from a running
// Electron window via CDP for N seconds.
//   node scripts/cdp-console.mjs <url-substring> [seconds] [port]
import WebSocket from 'ws';

const [, , match, secsArg, portArg] = process.argv;
const port = Number(portArg || 9234);
const secs = Number(secsArg || 4);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && (t.url || '').includes(match));
if (!target) { console.error('No target matching', match); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = (msg.params.args || []).map(a => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map(p => `${p.name}:${p.value}`) ?? a.type)).join(' ');
    console.log(`[${msg.params.type}] ${args}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[EXCEPTION]', msg.params.exceptionDetails?.exception?.description || JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
  }
});
send('Runtime.enable');
setTimeout(() => { ws.close(); process.exit(0); }, secs * 1000);
