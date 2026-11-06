<!-- ghost-arcade-channel: compatibility -->
# Ghost Arcade Studio 2.0.6

## p5.js sketches, imported and edited in the app

- **Import p5.js sketch** in the Media tray's JS tab takes a p5.js Web Editor username (to browse that account's public sketches), a link to one sketch, or a dropped zip, folder or set of sketch files. Each sketch is previewed before it is added, and is kept as it was written.
- Sketches play sandboxed on layers, thumbnails and Screens, with their images, sounds and fonts and with p5.sound. A loop that never ends is stopped with an error on its line instead of freezing the app (`// noprotect` turns this off).
- **Edit code** (in the Layer panel, on a p5 tile with `</>`, or in the tray's sketch controls) opens the sketch's own files as tabs, with the layer's live picture beside them. Edits reach the layer a moment after you stop typing, and errors are shown in plain words at the file and line you wrote. Learning mode explains the p5 ideas a sketch uses, with links to the p5.js reference and tutorials, and tips offer one-click fixes that keep the code plain p5.js.
- **Save** checks the code first. Code that does not compile, or that throws when it runs, is not saved, and the editor says where and what is wrong. Typed code is kept as a draft, so it comes back if the app closes before you save.
- Saving reaches every copy of the sketch: duplicated layers, saved compositions, VJ clips and stage presets.
- Three.js and p5.js pages hear the show through `window.ghostAudio`: level, bass, mid, treble, beat, kick, snare, BPM and more.
- Autosave and stage presets keep sketches whole, however large their files.

## Build a show around a song

- **File → New Show from Audio…**, the welcome screen's **Make a show to a song**, or dropping a song on the workspace opens one dialog. Keep the current look for the whole song, spread chosen presets across it, or let the song's tempo, beats and section changes bring in a new preset at each change, on the beat.
- Show audio plays any song: formats Chromium cannot play (AIFF, WMA, ALAC and others) are converted once and play from the copy.
- A show's song drives audio-reactive looks, even with no live input on.
- **Render to Video** includes the show's soundtrack.
- The Show timeline follows the song's own clock, so long shows no longer drift from the music. A show that does not loop can hold its last look, go back to the start, or black out at the end.
- The Show tray picks which sound card the show plays on, and VJ mode shows a compact soundtrack bar while a show with audio plays.

## Saving and undo you can rely on

- Quitting asks to save when there are unsaved changes, and every edit now counts: effects, shader settings, blend modes, masks, Screens and VJ clips. Opening a project asks about unsaved work first, and **File → New** starts from nothing the last project owned.
- The whole output stage (dome, output rotation and crop, edge blend and output grade) and every setting on a layer's media source are saved with the project. A Milkdrop layer reopens on its saved preset.
- One undo takes back one thing. Screen, mask, Master Warp and keyframe edits can be undone, a slider drag is one step, and Ctrl/Cmd+Z in a text field undoes the typing.
- Controllers, automation and modulation never make undo steps; a recorded take is one step. Undoing an edit no longer takes back a controller, show or preset change made before it.
- Playing a show no longer counts as editing it, and opening an older show with audio no longer reads as unsaved.
- Saves are written safely, so a crash mid-save leaves the old file or the new one. On Windows, saves succeed while OneDrive, Defender or the preview pane holds the file.
- A second close while the save prompt is up no longer closes the window, and quitting works after the editor reloads during the prompt.

## Mapping points

- Snapping works in screen pixels and only to what is drawn: other layers' outlines, the canvas edges and nearby grid lines. One **Snap** switch sits in the status bar. Shift drags snap from a tenth as far, so a point can be eased off a target.
- The arrow keys move any selected point (Shift ten pixels, Alt a tenth), on every kind of layer, Screen, Master Warp and the Stage Designer. Screen and Master Warp nudges step in master-canvas pixels.
- Shift drags points finely everywhere, and points no longer jump when grabbed.
- Mesh warp moves the content inside a Custom Shape and leaves the drawn outline where it is.
- Auto map turns curved surfaces measured by the phone into mesh layers that follow the surface.

## Outputs and Screens

- Outputs and Screens open on the display they are meant for. A Screen whose display is not connected no longer opens over the editor, and one whose projector is unplugged no longer opens on the display that took its number.
- Displays are recognised by their own names, so a renumbered display is still found.
- The standard output follows the Sequencer, keyframes and show transitions.
- If the GPU bridge does not draw, the workspace falls back to WebGL instead of staying empty.

## A new look for the top bars

- A new welcome screen.
- One **Mapping | VJ** switch, the same size and in the same place in both modes, with the current mode in silver. It replaces Open VJ Mixer and Exit VJ.
- Both top bars share one layout: Stage Edit beside Stage Sim, one record button, and condensed macro knobs in VJ mode.
- The mapping bar keeps the waveform and its audio settings in the bar, with Tap and the BPM behind one BPM button and a **Mobile** button with a phone icon.
- Sentence-case labels across effects and plugins. The top bar keeps its height in a narrow window, and the File menu scrolls in a short one.
- The app icon carries a small STUDIO label.

## Long shows

- Edits to a playing VJ clip are saved in its block, and VJ clip and deck edits count as unsaved changes.
- The editor does less work per frame and frees videos, cameras, 3D models and graphics contexts once nothing uses them.
- Pixel map and WLED skip frames that have not changed.
- MIDI clock tempo is steady, and a replugged controller is picked up again. An unplugged audio device drops to silence, reads as off and recovers when it is back.
- The mapping sequencer stays on the beat, and the VJ sequencer keeps its step when the tempo changes.

## Fixes

- Videos that cannot play are reported instead of hanging, and videos whose frames arrive late keep updating.
- A recording that cannot start puts the REC button back.
- Shaders that use `tanh`, `round` or `transpose` compile on WebGL1.
- **Settings → Diagnostics → Open log folder**, and the last three logs are kept.

## Downloads

Use the Ghost Arcade download page for the signed installers of Ghost Arcade Studio and Ghost Arcade Pro:

https://ghostarcade.live/download
