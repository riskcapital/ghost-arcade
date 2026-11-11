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
  waiting for. Inputs set to **Band keys** are left to the band's keys (see
  MIDI controllers and the band's keys below), so their notes do not play twice.

### Mixer (`mixer.ts`, `components/music/MixerPanel.svelte`)

The **Mixer** tab under the studio has a strip for each instrument of the
set and one for the live input. Each instrument's volume feeds its strip:
a low shelf (180 Hz), a mid peak (1.1 kHz) and a high shelf (4.8 kHz), each
±15 dB, then pan, then a mute/solo gate, then the FX rack or the mix. The
fader is the instrument's volume, so scenes, the bath morph and the dub drop
still move it. Solo only counts among the set's channels. A meter reads after
each strip. The strips are saved with the project (`mixer`).

### Band inputs (`liveInput.ts`, `bandInputs.ts`, `inputTracker.ts`)

Up to four instruments on audio inputs (bass and guitar on an interface, a
vocal mic) play through their own input strips and drive the visual voices.
Each input has a name, a device (kept per computer), a channel of that device
(**Mix** hears every channel together; a stereo interface sends its two
inputs as channels 1 and 2), what the visuals see it as (Lead, Bass, Kick...),
how quietly it can be played and still count (**Sens**), whether it is heard
(**Monitor**; off, it only drives the visuals and the band effects), and an
**FX** send into the band effects (the looper records each input at its own
level, whatever its send). A new input starts with Monitor off: the band's
dry sound stays on the band's desk, so it is not doubled in the room and the
desk cannot feed the studio's output back into itself. **Add input** starts
the next one on the same device and the next channel; added to an input
that hears every channel mixed, it splits them (the first input takes
channel 1, the new one channel 2), the usual bass and guitar on a stereo
interface. Each device is opened once and split into its
channels; a channel the device does not send says so instead of staying
silent. An interface that is unplugged mid-set (or not there when listening
starts) is waited for: when the computer reports a device plugged in, it is
opened again and its inputs come back by themselves; only a device that was
refused or is busy ends the listening. Call-audio processing (echo
cancelling, noise suppression, auto gain) is off. The inputs are saved with the project (`liveInputs`); a project from
before has its one input as the first.

The tracker reads the raw signal about 80 times a second, on its own timer:
a hit is a jump of 6 dB or more over the recent level, above the gate;
pitch comes from the normalised autocorrelation and only counts when the
block is clearly periodic (one string or one voice; a strummed chord gives
hits and level but no pitch); a held note that slides to a new pitch and
stays there becomes a new note; a note ends 6 dB under the gate. The notes go
straight to the visual voices (`pushOutsideNote`) and never play a studio
instrument. An input playing the bass listens down to a bass's low E; an
input set to a drum sound skips pitch.

### The sound library (`sounds/`, `soundSlots.ts`)

Every sound a bowl or an FX pad can play lives in one library
(`sounds/library.ts`), in five groups: bowls and bells (struck, pitched,
ringing: singing and crystal bowls, gong, temple and tubular bells, wind
chimes, kalimba, handpan, glass harmonica, music box, tongue drum, marimba),
dub (the eight original shots plus air horn, rewind, dub stab, spring
crash, siren rise, melodica, vinyl stop), risers and drops (timed in bars at
the tempo and landing on the next bar line), impacts, and atmospheres
(textures that start on one press and stop on the next: rain, wind, ocean,
crackle, night, fire, radio, underwater, heartbeat, choir breath, hum). Each
is plain Web Audio built from `time` on whatever context it is given
(`sounds/kit.ts`), so the same code plays live and renders offline.

**Bowls**: each of the five bowls has its own sound and octave
(**Sounds** in the bowls module), or a whole bowl set at once (Singing,
Crystal, Temple, Garden, Glass, Mallets). Ring, Tone and Spread work on every
bowl sound (Ring at its default is each sound's natural length).

**FX pads**: each set has eight pads, each holding any library sound
(**Sounds** in the pads module, with Size, Tail and Tone). A one-shot holds
its note for as long as it sounds, so a voice following "Shots and siren"
builds with a riser and falls with a drop. A project saved before pads could
be chosen keeps the original eight shots on every set.

**Drone**: the drone's sound is a pad patch (`sounds/padPatches.ts`): Warm
(the original), Choir, Strings, Glass, Shimmer, Breath, Harmonium, Dark
matter. All eight drone knobs work on every patch.

### Playing with a band (`bandFx.ts`, `keyFinder.ts`, `components/music/BandPanel.svelte`)

The **Live band** tab treats the live input as the band (feed it the desk's aux
send) and works it the way a dub engineer works the desk. Only effects come
back from the studio; the band's dry sound stays on the band's desk.

- **Echo**: a tape-like echo in time with the tempo (1/8, dotted 1/8, 1/4,
  dotted 1/4, 1/2). **Throw** opens the send fully while held and the
  repeats run on after; **Send** sets a steady amount; **Repeats** and
  **Tone** shape the tail. The echo washes into the reverb a little.
- **Reverb**: a long, soft room. **Wash** opens it fully while held.
- **Freeze**: holds the last moment of sound (the band and the studio) as
  a texture: short overlapping grains read from random points of that
  moment, an octave down, as played or an octave up, until it is let go.
  An audio worklet (`freezeWorklet.ts`) keeps the last four seconds.
- **Band's key**: **Listen** weighs the pitched notes coming in (the live input and
  Live's MIDI clips; level hits from Live's audio tracks do not count)
  against the major and minor key profiles, and shows the key it hears and
  how sure it is. **Use key** puts the studio in it, so the bowls, chords,
  drone, dub stab and tuned pads play along.

**With the band** (in the band inputs group):

- **Duck**: each hit on an input set to Kick dips the drone, the bowls, the
  FX pads and the synth (in 5 ms, scheduled at the hit) by the depth chosen;
  they come back over **Release**. A MIDI kick from the band's keys ducks
  them too.
- **Follow bass**: chords held on the drone move along the key so their root
  lands on the note the bass input (or a MIDI bass) is playing. A note must
  hold for 150 ms before the chords move; a note outside the key goes to the
  nearest one in it. The studio's key never changes, and turning it off puts
  the chords back on the key's root.

**Looper** (`bandLooper.ts`, `looperWorklet.ts`, `looperRuntime.ts`,
`sounds/chops.ts`): **Record** takes 1, 2, 4 or 8 bars of the band from the
next bar line (it counts in), frame-exact against the launch clock, into loop
A or B, and the loop plays on in time from the bar it ends on. Pressing
Record while it counts in cancels; while it records, it ends on the next bar
line. Play starts a stopped loop on the next bar line in the phase it was
recorded in; Stop is immediate. Loops follow tempo changes of up to 3%; past
that a loop keeps its own length and says so. **Chop to pads** slices the
loop into eight and puts the slices on the set's FX pads (they answer the
pads' Size, Tail and Tone); **Put back pads** restores what was there. Chops
last until the studio closes and are never saved: the project file and a
song keep what the pads held before they were chopped. The looper records
each band input at its own level, before its effects send. A recording is
capped at 32 seconds.

**Timing**: the band's sound reaches the computer a little late and the
loop's sound leaves it a little late, so a recording is taken that much
later than its bar lines (at the same length), and the band's beat lands on
the bar line when the loop plays. The delay is read from the browser (the
inputs' latency plus the output's) and shown in the Looper tab; **−** and
**+** move the next loops 5 ms later or earlier by ear, kept on this
computer, and **As measured** goes back to the measurement. It is limited to
between 50 ms early and 250 ms late, which the take's head always covers.

Kill lets the throw, the wash and the freeze go, drops a recording and stops
the loops; closing the studio also frees the loops and puts chopped pads back.

The visual voices feel the band effects (`bandFxVisuals.ts`): a throw holds
a note on the shots-and-effects sound and flashes on every echo repeat, fading
with the echo after it is let go; a wash holds one too; a freeze holds a note
on the pads-and-textures sound until it is let go.

### MIDI controllers and the band's keys (`midi/midiInputs.ts`, `studioControls.ts`, `studioMidiControls.ts`, `bandKeys.ts`)

Settings > MIDI lists every MIDI input. Each one is a **Controller** (it runs
the app through MIDI Learn), **Band keys** (a band member's keyboard or pads)
or off, and any number can be in use at once; the choice is kept per computer
by input name. A mapping learned on one controller fires only from it, so two
controllers can use the same notes; mappings from before fire from any. While
no controller is plugged in, an input with no use stands in, as before.

Band keys play into the visuals as the sound chosen for that input (Chords
unless set), as pitched notes, so they also tell the band's key. Channel 10
counts as drums (35/36 kick, 37-40 snare and clap, 42/44/46 hats, the rest
perc); a kick ducks the studio and a bass input moves Follow bass. **Play the
studio** also plays them on a studio instrument while the studio is open.

Every studio control a performer reaches for is `studio:<id>` to the router
and learnable on screen (the Live band tab, the FX pads, the bowls, the
visual rack, the song strip, Play and Kill). They are registered by the
studio's runtime, not its panels, so they answer while the Studio view is
hidden:

| ids | kind |
| --- | --- |
| `band.throw`, `band.wash` | hold |
| `band.freeze`, `band.listen`, `band.inputs`, `band.follow-bass` | toggle |
| `band.echo-send`, `band.verb-send`, `band.return`, `band.duck`, `band.duck-release`, `input.1-4.level`, `input.1-4.fx-send` | knob |
| `pad.1`-`pad.8` | trigger |
| `bowl.1`-`bowl.5` | hold (velocity on press, released on let go) |
| `voice.1-6.level` | knob |
| `voice.1-6.look-next`, `.look-prev`, `.follow-next` | trigger |
| `voice.1-6.mute` | toggle |
| `visuals.scene-next`, `visuals.scene-prev` | trigger |
| `looper.record`, `looper.chop` | trigger |
| `looper.play-a`, `looper.play-b` | toggle |
| `song.next`, `song.prev`, `song.go` | trigger |
| `studio.view`, `studio.play` | toggle |
| `studio.kill` | trigger |

A knob gets 0-1 across its own range whatever range the learned element had.
Controller moves are live control: they make no undo steps.

### Songs and set lists (`songs.ts`, `songRuntime.ts`, `components/music/SongsPanel.svelte`)

The **Songs** tab keeps a setup per song: **Save as song** keeps the set,
sounds, key, beat, mixer, the band inputs' roles and levels, the band
effects, the tempo, the playing studio scene, and the visuals (the looks on
each instrument feed and their scene, the VJ block, the playing VJ column,
and the stage preset when Stage mode is on). Each song has a name, notes,
its tempo (or leave the tempo to the band, Link or tap) and what calling it
up puts back: **Sound**, **Band** and **Visuals**. A song keeps tonight's
wiring when called up: a band input keeps its name and channel and takes the
song's role, levels and send.

A set list is songs in playing order; a song can come more than once. Calling
a song up, from the list, the set list, the song strip in the Studio header,
or MIDI, happens on the next bar; pressing again brings it up at once. While
Ableton Link has peers the tempo is left to Link. Next, previous, Go and MIDI
make no undo step; a song called up by hand from the list is one step for
what it changed on the map (a stage preset, the looks on a mapping layer).
Kill and closing the studio drop a song waiting for the bar.

### Ableton Live in control (`liveControl.ts`, `liveFeed.ts`, `components/music/LiveSessionGrid.svelte`)

**Ableton Live** in the Session tab hands the studio to Live: the studio's
instruments go quiet (the live input still plays), and the session grid
shows Live's scenes and clips through the Live control script
(`ableton/GhostArcade`). Launching one fires it in Live, and Live plays the
audio. The main Play and Stop run Live's transport, and tempo follows Live
over Link as before.

Each Live track's header says which sound it feeds the visual voices as.
**Match by name** fills in tracks whose names say what they are (Kick, Bass,
Pads...). A MIDI track sends its clip notes as they play, with exact pitch and
length on the song clock. An audio track sends its level, which is listened
to for hits. Tracks are matched by name, so the mapping survives tracks being
moved. The bridge streams only those tracks (`abletonBridge.setStudioFeed`),
alongside any score tracks and signals. `liveControl` and `liveRoles` are
saved with the project.

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

The band inputs (`liveInputs`), the songs (`songs`), the set lists
(`setlists`), the set list being played and the song up now are in it too;
moving through the set list does not count as an unsaved change.

It saves with .gha files, autosave recovery and Export Package (all use the
project export), and File > New resets it. Reading it back fills in anything
missing and drops malformed events. The MIDI input choice is per computer and
kept in local storage. Live state relayed between windows never touches the
studio, so a song keeps playing.

## Studio view (`components/music/StudioView.svelte`)

The **Studio** button in the music tray turns VJ mode into one full-screen
instrument. The live output stays in the middle (the view hands the native
preview its frame; VJ mode hides behind it) and the set's modules sit around
it. **Tray** goes back with the music playing; **Exit** stops it.

**Deck** (or the backquote key, left of 1; not while typing, when the
Performer owns the keys, or when a learned key binding uses it) goes to the
VJ deck for ordinary mixing while the music keeps playing, and back again.
On the deck a one-row studio strip sits under the clip grid: back to the
Studio or the tray, the song strip, Throw, Wash and Freeze, and a level knob
per look on the instrument feeds (`StudioDeckStrip.svelte`, `studioDeck.ts`).
It is hidden while the studio is closed. `studio:studio.view` does the same
from MIDI.

The chrome (top bar, output, session, the tray's header) is the app's
own; the app's eight macro knobs sit in the top bar as they do in VJ mode,
each with its effects and a jack. Each set's instruments sit on a face of
their own (`studioTokens.css`), so the mode reads at a glance: Sound bath is
deep blue glass and gold, Berlin black with hairlines, mono type and red, Dub
deep green and amber, Analog a matte black panel with cream legends,
aluminium knobs, walnut cheeks and orange.

Four sets, each with its own instruments (the keys switch to the set's own
voice where it has one):

- **Sound bath**: Drone (8 knobs, played by chords or keys), Bowls (five
  bowls tuned to the key), XY Space (X morphs drone against bowls, Y opens the
  reverb and shimmer; touching it plays a gliding tone in the key), Chords
  (eight chords in the key that layer: each holds until tapped again), Play,
  FX (shimmer, tape, delay, reverb), Beat.
- **Berlin**: Drums (a mixer with tune, level, mute and a jack per voice),
  Acid (a resonant bass line with its own 16-step note row, accents and
  glides, playing with the beat), FX (drive, bitcrush, dub delay, gated
  reverb), Beat (up to 64 steps), Pads.
- **Dub** (`dubSounds.ts`): Dub bass (a round mono bass with glide, played on
  the wide keyboard under the output), Siren (hold, or latch, with pitch,
  rate, depth and shape), Pads (the kit and the shots: laser, zap, riser,
  boing, crackle, boom, alarm, echo clap), and the Echo chamber: a
  tempo-locked tape echo with wow
  and a saturating feedback loop that can run away, a spring, a filter sweep
  and warmth. **Throw** floods the echo while held; **Drop** cuts the drums
  and bass so the echoes carry the tune.
- **Analog** (`analogSynth.ts`): a semi-modular mono synth. Two oscillators,
  a mixer with sub and noise, two cascaded resonant low-pass stages with
  drive, an ADSR envelope and an LFO. The envelope is normalled to the
  filter and the amp, so it plays with no cables. The patch bay's outputs
  (LFO, envelope, oscillator 2, level) patch into its inputs (cutoff, pitch,
  amp) at audio rate (oscillator 2 into pitch is FM), or out to a layer or a
  macro so the same signal moves the picture.

The key and scale (top bar) tune the chords, bowls, loops and scan synth;
**Lock** keeps what the keys play in the key. The keyboards mark the key's
notes.

**Cables** (`studioSets.ts`, `CableLayer.svelte`): drag from an output jack to
an input; cables hang in front of everything, the output included. Sound
jacks send an instrument through the set's FX rack (unpatched instruments
play dry). Control jacks carry a 0-1 signal (the XY pad, an instrument's
level, each drum voice's hits, the acid filter, the analog LFO and envelope,
the scan line's brightness) into a macro knob (turning it, so its effects
move) or a VJ layer (pulsing its opacity, so the hats can flash one layer and
the kick another). Drag a plugged input to move its cable, or drop it on
nothing to unplug it. Every knob, the key, the acid row, mutes and cables
save with the project.

**Session** (`session.ts`, `SessionGrid.svelte`, `ClipEditor.svelte`,
`presetLibrary.ts`): the loops play from a session grid, as in a DAW's
session view. There is a track per part (beat, bass, lead, chords, texture)
with clip slots. Click a clip to start it on the next bar; it takes over its
track. A row's play button launches the row across every track (tracks empty
in that row stop), and a track's square stops it. An empty slot's menu fills
it from the factory presets (beats, basslines, leads, chord parts and
textures) or your own.

Clips are the session's own copies, so editing one never changes a preset.
A clip made from a preset follows the studio's key by scale degree; a
recorded or imported clip keeps its pitches and the instrument it was played
on. Double-click a clip (or its pencil) to open the clip editor:
- for a notes clip, a piano roll with the key's notes shaded: draw, move,
  lengthen and delete notes, set velocities, length, snap and quantize,
  transpose;
- for a beat clip, a step grid with accents, steps and swing.

Edits play straight away, and a playing beat clip and the Beat module's grid
stay in step. **Add to my presets** keeps a clip on this computer for every
project. New sessions start with four rows of presets that work together.

**Transport**: the top bar's play button starts the music (what Stop
stopped, or the beat) and stops everything; **Kill** silences everything at
once, effect tails included.

**Scenes and the session** (`SceneBar.svelte`, in the top bar): **Save
scene** keeps what is playing now (beat, loops, take, VJ column) and the
whole sound (set, key, tones, kit, mixer, effects, cables, pads, the build)
and the visual voices; the Scenes menu launches one on the next bar, bringing
all of it back without stopping the music. **Session** saves the project
(Ctrl+S, with every scene, song and set list in it) or starts a new session:
the starter clips in the current key and no scenes. `sceneSave.test.ts`
covers a scene's save and load.

**Everything that sounds can drive a visual**: a visual voice can follow
everything, a drum, a part (bass, lead, chords, pads), what the keys play, or
one instrument: bowls, drone, XY tone, analog synth, scan synth, the echo
shots (each echo a fading hit), the build and drop, the siren, the acid line
and the dub bass (`VOICE_SOURCES`, new entries always on the end; the menu
offers the instruments the set has). By cable, every set also has the scan
level, the build's progress and the keys' level as control outputs.

**The loop library** (`loopLibrary.ts`, `groove.ts`): fewer, better loops,
each written like a part, in scale degrees so it plays in the studio's key,
with a default tone. Sixteen basslines (dub and roots with heavy roots or a
missing one, counter-phrases and approach notes; rolling and offbeat techno;
acid with slides; house and funk anticipations and octave pops; a two-step;
a sub) and thirteen chord loops voice-led so each voice moves the least
(`voiceLead`), with sevenths where the style wants them, in that style's
rhythm (choked skanks, organ bubbles, house stabs, pads, gates, clav), each
with a turnaround in its last bar. `applyGroove` adds the feel: swing on the
off sixteenths (about 55-57% for dub, house and funk, straight for techno),
accents, ghost notes kept soft and a hair of drift on the unaccented notes.
`loopLibrary.test.ts` rejects out-of-key notes, flat velocities, root-position
block chords, seconds below G3, basslines outside about E1-G3 and loops
without a tone. Old loop ids play as the loop now nearest them.

**The loop browser** (`LoopPicker.svelte`): a session slot's + (or Loops in
the Session tab) opens every loop as tiles in a grid, filtered by part, style,
a search and starred loops. Each tile draws the loop's shape from its notes
and previews it in the studio's key and tempo on its own tone, on the next
beat when music plays (`previewLoop`: one at a time, stopped by Kill). Add,
Enter or a double-click puts it in the slot; tiles drag onto session slots of
their part. Arrows move, Space previews, Esc closes. Stars stay on this
computer.

**Leads** (`leadLibrary.ts`): 33 hooks in techno, acid, house piano,
trance arps, dub melodica, livetronica, funk, synthwave and minimal styles,
each written to stick (a short motif said twice with one change, mostly
stepwise with one leap, space between phrases, call and answer, a tension
note resolving on the next downbeat, within an octave and a fifth) and each
with the tone it was written for, which a clip made from it starts on. Six
lead tones came with them: Fat saw lead, Hollow square, Bright pluck, Pulse
lead, FM bell lead and Acid lead. The old leads' ids play as the new lead
nearest them (`LEAD_ALIASES`), so saved scenes keep working.

**Record A/V** (`studioRecorder.ts`, `StudioRecordControls.svelte`, left of
Mixer; separate from Rec take, which records notes): records the program
output (or the source chosen in its menu) with the studio's mix as its sound,
through the app's own recorder: while the studio is open its master is the
recording's audio (`setStudioRecordingSource` in `clipAudioBus.ts`), muxed
into the native video file. Or the mix alone as a 16-bit WAV. Stems record a
WAV per mixer channel at the same time (silent ones are left out). A count-in
starts on the next bar. WAVs are kept in the app's asset folder, and with
Auto-Download on the mix is offered in a save dialog too. Recent recordings
are listed in its menu with Reveal.

**The mixer** (`MixerDesk.svelte`, the Mixer button right of the macros): a
hardware-style desk, the one deliberately skeuomorphic part of the studio. A
strip for every instrument whatever the set, each band input, the three
shared returns, and a wider master pinned on the right with a stereo meter.
Each strip, top to bottom: number, trim (+/-12 dB), insert effects (click to
edit the chain), EQ (high, mid with frequency, low, low cut), sends to the
shared reverb, tape echo and spring (`sendReturns.ts`), pan, the fader's dB
and the peak, a long-throw fader (`DeskFader.svelte`, `faderScale.ts`: unity
at three quarters, +10 dB at the top; shift-drag is fine, the wheel nudges,
double-click is 0 dB) beside a segmented LED meter with peak hold and a clip
light (`DeskMeter.svelte`), mute, solo and record arm (armed channels are the
stems Record A/V keeps), and a scribble strip coloured by family. One meter
tick serves every strip. It is the same state as the Mixer tab; faders, trims,
pans, mutes, solos, sends, returns and the master are MIDI- and OSC-learnable.

**Insert effects** (`InsertEditor.svelte`, `inserts` in the store): every
instrument channel and the master has a chain of as many effects as you
like, from the studio's full list (delay, tape echo, spring, reverb, filter,
EQ, compressor, chorus, phaser, bitcrush, drive, stutter, auto-pan), played in
order. Open a chain from a mixer strip's FX, Master FX, the Play module (what
the keys play), a session track's FX (that track's instrument) or the echo
shots. Drag or use the arrows to reorder; the light bypasses an effect, which
takes it out of the signal so it costs nothing. One chain class serves the
inserts and the macros (`macroFxAudio.ts`). Chains save with the project,
scenes and songs (`inserts.test.ts`).

**Build and drop** (`buildDrop.ts`, `buildFx.ts`, `BuildControls.svelte`
under the live output): **Build** runs a build-up of 1, 2, 4 or 8 bars that
lands exactly on a bar line (`buildLanding`); press it again, or Kill, to
cancel and put the mix back. **Drop** lands it on the next bar line. Over the
build a roll speeds up from quarters to thirty-seconds and climbs
(`rollHits`), a filter sweeps the whole mix (high-pass up or low-pass down),
an echo and reverb send opens, a riser and a reverse cymbal swell, and the
beat can drop out for the last bar with a gap before the downbeat. On the
downbeat everything snaps back with a sub boom and a crash, the visuals get a
big hit, and an optional scene or set comes in. Styles: Classic EDM, Dub,
Techno, Trap; right-click Build to edit. Progress is a control output
(`cv:build.progress`) for macros and visuals. MIDI-learnable: Build, Drop,
Cancel, next length, next style. `buildDrop.test.ts` and
`buildRuntime.test.ts` cover the bar alignment and cancel.

**Patching** (`controlSignals.ts`, `SourceBank.svelte`, `PatchBay.svelte`,
`CableLayer.svelte`): every sound is a control source. Besides the jacks on
each module has an out jack in its header: the instruments' levels, the
Beat module's whole kit (`cv:inst.drums.level`), the XY and acid levels, each
loop track in the session grid (`cv:track.<role>.level`), each band input
(`cv:chan.<input>.level`), the master (next to Record) and the drop's hit
(next to Build). Cables saved from the old Sources bank move onto these.
Control inputs: the macros, deck layers, the analog synth, visual voices'
opacity (`dest:voice.<i>.level`), mixer pans and sends
(`dest:mix.<channel>.pan`, `.send.<return>`), any insert effect's params
(`dest:insert:<channel>:<fxId>:<param>`) and the drop FX amount. The panel
over the output lists them all while a cable is in the hand. A control input
takes any number of cables, which add up and clip to 0-1. Right-click a cable
for its amount (-100% to +100%; negative turns it upside down), attack,
release and mode (envelope, or trigger: a pulse per hit). Each source is
read once a frame and shared; mixer, insert and voice modulation is applied
live, never written into the saved project. Cables and their settings save
with the set, scenes, sessions and songs.

**Sound, FX and Visual per instrument** (`instrumentDress.ts`,
`InstrumentDress.svelte`, first on the XY pad): Sound plays the instrument
with a tone-library tone instead of its own (into its own channel, so its
mixer strip and inserts still apply) and, on a pad, sets what Y does: the
built-in space, brightness (how hard notes play), the reverb or echo send or
the pan (applied live through the same modulation as cables, not saved into
the mixer). X stays pitch, in key. FX opens the instrument's insert chain.
Visual adds a visual voice tagged `inst:<id>` that follows it. Saved in
`dress` with the set, scenes, sessions and songs; MIDI-learnable as XY next
and previous sound and next Y axis. Drop the header into any module to give
that instrument the same.

**Acid line on and off**: the Berlin acid line plays with the beat only when
its On button (or the learnable "Acid line on or off") is on, coming in on
the next bar; switching to Berlin never starts it. Saved with the set,
scenes and songs. `acidRuntime.test.ts` holds it to that.

**Choosing a visual** (`VisualPicker.svelte`, `VisualPickButton.svelte`,
`visualPicker` in studioUi.ts): every place a visual voice is chosen (Play's
"Add a visual", each voice in the Visuals column and + Voice, the clip
editor, an instrument's Visual) opens one browser of tiles: a picture, the
name and what it answers to, filtered by the set it was drawn for, a search
and the starred ones; arrows, Enter and Esc. Pictures come from the app's
thumbnail cache, rendered once with the sound inputs set as if a phrase were
playing (`voiceThumbnails.ts`); `scripts/build-isf-thumbnails.mjs` bakes them
too. Voices built from several passes only draw in the native renderer, so
their tiles show their description until a native bake exists.

**Macros in the Studio**: right-click a macro (knob or FX tag) for the same
editor as VJ mode's macro bar (`MacroKnobBar` with `popoverOnly`, opened via
`macroEditRequest`): its targets, ranges, auto pulse, effect bundle and name,
on the one macros store, so VJ and the Studio always agree.

**Reggae and dub** (`loopLibrary.ts`, `reggae()`): 15 basslines and 16
skanks and organ bubbles, each tagged with its rhythm family (one drop,
rockers, steppers, rub-a-dub, meditation) and the drum groove it locks with
(`FAMILY_GROOVE`). A library preview plays that groove along when nothing
else is playing. They use the `roots` feel: a light swing, laid back a hair
behind the beat. The basses default to Dub round (or Rockers growl), the keys
to Skank piano, Bubble organ, Chop clav, Skank guitar, Dub skank (with a
dotted-eighth echo) or Skank tine. `loopLibrary.test.ts` holds them to the
craft: a fifth of every bass bar silent, no more than four sixteenths in a
row, bass at or under C3, a varied last bar, keys above C3, skanks a
sixteenth or shorter and placed for their groove.

**Drop FX** (`dropFx.ts`, in the build editor): a look on the whole output,
chosen per build: None, Glitch storm, Time stretch / stutter, Warp zoom,
Strobe flash, Kaleido burst or Melt. It creeps in on the build's progress (to
40% of its amount), hits its full amount on the drop's downbeat and lets go
over half a bar, one bar or two. The looks are existing composition effects
that the native core already runs, put on the VJ composition chain as live
control (ids `drop-fx:*`, no undo, taken off again when the release ends, on
cancel and on Kill), with the envelope as their mix. The strobe never flashes
faster than 3 a second, whatever the tempo, and the editor warns when it is
picked. `dropFx.test.ts` covers the envelope, the cap and the saved settings.

**A visual and effects per clip** (in the clip editor's "With this clip"
row): a clip can carry a visual voice (a VX visual, the sound it follows, its
blend and opacity) and its own insert chain (saved in the inserts as
`clip:<id>`). When the clip launches, on its bar, its effects go in after its
channel's own and its visual fades in over about half a second; when its
track stops or moves to another clip they go again. Both ride with the clip
into scenes, sessions and songs.

**Keyboard mode** (`keyMode.ts`, the menu beside Key): *Show key* marks the
key's notes and plays every note; *Lock to key* moves every pitched note,
from MIDI, band keys, letter keys or the on-screen keys, to the nearest note
in the key (out-of-key keys dim); *Scale on white keys* plays the scale from
the root at each C, a degree per white key. Drums never move. Each key or MIDI
note remembers the note it started, so a key change or two keys landing on
one note never leave a note stuck. MIDI-learnable as Next keyboard mode and
Lock to key on or off.

**Changing sets** changes instruments, not songs (`changeSetSounds` in
`musicRuntime.ts`). The clock, the tempo, the beat and its kit, playing loops
and session clips, the looper and the visual voices all keep going; loops and
clips play on the new set's instruments from their next note. Only sustained
sounds the new set has no place for let go, each with its own release: the
drone's chords and the XY tone when leaving the Sound bath, the siren when
leaving Dub. The old set's effects rack keeps its echo and reverb tails
ringing for four seconds before it goes. Kill and Exit still stop everything.
Calling up a song that brings another set is still a fresh start (`freshStart`).
`setSwitch.test.ts` checks that the beat and loops survive every switch.

**Scan synth** (`scanSynth.ts`, `OutputStrip.svelte`): the picture plays
music back. A line sweeps across the live output in time with the beat
(once every 16 bars to once a bar). Down that line the picture is cut into
24 bands, each a partial tuned to a note of the key, low at the bottom and
high at the top, and a band's brightness sets how loud it plays: bright,
busy pictures sing chords, dark ones go quiet, a strobe pulses the sound. It
reads a small frame from the native renderer about eleven times a second.
Its sound and its brightness have jacks, so the picture can also turn a
macro or pulse a layer.

**Visual voices** (`visualVoices.ts`, `visualScenes.ts`, `VisualRack.svelte`,
`public/ISF/VX-*.fs`): the picture side of the instrument. A voice is a
shader that follows **one sound**: the kick, snare, hats, toms, bass, lead,
chords, pads, shots, what is on the keys, or everything. The studio works out
that sound's signals every frame and writes them into the voice (`vx*`
inputs): its envelope, a flash per hit, velocity, pitch and a gliding pitch,
up to four sounding notes, a hit count, a motion clock that only runs forward
and speeds up while the sound plays, and the beat and bar. With **Auto** on, a
voice shows only while its sound is part of the music, so a scene builds and
strips back with the track by itself. Voices draw on black and stack with
screen blending; each has its own grammar (stripes for the hats, light frames
for the kick, smoke for the bass), so several stay readable together.
**Scenes** are ready-made stacks per set, in the set's palette of one ink and
one accent. The voices run on the native render core, several of them with
simulation buffers (ripples, smoke, phosphor, feedback).

**The Music Studio plugin** (`studioPlugin.ts`, `studioTarget.ts`,
`components/MusicStudioPanel.svelte`): the voices live in one place, a Music
Studio instance, never across the deck's rows. Drag **Music Studio** from the
media tray's Plugins tab onto a VJ cell, or apply it to a selected mapping
media layer. Each instance holds its own stack of up to six voices (the
shader, the sound it follows, Auto, level and look) and its palette, saved
with the clip or the layer. The clip panel (VJ) and the Plugin controls tab
(mapping) edit it: scene, palette and voices.

At render time an instance becomes its voices plus one mix: every voice is a
hidden shader layer, and the instance's own layer shows them screen-blended
through the native mix pass the VJ deck uses (`vj-mix`). The layer keeps its
place on the deck or the map, its opacity, blend, warp, masks and effects. In
a VJ row the mix runs with the other content, before the crossfades and the
deck mix read it (`graph_layer_frame_order` in the core). A project with a
studio clip starts the studio's clock when it shows, panel open or not.

The music itself comes from the studio, which lives in VJ mode (or from
Ableton Live through it); leaving VJ closes it. While it is closed nothing
plays, so voices on Auto show at rest instead of hiding: a studio layer on
the map is never black, and it comes alive with the music once the studio
plays.

The studio's **Visuals** rack edits the instance the studio plays to: the
studio clip on the selected row, else the first one playing, else the first
on the grid (in mapping, the selected studio layer, else the first). Loading a
scene with no instance puts one in the first free cell of deck A (or on the
selected media layer). The library:

- Berlin: Barcode (data stripes re-rolled by each hit), Light Lines (frames
  of light down a corridor), Panels (architectural light panels), Glyphs (a
  readout of the notes).
- Dub: Echo Rings (rings that repeat like a tape echo), Smoke (rising from
  where each bass note lands), Scope (the notes as oscilloscope figures, true
  to their intervals).
- Sound bath: Nebula (veils that open with the pads), Cymatics (sand settling
  into each note's figure), Aurora (a curtain per note of the chord).
- Analog: Video Synth (raster oscillators tuned to the notes, folded,
  keyed and colourised), Wobbulator (scan lines deflected by the sound), Scan
  Field (a scan-processor landscape that ripples on every hit), Feedback
  (camera-into-monitor feedback seeded by hits).

**Load jam** (Scenes tab) sets up a groove, loops, a visual scene and the
cables, and starts it: a techno beat and the acid line in Berlin, a one drop
with the bassline and skank through the echo in Dub, a filter-swept bassline
in Analog.

**Pads** (`PadsModule.svelte`): sixteen pads for finger and touch drumming,
the kit on the bottom rows (kick bottom left) and the shots above. Velocity
comes from pressure where the screen reports it, otherwise from where the
pad is hit (higher is harder); several fingers play at once. Full level and
note repeat (1/8 to 1/32 and triplets, on the beat grid while held).

**Recording loops** (`loopRecorder.ts`, `LoopRecorderBar.svelte`): **Rec**
counts in to the next bar (with a click when nothing else plays) and records
1, 2, 4 or 8 bars, or until pressed again (ending on a bar line). **Capture**
keeps what was just played without having recorded it: the latest phrase,
since the last pause of a bar, in whole bars. Notes snap to the chosen grid.
Melodic parts become clips in the session, one per instrument played, in
the first empty slot of their track; they start looping at once on the
instrument they were played on. Drum hits are written into the beat grid as
they are played, so touch drumming builds the pattern (the grid grows to
hold a longer recording), and the beat is kept as a clip. **Save** on the
beat track keeps the grid as a new clip.

**MIDI** (`midiFile.ts`, `midiExport.ts`): **MIDI out** saves the beat and
the playing clips as a multi-track .mid file for a DAW; each clip and take
has its own MIDI button. **MIDI in** adds clips to the session from a .mid
file: the drum channel becomes a beat clip, every other track a notes clip
on the track for its part.

**Macro effects** (`macroFx.ts`, `macroFxAudio.ts`, `MacroEditor.svelte`): the
FX button on a macro opens its effects. Sound: delay (beat-synced, ping-pong),
filter, reverb, chorus, phaser, bitcrush, drive, stutter and auto-pan on the
studio's mix; every parameter has a set value and a Macro amount, so turning
the macro sweeps it. Picture: visual effects from the app's catalog, which the
macro fades in. Both belong to the macro, apart from composition, layer and
clip effects, and save with the project.

**Scenes** capture the beat, the playing loops, the looping take and the VJ
column and launch them together on the next bar.

**The tray** (`VJMusicStudio.svelte`) is a condensed copy of the current set
under the VJ deck, on the set's face: the keys or pads, the set's main
modules and the session with its recorder, with play, record and kill
buttons in its header. Patching lives in the Studio view.

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
   - More drum kits (909, minimal, lo-fi, organic) and pattern chains.
   - An arrangement timeline for scenes, and loops recorded from takes.
   - Scan synth modes: read along a circle or a row, or follow a colour.
   - Live in control: a studio scene that fires a Live scene, Live's own
     mixer on the Mixer tab, and choosing the input channel of a
     multi-channel interface (a guitar on input 2 alone).
3. **Later**: per-take editing (quantize, trim, overdub), more instruments
   and sample kits, MIDI out to hardware, per-instrument audio analysis for
   the visual voices, a voice built on the render core's compute graph
   (instanced geometry and particles), and porting the studio to Studio.
