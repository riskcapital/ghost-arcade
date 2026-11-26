/**
 * When the browser preview's SVG renderer (src/lib/svg/renderer.ts) has to
 * read the artwork again or rebuild its scene. One decision per frame, so a
 * new layer is built once (it used to be built three times on its first
 * frame) and a slider that only moves a uniform never rebuilds.
 */
import type { SVGContent } from '../types';

/** The settings that change the scene's structure (geometry, materials,
 *  effect objects). Everything else updates live. */
export function svgSceneKey(c: SVGContent): string {
  return [
    c.fillMode,
    c.colorMode,
    c.liquidEnabled,
    c.particlesEnabled,
    c.energyEnabled,
    c.connectionsEnabled,
    c.glowEnabled,
    c.ripplesEnabled,
    c.lightningEnabled,
    c.edgeFlowEnabled,
    c.innerGlowEnabled,
    c.nebulaEnabled,
    c.heartbeatEnabled,
    c.plasmaEnabled,
    c.particleLinksEnabled,
    c.particleLinkMaxLinks, // a new max makes a new line pool
    c.echoEnabled,
    c.arcBridgesEnabled,
    c.renderMode,
    c.materialPreset,
    c.extrudeDepth,
    c.bevelEnabled,
    c.bevelSize,
    c.lightPreset,
    c.outlineStyle,
    c.connectionStyle,
    c.connectionRange,
    c.particleFillEnabled,
    c.particleFillDensity,
  ].join(',');
}

export type SvgSceneBuilt = { source: string; sceneKey: string };

export type SvgScenePlan = {
  /** Read the SVG source again. */
  parse: boolean;
  /** Rebuild the scene. */
  build: boolean;
  /** No artwork: nothing to draw, and the last picture must go. */
  empty: boolean;
  /** What is built once the plan has run. */
  next: SvgSceneBuilt;
};

export function planSvgScene(
  built: SvgSceneBuilt | null,
  content: SVGContent,
  sizeChanged: boolean,
): SvgScenePlan {
  const source = content.svgSource || '';
  const sceneKey = svgSceneKey(content);
  const next = { source, sceneKey };
  if (!source) return { parse: false, build: false, empty: true, next };
  const parse = !built || built.source !== source || sizeChanged;
  const build = parse || built!.sceneKey !== sceneKey;
  return { parse, build, empty: false, next };
}
