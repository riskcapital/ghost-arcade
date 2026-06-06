# Stage 3D Handoff

## Current user state

Justin now had Stage 3D screens showing VJ content, but after the last performance pass the connection between VJ layers and the 3D stage broke again.

Important: Justin asked the next agent not to continue coding blindly. Start by reading this and checking the current runtime state.

## User goal

The external Stage 3D window should show the 3D version of the active stage while Justin performs in VJ mode:

- Stage Designer / SVG import creates VJ screen layers.
- VJ layers are assigned to those screens.
- In VJ mode, the Stage tab shows the 2D mapped stage with visuals.
- The external Stage 3D window should show the matching 3D stage with those same visuals on the LED meshes.
- This needs to stay usable on an external monitor while the editor remains available.

## What was working before the last performance pass

After adding the Stage 3D IPC relay, Justin confirmed:

> now I see content on the screens

So the basic content path was working:

- Stage 3D window mounted `Stage3DWindowApp.svelte`.
- `Canvas stage3DOutput={true}` rendered its own local compositor.
- `Stage3DRenderer` sampled `engine.getCompositeTexture()` / screen-layer textures.
- The Electron IPC relay provided project/VJ/stage state to the separate window.

## What changed in the last performance pass

The relay was split into multiple streams to avoid repeated full project imports:

- `full`: full project/layout payload
- `live`: slim VJ live state
- `scene`: Stage 3D scene state
- `settings`: output settings

Relevant files:

- `src/lib/sync/stateBroadcast.ts`
- `electron/main.js`
- `src/lib/components/Canvas.svelte`
- `src/lib/stores/settings.ts`
- `src/lib/stage3d/Stage3DRenderer.ts`

Performance changes also added:

- Stage 3D render cap defaulting to `30fps` via `settings.performance.stage3DFrameRate`.
- Removed per-frame `JSON.stringify(stage)` hashing in `Stage3DRenderer`.

## Most likely cause of the new break

Electron main-process code does not hot reload like the renderer.

The renderer now publishes Stage 3D relay payloads like:

```ts
invoke('stage3d_publish_state', { kind, state })
```

But if the Electron app was not fully relaunched after editing `electron/main.js`, the old main-process handler is still active:

```js
ipcMain.handle('stage3d_publish_state', (_, payload) => {
  stage3dRelayedState = payload;
  stage3dRelayTick++;
});
ipcMain.handle('stage3d_get_state', () => ({
  state: stage3dRelayedState,
  tick: stage3dRelayTick,
}));
```

That old handler stores the wrapper object itself as `state`, for example:

```js
{ kind: 'live', state: { layerStates: ... } }
```

Then the new Stage 3D receiver sees the old/legacy shape:

```ts
if (result?.state && legacyTick !== lastStage3DRelayFullTick) {
  applyProjectStatePayload(result.state, 'Stage 3D IPC relay');
}
```

That means it tries to run `project.importProject()` on `{ kind, state }`, which is not a project payload. This can break/blank the connection.

## First thing to try

Fully quit and relaunch the Electron app, not just close/reopen the Stage 3D window. The main process must pick up the new `stage3d_publish_state` / `stage3d_get_state` handlers in `electron/main.js`.

Expected good logs in the Stage 3D window:

```text
[StateSync] Stage 3D IPC relay polling started
[StateSync] First project state received (Stage 3D IPC relay)
```

If it still fails after a full relaunch, continue below.

## Safest code fix if relaunch is not enough

Add a compatibility guard in `pollStage3DRelayState()` in `src/lib/sync/stateBroadcast.ts` so old-main/new-renderer wrapper payloads are not treated as full project payloads.

Current risky legacy block:

```ts
const legacyTick = typeof result?.tick === 'number' ? result.tick : -1;
if (result?.state && legacyTick !== lastStage3DRelayFullTick) {
  lastStage3DRelayFullTick = legacyTick;
  applyProjectStatePayload(result.state, 'Stage 3D IPC relay');
  return;
}
```

Safer shape:

```ts
const legacyTick = typeof result?.tick === 'number' ? result.tick : -1;
if (result?.state && legacyTick !== lastStage3DRelayFullTick) {
  const wrapped = result.state;
  if (wrapped && typeof wrapped === 'object' && 'kind' in wrapped && 'state' in wrapped) {
    if (wrapped.kind === 'full') applyProjectStatePayload(wrapped.state, 'Stage 3D IPC relay');
    else if (wrapped.kind === 'live') applyLiveVJStatePayload(wrapped.state, 'Stage 3D IPC relay');
    else if (wrapped.kind === 'scene') applyStage3DScenePayload(wrapped.state, 'Stage 3D IPC relay');
    else if (wrapped.kind === 'settings') applySettingsPayload(wrapped.state, 'Stage 3D IPC relay');
    return;
  }

  lastStage3DRelayFullTick = legacyTick;
  applyProjectStatePayload(result.state, 'Stage 3D IPC relay');
  return;
}
```

Even better: set the matching tick for the wrapped kind before returning.

## If the split relay itself is the issue

Revert to the known-working behavior temporarily:

- Publish a full `buildSyncedStatePayload()` to `stage3d_publish_state`.
- Receiver applies it through `applyProjectStatePayload()`.

That is slower but known to reconnect visuals. Then optimize incrementally.

The user cares more about reliable visuals than the performance pass right now.

## Other things to check

1. Confirm `electron/preload.cjs` still allows:

```text
stage3d_publish_state
stage3d_get_state
stage3d_is_open
```

2. Confirm `Stage3DWindowApp.svelte` calls:

```ts
initStateBroadcast('receiver')
```

3. Confirm editor `Canvas.svelte` still calls:

```ts
initStateBroadcast('sender')
```

only in the main/editor window, not in output windows.

4. Confirm `Stage3DRenderer.textureForNode()` still resolves:

- screen layers by order when `node.source === 'auto'`
- explicit layer IDs when `node.source` is a layer ID
- master mix when no screen texture is available

5. Confirm `Canvas.svelte` still passes `layersToRender` into:

```ts
stage3DRenderer.render(
  engine.getRenderer(),
  get(stage3dScene),
  engine.getCompositeTexture(),
  $settings?.output?.slices ?? [],
  layersToRender,
);
```

## Performance notes after reconnect

The right optimization direction is still:

- Full project import only on initial load or actual layout changes.
- Live VJ state updates should merge into `vjClipLauncher` without `project.importProject()`.
- Stage 3D external window should probably stay capped around `30fps` while it is rendering its own compositor.

Long-term best architecture:

- Render the Stage 3D output once in the editor process using the editor compositor texture.
- Present that final Stage 3D frame to the external monitor using the existing WebGPU / VideoFrame output path.
- That avoids running a second full VJ compositor in the Stage 3D window.

