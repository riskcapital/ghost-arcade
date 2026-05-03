// Audio Texture Manager
// Creates and updates FFT and Waveform DataTextures for ISF shader audio reactivity
// Uses Uint8Array + RGBA format for universal WebGL 1.0 compatibility

import * as THREE from 'three';
import type { AudioAnalysis } from './analyzer';

export class AudioTextureManager {
  private fftTexture: THREE.DataTexture;
  private waveformTexture: THREE.DataTexture;
  private fftBuffer: Uint8Array;
  private waveformBuffer: Uint8Array;
  private textureWidth: number;

  constructor(width: number = 512) {
    this.textureWidth = width;

    // RGBA format for maximum WebGL 1.0 compatibility (no float texture extensions needed)
    // Store audio value in all RGB channels for flexible shader sampling
    this.fftBuffer = new Uint8Array(width * 4);
    this.waveformBuffer = new Uint8Array(width * 4);

    this.fftTexture = new THREE.DataTexture(
      this.fftBuffer, width, 1, THREE.RGBAFormat
    );
    this.fftTexture.minFilter = THREE.LinearFilter;
    this.fftTexture.magFilter = THREE.LinearFilter;
    this.fftTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.fftTexture.wrapT = THREE.ClampToEdgeWrapping;

    this.waveformTexture = new THREE.DataTexture(
      this.waveformBuffer, width, 1, THREE.RGBAFormat
    );
    this.waveformTexture.minFilter = THREE.LinearFilter;
    this.waveformTexture.magFilter = THREE.LinearFilter;
    this.waveformTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.waveformTexture.wrapT = THREE.ClampToEdgeWrapping;

    // Mark for initial GPU upload so shaders never sample uninitialized textures
    this.fftTexture.needsUpdate = true;
    this.waveformTexture.needsUpdate = true;
  }

  /** Update textures from current analyzer data. Call once per frame. */
  update(analysis: AudioAnalysis): void {
    const fftData = analysis.fftData;
    const waveData = analysis.waveformData;
    const binCount = Math.min(fftData.length, this.textureWidth);
    const waveCount = Math.min(waveData.length, this.textureWidth);

    // Normalize FFT: dB range [-90, -10] -> [0, 255]
    for (let i = 0; i < this.textureWidth; i++) {
      const srcIdx = Math.min(i, binCount - 1);
      const normalized = Math.max(0, Math.min(1, (fftData[srcIdx] + 90) / 80));
      const byte = (normalized * 255) | 0;
      const offset = i * 4;
      this.fftBuffer[offset]     = byte; // R
      this.fftBuffer[offset + 1] = byte; // G
      this.fftBuffer[offset + 2] = byte; // B
      this.fftBuffer[offset + 3] = 255;  // A
    }

    // Normalize waveform: [-1, 1] -> [0, 255]
    for (let i = 0; i < this.textureWidth; i++) {
      const srcIdx = Math.min(i, waveCount - 1);
      const normalized = (waveData[srcIdx] + 1.0) * 0.5;
      const byte = (Math.max(0, Math.min(1, normalized)) * 255) | 0;
      const offset = i * 4;
      this.waveformBuffer[offset]     = byte;
      this.waveformBuffer[offset + 1] = byte;
      this.waveformBuffer[offset + 2] = byte;
      this.waveformBuffer[offset + 3] = 255;
    }

    this.fftTexture.needsUpdate = true;
    this.waveformTexture.needsUpdate = true;
  }

  get fft(): THREE.DataTexture { return this.fftTexture; }
  get waveform(): THREE.DataTexture { return this.waveformTexture; }

  dispose(): void {
    this.fftTexture.dispose();
    this.waveformTexture.dispose();
  }
}

// Singleton instance
export const audioTextures = new AudioTextureManager(512);
