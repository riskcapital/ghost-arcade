/**
 * MIDI Time Code.
 *
 * QUARTER FRAMES (F1 0nnn dddd) carry one nibble of the label each; eight of
 * them, sent four per frame, spell out a whole HH:MM:SS:FF plus the rate
 * code, so a complete label arrives every two frames:
 *
 *   0 frames lo   1 frames hi   2 secs lo   3 secs hi
 *   4 mins lo     5 mins hi     6 hours lo  7 0rrh (rate, hours bit 4)
 *
 * Piece 0 goes out at the start of the labelled frame, piece 7 a frame and
 * three quarters later, so at the moment piece 7 lands "now" is the label
 * plus 1.75 frames. That is the anchor this parser reports.
 *
 * FULL FRAMES (F0 7F <dev> 01 01 hr mn sc fr F7) are a locate: the sender
 * jumped or is parked there. They carry the whole label at once and mean the
 * transport is not (yet) running.
 *
 * Rate codes: 0 = 24, 1 = 25, 2 = 29.97 drop-frame, 3 = 30.
 */

import {
  actualFps,
  frameNumberToTimecode,
  timecodeToFrameNumber,
  timecodeToSeconds,
  type Timecode,
  type TimecodeRate,
} from './timecode';

const RATE_CODES: TimecodeRate[] = [24, 25, 29.97, 30];

export function mtcRateCode(rate: TimecodeRate): number {
  return rate === 24 ? 0 : rate === 25 ? 1 : rate === 29.97 ? 2 : 3;
}

export interface MtcEvent {
  kind: 'quarter-frame' | 'full-frame';
  timecode: Timecode;
  /** Show-clock seconds at `atMs`: the label's start plus 1.75 frames for a
   *  completed quarter-frame sequence, the label itself for a full frame. */
  seconds: number;
  /** Arrival time of the message that completed the event. */
  atMs: number;
  /** True for a running quarter-frame stream, false for a locate. */
  running: boolean;
}

export class MtcParser {
  private pieces = new Array<number>(8).fill(0);
  private seen = 0;
  private lastPiece = -1;
  private sysex: number[] | null = null;

  reset(): void {
    this.pieces.fill(0);
    this.seen = 0;
    this.lastPiece = -1;
    this.sysex = null;
  }

  /**
   * Feed raw MIDI bytes (one message, or a run of them) with the arrival
   * time. Returns every event the bytes completed. Anything that is not MTC
   * is skipped, including realtime bytes interleaved inside a SysEx.
   */
  feed(bytes: ArrayLike<number>, atMs: number): MtcEvent[] {
    const events: MtcEvent[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i] & 0xff;
      if (this.sysex) {
        if (byte >= 0xf8) continue; // realtime may interleave
        if (byte === 0xf7) {
          const ev = this.parseSysex(this.sysex, atMs);
          if (ev) events.push(ev);
          this.sysex = null;
          continue;
        }
        if (byte & 0x80) {
          // Any other status aborts the SysEx.
          this.sysex = null;
        } else {
          if (this.sysex.length < 32) this.sysex.push(byte);
          continue;
        }
      }
      if (byte === 0xf0) {
        this.sysex = [];
        continue;
      }
      if (byte === 0xf1 && i + 1 < bytes.length) {
        const data = bytes[++i] & 0x7f;
        const ev = this.quarterFrame(data >> 4, data & 0x0f, atMs);
        if (ev) events.push(ev);
      }
    }
    return events;
  }

  private quarterFrame(piece: number, nibble: number, atMs: number): MtcEvent | null {
    // Only a strictly ascending run counts. A reverse or scrambled stream
    // (tape rewinding, dropped bytes) restarts the assembly.
    if (piece === 0) {
      this.seen = 0;
    } else if (piece !== this.lastPiece + 1) {
      this.seen = 0;
      this.lastPiece = -1;
      return null;
    }
    this.pieces[piece] = nibble;
    this.seen |= 1 << piece;
    this.lastPiece = piece;
    if (piece !== 7 || this.seen !== 0xff) return null;
    const p = this.pieces;
    const rate = RATE_CODES[(p[7] >> 1) & 0x3];
    const tc: Timecode = {
      frames: p[0] | ((p[1] & 0x1) << 4),
      seconds: p[2] | ((p[3] & 0x3) << 4),
      minutes: p[4] | ((p[5] & 0x3) << 4),
      hours: p[6] | ((p[7] & 0x1) << 4),
      rate,
      dropFrame: rate === 29.97,
    };
    this.lastPiece = -1;
    this.seen = 0;
    if (!validTimecode(tc)) return null;
    return {
      kind: 'quarter-frame',
      timecode: tc,
      seconds: timecodeToSeconds(tc) + 1.75 / actualFps(rate),
      atMs,
      running: true,
    };
  }

  private parseSysex(body: number[], atMs: number): MtcEvent | null {
    // body excludes F0/F7: 7F <device> 01 01 hr mn sc fr
    if (body.length < 8 || body[0] !== 0x7f || body[2] !== 0x01 || body[3] !== 0x01) return null;
    const hr = body[4];
    const rate = RATE_CODES[(hr >> 5) & 0x3];
    const tc: Timecode = {
      hours: hr & 0x1f,
      minutes: body[5] & 0x3f,
      seconds: body[6] & 0x3f,
      frames: body[7] & 0x1f,
      rate,
      dropFrame: rate === 29.97,
    };
    if (!validTimecode(tc)) return null;
    // A locate also invalidates any half-assembled quarter-frame word.
    this.seen = 0;
    this.lastPiece = -1;
    return { kind: 'full-frame', timecode: tc, seconds: timecodeToSeconds(tc), atMs, running: false };
  }
}

function validTimecode(tc: Timecode): boolean {
  const fps = tc.rate === 29.97 ? 30 : tc.rate;
  if (tc.hours > 23 || tc.minutes > 59 || tc.seconds > 59 || tc.frames >= fps) return false;
  if (tc.dropFrame && tc.frames < 2 && tc.seconds === 0 && tc.minutes % 10 !== 0) return false;
  return true;
}

// ─── Generators (tests, and a loopback self-test) ────────────────────────

/** The eight quarter-frame messages that spell `tc`, as [0xF1, data] pairs. */
export function mtcQuarterFrames(tc: Timecode): number[][] {
  const code = mtcRateCode(tc.rate);
  const nibbles = [
    tc.frames & 0xf,
    (tc.frames >> 4) & 0x1,
    tc.seconds & 0xf,
    (tc.seconds >> 4) & 0x3,
    tc.minutes & 0xf,
    (tc.minutes >> 4) & 0x3,
    tc.hours & 0xf,
    ((tc.hours >> 4) & 0x1) | (code << 1),
  ];
  return nibbles.map((n, piece) => [0xf1, (piece << 4) | n]);
}

/** A full-frame locate message for `tc`. */
export function mtcFullFrame(tc: Timecode, deviceId = 0x7f): number[] {
  const hr = (mtcRateCode(tc.rate) << 5) | (tc.hours & 0x1f);
  return [0xf0, 0x7f, deviceId & 0x7f, 0x01, 0x01, hr, tc.minutes, tc.seconds, tc.frames, 0xf7];
}

export interface MtcStreamMessage {
  bytes: number[];
  atMs: number;
}

/**
 * A running quarter-frame stream from `start` for `frameCount` frames (must
 * be even: one label per two frames), timestamped at 4 messages per frame.
 */
export function mtcQuarterFrameStream(start: Timecode, frameCount: number, startMs = 0): MtcStreamMessage[] {
  const out: MtcStreamMessage[] = [];
  const frameMs = 1000 / actualFps(start.rate);
  const first = timecodeToFrameNumber(start);
  for (let f = 0; f < frameCount; f += 2) {
    const tc = frameNumberToTimecode(first + f, start.rate, start.dropFrame);
    const qfs = mtcQuarterFrames(tc);
    for (let q = 0; q < 8; q++) {
      out.push({ bytes: qfs[q], atMs: startMs + (f + q / 4) * frameMs });
    }
  }
  return out;
}
