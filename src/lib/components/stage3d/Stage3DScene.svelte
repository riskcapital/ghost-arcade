<script lang="ts">
  /**
   * The scene graph. Renders camera, lighting baseline, ground, and
   * dispatches over `Stage3DScene.nodes` to the right child component
   * per node `type`. Lives INSIDE a Threlte `<Canvas>` (provided by
   * Stage3DDesigner) so it can use the `T.*` shortcuts.
   */
  import { T } from '@threlte/core';
  import { OrbitControls, Grid, interactivity } from '@threlte/extras';
  import * as THREE from 'three';
  import LedScreen3D from './LedScreen3D.svelte';
  import { fitPlatform } from '../../stage3d/platformFit';
  import type { Stage3DScene } from '../../stage3d/types';

  export let scene: Stage3DScene;
  /** Live master composite texture from the editor's RenderEngine.
   *  Same renderer context — direct GPU texture handoff, no captureStream. */
  export let masterTexture: THREE.Texture | null;
  /** Currently selected node id — drives selection outline + properties
   *  panel. Two-way bound to Stage3DDesigner so meshes can claim
   *  selection on click. */
  import { selectedStage3DNodeId } from '../../stage3d/store';
  $: selectedNodeId = $selectedStage3DNodeId;

  // Enable pointer events on meshes (raycast-based). Required for any
  // `onclick` handler on a `<T.Mesh>` to fire.
  interactivity();

  // Live-fit the platform to the LED-screen footprint every render so
  // the deck always belongs to the rig that sits on it. Authoring the
  // platform's style (colors, height, underglow) on the scene/preset
  // still works — the auto-fit only overrides `position`, `width`,
  // `depth` to wrap the screens with padding.
  $: fittedPlatform = fitPlatform(scene);
</script>

<!-- Sky / ambient -->
<T.Color args={[scene.environment.background]} attach="background" />
<T.AmbientLight intensity={scene.environment.ambient} />

<!-- Hero directional rig — soft fill so PBR materials don't look murky.
     Audience-side lighting comes from the rig and the LED screen
     emissives; stage-back lights get added per-preset via reactive
     light nodes (Phase D). -->
<T.DirectionalLight position={[8, 12, 6]} intensity={1.1} castShadow />
<T.DirectionalLight position={[-8, 8, -4]} intensity={0.35} color="#a0c8ff" />

<!-- Default camera + orbit. `makeDefault` registers this camera as the
     scene's active camera so `<Canvas>` knows to render through it.
     OrbitControls binds to `target` from the scene's camera state. -->
<T.PerspectiveCamera
  makeDefault
  position={scene.camera.position}
  fov={scene.camera.fov}
  near={0.1}
  far={1000}
>
  <OrbitControls
    enableDamping
    dampingFactor={0.08}
    target={scene.camera.target}
    maxPolarAngle={Math.PI / 2 - 0.02}
    minDistance={2}
    maxDistance={120}
  />
</T.PerspectiveCamera>

<!-- Ground plane + grid. The grid uses a wide cellSize so the floor
     reads as a giant stage deck without going moiré at distance. -->
{#if scene.environment.showGround}
  <T.Mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
    <T.PlaneGeometry args={[200, 200]} />
    <T.MeshStandardMaterial color={scene.environment.groundColor} roughness={0.9} metalness={0.05} />
  </T.Mesh>
  <Grid
    cellSize={1}
    cellThickness={0.5}
    cellColor="#3a3a44"
    sectionSize={5}
    sectionColor="#5a5a6a"
    sectionThickness={1.2}
    fadeDistance={80}
    fadeStrength={1.2}
    position={[0, 0.005, 0]}
  />
{/if}

<!-- Stage platform — raised deck under the artist. Three pieces:
     1. The deck box itself, slightly bevelled so the top edge catches
        light and reads as a real stage rather than a flat plate.
     2. A skirt box sitting just below the bevelled top, sized larger
        in W/D so it forms a visible band of darker material around
        the perimeter of the deck.
     3. An optional underglow emissive strip running along the front
        of the deck — reads as LED tape under the stage lip.
     The platform size/position is fit-to-screens via `fitPlatform`,
     so it always belongs to the LED rig that sits on it. -->
{#if fittedPlatform}
  {@const p = fittedPlatform}
  {@const topY = p.position[1] + p.height}
  <!-- Skirt (slightly under, slightly wider so it shows as a band) -->
  <T.Mesh
    position={[p.position[0], p.position[1] + p.height / 2 - 0.02, p.position[2]]}
    receiveShadow
  >
    <T.BoxGeometry args={[p.width * 1.01, p.height + 0.04, p.depth * 1.01]} />
    <T.MeshStandardMaterial color={p.skirtColor} roughness={0.95} metalness={0.05} />
  </T.Mesh>
  <!-- Deck top — slightly inset so the skirt shows around its perimeter.
       Bevel approximated with a thin box right at the top. -->
  <T.Mesh
    position={[p.position[0], topY, p.position[2]]}
    receiveShadow
    castShadow
  >
    <T.BoxGeometry args={[p.width - p.bevelSize * 2, 0.06, p.depth - p.bevelSize * 2]} />
    <T.MeshStandardMaterial color={p.topColor} roughness={0.7} metalness={0.15} />
  </T.Mesh>
  {#if p.underglow?.enabled}
    <!-- Under-glow strip — emissive thin box at the front edge of the
         deck, slightly recessed into the skirt so the light reads as
         seeping out from under the lip. -->
    <T.Mesh
      position={[p.position[0], p.position[1] + 0.05, p.position[2] + p.depth / 2 + 0.005]}
    >
      <T.BoxGeometry args={[p.width * 0.98, 0.08, 0.04]} />
      <T.MeshStandardMaterial
        color={p.underglow.color}
        emissive={p.underglow.color}
        emissiveIntensity={p.underglow.intensity}
        toneMapped={false}
      />
    </T.Mesh>
  {/if}
{/if}

<!-- Per-node dispatch. New node types extend this switch. -->
{#each scene.nodes as node (node.id)}
  {#if node.type === 'led-screen'}
    <LedScreen3D
      {node}
      {masterTexture}
      selected={selectedNodeId === node.id}
      onSelect={() => selectedStage3DNodeId.set(node.id)}
    />
  {/if}
  <!-- Truss / primitive / svg-extrude / lights / lasers / fog wired in
       in their respective phases. -->
{/each}
