// Generated static cost exclusions. Conservative mobile budget; not device benchmark scores.
export const mobileHeavyShaderPaths = new Set<string>([
  "ISF/51_SacredGeometryCathedral.fs",
  "ISF/52_ChaoticOrbitalMesh.fs",
  "ISF/AR-GeodesicBloom.fs",
  "ISF/AR-MobiusStrip.fs",
  "ISF/AR-WaveformHelix.fs",
  "ISF/InfiniteGrid.fs",
  "ISF/MirrorRealm.fs",
  "ISF/OssiferousRadiolaria.fs",
  "ISF/PrismaticVoid.fs",
  "ISF/QuantumLattice.fs",
  "ISF/SM-ElectricFence.fs",
  "ISF/SM-RicochetLaser.fs",
  "ISF/SolLeWittCubes.fs",
  "ISF/ThreeBody.fs",
  "ISF/VoronoiWarpDrive.fs",
  "ISF/crystal-dimension.fs",
  "ISF/cube shaders/3D_01_SphereCluster.fs",
  "ISF/cube shaders/3D_02_ChromeSpheres.fs",
  "ISF/cube shaders/3D_03_WireframeGeo.fs",
  "ISF/cube shaders/3D_04_CubeField.fs",
  "ISF/cube shaders/3D_05_NeonCubes.fs",
  "ISF/cube shaders/3D_08_OrganicSculpt.fs",
  "ISF/cube shaders/3D_11_InfiniteHall.fs",
  "ISF/fractal-dimension-supreme.fs",
  "ISF/fractal-tunnel-cosmos.fs",
  "ISF/mega-blob-fusion.fs",
  "ISF/organic-dimension.fs",
  "ISF/psychedelic-noise-flow.fs",
  "ISF/quantum-grids.fs",
  "ISF/tron-organic-fusion.fs",
  "ISF/wireframe-mesh-3d.fs"
]);
/** Heavy shaders kept on mobile: internal render scale and raymarch detail multipliers. */
export const mobileShaderBudgets: Record<string, { scale: number; detail: number }> = {
  "ISF/GA-GhostFX.fs": {
    "scale": 0.6,
    "detail": 0.7
  }
};
/** Shaders stripped from the mobile release (native-mobile/release-exclusions.json). A saved set may still name them. */
export const mobileRemovedShaderPaths = new Set<string>([
  "ISF/AnotherGridThingy.fs",
  "ISF/Galaxy of Universes+.fs",
  "ISF/InnerDimensionalMatrix.fs",
  "ISF/Melty Boi.fs",
  "ISF/Neon psy.fs",
  "ISF/Pegasus Galaxy.fs",
  "ISF/Untitled Shader.fs",
  "ISF/grigM_gs61327.fs"
]);
