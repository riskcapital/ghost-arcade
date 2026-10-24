<!-- ghost-arcade-channel: compatibility -->
# Ghost Arcade Studio 2.0.4

## Fullscreen output turns off again on macOS

Clicking **Fullscreen** a second time now closes the fullscreen output. Before, the output window ignored the request and stayed on the projector. Screen windows sent to a display close again too, from the app or with Escape.

## The A/B slider runs one transition

With a blend mode other than Normal, the A/B slider now runs one transition from A to B. Bank B comes in combined with A by the blend mode and settles into plain B as the slider reaches B. Before, the whole picture passed through the blend at the halfway point, so it looked like two transitions.

## Point clouds load in the background

A PLY or splat that is slow to read, for example still downloading from iCloud or on a network drive, no longer locks the window. The loading screen has **Continue in background** (or press Escape): the project stays usable and a small corner chip shows the load until the layer appears. Progress now moves as the file is read.

## 3D model deformations

The Deformation panel shows only the controls each deformation uses, and Axis offers only the axes it moves along and now works, so no slider sits there doing nothing. Breathe is its own soft swell instead of a copy of Inflate, Melt's wobble follows Speed, and MIDI can reach all 21 types.

## MediaPipe and control bindings

- MIDI, OSC and MediaPipe bindings reach parameters whose names contain capitals. They were written under the wrong name, so nothing moved. Bindings saved by earlier versions still work.
- A MediaPipe binding made in mapping mode drives the layer it was made on, not whichever layer is selected, and its label names that layer.
- During assignment, a hand position or pinch binds only value controls, so clips, tabs and buttons keep working and you can move to another shader without leaving assignment mode. A gesture can still bind buttons.
- Shader parameters on deck B learn as deck B, and the crossfader blend mode binding works again.

## Fixes

- Opening a saved project keeps template shader clips and Performer clips working. They used to show as missing files.
- Stage Sim keeps the venue, lighting, beams, haze and objects when it is closed and reopened, and when the project is saved.
- A VJ video clip fired again soon after it stopped shows at once. It used to wait up to half a second.
- Text font menus list only fonts this computer has. A project's current font stays in the menu, marked not installed.

## Downloads

Use the Ghost Arcade download page for the signed installers of Ghost Arcade Studio and Ghost Arcade Pro:

https://ghostarcade.live/download
