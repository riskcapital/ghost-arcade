# GhostFX

Add GhostFX from Plugins to a mapping layer or VJ clip. It is a source: layer it, map it to screens, and apply clip/layer/composition effects as you would other visuals.

## Eight movements

| Movement | Character | Performance controls |
| --- | --- | --- |
| Drift | Particle vortex with trails and connections | Vortex, trail intensity, lattice range |
| Ribbons | Aurora-like flowing ribbons | Width, spawn density, translucency, lighting |
| Liquid | GPU fluid simulation with shaded dye and bubbles | Splat force, swirl, decay, gloss, bubbles |
| Spheres | Glossy orbs flowing through soft clouds | Flow, sphere size, fluid mass, palette |
| Hyperdrive | Seamless concentric gates moving through deep space | Motion, Structure, Depth / Scale |
| Tidal | Layered luminous wave terrain | Motion, Structure, Depth / Scale |
| Mandala | Interlaced harmonic petal chambers | Motion, Structure, Depth / Scale |
| Corona | Solar filaments circling a dark core | Motion, Structure, Depth / Scale |

Previous / Next cycle the movements; Shuffle picks a different one. Switching is immediate. These controls preserve the other settings; they do not promise crossfading between simulations.

The four new movements have six Color Stories: Deep Ocean, Ember Gold, Ultraviolet, Jade, Silver Ice, and Spectrum. Hue Drift animates within the chosen palette. Motion at zero stops geometric motion; set Hue Drift to zero too for fixed colors. Structure changes harmonic complexity and Depth / Scale changes the visual's spread.

## Music and compositing

Use the app's audio input. Sensitivity controls audio strength and Response adjusts the native renderer's gradual attack and release. Each layer keeps its own envelope. Discrete beat bursts and audio-scaled elapsed-time jumps are removed. The visuals remain active without audio; the new scenes swell and bend with bass/mids rather than relying on strobe pulses.

Bloom adds light around the structures; Exposure controls the finish and Vignette darkens the perimeter. Background Opacity at zero allows other layers to show through; use Add or Screen blending for luminous overlays.

The new scenes use bounded fragment passes followed by the existing native bloom/composite chain. They do not download video frames or simulate particles on the CPU. Existing four scene IDs and their saved settings remain unchanged.
