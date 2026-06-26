import type { PluginListenerHandle } from '@capacitor/core';

export interface GhostOscArg {
  type: string;
  value: number | string | boolean;
}

export interface GhostOscMessage {
  address: string;
  args: GhostOscArg[];
  from: string;
  port: number;
  receivedAt: number;
}

export interface GhostOscStatus {
  listening: boolean;
  port: number;
  error?: string;
}

export interface GhostOscPlugin {
  start(options: { port: number }): Promise<GhostOscStatus>;
  stop(): Promise<GhostOscStatus>;
  status(): Promise<GhostOscStatus>;
  addListener(eventName: 'message', listenerFunc: (message: GhostOscMessage) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'status', listenerFunc: (status: GhostOscStatus) => void): Promise<PluginListenerHandle>;
}

export declare const GhostOsc: GhostOscPlugin;
