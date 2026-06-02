// Multi-stem audio source — turns a multi-channel input device (e.g.
// BlackHole 16ch routed from a DAW) into N independent per-stem audio
// nodes that the StemRouter can mix into butterchurn (or other
// visualizers) according to a user-configured routing matrix.
//
// Each stem owns:
//   - a `sourceNode` (the per-stem audio signal after channel splitting
//     and optional stereo-pair merging) which other code can `connect()`
//     into its own destinations
//   - an `analyser` for the panel UI to show per-stem level meters
//
// The "stem layout" is user-declared up front because there's no
// metadata on a raw multi-channel stream telling us which channels are
// which DAW bus. The defaults match Demucs's 4-stem convention
// (drums / bass / vocals / other) when fed via BlackHole 16ch.

import { audioAnalyzer } from './analyzer';

export interface StemLayoutEntry {
  /** Stable id used as the matrix key. */
  id: string;
  /** Human-visible label. */
  label: string;
  /** 0-indexed input channel numbers this stem occupies. 1 entry = mono,
   *  2 entries = stereo pair merged to mono for analysis. */
  channels: number[];
}

export interface StemLayout {
  id: string;          // 'demucs-4', 'mono-2', etc.
  name: string;        // display name
  channelCount: number;
  stems: StemLayoutEntry[];
}

/** Built-in layouts. Custom layouts can be added later via UI. */
export const STEM_LAYOUTS: StemLayout[] = [
  {
    id: 'demucs-4',
    name: 'Demucs / 4-stem stereo (BlackHole 8ch+)',
    channelCount: 8,
    stems: [
      { id: 'drums',  label: 'Drums',  channels: [0, 1] },
      { id: 'bass',   label: 'Bass',   channels: [2, 3] },
      { id: 'vocals', label: 'Vocals', channels: [4, 5] },
      { id: 'other',  label: 'Other',  channels: [6, 7] },
    ],
  },
  {
    id: 'stereo-mono-4',
    name: '4 mono stems (BlackHole 4ch)',
    channelCount: 4,
    stems: [
      { id: 'stem1', label: 'Stem 1', channels: [0] },
      { id: 'stem2', label: 'Stem 2', channels: [1] },
      { id: 'stem3', label: 'Stem 3', channels: [2] },
      { id: 'stem4', label: 'Stem 4', channels: [3] },
    ],
  },
  {
    id: 'octo-mono-8',
    name: '8 mono stems (BlackHole 8ch)',
    channelCount: 8,
    stems: [
      { id: 'stem1', label: 'Stem 1', channels: [0] },
      { id: 'stem2', label: 'Stem 2', channels: [1] },
      { id: 'stem3', label: 'Stem 3', channels: [2] },
      { id: 'stem4', label: 'Stem 4', channels: [3] },
      { id: 'stem5', label: 'Stem 5', channels: [4] },
      { id: 'stem6', label: 'Stem 6', channels: [5] },
      { id: 'stem7', label: 'Stem 7', channels: [6] },
      { id: 'stem8', label: 'Stem 8', channels: [7] },
    ],
  },
];

export interface ActiveStem {
  id: string;
  label: string;
  channels: number[];
  /** Per-stem audio node — connect this to any downstream graph (e.g. the
   *  stem router that mixes into butterchurn). */
  sourceNode: AudioNode;
  /** AnalyserNode tap for per-stem level meters in the UI. */
  analyser: AnalyserNode;
}

export class MultiStemAnalyzer {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private stems: ActiveStem[] = [];
  private deviceId: string | null = null;
  private layout: StemLayout | null = null;

  /** Open the named input device with the requested channel count, build
   *  the per-stem node chain. Throws if the device doesn't deliver enough
   *  channels (the browser sometimes downmixes a 16ch device to stereo
   *  if `channelCount` isn't set explicitly). */
  async start(deviceId: string, layout: StemLayout): Promise<void> {
    await this.stop();

    const audioCtx = audioAnalyzer.getOrCreateAudioContext();
    this.audioCtx = audioCtx;
    this.deviceId = deviceId;
    this.layout = layout;

    // Request the exact device + exact channel count. Without `exact`
    // the browser silently picks the first matching device and downmixes
    // to stereo — fatal for stem routing because every stem would carry
    // the same mixed signal.
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { exact: layout.channelCount },
      } as MediaTrackConstraints,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    this.streamSource = audioCtx.createMediaStreamSource(this.stream);
    this.splitter = audioCtx.createChannelSplitter(layout.channelCount);
    this.streamSource.connect(this.splitter);

    // Build per-stem source nodes. For stereo pairs we merge L+R into
    // mono (sum + 0.5 gain) since downstream analysis is mono anyway.
    this.stems = layout.stems.map(def => {
      const merger = audioCtx.createGain();
      merger.gain.value = def.channels.length > 1 ? 1.0 / def.channels.length : 1.0;
      for (const ch of def.channels) {
        // splitter output index `ch` is the corresponding channel.
        this.splitter!.connect(merger, ch);
      }
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      merger.connect(analyser);
      return {
        id: def.id,
        label: def.label,
        channels: def.channels,
        sourceNode: merger,
        analyser,
      };
    });
  }

  /** Active stems — undefined when nothing is running. */
  getStems(): ActiveStem[] { return this.stems; }
  getStem(id: string): ActiveStem | null { return this.stems.find(s => s.id === id) ?? null; }
  getLayout(): StemLayout | null { return this.layout; }
  getDeviceId(): string | null { return this.deviceId; }
  isRunning(): boolean { return this.stems.length > 0; }

  async stop(): Promise<void> {
    if (this.streamSource) { try { this.streamSource.disconnect(); } catch {} this.streamSource = null; }
    if (this.splitter)     { try { this.splitter.disconnect(); }     catch {} this.splitter = null; }
    for (const s of this.stems) { try { s.sourceNode.disconnect(); } catch {} }
    this.stems = [];
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.deviceId = null;
    this.layout = null;
  }
}

/** Singleton — one multi-stem source serves every visualizer in the app
 *  (matches how the regular audioAnalyzer is a single global stream). */
export const multiStemAnalyzer = new MultiStemAnalyzer();
