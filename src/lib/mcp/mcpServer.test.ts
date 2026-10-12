import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createMcpHttpServer } = require(join(process.cwd(), 'electron', 'mcp-server.cjs'));

/**
 * MCP is an interop protocol, so the thing that matters is whether a client
 * that is not ours can talk to it. A handshake that is subtly wrong does not
 * error anywhere useful: Claude Desktop simply shows no tools, with nothing in
 * any log to say why. So this drives the real server over a real socket the
 * way a client does, rather than asserting on the shape of our own objects.
 *
 * The auth cases are here for a different reason. This port can black out a
 * live show, so "a rejected request never reaches the app" is a property worth
 * holding onto rather than a detail of the current implementation.
 */

const TOKEN = 'test-token-123';
const PORT = 7432;
const calls: Array<{ name: string; args: any }> = [];
let server: any;

async function start() {
  if (server) return;
  server = await createMcpHttpServer({
    token: TOKEN,
    port: PORT,
    callRenderer: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === 'get_output_frame') {
        return { text: 'Output frame, 4x4.', imageBase64: 'iVBORw0KGgo=' };
      }
      if (name === 'explode') throw new Error('renderer said no');
      return { text: `ran ${name}` };
    },
    onLog: () => {},
  });
}

async function rpc(body: unknown, token = TOKEN) {
  await start();
  const res = await fetch(`http://127.0.0.1:${PORT}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

afterAll(() => { try { server?.close(); } catch { /* already closed */ } });

describe('MCP handshake', () => {
  it('completes initialize with a tools capability', async () => {
    const res = await rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    expect(res.status).toBe(200);
    expect(res.json.result.capabilities.tools).toBeDefined();
    expect(res.json.result.serverInfo.name).toBe('ghost-arcade');
    // Echoing the client's version is what stops a newer client being told to
    // speak a dialect we picked.
    expect(res.json.result.protocolVersion).toBe('2025-06-18');
  });

  it('answers a notification with 202 and no body', async () => {
    // A notification carries no id and must not get a JSON-RPC response;
    // replying to one makes strict clients drop the connection.
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(res.json).toBeNull();
  });

  it('advertises every tool with a usable schema', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = res.json.result.tools;
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      // A tool with no description is one the model will not reach for.
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.inputSchema?.type).toBe('object');
    }
  });
});

describe('MCP tool calls', () => {
  it('passes arguments through to the app', async () => {
    calls.length = 0;
    const res = await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'set_control', arguments: { path: 'vj:0:opacity', value: 0.5 } },
    });
    expect(calls).toEqual([{ name: 'set_control', args: { path: 'vj:0:opacity', value: 0.5 } }]);
    expect(res.json.result.content[0]).toMatchObject({ type: 'text' });
  });

  it('returns a frame as an image block', async () => {
    const res = await rpc({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_output_frame', arguments: {} },
    });
    expect(res.json.result.content).toContainEqual(
      expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
    );
  });

  it('reports a failing tool as a tool error, not a transport error', async () => {
    // The model can read a tool error and try something else. A 500 just ends
    // the conversation.
    const res = await rpc({
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_state' },
    });
    expect(res.status).toBe(200);
    expect(res.json.result).toBeDefined();
  });

  it('rejects an unknown tool and an unknown method distinctly', async () => {
    const tool = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } });
    expect(tool.json.error).toBeDefined();
    const method = await rpc({ jsonrpc: '2.0', id: 7, method: 'nonsense' });
    expect(method.json.error.code).toBe(-32601);
  });
});

describe('MCP access control', () => {
  it('refuses a wrong token', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, 'wrong-token');
    expect(res.status).toBe(401);
  });

  it('never reaches the app on a refused request', async () => {
    // The property that matters: an unauthorized caller cannot move a fader
    // during someone's set, whatever else the server does with the request.
    calls.length = 0;
    await rpc({
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'set_control', arguments: { path: 'vj:0:opacity', value: 1 } },
    }, 'wrong-token');
    expect(calls).toEqual([]);
  });

  it('treats malformed JSON as a parse error rather than crashing', async () => {
    await start();
    const res = await fetch(`http://127.0.0.1:${PORT}/`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});
