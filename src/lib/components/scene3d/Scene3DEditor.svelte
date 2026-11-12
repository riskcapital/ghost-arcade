<script lang="ts">
  /**
   * Edit an Interactive 3D world in place: the core keeps drawing it while
   * values change. World look (sky, finish, music), the camera as an orbit,
   * and the nodes: add, pick, duplicate, delete, and each node's place and
   * settings. Every drag is one undo step; every switch or typed value is one.
   */
  import { project } from '../../stores/layers';
  import {
    CAMERA_MODES,
    COLLIDERS,
    FIELD_KINDS,
    MATERIAL_PRESETS,
    SKIES,
    type Scene3D,
    type SceneNode,
  } from '../../scene3d/sceneModel';
  import {
    addNode,
    cameraOrbit,
    duplicateNode,
    NEW_NODE_LABELS,
    patchNode,
    removeNode,
    setCameraOrbit,
    setMaterial,
    setMaterialPreset,
    setTransform,
    type NewNodeKind,
  } from '../../scene3d/sceneEdit';
  import Slider from './Scene3DSlider.svelte';

  export let layerId: string;
  export let scene: Scene3D;

  let selected = '';
  $: node = scene.nodes.find((n) => n.id === selected) as SceneNode | undefined;
  $: orbit = cameraOrbit(scene.camera);

  /** Write the world. `live`: part of a drag (one undo step per gesture). */
  function write(next: Scene3D, live = false, key = 'edit') {
    project.setScene3D(layerId, next, live ? key : undefined);
  }
  const KIND_LABEL: Record<SceneNode['kind'], string> = { mesh: 'Shape', emitter: 'Particles', field: 'Force', light: 'Light', zone: 'Zone' };
  const AXES = ['X', 'Y', 'Z'] as const;
  const FIELD_LABELS: Record<string, string> = { gravity: 'Gravity', wind: 'Wind', vortex: 'Vortex', attract: 'Attract', curl: 'Swirl' };
  const SKY_LABELS: Record<string, string> = { void: 'None (see-through)', studio: 'Studio', night: 'Night' };

  function add(kind: NewNodeKind) {
    const added = addNode(scene, kind);
    if (!added) return;
    write(added.scene);
    selected = added.id;
  }
</script>

<div class="editor">
  <div class="group-label">World</div>
  <div class="row">
    <label for="s3d-sky-{layerId}">Sky</label>
    <select id="s3d-sky-{layerId}" value={scene.environment.sky} onchange={(e) => write({ ...scene, environment: { ...scene.environment, sky: e.currentTarget.value as Scene3D['environment']['sky'] } })}>
      {#each SKIES as sky}<option value={sky}>{SKY_LABELS[sky]}</option>{/each}
    </select>
  </div>
  <Slider label="Sky light" value={scene.environment.intensity} min={0} max={4} onchange={(v, live) => write({ ...scene, environment: { ...scene.environment, intensity: v } }, live, 'sky')} />
  <Slider label="Fog" value={scene.environment.fog} min={0} max={1} onchange={(v, live) => write({ ...scene, environment: { ...scene.environment, fog: v } }, live, 'fog')} />

  <div class="group-label">Finish</div>
  <Slider label="Glow" value={scene.post.bloom} min={0} max={2} onchange={(v, live) => write({ ...scene, post: { ...scene.post, bloom: v } }, live, 'bloom')} />
  <Slider label="Exposure" value={scene.post.exposure} min={-4} max={4} step={0.05} onchange={(v, live) => write({ ...scene, post: { ...scene.post, exposure: v } }, live, 'exposure')} />
  <Slider label="Contrast" value={scene.post.contrast} min={0} max={2} onchange={(v, live) => write({ ...scene, post: { ...scene.post, contrast: v } }, live, 'contrast')} />
  <Slider label="Colour" value={scene.post.saturation} min={0} max={2} onchange={(v, live) => write({ ...scene, post: { ...scene.post, saturation: v } }, live, 'saturation')} />
  <Slider label="Warmth" value={scene.post.temperature} min={-1} max={1} onchange={(v, live) => write({ ...scene, post: { ...scene.post, temperature: v } }, live, 'temperature')} />
  <Slider label="Grain" value={scene.post.grain} min={0} max={1} onchange={(v, live) => write({ ...scene, post: { ...scene.post, grain: v } }, live, 'grain')} />

  <div class="group-label">Follows the music</div>
  <Slider label="Light" value={scene.react.light} min={0} max={1} onchange={(v, live) => write({ ...scene, react: { ...scene.react, light: v } }, live, 'react-light')} />
  <Slider label="Particles" value={scene.react.particles} min={0} max={1} onchange={(v, live) => write({ ...scene, react: { ...scene.react, particles: v } }, live, 'react-particles')} />
  <Slider label="Glow" value={scene.react.bloom} min={0} max={1} onchange={(v, live) => write({ ...scene, react: { ...scene.react, bloom: v } }, live, 'react-bloom')} />
  <Slider label="Camera" value={scene.react.camera} min={0} max={1} onchange={(v, live) => write({ ...scene, react: { ...scene.react, camera: v } }, live, 'react-camera')} />

  <div class="group-label">Camera</div>
  <div class="row">
    <label for="s3d-cam-{layerId}">Moves</label>
    <select id="s3d-cam-{layerId}" value={scene.camera.mode} onchange={(e) => write({ ...scene, camera: { ...scene.camera, mode: e.currentTarget.value as Scene3D['camera']['mode'] } })}>
      {#each CAMERA_MODES as mode}<option value={mode}>{mode === 'free' ? 'Stays put' : 'Circles slowly'}</option>{/each}
    </select>
  </div>
  <Slider label="Around" value={orbit.around} min={0} max={360} step={1} unit="°" onchange={(v, live) => write(setCameraOrbit(scene, { ...orbit, around: v }), live, 'orbit')} />
  <Slider label="Height" value={orbit.up} min={-89} max={89.5} step={0.5} unit="°" onchange={(v, live) => write(setCameraOrbit(scene, { ...orbit, up: v }), live, 'orbit')} />
  <Slider label="Distance" value={orbit.distance} min={0.5} max={60} step={0.1} unit="m" onchange={(v, live) => write(setCameraOrbit(scene, { ...orbit, distance: v }), live, 'orbit')} />
  <Slider label="Lens" value={scene.camera.fov} min={5} max={120} step={1} unit="°" onchange={(v, live) => write({ ...scene, camera: { ...scene.camera, fov: v } }, live, 'fov')} />

  <div class="group-label">In the world <span class="count">{scene.nodes.length}</span></div>
  <div class="row">
    <label for="s3d-add-{layerId}">Add</label>
    <select id="s3d-add-{layerId}" value="" onchange={(e) => { const v = e.currentTarget.value as NewNodeKind; e.currentTarget.value = ''; if (v) add(v); }}>
      <option value="" disabled>Choose…</option>
      {#each Object.entries(NEW_NODE_LABELS) as [kind, label]}<option value={kind}>{label}</option>{/each}
    </select>
  </div>
  <ul class="nodes" aria-label="Nodes">
    {#each scene.nodes as n (n.id)}
      <li>
        <button class:active={n.id === selected} class:hidden-node={!n.visible} onclick={() => (selected = n.id === selected ? '' : n.id)}>
          <span>{n.name}</span><small>{n.kind === 'mesh' ? n.shape : KIND_LABEL[n.kind]}</small>
        </button>
      </li>
    {/each}
  </ul>

  {#if node}
    <div class="group-label">{node.name}</div>
    <div class="row">
      <label for="s3d-name-{layerId}">Name</label>
      <input id="s3d-name-{layerId}" value={node.name} maxlength="100" onchange={(e) => write(patchNode(scene, node!.id, { name: e.currentTarget.value.slice(0, 100) }))} />
    </div>
    <div class="row">
      <span class="label">Shown</span>
      <input type="checkbox" checked={node.visible} aria-label="Shown" onchange={(e) => write(patchNode(scene, node!.id, { visible: e.currentTarget.checked }))} />
    </div>
    {#each (['position', 'rotation', 'scale'] as const).filter((part) => part === 'position' || (part === 'rotation' ? node!.kind !== 'light' || node!.light === 'spot' : node!.kind !== 'light' && node!.kind !== 'field')) as part}
      {#each AXES as axisName, axis}
        <Slider
          label={`${part === 'position' ? 'Place' : part === 'rotation' ? 'Turn' : 'Size'} ${axisName}`}
          value={node.transform[part][axis]}
          min={part === 'rotation' ? -180 : part === 'scale' ? 0.01 : -20}
          max={part === 'rotation' ? 180 : part === 'scale' ? 20 : 20}
          step={part === 'rotation' ? 1 : 0.01}
          unit={part === 'rotation' ? '°' : part === 'position' ? 'm' : ''}
          onchange={(v, live) => write(setTransform(scene, node!.id, part, axis as 0 | 1 | 2, v), live, `${node!.id}-${part}`)}
        />
      {/each}
    {/each}

    {#if node.kind === 'mesh'}
      <div class="row">
        <label for="s3d-preset-{layerId}">Material</label>
        <select id="s3d-preset-{layerId}" value={node.material.preset ?? ''} onchange={(e) => e.currentTarget.value && write(setMaterialPreset(scene, node!.id, e.currentTarget.value as typeof MATERIAL_PRESETS[number]))}>
          <option value="" disabled>Custom</option>
          {#each MATERIAL_PRESETS as p}<option value={p}>{p[0].toUpperCase() + p.slice(1)}</option>{/each}
        </select>
      </div>
      <div class="row">
        <label for="s3d-base-{layerId}">Colour</label>
        <input id="s3d-base-{layerId}" type="color" value={node.material.base} onchange={(e) => write(setMaterial(scene, node!.id, { base: e.currentTarget.value }))} />
      </div>
      <Slider label="Metal" value={node.material.metal} min={0} max={1} onchange={(v, live) => write(setMaterial(scene, node!.id, { metal: v }), live, `${node!.id}-metal`)} />
      <Slider label="Rough" value={node.material.rough} min={0} max={1} onchange={(v, live) => write(setMaterial(scene, node!.id, { rough: v }), live, `${node!.id}-rough`)} />
      <Slider label="Glows" value={node.material.emissive} min={0} max={10} step={0.1} onchange={(v, live) => write(setMaterial(scene, node!.id, { emissive: v }), live, `${node!.id}-emissive`)} />
      <Slider label="Solid" value={node.material.opacity} min={0} max={1} onchange={(v, live) => write(setMaterial(scene, node!.id, { opacity: v }), live, `${node!.id}-opacity`)} />
      <div class="row">
        <label for="s3d-collider-{layerId}">Particles</label>
        <select id="s3d-collider-{layerId}" value={node.collider} onchange={(e) => write(patchNode(scene, node!.id, { collider: e.currentTarget.value }))}>
          {#each COLLIDERS as c}<option value={c}>{c === 'none' ? 'Pass through' : c === 'static' ? 'Bounce off' : 'Bounce off (moves later)'}</option>{/each}
        </select>
      </div>
      <div class="row">
        <span class="label">Real room</span>
        <label class="check"><input type="checkbox" checked={node.catcher} onchange={(e) => write(patchNode(scene, node!.id, { catcher: e.currentTarget.checked }))} /> Invisible; takes shadows</label>
      </div>
    {:else if node.kind === 'light'}
      <div class="row">
        <label for="s3d-lcolor-{layerId}">Colour</label>
        <input id="s3d-lcolor-{layerId}" type="color" value={node.color} onchange={(e) => write(patchNode(scene, node!.id, { color: e.currentTarget.value }))} />
      </div>
      <Slider label="Power" value={node.power} min={0} max={10} step={0.05} onchange={(v, live) => write(patchNode(scene, node!.id, { power: v }), live, `${node!.id}-power`)} />
      {#if node.light === 'key'}
        <div class="row">
          <span class="label">Shadows</span>
          <input type="checkbox" checked={node.shadows} aria-label="Shadows" onchange={(e) => write(patchNode(scene, node!.id, { shadows: e.currentTarget.checked }))} />
        </div>
        <Slider label="Circles" value={node.orbit} min={-60} max={60} step={0.5} unit="°/s" onchange={(v, live) => write(patchNode(scene, node!.id, { orbit: v }), live, `${node!.id}-orbit`)} />
        <p class="hint">A sun's direction is from the world's centre to its place.</p>
      {/if}
    {:else if node.kind === 'emitter'}
      <div class="row">
        <label for="s3d-ecolor-{layerId}">Colour</label>
        <input id="s3d-ecolor-{layerId}" type="color" value={node.color} onchange={(e) => write(patchNode(scene, node!.id, { color: e.currentTarget.value }))} />
      </div>
      <Slider label="A second" value={node.rate} min={0} max={20000} step={10} onchange={(v, live) => write(patchNode(scene, node!.id, { rate: v }), live, `${node!.id}-rate`)} />
      <Slider label="Burst" value={node.burst} min={0} max={20000} step={10} onchange={(v, live) => write(patchNode(scene, node!.id, { burst: v }), live, `${node!.id}-burst`)} />
      <Slider label="Lifetime" value={node.life} min={0.05} max={60} step={0.05} unit="s" onchange={(v, live) => write(patchNode(scene, node!.id, { life: v }), live, `${node!.id}-life`)} />
      <Slider label="Speed" value={node.speed} min={0} max={20} step={0.05} unit="m/s" onchange={(v, live) => write(patchNode(scene, node!.id, { speed: v }), live, `${node!.id}-speed`)} />
      <Slider label="Spread" value={node.spread} min={0} max={180} step={1} unit="°" onchange={(v, live) => write(patchNode(scene, node!.id, { spread: v }), live, `${node!.id}-spread`)} />
      <Slider label="Size" value={node.size} min={0.001} max={0.5} step={0.001} unit="m" onchange={(v, live) => write(patchNode(scene, node!.id, { size: v }), live, `${node!.id}-size`)} />
      <Slider label="Glows" value={node.glow} min={0} max={10} step={0.05} onchange={(v, live) => write(patchNode(scene, node!.id, { glow: v }), live, `${node!.id}-glow`)} />
    {:else if node.kind === 'field'}
      <div class="row">
        <label for="s3d-field-{layerId}">Force</label>
        <select id="s3d-field-{layerId}" value={node.field} onchange={(e) => write(patchNode(scene, node!.id, { field: e.currentTarget.value }))}>
          {#each FIELD_KINDS as f}<option value={f}>{FIELD_LABELS[f]}</option>{/each}
        </select>
      </div>
      <Slider label="Strength" value={node.strength} min={-50} max={50} step={0.05} onchange={(v, live) => write(patchNode(scene, node!.id, { strength: v }), live, `${node!.id}-strength`)} />
      <Slider label="Reach" value={node.radius} min={0} max={50} step={0.1} unit="m" onchange={(v, live) => write(patchNode(scene, node!.id, { radius: v }), live, `${node!.id}-radius`)} />
      <p class="hint">Reach 0 is everywhere, at full strength.</p>
    {/if}

    <div class="tools">
      <button onclick={() => { const d = duplicateNode(scene, node!.id); if (d) { write(d.scene); selected = d.id; } }}>Duplicate</button>
      <button class="danger" onclick={() => { const id = node!.id; selected = ''; write(removeNode(scene, id)); }}>Delete</button>
    </div>
  {/if}
</div>

<style>
  .editor {
    margin: 4px 0 12px;
  }
  .group-label {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-ink-2, #6b7280);
    margin: 14px 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }
  .count {
    float: right;
    font-weight: 500;
    letter-spacing: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h, 26px);
    margin-bottom: 4px;
  }
  .row label,
  .label {
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control, 12px);
  }
  .row select,
  .row input:not([type='checkbox']):not([type='color']) {
    height: var(--ga-control-h, 26px);
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    font-size: var(--ga-text-control, 12px);
    padding: 0 8px;
    min-width: 0;
  }
  .row input[type='color'] {
    width: 44px;
    height: var(--ga-control-h-sm, 22px);
    padding: 0;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: transparent;
  }
  .row .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nodes {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    max-height: 220px;
    overflow: auto;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
  }
  .nodes button {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: var(--ga-control-h-sm, 24px);
    padding: 0 8px;
    background: transparent;
    border: 0;
    color: var(--ga-ink-0, #eef0f4);
    font-size: var(--ga-text-control, 12px);
    text-align: left;
    cursor: pointer;
  }
  .nodes button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nodes button small {
    color: var(--ga-ink-2, #6b7280);
  }
  .nodes button:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .nodes button.active {
    background: color-mix(in srgb, var(--ga-icon, #5278ff) 22%, transparent);
  }
  .nodes button.hidden-node span {
    color: var(--ga-ink-2, #6b7280);
  }
  .hint {
    margin: 0 0 6px 92px;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #6b7280);
  }
  .tools {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .tools button {
    min-height: var(--ga-control-h, 26px);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }
  .tools button.danger:hover {
    color: var(--ga-danger, #e5484d);
  }
</style>
