import { writable } from 'svelte/store';

export const PHONE_CAMERA_MEDIA_ID = 'phone-camera-live';
export const PHONE_CAMERA_SOURCE_PREFIX = 'live://phone-camera';

export type PhoneVisionStatus = 'idle' | 'connecting' | 'live' | 'failed';
export type PhoneVisionTransport = 'native-rtc' | 'browser-rtc';
export type PhoneVisionEffectKind = 'aura' | 'point-cloud';
export type PhoneVisionCaptureProfile = 'rgb-fast' | 'object-relief' | 'person-aura' | 'lidar-depth';
export type PhoneVisionDepthPipeline = 'none' | 'image-estimated' | 'native-depth';
export type PhoneVisionSegmentationPipeline = 'none' | 'person-mask' | 'object-edge';
export type PhoneVisionPointCloudPreset = 'object-relief' | 'human-ghost' | 'liquid-swarm';
export type PhoneVisionAuraPreset = 'body-glow' | 'object-halo' | 'edge-trace';

export interface PhoneVisionPreset<T extends string = string> {
  id: T;
  label: string;
}

export const PHONE_VISION_POINT_CLOUD_PRESETS: PhoneVisionPreset<PhoneVisionPointCloudPreset>[] = [
  { id: 'object-relief', label: 'Object Relief' },
  { id: 'human-ghost', label: 'Human Ghost' },
  { id: 'liquid-swarm', label: 'Liquid Swarm' },
];

export const PHONE_VISION_AURA_PRESETS: PhoneVisionPreset<PhoneVisionAuraPreset>[] = [
  { id: 'body-glow', label: 'Body Glow' },
  { id: 'object-halo', label: 'Object Halo' },
  { id: 'edge-trace', label: 'Edge Trace' },
];

export interface PhoneVisionCaptureProfileConfig extends PhoneVisionPreset<PhoneVisionCaptureProfile> {
  depthPipeline: PhoneVisionDepthPipeline;
  segmentationPipeline: PhoneVisionSegmentationPipeline;
  width: number;
  height: number;
  frameRate: number;
}

export const PHONE_VISION_CAPTURE_PROFILES: PhoneVisionCaptureProfileConfig[] = [
  {
    id: 'rgb-fast',
    label: 'RGB Fast',
    depthPipeline: 'none',
    segmentationPipeline: 'none',
    width: 1280,
    height: 720,
    frameRate: 60,
  },
  {
    id: 'object-relief',
    label: 'Object Relief',
    depthPipeline: 'image-estimated',
    segmentationPipeline: 'object-edge',
    width: 1280,
    height: 720,
    frameRate: 30,
  },
  {
    id: 'person-aura',
    label: 'Person Aura',
    depthPipeline: 'image-estimated',
    segmentationPipeline: 'person-mask',
    width: 1280,
    height: 720,
    frameRate: 30,
  },
  {
    id: 'lidar-depth',
    label: 'LiDAR Depth Ready',
    depthPipeline: 'native-depth',
    segmentationPipeline: 'object-edge',
    width: 1920,
    height: 1080,
    frameRate: 30,
  },
];

export function phoneVisionCaptureProfileConfig(
  profile: PhoneVisionCaptureProfile = 'object-relief',
): PhoneVisionCaptureProfileConfig {
  return PHONE_VISION_CAPTURE_PROFILES.find(item => item.id === profile) ?? PHONE_VISION_CAPTURE_PROFILES[1];
}

export interface PhoneVisionCalibrationPoint {
  x: number;
  y: number;
  index: number;
}

export interface PhoneVisionCapabilities {
  transport: PhoneVisionTransport;
  captureProfile: PhoneVisionCaptureProfile;
  depthPipeline: PhoneVisionDepthPipeline;
  segmentationPipeline: PhoneVisionSegmentationPipeline;
  color: boolean;
  depth: boolean;
  nativeDepth: boolean;
  segmentation: boolean;
  calibration: boolean;
  facingMode: 'environment' | 'user';
  width: number;
  height: number;
  frameRate: number;
}

export interface PhoneVisionNativeRasterSample {
  kind: 'depth' | 'person-mask' | string;
  format: 'r8-depth-normalized' | 'r8-mask' | string;
  width: number;
  height: number;
  timestamp: number;
  data: string;
  minDepth?: number;
  maxDepth?: number;
}

export interface PhoneVisionNativeFrame {
  timestamp: number;
  width: number;
  height: number;
  captureProfile: PhoneVisionCaptureProfile;
  facingMode: 'environment' | 'user';
  depth: boolean;
  depthSample?: PhoneVisionNativeRasterSample;
  maskSample?: PhoneVisionNativeRasterSample;
}

export interface PhoneVisionActiveLayer {
  id: string;
  kind: PhoneVisionEffectKind;
  preset: PhoneVisionPointCloudPreset | PhoneVisionAuraPreset;
  calibrated: boolean;
}

export interface PhoneVisionState {
  status: PhoneVisionStatus;
  sessionId: string | null;
  label: string;
  error: string;
  capabilities: PhoneVisionCapabilities;
  nativeFrame: PhoneVisionNativeFrame | null;
  calibrationPoints: PhoneVisionCalibrationPoint[];
  activeLayers: PhoneVisionActiveLayer[];
  lastEffect: PhoneVisionEffectKind | null;
}

export function defaultPhoneVisionCapabilities(
  facingMode: 'environment' | 'user' = 'environment',
  captureProfile: PhoneVisionCaptureProfile = 'object-relief',
): PhoneVisionCapabilities {
  const profile = phoneVisionCaptureProfileConfig(captureProfile);
  return {
    transport: 'native-rtc',
    captureProfile,
    depthPipeline: profile.depthPipeline,
    segmentationPipeline: profile.segmentationPipeline,
    color: true,
    depth: profile.depthPipeline !== 'none',
    nativeDepth: profile.depthPipeline === 'native-depth',
    segmentation: profile.segmentationPipeline !== 'none',
    calibration: true,
    facingMode,
    width: profile.width,
    height: profile.height,
    frameRate: profile.frameRate,
  };
}

export function defaultPhoneVisionState(): PhoneVisionState {
  return {
    status: 'idle',
    sessionId: null,
    label: 'Phone Camera',
    error: '',
    capabilities: defaultPhoneVisionCapabilities(),
    nativeFrame: null,
    calibrationPoints: [],
    activeLayers: [],
    lastEffect: null,
  };
}

export const phoneVision = writable<PhoneVisionState>(defaultPhoneVisionState());
