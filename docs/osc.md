# OSC in Ghost Arcade

Ghost Arcade speaks OSC in both directions: it takes control from a surface or
a DAW, and sends state back so the surface can show what is happening.

Turn it on in **Settings → OSC**. The listener defaults to UDP **8000**
(TouchOSC's default; TouchDesigner tends to use 9000).

## Getting started

Press **Install template**. That generates a binding for every address below,
sized to your current deck — re-run it after adding layers or columns and the
new cells are covered.

You do not have to use the template. Any address can be bound to any parameter
path by hand, and **Learn** binds the next message that arrives to whatever you
have selected.

## Addresses

`{deck}` is `a` or `b`. Indices in addresses are **1-based** — layer 1 is the
top layer, matching what the UI shows.

### Triggering

| Address | Does |
| --- | --- |
| `/ghost/vj/{deck}/layer/{L}/clip/{C}` | Fire one clip |
| `/ghost/vj/{deck}/column/{C}` | Fire column `C` across **every** layer at once |
| `/ghost/vj/block/{N}` | Switch to block `N` |
| `/ghost/vj/snapshot/{N}` | Recall snapshot `N` (1–16) |
| `/ghost/vj/stop` | Stop all clips |

A column launch is one message, not one per layer. Layers with no clip in that
column are cleared, which is what makes it a scene rather than a chord.

### Mixer

| Address | Range |
| --- | --- |
| `/ghost/vj/{deck}/layer/{L}/opacity` | 0–1 |
| `/ghost/vj/{deck}/layer/{L}/blend` | 0–1 across the blend-mode list |
| `/ghost/vj/{deck}/layer/{L}/solo` | trigger |
| `/ghost/vj/{deck}/layer/{L}/mute` | trigger |
| `/ghost/vj/master` | 0–1 |
| `/ghost/vj/crossfader` | 0–1 (A → B) |

### Transport

| Address | Range |
| --- | --- |
| `/ghost/vj/{deck}/layer/{L}/video/play` | trigger (toggles) |
| `/ghost/vj/{deck}/layer/{L}/video/restart` | trigger |
| `/ghost/vj/{deck}/layer/{L}/video/position` | 0–1 across the trimmed clip |
| `/ghost/vj/tempo` | BPM (not 0–1) |

### Mapping mode

| Address | Does |
| --- | --- |
| `/ghost/map/preset/{N}` | Recall mapping preset `N` |
| `/ghost/map/layer/opacity` | Selected layer opacity, 0–1 |
| `/ghost/map/media/play` | Play / pause selected media |
| `/ghost/map/media/restart` | Restart selected media |
| `/ghost/map/media/position` | Playhead, 0–1 |

## Following an external timeline

`video/position` is the one to send if you want clips to follow a track rather
than just be triggered by it — from Beat Link Trigger reading a CDJ, a DAW, or
a show controller.

Send it continuously as a 0–1 fraction of the clip. Ghost Arcade does **not**
seek on every message: playback runs from an anchor, so between corrections the
clip advances at the right rate on its own, and a seek is only issued once it
has drifted more than about 80ms. Sending at 20–50Hz is fine and will not make
playback stutter.

A cue jump is just a large position change, so it re-anchors and lands. Loop
regions are not followed — a loop's boundaries are not sent as position.

`/ghost/vj/tempo` sets the tempo the clip quantizer uses. A live Ableton Link
session outranks it: a real session phase is better than a number sent over UDP.

## Sending state back

Turn on **Send feedback** and give it the host and port your surface listens on
— `127.0.0.1` for an app on the same machine, the tablet's IP for TouchOSC over
Wi-Fi.

Feedback answers on **the addresses you have bound**. Whatever a surface sends,
it hears back, so there is no second mapping to maintain. What is mirrored:

- clip and column state (1 when live) — this is what lights a clip button
- layer opacity, solo, mute
- master and crossfader
- video play state and playhead position

Only changes are sent, so an idle rig puts nothing on the wire. Values that
cannot be read right now — a layer with no clip loaded — send nothing rather
than zero, so a surface does not light up for something that is not there.

Shader, splat and plugin parameters are not mirrored, and are not in the
template: they depend on what is loaded in a layer, so there is no fixed
address for them. Bind those by hand or with Learn.

## Notes

- Argument-less messages, OSC Impulse, and numeric or boolean values all work
  for triggers.
- Several bindings can share one address; each one dispatches.
- Bindings are saved with the project. The port and feedback settings are
  remembered per machine.
