<!-- ghost-arcade-channel: compatibility -->
# Ghost Arcade Studio 2.0.5

## Media stays linked when a show moves

A project used to save only each file's full path, so moving the show folder, opening it on another computer or using Save As left every file missing.

- Saving now also writes where each file sits relative to the project, so a show folder can move or travel to another computer and its media still opens.
- Opening a project looks for each file beside the project, then where it was saved from, then by name anywhere in the project's folder. Files found in a new place are listed and count as an unsaved change; anything still missing is listed with a pointer to **Project Media**.
- Locating one missing file in Project Media, or one clip on the VJ deck, relinks every other missing file found in that folder. The VJ deck checks clips in every block.
- Relinks count as unsaved changes, so quitting asks before they are lost.
- A .gltf or .obj loads the buffers, materials and textures beside it. File names with "#", "%" or "..." load. Built-in shaders no longer show as missing media. Double-clicking a .gha opens it, also while the app is running, and autosave keeps VJ-only shows.
- Media that iCloud has not downloaded yet is named as such instead of reported missing, its download starts, and Project Media has a **Download** button for it.
- Crash recovery reopens the project the snapshot came from, and a dropped file with no path on disk is kept with the app's project assets.

## Export a show as one package

**File → Export Package…** writes the project and every media file it uses into one .zip, with the media in a Media folder. **File → Open Package…** (or File → Open on a .zip) unpacks it into its own folder and opens it; unzipping it by hand and opening the project inside works too.

- Packing runs at copy speed and handles files and packages over 4 GB. Progress shows while it packs, and Cancel leaves nothing behind.
- Files keep their names, and 3D models are packed with the files they load.
- Missing files no longer stop the export: they are listed, along with any fonts the other computer needs installed.
- **Collect** in Project Media packs the same way.

## Map Sim: auto-map, and it saves with the project

- **Auto-map this model** makes one media layer per face the projectors can see, with its corners where that face lands in the projector's image. Each face shows a flat colour until you give it a shader, clip or image.
- The Map Sim scene (room, objects, projectors and imported models) is saved with the project and its autosave and comes back when you open it. Edits made in the pop-out window are saved too.

## Mesh warp fits Custom Shapes

Turning on Mesh for a layer with a closed Custom Shape puts the mesh on the shape instead of the whole layer, and the content, mask and outline stay where they are until you move a point. Moving a point moves the shape next to it, and the shape handles stay on the drawn outline.

**Fit Mesh To** picks how the mesh sits: **Shape** (an even grid over the shape's bounds), **Outline** (a grid whose border follows the outline) or **Layer** (an even grid over the whole layer). A mesh that has not been warped follows edits to its shape.

## Many layers render faster

- Simple layers (no effects or masks) with the Normal, Screen or Multiply blend are drawn straight into the picture instead of each through its own full-size image. 81 auto-mapped faces went from about 40 to the display's full frame rate, with the picture unchanged.
- Simple layers with other blend modes only work on the area they cover.
- A hidden shader layer no longer renders unless another layer reads it.
- A video uploads to the GPU only when it has a new frame.

## Outputs

- On macOS a fullscreen output or slice window now covers its whole display, including the strip where the menu bar sits, and nothing else draws over it, even when you switch to another app. Your main screen keeps its menu bar and Dock. Escape closes a fullscreen output, as it does a slice window.
- Fullscreen no longer resizes the project to the projector unless **Settings → Display → Match on Fullscreen** is on. It rebuilt everything before the output appeared and changed the project without asking.
- An output that cannot start WebGPU reopens on the standard transport instead of showing a message on the projector.

## Canvas zoom that is easy to control

Zooming follows how far the wheel or your fingers move, so a trackpad no longer races to 4%. **Settings → Canvas** has **Zoom Speed** and **Two-Finger Scroll** (pan instead of zoom). Zoom controls with **Fit** sit in the canvas corner, and Ctrl/Cmd 0, + and − work too.

## VJ mode

- The VJ library opens at once on a new computer. It used to compile about 350 shaders for their thumbnails first, which dropped a VJ set to 5–20 frames a second for minutes.
- The editor does far less work per frame in a busy set, and its frame rate cap now defaults to 60 (projectors are 60 Hz). Installs that kept the old uncapped default move to 60 once.
- On the A/B slider, a blend mode such as Difference or Multiply now shows clearly through the move, and it works in Stage mode too.
- Launch quantize lands on the beat the tempo display shows and follows Resync, tempo nudge and Ableton Link. Column launches (header buttons, number keys, MIDI, groups and cues) now wait for the boundary too; launching the same column again cancels it.

## Fixes

- The editor no longer goes black after its display restarts. It also recovers if the GPU resets.
- The editor stops sending project changes to output windows once none is listening.

## Downloads

Use the Ghost Arcade download page for the signed installers of Ghost Arcade Studio and Ghost Arcade Pro:

https://ghostarcade.live/download
