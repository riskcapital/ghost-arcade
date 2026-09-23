# HandFX performance guide

HandFX turns tracked hands into a transparent visual instrument. Add the HandFX plugin to a Mapping layer or a VJ clip, then open its plugin controls.

## Start here

Choose **Input → Rehearsal · no camera** to audition looks with two animated virtual hands. For a performance, choose **Live hands**, enable **Camera On**, allow camera access, and bring your hands into view. Energy Bridge needs two hands; Orbital Field and Laser Fan work with one or two.

Camera On enables HandFX tracking input. Turning it off clears HandFX's live hand input; another feature using the shared MediaPipe camera may keep the camera running. Rehearsal does not require or start a camera.

## Looks and gestures

| Look | How to play it |
| --- | --- |
| Energy Bridge | Move two palms apart to stretch interwoven light strands; bring them together to compress the bridge. |
| Orbital Field | Each palm carries animated rings. Pinch thumb and index to contract them; release to expand. |
| Laser Fan | Spread and rotate your fingers to fan and aim the beams. Thumb–index distance also controls their reach. |
| Paint | Move fingertips to emit flowing particles and sparks. |
| Ink | Paint soft drifting clouds with your fingertips. |
| Pinch Spray | Pinch thumb and index to emit particles; release to let them drift and fade. |
| Neon Skeleton | Trace the tracked hand joints with illuminated lines. |
| Panel | Position two hands to define a rectangle. Try Difference blending over other content. |

## Shape the performance

- **Palette:** Deep Ocean, Ember Gold, Ultraviolet, Acid Green, Pure Light, Coral, Ice, or Spectrum. Original mode colors preserves the older per-look color settings.
- **Brightness:** overall light intensity.
- **Audio response:** adds energy from the app's connected audio input. Zero disables it; visuals still respond to hands without audio.
- **Field size:** adjusts the scale of the three field looks. **Strands / rings** controls complexity in Bridge and Orbit. **Stroke width** controls line thickness.
- **Smoothing / Predict Ahead:** tune tracking feel. Higher smoothing softens motion; prediction helps compensate for tracking latency but can overshoot abrupt changes.
- **Background Opacity:** keep at zero for an overlay, or raise it for a darker backdrop. Add or Screen layer blending works well over video.

The controls participate in the plugin panel's MIDI Learn system. Saved projects retain their settings; existing projects without a new palette selection retain their original colors.

Hand tracking uses MediaPipe. Visuals and particle simulation run in the native GPU renderer; the camera image is not drawn into the effect. Use even lighting and keep your hands clear of each other for reliable tracking. Rehearsal verifies the visuals but does not verify your camera or real tracking latency.
