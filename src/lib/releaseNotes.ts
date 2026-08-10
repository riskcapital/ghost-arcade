export const DOWNLOAD_PAGE_URL = 'https://ghostarcade.live/download';
export const CHANGELOG_PAGE_URL = 'https://ghostarcade.live/changelog';

export interface AppReleaseNotes {
  title: string;
  summary: string[];
  highlights: string[];
}

const RELEASE_NOTES: Record<string, AppReleaseNotes> = {
  '1.9.992': {
    title: 'Reliable OSC, trimmed playback, and portable media',
    summary: [
      'OSC listening and Learn Binding now work reliably in the desktop app.',
      'Trimmed videos loop and restart from their selected in point.',
      'Saved VJ clips recover durable media paths more consistently.',
    ],
    highlights: [
      'The OSC listener starts with the app, opens the configured UDP port reliably, and reports its live socket status.',
      'OSC Learn now uses an in-app binding editor instead of the unsupported Electron prompt dialog, with path validation and documented examples.',
      'OSC and MIDI controls can trigger VJ clips, Mapping presets, and Mapping or VJ video transport controls through normalized parameter paths.',
      'Trimmed videos stay inside their selected range, loop back to trim-in, and keep the timeline playhead aligned with the active trim.',
      'VJ project saves recover durable local-file references from the media library, reducing unexpected relink prompts after reopening a project.',
      'Imported GLB models preserve embedded materials and textures by default instead of replacing them with a flat gray material.',
      'VJ block removal is available from the context menu while individual clip cells retain their quick remove control.',
    ],
  },
  '1.9.991': {
    title: 'Stage editing and VJ playback reliability',
    summary: [
      'VJ videos launch from a decoded trim-start frame without a black transition frame.',
      'Unified stage slices preserve their intended visual order.',
      'Stage geometry editing gains reliable undo and multi-slice stretching.',
    ],
    highlights: [
      'VJ video triggers and column launches use a pre-armed decoded frame at the clip trim start, avoiding the one-frame delay seen when switching from shaders.',
      'Unified Stage Designer groups preserve the Stage texture orientation used by their generated slices, including layouts with vertical rows.',
      'Stage Designer geometry edits support Cmd/Ctrl+Z, redo, grouped drag history, and canceling an active drag with Escape.',
      'Multi-selected mapping slices can be stretched from any side as a group while retaining the existing uniform scale control.',
      'Layer blend modes are restored to full-strength compositing, with opacity acting as the straightforward layer mix amount.',
      'Imported Mapping Mode projects recreate saved video sources after resolving their portable asset references.',
    ],
  },
  '1.9.99': {
    title: 'Live performance and control polish',
    summary: [
      'Video triggering, layer blending, warp editing, and control surfaces are more reliable.',
      'LED FX adds multi-color patterns and compact live controls.',
      'GPU Shader and Text Creator sources are now available in the VJ plugin library.',
    ],
    highlights: [
      'Armed VJ videos reuse their warmed texture on launch, removing the black-frame flash that could briefly expose layers beneath a new clip.',
      'Layer blend modes follow opacity, preserving normal opaque coverage at 100% while building to their strongest interaction around the midpoint.',
      'Master corner and mesh warp points use the same configurable keyboard nudge sensitivity as Mapping Mode.',
      'LED FX adds a compact pattern selector, one-to-four-color layouts, custom colors, and performance-ready palettes.',
      'GPU Shader and Text Creator sources can be launched directly from the VJ plugin library, alongside eight new audio-reactive ISF visuals and Warp Loom.',
      'OSC bindings now expose stable clip, preset, transport, crossfader, macro, and LED routes for DAWs and Pro DJ Link bridge software.',
      'Ghost Arcade prevents display sleep and the screensaver while the desktop app is running.',
    ],
  },
  '1.9.98': {
    title: 'Reliable stage presets, live LED performance, and restored loop transitions',
    summary: [
      'Stage effects and WLED output now follow every stage preset.',
      'VJ videos display upright and unmirrored by default.',
      'The full grouped video-loop transition library is restored.',
    ],
    highlights: [
      'Stage effects now resolve against each recalled stage preset instead of remaining attached only to the newest preset.',
      'WLED output stays active while switching presets and now includes Auto, Strip, Matrix, and Custom spatial maps; source-region cropping; serpentine and reverse wiring; linear-light per-controller color matching; live shader palette sampling; and LED-order, chase, and solid-color test patterns.',
      'The new LED FX performance tab contains 47 patterns across Movement, Organic, Rhythmic, Spatial, Content Aware, and Glitch collections, with latch and push-hold triggering, BPM sync, automatic sequencing, blend controls, and MIDI or keyboard assignment.',
      'Named controller ranges and multi-controller LED groups let one WLED controller drive multiple strips while effects target the whole rig, one controller, one strip, or a combined fixture group.',
      'VJ video clips now use the correct vertical texture orientation without introducing a horizontal mirror.',
      'Video Loop Creator restores the expanded Essentials, Motion, Glitch, Loop FX, and Reveals transition groups, including the custom scanline, block, chroma, tape-tear, and signal-pulse treatments.',
    ],
  },
  '1.9.97': {
    title: 'Mapping precision, persistent masks, and hierarchy mattes',
    summary: [
      'Mesh warp nudges now follow the global mapping movement granularity.',
      'Finished masks stay enabled while you return to corner or mesh editing.',
      'New mask-only layers matte every layer beneath them in the hierarchy.',
    ],
    highlights: [
      'The mapping movement granularity setting now applies consistently to corner, whole-layer, fine-tune, and individual mesh-point arrow nudges, with Shift retaining the 10x movement multiplier.',
      'Done Editing Mask now exits mask-point editing without disabling or removing the visible mask.',
      'The mask pencil control reopens an existing mask for editing, while active masks no longer block corner or mesh warp work.',
      'The new Mask Layer type accepts no media and masks all layers beneath its stack position, including layers organized inside groups.',
    ],
  },
  '1.9.96': {
    title: 'VJ media polish, preset reliability, and MIDI clock routing',
    summary: [
      'VJ media cells stay stable when images are dropped into the grid.',
      'Mapping presets with video sources restore playback more reliably.',
      'MIDI clock can use its own input while controller mappings use another.',
    ],
    highlights: [
      'Expanded VJ Effect Bundle parameters now show the effect name at the top of the parameter list so it is clear which effect is being edited.',
      'VJ clip cells keep fixed sizing during drag/drop, fixing image drops that could make rows and columns grow unexpectedly.',
      'Still-image clips now expose the same fit, mirror, zoom, anchor, rotation, opacity, and reset transform controls as video clips.',
      'Animated GIF image sources are refreshed in the renderer so output playback advances instead of freezing on the first uploaded frame.',
      'Mapping media layers auto-rename to the dropped image or video name when the layer still has a generic media-layer name.',
      'Mapping presets and VJ blocks can be drag-reordered, with MIDI preset indexes following the visual order.',
      'Mapping presets that contain video sources now rehydrate video elements when recalled, avoiding the Replace workaround.',
      'Settings now supports Cmd/Ctrl+, and MIDI Learn can be toggled with Cmd/Ctrl+M.',
      'MIDI clock can be received from a separate input device while controller mappings stay on the main MIDI device.',
      'VJ video speed can be free-running or synced so the clip/trim span fits 1 beat, 2 beats, 1 bar, 2 bars, or 4 bars at the master BPM.',
    ],
  },
  '1.9.95': {
    title: 'Marquee select no longer blocks mask and light-painting clicks',
    summary: [
      'Editing a layer mask and drawing light-painting strokes work again.',
      'The marquee multi-select tool no longer hijacks those canvas clicks.',
    ],
    highlights: [
      'Fixed the 1.9.9 marquee multi-select tool intercepting clicks meant for the mapping-mode layer mask pen, so click-to-add mask points works again.',
      'Fixed marquee multi-select intercepting light-painting clicks, so click-and-drag to create strokes works again while the layer is being painted.',
      'Marquee drag-select now stands down automatically while mask editing or light-painting draw / path-edit is active, and still works everywhere else.',
    ],
  },
  '1.9.9': {
    title: 'Stage 3D venues, recording reliability, mapping polish, and cleanup',
    summary: [
      'Stage 3D recording and Demo Reel export now capture the live rendered canvas.',
      'Sphere, lighting, mapping, and Map Sim workflows are more polished and reliable.',
      'Runtime cleanup now releases Stage 3D, VJ, and Map Sim GPU resources more carefully.',
    ],
    highlights: [
      'Stage 3D recording and Demo Reel export now capture from the live rendered canvas, fixing black MP4 output and preserving the exact on-screen lighting, exposure, haze, and screen glow.',
      'Demo Reel rendering now supports cross-dissolve transitions while keeping shader content, camera motion, and lighting FX locked to the same virtual render clock.',
      'The Sphere venue now uses a true dome-style screen with better default framing, editable dome tuning controls, screen/room inspector tabs, locked venue defaults, and a more recognizable room layout.',
      'Stage 3D lighting fixtures now have richer per-fixture controls, patterns, colors, timing modes, and lower-cost beams so movers, washes, blinders, strips, lasers, and haze read more like a live rig.',
      'Mapping and Stage Designer workflows gained marquee multi-select, multi-layer transform improvements, arrow-key movement, clearer layer drop indicators, restored grid/snap access, and fixed warp editing after marquee selection.',
      'Map Sim ships with the refreshed isometric cube pyramid default scene, more reliable click selection, undo behavior, and recording that respects the visible lighting result.',
      'VJ Mode clip cells keep their grid sizing stable during drag/drop, and runtime texture caches now dispose cleanly when clips are swapped or VJ mode closes.',
    ],
  },
  '1.9.8': {
    title: 'Faster exports, Veo loop bridges, and render-clock fixes',
    summary: [
      'JPEG sequence export now uses a native encoder path for much faster frame saves.',
      'Particles, GPU shaders, and offline renders stay locked to the render clock.',
      'Video loops can now use a Veo bridge between the last and first frame.',
    ],
    highlights: [
      'Render to Video now drives JPEG sequence export through a persistent native FFmpeg encoder instead of saving every frame through a slower per-image path, making long 4K frame sequences much more practical.',
      'Offline rendering now keeps GPU shader layers, Pixel Particles GPU Shader, and Particles 3D tied to the virtual render clock so exported videos advance frame-by-frame instead of sampling runaway live animation time.',
      'Standard video loop creation uses the native FFmpeg path with hardware H.264 where available, better progress reporting, and a browser fallback if the desktop encoder cannot run.',
      'The loop creator adds a Veo Bridge mode: Ghost Arcade captures the source video last frame and first frame, asks Veo 3.1 to generate the transition, then appends the bridge to the original clip.',
      'AI video generation now supports Veo first-frame and first/last-frame uploads, including the live endpoint payload shape Veo expects for keyframed generation.',
      'The mobile controller groundwork adds Phone Vision source state, native OSC layouts, and native vision hooks for future iOS/Android capture workflows.',
    ],
  },
  '1.9.7': {
    title: 'Mapping Composition effects, visual polish, and sharper downloads',
    summary: [
      'Mapping Mode gets composition-level effects and VJ-style stage-effect triggers.',
      'Map Sim controls are cleaner, faster to scan, and easier to perform with.',
      'The interface now uses a tighter two-font system across the app.',
    ],
    highlights: [
      'Mapping Mode now has a Composition section that can run effects across the mapped layer stack and trigger stage-style screen effects with the same live, hold, cycle, and MIDI-friendly behavior used in VJ Mode.',
      'Map Sim top controls are reorganized for real work: New, Save, Load, Copy, Paste, Delete, transform tools, view controls, sync, fullscreen, and record are grouped with clearer iconography.',
      'New effect-library visuals include phase/magnification-inspired tools and the recent experimental visuals as reusable effects, so they can be applied to any source instead of living as isolated shader layers.',
      'SRC webcam feeds now mirror by default for natural performer-facing camera control.',
      'The UI typography pass moves Ghost Arcade onto a consistent Geist + Geist Mono system, trims front-facing UI type by 1px, and normalizes mixed font weights/casing across panels.',
      'The website download flow now starts the download immediately and then asks users to follow the project/community accounts, keeping the app free while helping the community grow.',
    ],
  },
  '1.9.6': {
    title: 'Map Sim polish, sequencer fixes, source point clouds, and frame export',
    summary: [
      'Map Sim and Stage Sim now behave more cleanly across presets and sessions.',
      'VJ sequencer cells update live, with slower crossfade and step timing options.',
      'Photo/video point-cloud shaders and offline frame exports render more predictably.',
    ],
    highlights: [
      'Map Sim and Stage Sim now keep unsaved edits scoped to the active scene, ask whether to keep added elements when switching presets, and stop carrying unsaved objects into the next app launch.',
      'Map Sim object editing is tighter: lockable projectors and objects, scene click selection, copy/paste, delete, snapping, even-spacing guides, GLB import parity with mapping-mode 3D model layers, and the focused isometric cube, fragmented cube, and museum presets.',
      'Projection rendering has stronger real-world behavior with one-sided projection, darker backsides, floor hits when the projector is angled correctly, projector shadow controls, and smoother intensity changes.',
      'VJ Layer Sequencer fixes live cell updates so clicks show immediately, adds slower crossfade timing, and expands movement intervals beyond 1/4 steps.',
      'VJ layers and group layers can now choose the full VJ Mix as an output source when that is the cleanest routing path.',
      'GPU Shader photo/video point-cloud effects now derive depth from the source image, preserve source colors, and add smoother particle motion controls for animated depth-cloud looks.',
      'Render to Video adds a JPEG frame-sequence output path and fixes GPU Shader offline timing so exported frames advance one virtual frame at a time, including slow-motion workflows compiled at a lower FPS.',
    ],
  },
  '1.9.5': {
    title: 'Map Sim, keyboard control, and updater download fix',
    summary: [
      'Map Sim opens a dedicated projection simulator for mapping practice and proposals.',
      'Keyboard shortcuts now drive VJ, mapping, and performance controls.',
      'Updater prompts now send users to the signed download page.',
    ],
    highlights: [
      'Map Sim adds a dedicated projection-simulation workspace with a Stage Sim-style pop-out window, projector placement, room exposure, shadow strength, floor projection, lockable projectors and objects, copy/paste, snapping, even-spacing guides, fullscreen, recording, save/load, and direct scene selection.',
      'Projection setups now start from focused presets: the isometric cube pyramid, fragmented cube wall, and museum facade. You can edit or delete preset objects, snap them together, space them coherently, and import the same complex GLB/3D model files used by mapping-mode 3D model layers.',
      'Keyboard control joins MIDI and OSC as a first-class control surface: key combinations persist per project and dispatch through the shared mapping router for VJ, mapping, and performance workflows.',
      'VJ Layer Sequencer adds a BPM-synced step grid for opacity gating, with the sequenced output wired through live output, offline rendering, and Stage 3D recording paths.',
      'VJ mode now has a vertical A/B crossfader and a Plugins tab that mirrors the editor Media Library, making performer-mode browsing and deck blending line up with the main editor.',
      'Release/update polish replaces brittle in-app installer downloads with a direct link to the signed download page and shows readable release notes instead of generated GitHub link noise.',
    ],
  },
  '1.9.4': {
    title: 'Map Sim, keyboard control, and VJ sequencer',
    summary: [
      'Map Sim opens a dedicated projection simulator for mapping practice and proposals.',
      'Keyboard shortcuts now drive VJ, mapping, and performance controls.',
      'VJ mode gets a sequencer, vertical crossfader, and plugins parity.',
    ],
    highlights: [
      'Map Sim adds a dedicated projection-simulation workspace with a Stage Sim-style pop-out window, projector placement, room exposure, shadow strength, floor projection, lockable projectors and objects, copy/paste, snapping, even-spacing guides, fullscreen, recording, save/load, and direct scene selection.',
      'Projection setups now start from focused presets: the isometric cube pyramid, fragmented cube wall, and museum facade. You can edit or delete preset objects, snap them together, space them coherently, and import the same complex GLB/3D model files used by mapping-mode 3D model layers.',
      'Keyboard control joins MIDI and OSC as a first-class control surface: key combinations persist per project and dispatch through the shared mapping router for VJ, mapping, and performance workflows.',
      'VJ Layer Sequencer adds a BPM-synced step grid for opacity gating, with the sequenced output wired through live output, offline rendering, and Stage 3D recording paths.',
      'VJ mode now has a vertical A/B crossfader and a Plugins tab that mirrors the editor Media Library, making performer-mode browsing and deck blending line up with the main editor.',
      'Release/update polish replaces brittle in-app installer downloads with a direct link to the signed download page and shows readable release notes instead of generated GitHub link noise.',
    ],
  },
};

function normalizeVersion(version: string | null | undefined): string {
  return (version ?? '').trim().replace(/^v/i, '');
}

function cleanReleaseBody(body: string | null | undefined): string[] {
  if (!body) return [];

  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^#+\s*/, ''))
    .filter((line) => line.length > 0)
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/github\.com/i.test(line))
    .filter((line) => !/full changelog|compare changes|assets?|download/i.test(line))
    .slice(0, 6);
}

export function releaseNotesForVersion(version: string, fallbackBody?: string): AppReleaseNotes {
  const normalized = normalizeVersion(version);
  const notes = RELEASE_NOTES[normalized];
  if (notes) return notes;

  const cleaned = cleanReleaseBody(fallbackBody);
  return {
    title: `Ghost Arcade v${normalized || version}`,
    summary: cleaned.slice(0, 3),
    highlights: cleaned.length > 0
      ? cleaned
      : ['Open the download page for the latest signed installers and release notes.'],
  };
}
