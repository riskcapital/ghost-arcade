import type {
  PhoneVisionCaptureProfile,
  PhoneVisionDepthPipeline,
  PhoneVisionSegmentationPipeline,
} from '../stores/phoneVision';

export type NativeVisionPlatform = 'ios' | 'android' | 'web';

export interface NativeVisionCapabilities {
  available: boolean;
  platform: NativeVisionPlatform;
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

export interface NativeVisionStatus {
  active: boolean;
  captureProfile: PhoneVisionCaptureProfile | string;
  facingMode?: 'environment' | 'user';
  capabilities: NativeVisionCapabilities;
  error?: string;
}

export interface NativeVisionRasterSample {
  kind: 'depth' | 'person-mask' | string;
  format: 'r8-depth-normalized' | 'r8-mask' | string;
  width: number;
  height: number;
  timestamp: number;
  data: string;
  minDepth?: number;
  maxDepth?: number;
}

export interface NativeVisionFrame {
  timestamp: number;
  width: number;
  height: number;
  captureProfile: PhoneVisionCaptureProfile | string;
  depth: boolean;
  depthWidth?: number;
  depthHeight?: number;
  depthSample?: NativeVisionRasterSample;
  maskSample?: NativeVisionRasterSample;
}

type PluginListenerHandle = { remove: () => Promise<void> | void };

type GhostVisionNativePlugin = {
  getCapabilities(options?: { facingMode?: 'environment' | 'user'; captureProfile?: string }): Promise<NativeVisionCapabilities>;
  start(options?: { facingMode?: 'environment' | 'user'; captureProfile?: string; frameRate?: number }): Promise<NativeVisionStatus>;
  stop(): Promise<NativeVisionStatus>;
  status(): Promise<NativeVisionStatus>;
  addListener(eventName: 'status', cb: (status: NativeVisionStatus) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'frame', cb: (frame: NativeVisionFrame) => void): Promise<PluginListenerHandle>;
};

export interface NativeVisionProfileHints {
  depthPipeline: PhoneVisionDepthPipeline;
  segmentationPipeline: PhoneVisionSegmentationPipeline;
  width: number;
  height: number;
  frameRate: number;
}

function nativePlugin(): GhostVisionNativePlugin | null {
  if (typeof window === 'undefined') return null;
  const win = window as any;
  const cap = win.Capacitor;
  if (!win.GhostVision && cap?.registerPlugin && cap?.isPluginAvailable?.('GhostVision')) {
    win.GhostVision = cap.registerPlugin('GhostVision');
  }
  return win.GhostVision
    ?? cap?.Plugins?.GhostVision
    ?? null;
}

export function isNativeVisionBridgeAvailable(): boolean {
  const plugin = nativePlugin();
  return !!plugin && typeof plugin.getCapabilities === 'function';
}

export async function getNativeVisionCapabilities(
  facingMode: 'environment' | 'user',
  captureProfile: PhoneVisionCaptureProfile,
): Promise<NativeVisionCapabilities | null> {
  const plugin = nativePlugin();
  if (!plugin) return null;
  try {
    return await plugin.getCapabilities({ facingMode, captureProfile });
  } catch {
    return null;
  }
}

export async function startNativeVisionCapture(
  facingMode: 'environment' | 'user',
  captureProfile: PhoneVisionCaptureProfile,
  frameRate: number,
): Promise<NativeVisionStatus | null> {
  const plugin = nativePlugin();
  if (!plugin) return null;
  return plugin.start({ facingMode, captureProfile, frameRate });
}

export async function stopNativeVisionCapture(): Promise<NativeVisionStatus | null> {
  const plugin = nativePlugin();
  if (!plugin) return null;
  return plugin.stop();
}

export async function getNativeVisionStatus(): Promise<NativeVisionStatus | null> {
  const plugin = nativePlugin();
  if (!plugin) return null;
  return plugin.status();
}

export async function addNativeVisionListeners(listeners: {
  status?: (status: NativeVisionStatus) => void;
  frame?: (frame: NativeVisionFrame) => void;
}): Promise<PluginListenerHandle[]> {
  const plugin = nativePlugin();
  if (!plugin) return [];
  const handles: PluginListenerHandle[] = [];
  if (listeners.status) handles.push(await plugin.addListener('status', listeners.status));
  if (listeners.frame) handles.push(await plugin.addListener('frame', listeners.frame));
  return handles;
}

export function nativeVisionProfileHints(
  caps: NativeVisionCapabilities | null,
  captureProfile: PhoneVisionCaptureProfile,
): NativeVisionProfileHints | null {
  if (!caps?.available) return null;
  const wantsPerson = captureProfile === 'person-aura';
  const wantsDepth = captureProfile === 'lidar-depth';
  return {
    depthPipeline: wantsDepth && caps.nativeDepth
      ? 'native-depth'
      : captureProfile === 'rgb-fast'
        ? 'none'
        : 'image-estimated',
    segmentationPipeline: wantsPerson && caps.personSegmentation
      ? 'person-mask'
      : captureProfile === 'rgb-fast'
        ? 'none'
        : 'object-edge',
    width: caps.preferredWidth || (captureProfile === 'rgb-fast' ? 1280 : 1920),
    height: caps.preferredHeight || (captureProfile === 'rgb-fast' ? 720 : 1080),
    frameRate: caps.preferredFrameRate || (captureProfile === 'rgb-fast' ? 60 : 30),
  };
}
