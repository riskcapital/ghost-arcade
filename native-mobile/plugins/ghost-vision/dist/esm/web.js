import { WebPlugin } from '@capacitor/core';

export class GhostVisionWeb extends WebPlugin {
  async getCapabilities() {
    const hasCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    return {
      available: false,
      platform: 'web',
      camera: hasCamera,
      color: hasCamera,
      depth: false,
      nativeDepth: false,
      lidar: false,
      trueDepth: false,
      segmentation: false,
      personSegmentation: false,
      preferredWidth: 1280,
      preferredHeight: 720,
      preferredFrameRate: 30,
      notes: ['Native depth and segmentation require the Ghost Arcade mobile app.'],
    };
  }

  async start() {
    throw this.unavailable('Native vision capture requires the Ghost Arcade iOS or Android app.');
  }

  async stop() {
    return {
      active: false,
      captureProfile: 'object-relief',
      capabilities: await this.getCapabilities(),
    };
  }

  async status() {
    return this.stop();
  }
}
