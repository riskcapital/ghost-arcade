// Generated from static code cost and measured GPU cost (native-mobile/shader-gpu-cost.json).
export const mobileHeavyShaderPaths = new Set<string>([
  "ISF/15_NeuralNetwork.fs",
  "ISF/16_AtomicOrbital.fs",
  "ISF/36_ConstellationMap.fs",
  "ISF/37_TorusKnot.fs",
  "ISF/39_TensorField.fs",
  "ISF/42_GyroscopicRings.fs",
  "ISF/44_Oscilloscope.fs",
  "ISF/51_SacredGeometryCathedral.fs",
  "ISF/52_ChaoticOrbitalMesh.fs",
  "ISF/54_ShatteredLattice.fs",
  "ISF/56_ConnectedCubes.fs",
  "ISF/61_SingularityCollapse.fs",
  "ISF/67_ParticleSupernova.fs",
  "ISF/68_MoebiusPortal.fs",
  "ISF/70_LiquidMetal.fs",
  "ISF/71_CosmicSpine.fs",
  "ISF/72_ShatteredReality.fs",
  "ISF/78_PlasmaVortex.fs",
  "ISF/79_FractalFoldExplorer.fs",
  "ISF/83_CosineCaveMarcher.fs",
  "ISF/AR-DoublePendulum.fs",
  "ISF/AR-Ferrofluid.fs",
  "ISF/AR-FrequencyTerrain.fs",
  "ISF/AR-GeodesicBloom.fs",
  "ISF/AR-Lissajous.fs",
  "ISF/AR-MobiusStrip.fs",
  "ISF/AR-StrangeAttractor.fs",
  "ISF/AR-WaveformHelix.fs",
  "ISF/AbyssalHelix.fs",
  "ISF/AstralCrystal.fs",
  "ISF/AstralJellyfish.fs",
  "ISF/DM-NodeNetwork.fs",
  "ISF/DM-ParticleVortex.fs",
  "ISF/DM-Spirograph.fs",
  "ISF/DM-Starfield.fs",
  "ISF/DeepMetalBlobs.fs",
  "ISF/DimensionalRift.fs",
  "ISF/Featured-aurora.fs",
  "ISF/Featured-murmur.fs",
  "ISF/Featured-sentinels.fs",
  "ISF/Featured-tide.fs",
  "ISF/FireEmber.fs",
  "ISF/FractalVoronoiBloom.fs",
  "ISF/InfiniteGrid.fs",
  "ISF/LeWittPyramid.fs",
  "ISF/LithoponicErosion.fs",
  "ISF/MirrorRealm.fs",
  "ISF/MoltenVoronoiCore.fs",
  "ISF/NestedCubes.fs",
  "ISF/OrganicMetal.fs",
  "ISF/OssiferousRadiolaria.fs",
  "ISF/ParticleField.fs",
  "ISF/PrismaticVoid.fs",
  "ISF/QuantumLattice.fs",
  "ISF/SM-ElectricFence.fs",
  "ISF/SM-PongArena.fs",
  "ISF/SM-RicochetLaser.fs",
  "ISF/SM-SwarmIntelligence.fs",
  "ISF/SM-VineCrawl.fs",
  "ISF/SolLeWittCubes.fs",
  "ISF/StellarNursery.fs",
  "ISF/ThreeBody.fs",
  "ISF/VoronoiCrystalExtrusion.fs",
  "ISF/VoronoiTerrainFlyover.fs",
  "ISF/VoronoiWarpDrive.fs",
  "ISF/crystal-dimension.fs",
  "ISF/cube shaders/3D_01_SphereCluster.fs",
  "ISF/cube shaders/3D_02_ChromeSpheres.fs",
  "ISF/cube shaders/3D_03_WireframeGeo.fs",
  "ISF/cube shaders/3D_04_CubeField.fs",
  "ISF/cube shaders/3D_05_NeonCubes.fs",
  "ISF/cube shaders/3D_07_FluidCube.fs",
  "ISF/cube shaders/3D_08_OrganicSculpt.fs",
  "ISF/cube shaders/3D_10_ShatteredCube.fs",
  "ISF/cube shaders/3D_11_InfiniteHall.fs",
  "ISF/cube shaders/3D_14_NebulaCloud.fs",
  "ISF/cube shaders/3D_17_BubbleMass.fs",
  "ISF/cube shaders/3D_19_AbstractPillars.fs",
  "ISF/cube shaders/3D_20_MoltenCore.fs",
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
  "ISF/11_RadialShards.fs": {
    "scale": 0.8,
    "detail": 0.85
  },
  "ISF/23_StarCluster.fs": {
    "scale": 0.6,
    "detail": 0.85
  },
  "ISF/25_PlasmaTendrils.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/38_ParticleCollider.fs": {
    "scale": 0.85,
    "detail": 0.85
  },
  "ISF/48_PlasmaContainment.fs": {
    "scale": 0.75,
    "detail": 0.85
  },
  "ISF/80_ResonantWaveWeb.fs": {
    "scale": 0.9,
    "detail": 0.85
  },
  "ISF/81_FlowFieldMosaic.fs": {
    "scale": 0.9,
    "detail": 0.85
  },
  "ISF/82_SineVortexField.fs": {
    "scale": 0.8,
    "detail": 0.85
  },
  "ISF/AR-CrystalGrowth.fs": {
    "scale": 0.75,
    "detail": 0.85
  },
  "ISF/AR-DisplacementSphere.fs": {
    "scale": 0.8,
    "detail": 0.85
  },
  "ISF/AR-SmokeTendrils.fs": {
    "scale": 0.6,
    "detail": 0.85
  },
  "ISF/AR-WaveletDecomp.fs": {
    "scale": 0.85,
    "detail": 0.85
  },
  "ISF/DM-AuroraBorealis.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/DM-DNAHelix.fs": {
    "scale": 0.8,
    "detail": 0.85
  },
  "ISF/Featured-pulse.fs": {
    "scale": 0.85,
    "detail": 0.85
  },
  "ISF/Featured-quantumchamber.fs": {
    "scale": 0.6,
    "detail": 0.85
  },
  "ISF/GA-GhostFX.fs": {
    "scale": 0.6,
    "detail": 0.7
  },
  "ISF/LiquidDepth.fs": {
    "scale": 0.6,
    "detail": 0.85
  },
  "ISF/NeuralVoronoiMatrix.fs": {
    "scale": 0.85,
    "detail": 0.85
  },
  "ISF/PlasmaCalligraphy.fs": {
    "scale": 0.95,
    "detail": 0.85
  },
  "ISF/SM-ErosionGrowth.fs": {
    "scale": 0.95,
    "detail": 0.85
  },
  "ISF/VX-AuroraWater.fs": {
    "scale": 0.9,
    "detail": 1
  },
  "ISF/VX-BaitBall.fs": {
    "scale": 0.7,
    "detail": 1
  },
  "ISF/VX-Louvers.fs": {
    "scale": 0.85,
    "detail": 1
  },
  "ISF/VX-Nebula.fs": {
    "scale": 0.65,
    "detail": 1
  },
  "ISF/VX-Northlight.fs": {
    "scale": 0.65,
    "detail": 1
  },
  "ISF/VX-Pillars.fs": {
    "scale": 0.65,
    "detail": 1
  },
  "ISF/VX-Riverlight.fs": {
    "scale": 0.8,
    "detail": 1
  },
  "ISF/VX-SoapFilm.fs": {
    "scale": 0.65,
    "detail": 1
  },
  "ISF/VX-SpiralGalaxy.fs": {
    "scale": 0.85,
    "detail": 1
  },
  "ISF/cube shaders/3D_09_CrystalCluster.fs": {
    "scale": 0.9,
    "detail": 0.85
  },
  "ISF/cube shaders/3D_12_PlasmaSphere.fs": {
    "scale": 0.9,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_02_SmokeLayers.fs": {
    "scale": 0.8,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_17_SporeCloud.fs": {
    "scale": 0.9,
    "detail": 0.85
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
