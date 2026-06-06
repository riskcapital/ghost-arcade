// Mobile standalone audio analyser. Publishes the same uniform set the
// desktop renderer publishes (verified by 2026-06-03 shader audit):
//   audioBass, audioMid, audioHigh, audioLevel, audioBeat
// All values are normalized 0..1. `audioBeat` is a transient pulse that
// decays — the desktop codebase uses this as the dominant audio signal,
// so the standalone engine matches.

export interface AudioUniforms {
  audioBass: number;
  audioMid: number;
  audioHigh: number;
  audioLevel: number;
  audioBeat: number;
}

export const SILENT_AUDIO: AudioUniforms = {
  audioBass: 0,
  audioMid: 0,
  audioHigh: 0,
  audioLevel: 0,
  audioBeat: 0,
};

export class StandaloneAudio {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freq: Uint8Array = new Uint8Array(0);

  // Beat detection: envelope follower on the bass band.
  // When the bass exceeds (running average * threshold), pop a beat that
  // decays over ~250ms — the "still alive at silence" requirement is
  // satisfied by gentle drift, not zero.
  private bassEnv = 0;
  private bassAvg = 0;
  private beatStrength = 0;
  private lastBeatTime = 0;

  public uniforms: AudioUniforms = { ...SILENT_AUDIO };
  public ready = false;

  async start(): Promise<void> {
    if (this.ready) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.ready = true;
  }

  /** Pull one frame of audio and update the uniforms.
   *  Call from your render loop — cheap, allocates nothing. */
  update(now = performance.now()): void {
    if (!this.analyser || !this.ready) return;
    this.analyser.getByteFrequencyData(this.freq);

    // Bin split: with fftSize=1024 @ 48kHz, each bin ≈ 47Hz. We want
    // bass ≈ 0-250Hz (bins 0-5), mid ≈ 250-2kHz (bins 5-42),
    // high ≈ 2kHz-12kHz (bins 42-256). Rest discarded (too quiet to matter).
    let bassSum = 0, midSum = 0, highSum = 0;
    const f = this.freq;
    for (let i = 0; i < 5; i++) bassSum += f[i];
    for (let i = 5; i < 42; i++) midSum += f[i];
    for (let i = 42; i < 256; i++) highSum += f[i];
    const bass = bassSum / (5 * 255);
    const mid = midSum / ((42 - 5) * 255);
    const high = highSum / ((256 - 42) * 255);
    const level = (bass + mid + high) / 3;

    // Beat detection: when bass envelope spikes above running average
    // by a sensitivity-driven factor AND we haven't beat recently.
    this.bassEnv = Math.max(this.bassEnv * 0.85, bass);
    this.bassAvg = this.bassAvg * 0.99 + bass * 0.01;
    const sinceLastBeat = now - this.lastBeatTime;
    if (
      this.bassEnv > this.bassAvg * 1.5 &&
      this.bassEnv > 0.15 &&
      sinceLastBeat > 180
    ) {
      this.beatStrength = 1;
      this.lastBeatTime = now;
    } else {
      this.beatStrength *= 0.9; // ~250ms decay
    }

    this.uniforms.audioBass = bass;
    this.uniforms.audioMid = mid;
    this.uniforms.audioHigh = high;
    this.uniforms.audioLevel = level;
    this.uniforms.audioBeat = this.beatStrength;
  }

  stop(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.ctx?.close().catch(() => { /* ignore close races */ });
    this.source = null;
    this.analyser = null;
    this.ctx = null;
    this.ready = false;
    this.uniforms = { ...SILENT_AUDIO };
  }
}
