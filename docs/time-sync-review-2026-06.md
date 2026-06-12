# Time-Sync / MIDI Clock Review — vs pro VJ apps (2026-06-12)

Triggered by a user asking "can the LFO sync to MIDI clock?" Full audit
of the DJ-sync domain vs Resolume Arena / VDMX / Modul8.

## Answer to the user's question: YES, it already works

Enable **MIDI clock-in** (`src/lib/midi/midiManager.ts`) and set
**`bpmSync: true`** on any LFO (`src/lib/audio/modulation.ts:115-125,
1300-1316`). Incoming 0xF8 timing-clock ticks (24 PPQN, averaged over a
48-tick window) drive `audioStore.manualBPM`; a bpm-synced LFO's speed
then means beat divisions (speed 1 = 1 cycle/beat, 0.25 = one cycle
per 4 beats, 4 = sixteenths) instead of Hz.

## What we have today

- **MIDI clock receive** — BPM from tick intervals, 30–300 BPM guard,
  stale detection (>500ms → stopped). `midiManager.ts:23-355`.
- **MIDI clock send** — 0xFA/0xFC/0xF8 out at the master BPM; source
  cascade: clock-in → tap tempo → audio estimate → 120.
- **Tap tempo** + **audio BPM estimation** with a confidence metric,
  energy-based beat detection, kick/snare onset modulation sources.
- **Clip-launch quantization grid** (off / 1/4 / 1/2 / 1bar / 2bar /
  4bar) — schema + pending-trigger machinery in `vjClipLauncher.ts`.
- **OSC learn** routed through the same dispatch as MIDI (params only).

## Gaps vs Resolume / VDMX, ranked for DJ workflows

1. **Ableton Link** — ✅ SHIPPED 2026-06-12. Native addon
   (`electron/native/link_addon.cpp`, vendor at `vendor/link`),
   main-process singleton + IPC, renderer bridge
   (`src/lib/sync/abletonLink.ts`) polling at 4Hz with local phase
   extrapolation; tempo bidirectional with `audioStore.manualBPM`
   (running MIDI clock-in takes priority). Toggle in Settings → MIDI.
   Verified: two-peer discovery, tempo propagation both directions.
   ⚠️ LICENSING: vendor is GPLv2 — request Ableton's no-cost
   commercial Link license (link-devs@ableton.com) BEFORE shipping a
   release with Link enabled.
2. **MIDI clock mirror/throughput** (HIGH, trivial) — re-send incoming
   0xF8 to a second output device (lighting rig, second machine).
   ~30 lines in midiManager + a checkbox.
3. **LFO phase-lock to clock ticks** (MEDIUM) — our LFO phase is
   wall-clock; clock-in drives BPM but not phase, so strobes can
   micro-drift vs Resolume's tick-locked oscillators. Fix: when
   clock-in is running, derive LFO phase from tick count instead of
   time (~40 lines in modulation.ts).
4. **Beat-confidence auto-fallback** (LOW, ~15 lines) — auto-prefer
   clock-in when audio BPM confidence drops.
5. **Tap tempo as MIDI-learnable action** (LOW, ~20 lines) — bind a
   pad/foot pedal to tap.
6. **SMPTE/MTC timecode** (defer) — arena/fixed-script shows only.
7. **Denon StagelinQ / Pioneer Pro DJ Link** (skip) — very niche.

## Recommended build order

Clock mirror (1–2 days) → LFO tick phase-lock (2–3 days) → Ableton
Link addon (1–2 weeks, can start in parallel) → confidence fallback +
tap action + a "Syncing with your DJ" docs page.

## Electron/Web-MIDI quirks worth remembering

- Chromium delivers 0xF8 only to inputs with an active `onmidimessage`
  listener — midiManager installs one at boot, so we're safe.
- `MIDIOutput.send(bytes, timestamp)` scheduling is parsed but ignored
  in Chromium — our setTimeout-based clock-out has ~1ms jitter vs the
  <100µs native apps get from CoreMIDI/WinMM. Acceptable for visuals.
