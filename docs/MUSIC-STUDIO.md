# Music studio

The music studio lives in VJ mode (the **Music** button in the deck dock). A
performer plays instruments and beats, and the notes drive note-reactive
shaders, live or from a recorded take.

## How it fits together

```
letter keys ─┐
on-screen keys ┤                       ┌─ audio engine (Web Audio)
MIDI inputs ──┼─► NoteEvent ─► note bus ┼─ note visuals ─► shader inputs ─► VJ clips
step sequencer ┤                       ├─ take recorder
take replay ──┘                        └─ panel (lit keys, pads)
```

Code is in `src/lib/music/`, the panel is `src/lib/components/music/VJMusicStudio.svelte`.

### Note events (`noteEvents.ts`)

Every input becomes one shape:

| field | meaning |
| --- | --- |
| `type` | `on` / `off` |
| `instrument` | `synth`, `keys` or `drums` |
| `note` | MIDI note 0-127 (drums use the General MIDI kit notes) |
| `velocity` | 0-1 |
| `drum` | kit voice for drums: kick, snare, clap, hats, tom, rim, crash |
| `source` | keyboard, screen, midi, sequencer, replay |
| `time` | seconds on the music clock (the audio context clock) |

Live input is stamped "now"; the sequencer and replay stamp a little ahead
(120 ms look-ahead, 25 ms scheduler), so timing is sample-accurate and does
not depend on frame rate. Held notes are counted per pitch, so two inputs
holding the same note release cleanly.

### Sound (`audioEngine.ts`)

Web Audio on the app's shared `AudioContext` (interactive latency, the VJ
output device). Everything is synthesised, nothing to load or ship:

- **Synth**: two detuned oscillators, a filter with its own envelope, ADSR.
  Patches: pad, pluck, bass, lead.
- **Keys**: two-operator FM (electric piano, bells) and a drawbar organ.
- **Drums**: kick, snare, clap, closed and open hat (with choke), tom, rim, crash.

The mix also feeds the audio analyser while it listens to a mic or system
input, so the existing audio-reactive shaders follow the music too.

### Inputs

- **Letter keys** (`keyboardLayout.ts`, `musicKeyboard.ts`): A–' are a piano
  with W E T Y U O P as the black keys, Z / X shift octave, C / V velocity. Keys
  are matched by position, so the layout holds on AZERTY. With the drum kit
  selected, A–K are the eight pads. While armed, the studio takes those keys
  ahead of the single-key shortcuts and learned key bindings; modifier
  shortcuts and number keys still work, and typing in a text field never
  plays notes.
- **On-screen keys and pads**: press, slide across keys, multi-touch.
- **MIDI** (`midiNotes.ts`): every input or a chosen one, hot-plug, sustain
  pedal, all-notes-off. Channel 10 plays the kit. The studio listens beside the
  app's MIDI mapping rather than taking it over, and leaves alone notes that
  are already mapped (a pad that launches a clip) or that MIDI learn is
  waiting for.

### Note-reactive shaders (`noteVisuals.ts`, `public/ISF/NR-*.fs`)

A shader opts in by declaring ordinary ISF float inputs with these names (any
subset):

| input | meaning |
| --- | --- |
| `notePitch0`…`7` | pitch of each of 8 voices, note / 127 |
| `noteEnergy0`…`7` | brightness of each voice, its envelope times velocity |
| `noteVoice0`…`7` | instrument of each voice (0 synth, 1 keys, 2 drums) |
| `noteLevel` | everything playing, 0-1 |
| `noteHit` | a short flash on every note-on |
| `noteBuild` | grows with each note, leaks away slowly |
| `noteEvolve` | a clock that only runs while notes sound |
| `noteLast` | pitch of the latest note |
| `noteCount` | notes held |
| `noteBuilding` | 1 when the latest instrument is in build mode |
| `drumKick`, `drumSnare`, `drumHat`, `drumPerc` | drum envelopes |

Each frame the studio advances the visuals to the audio clock and writes
these values into every playing VJ shader clip that declares them, through
the per-frame path modulation already uses (`batchUpdateShaderValues`). Both
the browser renderer and the native render core read clip values from there,
so note shaders work on both paths with no new render-core commands. The VJ
parameter panel hides these inputs, since they are played, not set.

**Fade or build.** Each instrument has a mode:

- *Fade*: an ADSR envelope; visuals rise, settle and fade after release.
- *Build*: voices hold while played and linger long after release, and every
  note adds to `noteBuild`, so the picture accumulates and evolves.

A shader can override the instrument with its own `noteMode` input (a long:
follow instrument, fade, build), which the performer sets per clip in the
normal parameter panel. Envelopes are pure functions of note times, so a
replayed take produces the same picture as the live performance.

Shipped shaders (category "Note Reactive"): **Note Bloom** (orbs on a pitch
wheel), **Chord Rings** (a ring per pitch that widens as it fades), **Note
Ink** (pitch-driven brushes on a persistent canvas), **Beat Grid** (a tile wall
played by the drums). The panel's "Add to deck" puts one in the next free
slot and plays it.

### Recording and replay (`recording.ts`, `drumPattern.ts`)

A take is the note events of a performance in seconds from its start, plus a
copy of the beat pattern if the sequencer was playing. The sequencer's notes
are in the events, so replaying the events alone reproduces the song (and so
its visuals); the pattern copy can be loaded back into the sequencer. Notes
still held at the stop are closed, retriggers close the held note first, and
replayed notes are never recorded into a new take. Replay plays once or
loops, and stops every note it started when stopped.

The step sequencer is 8 kit rows × 8/16/32 sixteenth steps with velocity and
swing. It runs on the VJ launch clock's beats, so it stays in phase with
quantized launches, tapped tempo and Ableton Link.

### Saving (`musicStudioStore.ts`)

The `musicStudio` section of the project file:

```json
{
  "schemaVersion": 1,
  "instrument": "keys",
  "synthPatch": "pad", "keysPatch": "epiano",
  "volumes": { "synth": 0.8, "keys": 0.8, "drums": 0.9 }, "masterVolume": 0.85,
  "visuals": { "synth": { "mode": "fade", "attack": 0.02, "decay": 0.4, "sustain": 0.65, "release": 0.9, "linger": 8, "growth": 0.06 }, "keys": {}, "drums": {} },
  "octave": 4, "velocity": 0.8,
  "pattern": { "steps": 16, "swing": 0, "tracks": { "kick": [1, 0, 0, 0] } },
  "takes": [{ "id": "…", "name": "Take 1", "createdAt": 0, "length": 12.5, "bpm": 124,
              "events": [{ "t": 0.1, "type": "on", "instrument": "keys", "note": 64, "velocity": 0.7 }],
              "pattern": null }]
}
```

It saves with .gha files, autosave recovery and Export Package (all use the
project export), and File > New resets it. Reading it back fills in anything
missing and drops malformed events. The MIDI input choice is per computer and
kept in local storage. Live state relayed between windows never touches the
studio, so a song keeps playing.

## Phases

1. **Done**: instruments (synth, keys, drum kit), letter / on-screen / MIDI
   input with hot-plug, step sequencer on the VJ clock, fade and build note
   visuals, four note-reactive shaders, recording and replay, project save.
2. **Next**:
   - Replay in offline render: give the studio a `seek(time)` driven by the
     export clock, so a recorded song renders frame-accurately (audio
     included).
   - Note state on mapping-mode shader layers, not only VJ clips.
   - Takes in VJ compositions and stage presets, and in undo.
   - A dedicated low-latency note channel to the render core (a small
     per-frame `set_note_state` command and a `NOTES[16]` uniform block), for
     more voices and less per-frame traffic than clip inputs.
   - Thumbnails for the note shaders; a few more shaders.
3. **Later**: per-take editing (quantize, trim, overdub), more instruments
   and sample kits, MIDI out to hardware, exporting a take as a MIDI file.
