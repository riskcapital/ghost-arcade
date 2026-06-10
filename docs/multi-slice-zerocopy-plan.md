# Multi-Slice Zero-Copy Senders — Implementation Plan (Optimized)

Status: proposed (2026-06-10). Target: GPU-resident, multi-sender Spout
(Windows) / Syphon (macOS) output that scales to many screens with a
**flat cost** — one compositor + one GPU capture regardless of slice
count. No per-slice windows, no CPU readback.

## Why

Two problems, one fix:

1. **Zero-copy gap.** Slices routed to a texture-share *sender* (not a
   physical display) are the last CPU-readback path
   (`renderSlicePixelsAsync` → GPU→CPU PBO → IPC per slice per frame).
2. **Multi-sender is actually broken on Spout/Syphon.** `spout_send_image`
   ignores the per-slice `senderName` and always writes the single global
   `spoutOutput`; ≥2 sender slices stomp one sender, last-writer-wins.
   (NDI is fine — proper per-name senders.) This feature fixes that too.

## Chosen architecture — "Atlas OSR + native sub-region fan-out"

One hidden offscreen (OSR) window renders **all** sender-slices into a
single packed **atlas** canvas using the existing slice shader. Chromium
captures the atlas as **one** shared GPU texture. The native addon opens
that texture once and, for each slice, does a cheap **GPU sub-region
copy** into that sender's texture and publishes it. N zero-copy senders,
one compositor, one capture, no CPU pixels — cost is flat in slice count.

```
 hidden OSR window (ONE compositor, ONE renderer process)
   renders every sender-slice into its tile of an atlas canvas
   via the existing SLICE_SHADER_WGSL (crop+warp+rotate+color+blend)
        │  Chromium OSR paint → ONE shared GPU texture (DXGI / IOSurface)
        ▼
 native addon: open atlas texture ONCE, then per slice:
   GPU sub-rect copy (D3D11 CopySubresourceRegion / GL blit) → sender tex
   → SpoutDX/Syphon publish
        ▼
   N independent zero-copy Spout/Syphon senders
```

Why this is the optimal shape:
- **Flat cost.** 1 hidden window + 1 capture + N tiny GPU copies. Adding
  screens adds only a GPU sub-copy + a sender object — no extra
  compositor/process. This is what lets people run many screens with
  confidence.
- **No warp-logic duplication.** All crop/warp/rotation/color/edge-blend
  stays in the existing WGSL slice shader, rendered into atlas tiles. The
  native side only does rectangular GPU copies — no shaders, no drift.
- **Reuses the proven OSR→sendTexture transport** (the single-output
  zero-copy path) — same handle handling, same GPU-adapter checks.

## Components & changes

### 1. Atlas renderer — new window mode `slice-atlas` (renderer)
New lightweight app (or a mode in `SliceOutputApp`) mounted at
`?mode=slice-atlas`. It:
- Runs one state-synced master compositor (like `SpoutOutputApp` does for
  single output) — its own `<Canvas/>` + master-warp tick.
- Computes an atlas layout: shelf-pack every `targetType:'sender'`,
  `outputType:'spout'|'syphon'` slice's output rect (rotation-aware) into
  a single canvas, max dim 16384, wrap to rows.
- Each frame, for each slice tile: set the WebGPU viewport/scissor to the
  tile and run the existing `SLICE_SHADER_WGSL` (crop+warp+rotate+color+
  edge-blend) sampling the master frame → writes that tile.
- Publishes the atlas layout (`[{sliceId, senderName, outputType, x, y,
  w, h}]` + atlas w/h) to main via IPC whenever it changes.

### 2. Native addons — atlas fan-out (C++/ObjC, both platforms)
New multi-sender manager per platform (no warp logic — copies only):
- **Windows `SpoutAtlasOutput`** (`spout_addon.cpp`): `configure(regions)`
  creates/updates N named `SpoutDX` senders + N `ID3D11Texture2D` targets.
  `sendAtlas(sharedHandle, atlasW, atlasH, regions)` → `OpenSharedResource`
  the atlas once, per region `CopySubresourceRegion` tile→sender tex,
  `SendTexture`. Pure GPU copies.
- **macOS `SyphonAtlasOutput`** (`syphon_addon.mm`): `configure(regions)`
  creates N `SyphonServer` + N `GL_TEXTURE_2D`. `sendAtlas(ioSurface,
  atlasW, atlasH, regions)` → wrap atlas via `CGLTexImageIOSurface2D`
  once, per region blit sub-rect → sender tex (`glBlitFramebuffer` or
  textured quad), `publishFrameTexture`. Handle the `flipped:` convention
  to match single-output.
- Existing `SpoutOutput`/`SyphonOutput` (single full-frame sender)
  unchanged.

### 3. Main process orchestration (`electron/main.js`)
- New `slice-atlas` OSR window (mirrors `createSpoutOsrWindow`): hidden,
  `offscreen:{useSharedTexture:true}`, sized to the atlas, loads
  `?mode=slice-atlas`. One window total, not per slice.
- Hold one `SpoutAtlasOutput`/`SyphonAtlasOutput`. On atlas-layout IPC,
  call `configure(regions)`; resize the OSR window to atlas dims.
- `paint` handler → `atlasOutput.sendAtlas(handle, atlasW, atlasH,
  regions)`.
- IPC: `texshare_start_atlas(regions)` / `texshare_stop_atlas()` /
  extend `spout_get_status` to report per-sender zero-copy state.
- Teardown discipline: atlas window + atlas output + all sender textures
  released on stop/quit (`closeAuxiliaryWindows`).

### 4. Renderer routing (`Canvas.svelte`)
- When the atlas path is active, **skip** `renderSlicePixelsAsync` +
  `spout_send_image` for every Spout/Syphon sender slice (the atlas
  window produces them).
- On slice-config change (already tracked via `lastSliceIdsKey`), push
  the sender-slice set so the atlas window re-packs and main re-configures.
- Per-sender degraded badge in the Screens panel when zero-copy is off
  (closes the "never fail silently" item for slices).

### 5. NDI
NDI is a CPU-frame protocol — stays on the existing async PBO readback
with its correct per-name senders. Not part of the atlas. (Optional later:
read back atlas tiles once to feed NDI from the same render; not needed
now.)

## Phasing (Windows-testable first; Mac for Syphon)

1. **Atlas renderer** (`slice-atlas` mode) + layout IPC. Verify the atlas
   canvas shows all slices correctly tiled (screenshot the OSR window).
   *Testable here.*
2. **Windows `SpoutAtlasOutput`** + main orchestration + renderer
   routing. Verify N independent Spout senders in a Spout receiver, all
   live, correct content, zero CPU readback. *Testable here (Spout loopback).*
3. **macOS `SyphonAtlasOutput`** parity. Verify N Syphon servers in a
   Syphon receiver. *Mac/codex dev verifies + builds the .mm.*
4. **NDI no-regression** + degraded-status UI + status reporting.
   *Testable here.*
5. **Polish:** atlas-dimension guard (split to a second atlas window only
   if >16384 — rare), docs, update the zero-copy state map.

## Risks

- **Native build dependency.** Real C++/ObjC in both addons; the macOS
  half must be built + verified on the Mac. Windows half built here via
  the existing `electron/native` CMake flow.
- **Atlas size ceiling.** 16384² fits e.g. 6×4K or many 1080p; a guard
  splits to a second atlas window only in extreme cases.
- **D3D11 shared-texture / adapter constraint.** Same as single-output:
  the OSR window's Chromium must be on the SpoutDX adapter (reuse the
  existing GPU-renderer check).
- **Orientation/flip parity** per platform — mirror single-output's
  settled conventions; verify in a receiver on each OS.
- **Atlas tile bleed.** Use scissor per tile + 0-padding between tiles so
  edge-blend gradients don't sample neighbours.

## Out of scope
- NDI zero-copy (protocol is CPU-frame).
- Per-slice physical-display windows (already zero-copy, unchanged).
