import { writable } from 'svelte/store';
import { project } from './layers';
import type { Point2D, WarpCorners } from '../types';

interface ConnectionState {
  isHost: boolean;
  connected: boolean;
  clientCount: number;
  serverUrl: string | null;
  error: string | null;
}

function createConnectionStore() {
  const { subscribe, update } = writable<ConnectionState>({
    isHost: false,
    connected: false,
    clientCount: 0,
    serverUrl: null,
    error: null,
  });

  let ws: WebSocket | null = null;

  return {
    subscribe,

    // Connect as a client (mobile app)
    connect(url: string) {
      if (ws) {
        ws.close();
      }

      try {
        ws = new WebSocket(url);

        ws.onopen = () => {
          update((s) => ({ ...s, connected: true, error: null, serverUrl: url }));
          console.log('[WS] Connected to server');
        };

        ws.onclose = () => {
          update((s) => ({ ...s, connected: false }));
          console.log('[WS] Disconnected from server');
        };

        ws.onerror = (e) => {
          update((s) => ({ ...s, error: 'Connection failed', connected: false }));
          console.error('[WS] Error:', e);
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            handleMessage(msg);
          } catch (err) {
            console.error('[WS] Failed to parse message:', err);
          }
        };
      } catch (err) {
        update((s) => ({ ...s, error: 'Invalid URL', connected: false }));
      }
    },

    disconnect() {
      if (ws) {
        ws.close();
        ws = null;
      }
      update((s) => ({ ...s, connected: false, serverUrl: null }));
    },

    // Send control point update
    sendControlPoint(layerId: string, corner: keyof WarpCorners, position: Point2D) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'control_point',
            layerId,
            corner,
            position,
          })
        );
      }
    },

    // Send parameter update
    sendParameter(layerId: string, param: string, value: number | string | boolean) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'parameter',
            layerId,
            param,
            value,
          })
        );
      }
    },

    // Request full state sync
    requestSync() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'sync_request' }));
      }
    },
  };
}

// Handle incoming messages
function handleMessage(msg: { type: string; [key: string]: unknown }) {
  switch (msg.type) {
    case 'control_point': {
      const { layerId, corner, position } = (msg as unknown) as {
        layerId: string;
        corner: keyof WarpCorners;
        position: Point2D;
      };
      project.setCorner(layerId, corner, position);
      break;
    }

    case 'parameter': {
      const { layerId, param, value } = (msg as unknown) as {
        layerId: string;
        param: string;
        value: number | string | boolean;
      };
      if (param === 'opacity' && typeof value === 'number') {
        project.setLayerOpacity(layerId, value);
      } else if (param === 'blendMode' && typeof value === 'string') {
        project.setLayerBlendMode(layerId, value as import('../types').BlendMode);
      }
      break;
    }

    case 'sync': {
      // Full state sync from server
      const { project: projectData } = (msg as unknown) as { project: import('../types').Project };
      if (projectData) {
        project.set(projectData);
      }
      break;
    }

    default:
      console.log('[WS] Unknown message type:', msg.type);
  }
}

export const connection = createConnectionStore();

// Utility to get local IP addresses (for display to user)
export function getLocalIPs(): string[] {
  // This would need to be implemented via Tauri/Node.js backend
  // For now, return placeholder
  return ['localhost'];
}
