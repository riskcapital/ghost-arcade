// Generated from static code cost and measured GPU cost (native-mobile/shader-gpu-cost.json).
export const mobileHeavyShaderPaths = new Set<string>([
  "ISF/15_NeuralNetwork.fs",
  "ISF/39_TensorField.fs",
  "ISF/42_GyroscopicRings.fs",
  "ISF/51_SacredGeometryCathedral.fs",
  "ISF/52_ChaoticOrbitalMesh.fs",
  "ISF/56_ConnectedCubes.fs",
  "ISF/61_SingularityCollapse.fs",
  "ISF/67_ParticleSupernova.fs",
  "ISF/71_CosmicSpine.fs",
  "ISF/72_ShatteredReality.fs",
  "ISF/AR-Ferrofluid.fs",
  "ISF/AR-GeodesicBloom.fs",
  "ISF/AR-Lissajous.fs",
  "ISF/AR-MobiusStrip.fs",
  "ISF/AR-StrangeAttractor.fs",
  "ISF/AR-WaveformHelix.fs",
  "ISF/AbyssalHelix.fs",
  "ISF/AstralJellyfish.fs",
  "ISF/DM-NodeNetwork.fs",
  "ISF/DM-ParticleVortex.fs",
  "ISF/DM-Spirograph.fs",
  "ISF/DM-Starfield.fs",
  "ISF/DeepMetalBlobs.fs",
  "ISF/DimensionalRift.fs",
  "ISF/FireEmber.fs",
  "ISF/InfiniteGrid.fs",
  "ISF/LeWittPyramid.fs",
  "ISF/MirrorRealm.fs",
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
  "ISF/VoronoiTerrainFlyover.fs",
  "ISF/VoronoiWarpDrive.fs",
  "ISF/crystal-dimension.fs",
  "ISF/cube shaders/3D_01_SphereCluster.fs",
  "ISF/cube shaders/3D_02_ChromeSpheres.fs",
  "ISF/cube shaders/3D_03_WireframeGeo.fs",
  "ISF/cube shaders/3D_04_CubeField.fs",
  "ISF/cube shaders/3D_05_NeonCubes.fs",
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
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/16_AtomicOrbital.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/23_StarCluster.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/36_ConstellationMap.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/37_TorusKnot.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/44_Oscilloscope.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/48_PlasmaContainment.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/54_ShatteredLattice.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/62_HypercubeTesseract.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/70_LiquidMetal.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/78_PlasmaVortex.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/AR-DisplacementSphere.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/AR-FrequencyTerrain.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/AR-SmokeTendrils.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/AR-WaveletDecomp.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/AstralCrystal.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/DM-DNAHelix.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/DM-FireParticles.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/EmberCloud.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/Featured-aurora.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/Featured-chrysalis.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/Featured-murmur.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/Featured-prism.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/Featured-quantumchamber.fs": {
    "scale": 0.5,
    "detail": 0.7
  },
  "ISF/Featured-sentinels.fs": {
    "scale": 0.4,
    "detail": 0.7
  },
  "ISF/Featured-tide.fs": {
    "scale": 0.5,
    "detail": 0.7
  },
  "ISF/GA-GhostFX.fs": {
    "scale": 0.6,
    "detail": 0.7
  },
  "ISF/LiquidDepth.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/MetalParticles.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/ParticleSwarm.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/SM-AsymmetricLightning.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/SM-Fireflies.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/SM-MagneticFilings.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/SM-ParticleNodes.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/SM-SmokeChamber.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/SM-SpiderWeb.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/SacredGeometry.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/cube shaders/3D_12_PlasmaSphere.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_03_LavaLampDepth.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_04_FireflyGarden.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_08_ElectricTendrils.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_09_LiquidChrome.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_10_JellyfishFloat.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/cube shaders/ROOM_17_SporeCloud.fs": {
    "scale": 0.7,
    "detail": 0.85
  },
  "ISF/gpt.fs": {
    "scale": 0.7,
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
