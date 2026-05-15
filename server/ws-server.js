/**
 * GhostArcade WebSocket Server
 *
 * Standalone WebSocket server for mobile control.
 * Run with: node server/ws-server.js
 *
 * This will be integrated into Tauri/Rust backend later.
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Shader library directory - in packaged Electron, extraResources land in resources/
// while __dirname is inside app.asar/server/, so we need to go up two levels to resources/
const _isPackaged = __dirname.includes('app.asar');
const SHADERS_DIR = _isPackaged
  ? path.join(__dirname, '..', '..', 'user-shaders')   // resources/user-shaders/
  : path.join(__dirname, '..', 'user-shaders');          // dev: project-root/user-shaders/

const PORT = process.env.WS_PORT || 9001;
const HTTP_PORT = process.env.HTTP_PORT || 9002;

// Get local IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }

  return ips;
}

// Create a mesh grid with uniform distribution
function createMeshGrid(rows, cols) {
  const points = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        x: c / (cols - 1),
        y: r / (rows - 1),
      });
    }
    points.push(row);
  }
  return { rows, cols, points };
}

// Current project state (synchronized from desktop app)
let projectState = {
  id: 'default',
  name: 'Untitled Project',
  width: 1920,
  height: 1080,
  layers: [],
  selectedLayerId: null,
};

// Media library state (synchronized from desktop app)
let mediaLibraryState = [];

// VJ Clip Launcher state (synchronized from desktop app)
let vjClipsState = null;

// Compositions/presets state (synchronized from desktop app)
let compositionsState = [];

// Output-frozen state (true when desktop's outputFrozen store is set).
// Cached so newly-connected mobiles see the right play/pause icon on
// the freeze pill from the moment they mount. Updated by the
// `output_freeze_state` message the desktop broadcasts on every change.
let outputFrozenState = false;

// User shader library (synchronized from desktop's shaderLibrary store).
// Mobile shader tab uses this to mirror desktop's add/remove of custom
// shaders so the picker stays in lockstep across both surfaces.
let shaderLibraryState = [];

// Connected clients
const clients = new Set();
let desktopClient = null;

// Create WebSocket server — bind to 0.0.0.0 so mobile devices on the LAN can connect
const wss = new WebSocketServer({
  host: '0.0.0.0',
  port: PORT,
  maxPayload: 10 * 1024 * 1024, // 10 MB max message size (prevents OOM DoS)
});

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                      GhostArcade Server                            ║
╠═══════════════════════════════════════════════════════════════╣
║  WebSocket Server running on port ${PORT}                       ║
║                                                               ║
║  Connect your mobile device:                                  ║`);

const ips = getLocalIPs();
for (const ip of ips) {
  console.log(`║  ws://${ip}:${PORT}`.padEnd(64) + '║');
}

console.log(`║                                                               ║
║  Or scan the QR code displayed in the desktop app             ║
╚═══════════════════════════════════════════════════════════════╝
`);

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[+] Client connected: ${clientIp}`);
  clients.add(ws);

  // Send current state to new client
  ws.send(JSON.stringify({
    type: 'sync',
    project: projectState,
  }));

  // Send media library state to new client
  if (mediaLibraryState.length > 0) {
    ws.send(JSON.stringify({
      type: 'library_sync',
      library: mediaLibraryState,
    }));
  }

  // Send VJ clips state to new client
  if (vjClipsState) {
    ws.send(JSON.stringify({
      type: 'vj_clips_sync',
      vjClips: vjClipsState,
    }));
  }

  // Send compositions state to new client
  if (compositionsState.length > 0) {
    ws.send(JSON.stringify({
      type: 'compositions_sync',
      compositions: compositionsState,
    }));
  }

  // Send current output-frozen state so the mobile pause/play pill
  // shows the right icon from the first paint.
  ws.send(JSON.stringify({
    type: 'output_freeze_state',
    frozen: outputFrozenState,
  }));

  // Send user shader library so mobile mirrors desktop's custom adds.
  if (shaderLibraryState.length > 0) {
    ws.send(JSON.stringify({
      type: 'shader_library_sync',
      shaders: shaderLibraryState,
    }));
  }

  // Broadcast client count
  broadcastClientCount();

  // Rate limiting: max 200 messages per second per client
  let msgCount = 0;
  let msgResetTime = Date.now();

  ws.on('message', (data) => {
    try {
      // Rate limit check
      const now = Date.now();
      if (now - msgResetTime > 1000) { msgCount = 0; msgResetTime = now; }
      msgCount++;
      if (msgCount > 200) { return; } // silently drop excessive messages

      const msg = JSON.parse(data.toString());
      // Basic message validation
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        console.warn('[!] Invalid message structure, ignoring');
        return;
      }
      if (msg.type.length > 64) return; // reject absurdly long type strings
      handleMessage(ws, msg);
    } catch (err) {
      console.error('[!] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected: ${clientIp}`);
    clients.delete(ws);

    if (ws === desktopClient) {
      desktopClient = null;
      console.log('[!] Desktop client disconnected');
    }

    broadcastClientCount();
  });

  ws.on('error', (err) => {
    console.error('[!] WebSocket error:', err);
    clients.delete(ws);
  });
});

function handleMessage(sender, msg) {
  switch (msg.type) {
    case 'register_desktop':
      // Desktop app registers itself as the host
      desktopClient = sender;
      console.log('[*] Desktop client registered');
      break;

    case 'sync':
      // Desktop sends full state update
      projectState = msg.project;
      // Broadcast to all other clients
      broadcast(sender, {
        type: 'sync',
        project: projectState,
      });
      break;

    case 'control_point': {
      // Mobile sends corner control point update. Validate `msg.corner` against
      // a whitelist to prevent prototype pollution via `__proto__`/`constructor`
      // and ensure `msg.position` has numeric x/y. A malicious LAN client
      // sending `{corner: '__proto__'}` could otherwise poison Object.prototype.
      //
      // The canonical key names match the WarpCorners type in src/lib/types.ts
      // (topLeft/topRight/bottomLeft/bottomRight). An earlier revision of this
      // whitelist used the shorter 'tl'/'tr'/'bl'/'br' which never matched
      // what mobile actually sends (MobileApp.svelte passes `keyof WarpCorners`
      // directly into the message), so every mapping-warp gesture from the
      // tablet was rejected at this line and the desktop never saw the drag.
      const ALLOWED_CORNERS = new Set(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
      if (!ALLOWED_CORNERS.has(msg.corner)) break;
      if (!msg.position || typeof msg.position.x !== 'number' || typeof msg.position.y !== 'number') break;
      if (!Number.isFinite(msg.position.x) || !Number.isFinite(msg.position.y)) break;
      const layer = projectState.layers.find(l => l.id === msg.layerId);
      if (layer && layer.corners) {
        layer.corners[msg.corner] = { x: msg.position.x, y: msg.position.y };
      }
      // Forward to all clients (including desktop)
      broadcastAll(msg);
      break;
    }

    case 'mesh_point': {
      // Mobile sends mesh warp point update. Validate that row/col are finite
      // non-negative integers within the existing grid bounds so a hostile
      // `row=99999, col=99999` can't allocate giant sparse arrays (OOM DoS).
      if (!Number.isInteger(msg.row) || !Number.isInteger(msg.col)) break;
      if (msg.row < 0 || msg.col < 0) break;
      if (!msg.position || typeof msg.position.x !== 'number' || typeof msg.position.y !== 'number') break;
      if (!Number.isFinite(msg.position.x) || !Number.isFinite(msg.position.y)) break;
      const meshLayer = projectState.layers.find(l => l.id === msg.layerId);
      if (meshLayer && meshLayer.meshGrid && Array.isArray(meshLayer.meshGrid.points)) {
        const row = meshLayer.meshGrid.points[msg.row];
        if (Array.isArray(row) && msg.col < row.length) {
          row[msg.col] = { x: msg.position.x, y: msg.position.y };
        }
      }
      // Forward to all clients
      broadcastAll(msg);
      break;
    }

    case 'parameter': {
      // Mobile sends parameter update. Whitelist param names and coerce value
      // types to prevent injection/pollution.
      if (typeof msg.param !== 'string') break;
      const ALLOWED_PARAMS = new Set(['opacity', 'blendMode', 'visible']);
      if (!ALLOWED_PARAMS.has(msg.param)) break;
      const targetLayer = projectState.layers.find(l => l.id === msg.layerId);
      if (targetLayer) {
        if (msg.param === 'opacity' && typeof msg.value === 'number' && Number.isFinite(msg.value)) {
          targetLayer.opacity = Math.max(0, Math.min(1, msg.value));
        } else if (msg.param === 'blendMode' && typeof msg.value === 'string' && msg.value.length < 32) {
          targetLayer.blendMode = msg.value;
        } else if (msg.param === 'visible' && typeof msg.value === 'boolean') {
          targetLayer.visible = msg.value;
        }
      }
      // Forward to all clients
      broadcastAll(msg);
      break;
    }

    case 'sync_request':
      // Client requests full state
      sender.send(JSON.stringify({
        type: 'sync',
        project: projectState,
      }));
      break;

    case 'select_layer':
      // Mobile selects a layer
      projectState.selectedLayerId = msg.layerId;
      broadcastAll(msg);
      break;

    case 'warp_mode':
      // Mobile changes warp mode (corners/mesh)
      const warpLayer = projectState.layers.find(l => l.id === msg.layerId);
      if (warpLayer) {
        warpLayer.warpMode = msg.mode;
        // Initialize mesh grid if switching to mesh and no grid exists
        if (msg.mode === 'mesh' && !warpLayer.meshGrid) {
          warpLayer.meshGrid = createMeshGrid(4, 4);
        }
      }
      broadcastAll(msg);
      break;

    case 'mesh_resize': {
      // Mobile requests mesh grid resize. Validate dims before allocating —
      // createMeshGrid multiplies rows*cols so a hostile {rows:99999,cols:99999}
      // message would OOM the server. Bounds match the slider range in
      // MobileApp's mesh UI (2..16 on each axis) with slack.
      if (!Number.isInteger(msg.rows) || !Number.isInteger(msg.cols)) break;
      if (msg.rows < 2 || msg.rows > 32 || msg.cols < 2 || msg.cols > 32) break;
      const resizeLayer = projectState.layers.find(l => l.id === msg.layerId);
      if (resizeLayer) {
        resizeLayer.meshGrid = createMeshGrid(msg.rows, msg.cols);
      }
      // Forward the message itself (not a full 'sync'). Desktop's
      // handleServerMessage has a 'mesh_resize' case that calls
      // project.setMeshGridSize; it has NO 'sync' case — a previous revision
      // of this handler broadcast {type:'sync', project} and desktop silently
      // dropped it, so mobile could resize the grid visually but desktop
      // would stay on the old dims. Mobile clients other than the sender
      // still get the fresh state via broadcastAll of the mesh_resize msg.
      broadcastAll(msg);
      break;
    }

    case 'set_layer_source':
      // Mobile triggers a media source on a layer
      // Forward to desktop to handle the actual media loading
      console.log(`[*] Set layer source: ${msg.layerId} -> ${msg.sourceType}:${msg.sourceName}`);
      broadcastAll(msg);
      break;

    case 'library_sync':
      // Desktop sends media library update
      mediaLibraryState = msg.library || [];
      console.log(`[*] Media library updated: ${mediaLibraryState.length} items`);
      // Broadcast to all other clients (mobile devices)
      broadcast(sender, {
        type: 'library_sync',
        library: mediaLibraryState,
      });
      break;

    case 'vj_clips_sync':
      // Desktop sends VJ clips update
      vjClipsState = msg.vjClips || null;
      const clipCount = vjClipsState?.blocks?.reduce((acc, b) =>
        acc + b.clipGrid.flat().filter(c => c !== null).length, 0) || 0;
      console.log(`[*] VJ clips updated: ${clipCount} clips in ${vjClipsState?.blocks?.length || 0} blocks`);
      // Broadcast to all other clients (mobile devices)
      broadcast(sender, {
        type: 'vj_clips_sync',
        vjClips: vjClipsState,
      });
      break;

    case 'compositions_sync':
      // Desktop sends compositions/presets update
      compositionsState = msg.compositions || [];
      console.log(`[*] Compositions updated: ${compositionsState.length} presets`);
      // Broadcast to all other clients (mobile devices)
      broadcast(sender, {
        type: 'compositions_sync',
        compositions: compositionsState,
      });
      break;

    // ───────────────────────────────────────────────────────────────
    //  Mobile-originated state writes
    // ───────────────────────────────────────────────────────────────
    //  All of these are user-input messages from a mobile client that
    //  the desktop should receive and apply. They use `broadcast(sender,
    //  msg)` (NOT broadcastAll) so the originating mobile client does
    //  NOT see its own message echoed back.
    //
    //  Why echo is bad: mobile applies the update OPTIMISTICALLY at
    //  pointerdown for tactile feedback. The echo would then arrive
    //  ~1 frame later carrying the same value, race the in-flight
    //  drag, and visibly fight the local optimistic state. With
    //  broadcast(sender) the desktop is the only consumer, and the
    //  authoritative state flows back via the throttled vj_clips_sync.
    //  Other mobile clients still get the message via broadcast(sender)
    //  since it goes to every OTHER client, just not the originator.
    //  (Fix v17.1)
    case 'trigger_vj_clip':
      console.log(`[*] Trigger VJ clip: layer ${msg.layerIndex}, column ${msg.columnIndex}`);
      broadcast(sender, msg);
      break;

    case 'trigger_vj_column':
      console.log(`[*] Trigger VJ column: ${msg.columnIndex}`);
      broadcast(sender, msg);
      break;

    case 'stop_vj_layer':
      console.log(`[*] Stop VJ layer: ${msg.layerIndex}`);
      broadcast(sender, msg);
      break;

    case 'stop_all_vj':
      console.log(`[*] Stop all VJ clips`);
      broadcast(sender, msg);
      break;

    case 'set_vj_block':
      console.log(`[*] Set VJ block: ${msg.blockId}`);
      broadcast(sender, msg);
      break;

    case 'set_vj_live':
      console.log(`[*] Set VJ live: ${msg.isLive}`);
      broadcast(sender, msg);
      break;

    case 'set_vj_layer_opacity':
      console.log(`[*] Set VJ layer ${msg.layerIndex} opacity: ${msg.opacity}`);
      broadcast(sender, msg);
      break;

    case 'set_vj_layer_blend_mode':
      console.log(`[*] Set VJ layer ${msg.layerIndex} blend: ${msg.blendMode}`);
      broadcast(sender, msg);
      break;

    case 'set_vj_master_opacity':
      // Broadcast master opacity changes from mobile → desktop. Without
      // this case the message was silently dropped at the server and
      // the master fader on iPad appeared to do nothing.
      broadcast(sender, msg);
      break;

    case 'load_composition':
      console.log(`[*] Load composition: ${msg.compositionId}`);
      broadcast(sender, msg);
      break;

    case 'add_vj_layer_effect':
      console.log(`[*] Add VJ layer ${msg.layerIndex} effect: ${msg.effect?.type}`);
      broadcast(sender, msg);
      break;

    case 'remove_vj_layer_effect':
      console.log(`[*] Remove VJ layer ${msg.layerIndex} effect: ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    case 'toggle_vj_layer_effect':
      console.log(`[*] Toggle VJ layer ${msg.layerIndex} effect: ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    case 'update_vj_layer_effect_params':
      console.log(`[*] Update VJ layer ${msg.layerIndex} effect params: ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    case 'update_vj_shader_value':
      console.log(`[*] Update VJ layer ${msg.layerIndex} shader param: ${msg.paramName}`);
      broadcast(sender, msg);
      break;

    // ═══ Composition effect messages ═══
    case 'add_vj_comp_effect':
      console.log(`[*] Add VJ composition effect: ${msg.effect?.type}`);
      broadcast(sender, msg);
      break;

    case 'remove_vj_comp_effect':
      console.log(`[*] Remove VJ composition effect: ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    case 'toggle_vj_comp_effect':
      console.log(`[*] Toggle VJ composition effect: ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    case 'update_vj_comp_effect_params':
      console.log(`[*] Update VJ composition effect params: ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    // ═══ Clip effect messages ═══
    case 'add_vj_clip_effect':
      console.log(`[*] Add VJ clip effect: layer ${msg.layerIndex} col ${msg.columnIndex} type ${msg.effect?.type}`);
      broadcast(sender, msg);
      break;

    case 'remove_vj_clip_effect':
      console.log(`[*] Remove VJ clip effect: layer ${msg.layerIndex} col ${msg.columnIndex} id ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    case 'toggle_vj_clip_effect':
      console.log(`[*] Toggle VJ clip effect: layer ${msg.layerIndex} col ${msg.columnIndex} id ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    case 'update_vj_clip_effect_params':
      console.log(`[*] Update VJ clip effect params: layer ${msg.layerIndex} col ${msg.columnIndex} id ${msg.effectId}`);
      broadcast(sender, msg);
      break;

    // Light painting from mobile (iPad Apple Pencil) — these are
    // many-per-frame stroke samples; the desktop is the only consumer
    // and we don't want them echoed back to the originator.
    case 'lightpainting_hover':
    case 'lightpainting_stroke_start':
    case 'lightpainting_stroke_point':
    case 'lightpainting_stroke_end':
      broadcast(sender, msg);
      break;

    // ═══ Crossfader messages (dual-deck mode) ═══
    case 'set_vj_crossfader_enabled':
    case 'set_vj_crossfader_value':
    case 'set_vj_crossfader_transition':
    case 'set_vj_crossfader_curve':
    case 'set_vj_crossfader_blend_mode':
    case 'vj_cut_to_a':
    case 'vj_cut_to_b':
      broadcast(sender, msg);
      break;

    // ═══ Quantization ═══
    case 'set_vj_quantization':
    case 'clear_vj_pending_triggers':
      broadcast(sender, msg);
      break;

    // ═══ Macros ═══
    case 'set_vj_macro_value':
      broadcast(sender, msg);
      break;

    // ═══ Snapshots ═══
    case 'recall_vj_snapshot':
    case 'save_vj_snapshot':
      broadcast(sender, msg);
      break;

    // ═══ Tempo / tap tempo ═══
    case 'vj_tap_tempo':
    case 'vj_clear_manual_bpm':
      broadcast(sender, msg);
      break;

    // ═══ Per-bank layer controls (Bank A or B) ═══
    // Reuse the existing handlers when the message includes a `bank`
    // field — desktop reads it and routes to the right deck.
    case 'toggle_vj_layer_solo':
    case 'toggle_vj_layer_mute':
      broadcast(sender, msg);
      break;

    // ═══ Beat pulse (desktop → mobile only) ═══
    // Tiny dedicated message emitted by the desktop on every detected
    // beat (rising edge of audio analyzer's isBeat). Bypasses the
    // syncVJClips throttle so the mobile TAP button can pulse in
    // tempo. Sender is always the desktop, so broadcast-to-others
    // sends only to mobile clients.
    case 'beat_pulse':
      broadcast(sender, msg);
      break;

    // ═══ Output freeze (mobile pause/play in mapping mode) ═══
    // Bidirectional: mobile sends `set_output_freeze` to ask the
    // desktop to freeze/resume; desktop replies + broadcasts
    // `output_freeze_state` so every connected client (including
    // future mobiles that connect after the toggle) shows the right
    // play/pause icon. We cache the latest value on the server so a
    // freshly-connected mobile can be told the current state on
    // connect (see initial-sync block above).
    case 'set_output_freeze':
      console.log(`[*] Mobile → set_output_freeze: ${msg.frozen}`);
      broadcast(sender, msg);
      break;
    case 'output_freeze_state':
      outputFrozenState = !!msg.frozen;
      console.log(`[*] Desktop → output_freeze_state: ${outputFrozenState}`);
      broadcast(sender, msg);
      break;

    // ═══ Shader library sync (desktop MediaTray → mobile) ═══
    // Sent by the desktop whenever its MediaTray shader list changes so
    // the mobile picker mirrors exactly what the user sees on desktop —
    // built-in catalog + user-added + AI-generated + cloud-synced.
    // Cached so newly-connected mobiles get the current list immediately.
    case 'shader_library_sync':
      shaderLibraryState = Array.isArray(msg.shaders) ? msg.shaders : [];
      console.log(`[*] Shader library updated: ${shaderLibraryState.length} shaders`);
      broadcast(sender, {
        type: 'shader_library_sync',
        shaders: shaderLibraryState,
      });
      break;

    default:
      console.log('[?] Unknown message type:', msg.type);
  }
}

// Broadcast to all clients except sender
function broadcast(sender, msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Broadcast to ALL clients including sender
function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastClientCount() {
  const count = clients.size;
  broadcastAll({
    type: 'client_count',
    count,
  });
}

// Ensure shader directory exists
function ensureShadersDir() {
  if (!fs.existsSync(SHADERS_DIR)) {
    fs.mkdirSync(SHADERS_DIR, { recursive: true });
    console.log(`[*] Created shader library directory: ${SHADERS_DIR}`);
  }
}

// Get file extension for shader type
const VALID_SHADER_TYPES = { 'shader-isf': '.fs', 'threejs': '.three.html', 'p5js': '.p5.html' };

function getShaderExtension(type) {
  return VALID_SHADER_TYPES[type] || '.shader';
}

// Get shader filename from shader object
function getShaderFilename(shader) {
  const safeName = String(shader.name || 'untitled').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
  const safeId = String(shader.id || '').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 64);
  if (!safeId) throw new Error('Invalid shader ID');
  return `${safeName}-${safeId}${getShaderExtension(shader.type)}`;
}

// Load all shaders from disk
function loadShadersFromDisk() {
  ensureShadersDir();
  const shaders = [];

  try {
    // Read index file if it exists
    const indexPath = path.join(SHADERS_DIR, 'index.json');
    if (fs.existsSync(indexPath)) {
      const indexData = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(indexData);
      return index.shaders || [];
    }
  } catch (e) {
    console.error('[!] Failed to load shader index:', e);
  }

  return shaders;
}

// Save shader to disk
function saveShaderToDisk(shader) {
  ensureShadersDir();

  try {
    // Save the shader code file
    const filename = getShaderFilename(shader);
    const filepath = path.join(SHADERS_DIR, filename);
    fs.writeFileSync(filepath, shader.code, 'utf-8');

    // Update index file
    const indexPath = path.join(SHADERS_DIR, 'index.json');
    let index = { shaders: [] };

    if (fs.existsSync(indexPath)) {
      try {
        index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      } catch (e) {
        console.warn('[!] Failed to parse shader index, creating new one');
      }
    }

    // Remove code from index entry (it's in the file)
    const indexEntry = { ...shader, filename };
    delete indexEntry.code;

    // Update or add shader in index
    const existingIndex = index.shaders.findIndex(s => s.id === shader.id);
    if (existingIndex >= 0) {
      index.shaders[existingIndex] = indexEntry;
    } else {
      index.shaders.push(indexEntry);
    }

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    console.log(`[+] Saved shader: ${filename}`);

    return true;
  } catch (e) {
    console.error('[!] Failed to save shader:', e);
    return false;
  }
}

// Delete shader from disk
function deleteShaderFromDisk(shaderId) {
  ensureShadersDir();

  try {
    const indexPath = path.join(SHADERS_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) return false;

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const shaderEntry = index.shaders.find(s => s.id === shaderId);

    if (shaderEntry) {
      // Delete the code file
      const filepath = path.join(SHADERS_DIR, shaderEntry.filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      // Remove from index
      index.shaders = index.shaders.filter(s => s.id !== shaderId);
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

      console.log(`[-] Deleted shader: ${shaderEntry.filename}`);
      return true;
    }
  } catch (e) {
    console.error('[!] Failed to delete shader:', e);
  }

  return false;
}

// Get shader with code loaded
function getShaderWithCode(shaderEntry) {
  try {
    const filepath = path.join(SHADERS_DIR, shaderEntry.filename);
    if (fs.existsSync(filepath)) {
      const code = fs.readFileSync(filepath, 'utf-8');
      return { ...shaderEntry, code };
    }
  } catch (e) {
    console.error(`[!] Failed to load shader code for ${shaderEntry.id}:`, e);
  }
  return shaderEntry;
}

// Parse request body with size limit (default 5MB)
const MAX_BODY_SIZE = 5 * 1024 * 1024;
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Simple HTTP server to serve mobile PWA and shader API
const httpServer = http.createServer(async (req, res) => {
  // Add CORS headers — allow local origins only (desktop app + mobile on LAN)
  const origin = req.headers.origin || '';
  const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', isLocalOrigin ? (origin || '*') : 'null');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);

  // Shader API endpoints
  if (url.pathname === '/api/shaders') {
    if (req.method === 'GET') {
      // List all shaders with their code
      try {
        const index = loadShadersFromDisk();
        const shadersWithCode = index.map(s => getShaderWithCode(s));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(shadersWithCode));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (req.method === 'POST') {
      // Save a new shader
      try {
        const shader = await parseBody(req);
        const success = saveShaderToDisk(shader);
        if (success) {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, id: shader.id }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to save shader' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
  }

  // Delete shader by ID
  if (url.pathname.startsWith('/api/shaders/') && req.method === 'DELETE') {
    const shaderId = url.pathname.split('/').pop();
    // Validate shader ID format (alphanumeric, hyphens, underscores only)
    if (!shaderId || !/^[a-zA-Z0-9_-]{1,128}$/.test(shaderId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid shader ID' }));
      return;
    }
    const success = deleteShaderFromDisk(shaderId);
    res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success }));
    return;
  }

  if (url.pathname === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      wsPort: PORT,
      httpPort: HTTP_PORT,
      ips: getLocalIPs(),
    }));
    return;
  }

  // ── Serve the built Svelte app for mobile devices ──
  // Resolve the dist directory (built by Vite)
  // In asar: __dirname = app.asar/server → dist is at app.asar/dist
  // In dev: __dirname = project-root/server → dist is at project-root/dist
  const distDir = path.join(__dirname, '..', 'dist');

  // CORS already set at top of handler

  // Map URL path to file in dist/
  let filePath;
  let reqPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);

  // For hash-based routing (#/mobile), always serve index.html
  filePath = path.resolve(distDir, '.' + reqPath);

  // Security: prevent path traversal outside dist directory
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // If the file doesn't exist, serve index.html (SPA fallback)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.ico': 'image/x-icon',
      '.wasm': 'application/wasm',
      '.glsl': 'text/plain',
      '.fs': 'text/plain',
      '.vs': 'text/plain',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (err) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  } else {
    // Fallback: serve a help page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ghost Arcade Mobile</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: sans-serif; padding: 20px; text-align: center; background: #111; color: #eee;">
          <h1>Ghost Arcade Mobile</h1>
          <p>WebSocket Server: ws://${getLocalIPs()[0] || 'localhost'}:${PORT}</p>
          <p>Mobile interface not found. Please rebuild the app.</p>
        </body>
      </html>
    `);
  }
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[*] HTTP server on port ${HTTP_PORT} (0.0.0.0 — LAN accessible)`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[*] Shutting down...');
  wss.close();
  httpServer.close();
  process.exit(0);
});
