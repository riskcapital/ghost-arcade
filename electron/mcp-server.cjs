'use strict';

/**
 * MCP server, so an external AI client can operate Ghost Arcade.
 *
 * Hosted in the main process over HTTP rather than stdio. Stdio assumes the
 * client spawns the server and owns its lifetime; Ghost Arcade is a
 * long-running GUI that is already open when a client wants to talk to it, so
 * the app hosts and the client connects.
 *
 * Tools execute in the RENDERER, because that is where the stores live. Main
 * owns the socket and forwards each call across IPC, which is why every tool
 * here is a thin pass-through: the real surface is src/lib/mcp/mcpTools.ts.
 *
 * Two safety properties matter more than anything else here. This port can
 * black out a live show, so it binds to loopback only and every request must
 * carry a bearer token generated at enable time. Neither is a substitute for
 * the other: loopback keeps the network out, the token keeps other local
 * processes out.
 */

const http = require('http');
const { randomUUID } = require('crypto');

const HOST = '127.0.0.1';

/** Tool schemas. Kept beside the server so a client sees them without the
 *  renderer having to be up yet. */
const TOOLS = [
  {
    name: 'get_state',
    description:
      'What is loaded and what is playing: both decks, each layer\'s opacity, '
      + 'blend, solo/mute, which clip is live, and what sits in each grid cell. '
      + 'Start here before changing anything.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_controls',
    description:
      'The control-path vocabulary: every family of parameter that can be set, '
      + 'with its range. Ghost Arcade addresses everything through paths like '
      + 'vj:0:opacity, and this is the map of them.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_control',
    description:
      'Set any control path. This is the main way to operate the app: fire a '
      + 'clip, move a fader, launch a column, cross-fade, set tempo. Call '
      + 'list_controls first to see the vocabulary.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'e.g. vj:0:opacity, vj:column:2, vj:crossfader:value' },
        value: { type: 'number', description: 'Usually 0..1. Triggers fire on any value above 0.' },
      },
      required: ['path', 'value'],
    },
  },
  {
    name: 'read_control',
    description:
      'Read one control path back. Not every path is readable; the ones that '
      + 'are cover the mixer, clip and column state, and video transport.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'get_output_frame',
    description:
      'A PNG of what is on the output right now. Use it to check the result of '
      + 'a change: layer values alone do not tell you whether a composition '
      + 'reads, and this is the only way to actually see the work.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Minimal MCP over Streamable HTTP.
 *
 * Hand-rolled rather than pulled from the SDK: the surface actually needed is
 * initialize, tools/list and tools/call, and keeping it here means the whole
 * protocol path is inspectable next to the auth that guards it.
 */
function createMcpHttpServer({ token, port, callRenderer, onLog }) {
  const log = onLog || (() => {});

  async function handleRpc(message) {
    const { id, method, params } = message || {};

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params?.protocolVersion || '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'ghost-arcade', version: '1.0.0' },
          },
        };

      // Notifications carry no id and expect no response.
      case 'notifications/initialized':
        return null;

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

      case 'tools/call': {
        const name = params?.name;
        if (!TOOLS.some((t) => t.name === name)) {
          return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
        }
        try {
          const result = await callRenderer(name, params?.arguments || {});
          const content = [];
          if (result?.text) content.push({ type: 'text', text: result.text });
          if (result?.imageBase64) {
            content.push({ type: 'image', data: result.imageBase64, mimeType: 'image/png' });
          }
          if (content.length === 0) content.push({ type: 'text', text: 'Done.' });
          return { jsonrpc: '2.0', id, result: { content, isError: !!result?.isError } };
        } catch (err) {
          // Surfaced as a tool error rather than a transport error: the model
          // can read it and try something else, which it cannot do with a 500.
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Tool failed: ${err?.message || err}` }],
              isError: true,
            },
          };
        }
      }

      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    // Loopback is enforced by the bind address, but a request that arrives
    // claiming another origin is worth refusing outright rather than trusting
    // the bind to have covered it.
    const remote = req.socket.remoteAddress || '';
    if (!remote.includes('127.0.0.1') && !remote.includes('::1')) {
      return send(403, { error: 'forbidden' });
    }

    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${token}`) {
      return send(401, { error: 'unauthorized' });
    }

    if (req.method !== 'POST') {
      return send(405, { error: 'method not allowed' });
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // A client that never stops sending should not be able to exhaust memory.
      if (body.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        return send(400, jsonRpcError(null, -32700, 'Parse error'));
      }
      try {
        const response = await handleRpc(message);
        // A notification gets 202 with no body, per the transport.
        if (response === null) return send(202);
        return send(200, response);
      } catch (err) {
        log(`request failed: ${err?.message || err}`);
        return send(500, jsonRpcError(message?.id, -32603, 'Internal error'));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      log(`listening on http://${HOST}:${port}`);
      resolve(server);
    });
  });
}

module.exports = { createMcpHttpServer, TOOLS, randomUUID };
