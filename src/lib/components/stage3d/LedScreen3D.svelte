<script lang="ts">
  /**
   * A single LED-wall mesh. The texture handed in is a THREE.Texture
   * sourced directly from the editor's RenderEngine compositeTarget —
   * same renderer process, same GL context, zero-copy at the GPU level.
   * No captureStream, no VideoTexture, no media pipeline.
   *
   * Each mesh clones the source texture so it can independently set
   * offset/repeat for the VJ Screen crop region without affecting
   * other walls. Clones share the underlying GPUTexture upload — the
   * UV transform is per-material.
   *
   * Curvature: a positive `curvature` produces a convex panel that bows
   * toward the audience, negative = concave. `curvature === 0` falls
   * back to a flat PlaneGeometry for cheaper draw cost.
   */
  import { T } from '@threlte/core';
  import * as THREE from 'three';
  import { onDestroy } from 'svelte';
  import type { StageLedScreenNode } from '../../stage3d/types';
  import { screens } from '../../stores/screens';

  export let node: StageLedScreenNode;
  /** Master composite texture from the editor's RenderEngine. Live —
   *  Three uses the GPU texture handle directly, so updates appear
   *  with no extra work. */
  export let masterTexture: THREE.Texture | null;
  /** True when this node is the inspector's selection target — renders
   *  a highlighted outline so the user can see which screen they're
   *  editing. */
  export let selected: boolean = false;
  /** Click callback — fires when the user clicks the screen mesh.
   *  Used by Stage3DScene to claim selection. */
  export let onSelect: () => void = () => {};

  // Per-mesh texture clone. Clones a THREE.Texture but shares the
  // underlying GPU image, so each LED wall can apply its own UV
  // transform (crop) without re-uploading the texture.
  let texture: THREE.Texture | null = null;

  $: if (masterTexture && !texture) {
    texture = masterTexture.clone();
    // RenderEngine writes to compositeTarget in linear color space; the
    // composited target is sRGB-encoded. Pass through unchanged so the
    // 3D scene sees identical colour to the editor viewport.
    texture.colorSpace = masterTexture.colorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // The editor's composite target is Y-flipped (WebGL convention) but
    // Three's PlaneGeometry expects Y=0 at the bottom; flipping the
    // texture lines them up so the rendered shader doesn't appear
    // upside-down on the LED walls.
    texture.flipY = false;
    texture.needsUpdate = true;
  }

  // VJ Screen crop. `source === 'master'` shows the full master canvas;
  // anything else is a screen id from the editor's screens store. If
  // the screen doesn't exist (sync race at startup) we fall back to the
  // full master view instead of going black.
  $: cropRect = (() => {
    if (!node.source || node.source === 'master') {
      return { x: 0, y: 0, w: 1, h: 1 };
    }
    const screen = $screens.find(s => s.id === node.source);
    if (!screen) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: screen.cropX, y: screen.cropY, w: screen.cropW, h: screen.cropH };
  })();

  // Apply the crop via Three's texture.offset/repeat. With flipY=false,
  // the composite target's V axis matches a top-down image — so screen
  // cropY (measured from the top of the editor canvas, matching the
  // editor's slice convention) maps directly to texture.offset.y after
  // accounting for the GL bottom-up convention: offset.y measures from
  // the bottom of the source image upward.
  $: if (texture) {
    texture.offset.set(cropRect.x, 1 - cropRect.y - cropRect.h);
    texture.repeat.set(cropRect.w, cropRect.h);
    texture.needsUpdate = true;
  }

  // Build a curved-panel geometry on-the-fly so curvature changes don't
  // need a re-mount. For flat screens we let Threlte use the cached
  // PlaneGeometry primitive (cheaper). The curved variant samples N
  // segments along the width and bends them around an arc.
  function buildCurvedGeometry(w: number, h: number, curvature: number): THREE.BufferGeometry {
    const segments = 24;
    const geo = new THREE.PlaneGeometry(w, h, segments, 1);
    const pos = geo.attributes.position;
    const R = 1 / curvature;
    const sign = Math.sign(curvature);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const arg = Math.max(0, R * R - x * x);
      const dz = (Math.abs(R) - Math.sqrt(arg)) * sign;
      pos.setZ(i, dz);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  $: curvedGeometry = node.curvature !== 0
    ? buildCurvedGeometry(node.width, node.height, node.curvature)
    : null;

  $: emissiveIntensity = node.finish === 'led'
    ? node.brightness * 1.2
    : node.finish === 'projection'
      ? node.brightness * 0.6
      : node.brightness;

  function handleMeshClick(e: Event) {
    e.stopPropagation();
    onSelect();
  }

  onDestroy(() => {
    // Dispose the per-mesh clone but don't touch the master texture —
    // it's owned by the editor's RenderEngine and survives across
    // scene swaps.
    texture?.dispose();
    texture = null;
    curvedGeometry?.dispose();
  });
</script>

<T.Group
  position={node.position}
  rotation={node.rotation}
  scale={node.scale}
  visible={node.visible}
  userData={{ nodeId: node.id, nodeType: 'led-screen' }}
>
  {#if curvedGeometry}
    <T.Mesh
      geometry={curvedGeometry}
      onclick={handleMeshClick}
    >
      <T.MeshStandardMaterial
        map={texture}
        emissiveMap={texture}
        emissive="#ffffff"
        {emissiveIntensity}
        roughness={0.6}
        metalness={0}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </T.Mesh>
  {:else}
    <T.Mesh onclick={handleMeshClick}>
      <T.PlaneGeometry args={[node.width, node.height]} />
      <T.MeshStandardMaterial
        map={texture}
        emissiveMap={texture}
        emissive="#ffffff"
        {emissiveIntensity}
        roughness={0.6}
        metalness={0}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </T.Mesh>
  {/if}

  {#if selected}
    <T.Mesh position={[0, 0, 0.02]}>
      <T.PlaneGeometry args={[node.width * 1.04, node.height * 1.04]} />
      <T.MeshBasicMaterial color="#BB86FC" wireframe transparent opacity={0.7} side={THREE.DoubleSide} />
    </T.Mesh>
  {/if}

  {#if node.frameDepth > 0}
    <T.Mesh position={[0, 0, -node.frameDepth / 2 - 0.01]}>
      <T.BoxGeometry args={[node.width * 1.02, node.height * 1.02, node.frameDepth]} />
      <T.MeshStandardMaterial color="#0a0a0e" roughness={0.85} metalness={0.2} />
    </T.Mesh>
  {/if}
</T.Group>
