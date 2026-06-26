import type { PluginListenerHandle } from '@capacitor/core';

export interface GhostVisionCapabilities {
  available: boolean;
  platform: 'ios' | 'android' | 'web';
  facingMode?: 'environment' | 'user';
  camera: boolean;
  color: boolean;
  depth: boolean;
  nativeDepth: boolean;
  lidar: boolean;
  trueDepth: boolean;
  segmentation: boolean;
  personSegmentation: boolean;
  preferredWidth: number;
  preferredHeight: number;
  preferredFrameRate: number;
  notes?: string[];
}

export interface GhostVisionStatus {
  active: boolean;
  captureProfile: string;
  facingMode?: 'environment' | 'user';
  capabilities: GhostVisionCapabilities;
  error?: string;
}

export interface GhostVisionRasterSample {
  kind: 'depth' | 'person-mask' | string;
  format: 'r8-depth-normalized' | 'r8-mask' | string;
  width: number;
  height: number;
  timestamp: number;
  data: string;
  minDepth?: number;
  maxDepth?: number;
}

export interface GhostVisionFrame {
  timestamp: number;
  width: number;
  height: number;
  captureProfile: string;
  depth: boolean;
  depthWidth?: number;
  depthHeight?: number;
  depthSample?: GhostVisionRasterSample;
  maskSample?: GhostVisionRasterSample;
}

export interface GhostVisionPlugin {
  getCapabilities(options?: { facingMode?: 'environment' | 'user'; captureProfile?: string }): Promise<GhostVisionCapabilities>;
  start(options?: { facingMode?: 'environment' | 'user'; captureProfile?: string; frameRate?: number }): Promise<GhostVisionStatus>;
  stop(): Promise<GhostVisionStatus>;
  status(): Promise<GhostVisionStatus>;
  addListener(eventName: 'status', listenerFunc: (status: GhostVisionStatus) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'frame', listenerFunc: (frame: GhostVisionFrame) => void): Promise<PluginListenerHandle>;
}

export declare const GhostVision: GhostVisionPlugin;
