# One backdrop, two projectors

This workflow is for two projectors showing one continuous composition on a flat backdrop, including portrait projectors mounted at oblique angles. The projector outputs keep their calibration when VJ clips change. These controls are available starting in 2.0.15; they are not available in 2.0.7.

## Three separate jobs

- **Source slice** selects which part of the full composition a projector receives. Adjacent projectors need overlapping source regions, not two independently stretched copies of a clip.
- **Projector calibration** places that source region on the real backdrop. Its four destination corners use a perspective transform, so straight lines on a flat surface remain straight. This is separate from the older Slice Corner pin/Mesh controls, which select a distorted source region.
- **Shared overlap blend** fades both outputs in the same composition coordinates. Left and right boundary positions can differ at the top and bottom, producing an angled or widening overlap. The two weights sum to one in linear light for a projector with a standard 2.2 gamma; the **Projector gamma** control reshapes the fade for projectors that are darker or brighter than that. This is not an automatic scan or a replacement for physically aligning the images.

## Set up

1. Connect the projectors as **extended displays**, not mirrored displays. Set each display to the actual orientation/resolution (for example 1080 × 1920). Use the Screen rotation control only if the image still needs rotating.
2. Set the composition aspect ratio to the full backdrop's intended picture. Two portrait projectors do not automatically mean a 2160 × 1920 composition: physical overlap reduces the combined width.
3. Put one full-width image in the composition (a flat white or mid-grey field is enough; the Media Library's SolidColor, UVGrid and TestPattern shaders work). You do not need your own grid image: **Show alignment grid** in the Screen's Projector calibration section draws a numbered grid with circles and diagonals on the projectors (see below). Keep creative effects and layer feathering off during calibration. Do not split the content into two VJ layers.
4. Create two **Screens**, route one to each projector display, and open both output windows. Both outputs sample the same composition. The second Screen is created with the name Center: rename it if you like. Press **Identify** on a Screen to flash its number on its own projector and confirm which is which. If a Screen says its display is not connected, pick the display again (display ids change between computers and sometimes when a projector is re-plugged).
5. In the first screen's **Projector calibration → Shared overlap blend**, enable **Angled two-projector overlap**. Choose which side this projector covers and select the other screen.
6. Enter the overlap boundaries as percentages of the **whole composition**. Example: left boundary 46% at the top and 40% at the bottom; right boundary 54% at the top and 60% at the bottom. This describes a band widening toward the bottom. These are starting values, not universal projector settings.
7. Click **Pair blend & set overlapping crops**. This creates complementary fades and source crops covering the band. It sets both source slices to Rectangle and clears the older rectangular edge fades. It preserves existing projector destination corners. Pairing is undoable. The panel now shows **Paired with …**: from here on, changing a boundary, the side, the gamma or the on/off switch on either Screen updates both Screens and both crops at once. If the two ever differ (for example after dragging a crop on the canvas), the panel says so and offers **Re-sync pair from this Screen**.
8. On each screen, enable **Correct output geometry** and press **Show alignment grid**. Drag the four corners in the projector editor for coarse placement (hold **Shift** while dragging for a tenth of the movement). For fine work click a corner and use the **arrow keys**: one output pixel per press, **Shift** 10 pixels, **Alt** 0.1 pixel; Up/Down inside a number box do the same. You can also type X/Y percentages: a value takes effect on Enter or when you leave the box, Escape restores it. Each corner shows its position in output pixels. Align the same numbered grid cells in the overlap. The values describe positions in that projector's raster, not source-crop coordinates. Outside the corrected quad is black.
9. Adjust the band boundaries so the fade remains inside the region that **both** projectors physically cover (the grid's yellow lines show the boundaries on the wall). Refine geometry again if the source crops changed. A doubled grid line means geometry is still misaligned; increasing feather width cannot fix it.
10. Hide the grid. Match each projector's brightness, contrast and gamma. Test white, mid-gray, dark-gray and black fields. If the overlap is darker than the rest on white or mid-grey, raise **Projector gamma (overlap brightness)**; if it is brighter, lower it (2.2 is standard; double-click the slider to reset). Use black-level compensation where needed. **Save the project and save a Screen Setup** once calibrated: the Screens and their calibration belong to the project, so quitting without saving leaves only the Recover Unsaved Project prompt (or the saved Screen Setup) to bring them back.

## Alignment grid and Identify

**Show alignment grid** replaces the picture on the paired Screens with a grid drawn in composition coordinates, so both projectors draw the same lines and they must land on each other. Cells are numbered from 1 (top left), 16 across. The left projector draws **green** and the right **magenta**: where they coincide the marks turn white, and a doubled mark shows which projector is off. Yellow lines are the overlap boundaries, the white frame is the edge of the composition. The fade is switched off while the grid shows, so the overlap is brighter than the rest and you can see exactly where both projectors reach. The grid is never saved with the project and is off after a restart. **Identify** shows the Screen's number on its own projector for four seconds. Both need the Screen's output window to be open.

## Perform

Switch full-width images, videos or shaders in VJ mode. Keep the composition dimensions and Screen calibration unchanged. Apply Stretch/Fill/Contain once to the content's placement within the composition; do not use it to independently resize the two projector halves. For a theatre backdrop, output the same composition to both Screens throughout the show.

## Limits and troubleshooting

- Physical projector black levels add together. Software cannot subtract that light; a dark-scene seam may need black-level matching, projector settings or optical treatment.
- This tool currently pairs **two horizontally adjacent outputs** with a straight boundary on each side of the band. Arbitrary multi-projector intersections and curved-surface calibration require more than this paired workflow.
- Corner correction assumes a flat surface. Existing mesh/source-warp tools remain available, but this new destination calibration is a four-point perspective correction.
- Crossing or collapsing projector corners blacks out that screen rather than rendering an invalid transform. Use Reset projector corners (or Undo) to recover.
- Screen **Rotation** turns the picture inside the corrected quad: 90° puts the picture's top along the projector's left edge. The four corners always describe the projector's own raster, whatever the rotation.
- Deleting one Screen of a pair leaves the other still fading toward it; its panel says so. Pair it with another Screen or turn the overlap off. Deleting a Screen is undoable.
- Black-level compensation lifts the areas where only one projector lands. It can only flatten black if the fade covers nearly all of the area both projectors physically reach.
- Disable legacy Edge Blend ramps on the shared seam; combining them with the paired blend darkens the overlap twice. The pairing button clears these ramps automatically.
- No physical two-projector acceptance test has been performed yet. GPU tests verify corner mapping, complementary blend brightness on angled overlaps (including portrait 1080 × 1920 outputs, a quarter-turned Screen and non-standard projector gamma), output clipping, the alignment grid and calibration retained across source-frame changes. Final brightness/colour matching must be checked on the actual venue rig.
- A phone calibration import puts the traced surface's corners into top-left, top-right, bottom-right, bottom-left order for the projector, whatever order they were traced in, and says when it did. It never turns or mirrors the picture: use the Screen's Rotation for a turned surface.

## Windows output routing correction (2.0.16)

A Windows-specific capability report in 2.0.15 incorrectly marked native Screen presentation unavailable. The application could then show an older browser-rendered output that ignored projector calibration and source warping. The fix enables the existing DXGI Screen presenter, routes Screen windows through native presentation, and reports an error instead of silently opening an uncalibrated fallback on Windows/macOS.

After installing the corrected build, close and reopen each Screen output. Test one projector at a time: move its top-right destination corner down to 30%. The projected picture must visibly change immediately. Reset the corner before calibrating both projectors. If it does not change, stop calibration and report the output error; do not compensate by changing source crops.
