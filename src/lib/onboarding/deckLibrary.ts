/**
 * Shader sets by style, shared by the starter templates and the Performer's
 * starter keyboard. Names are library files without `.fs`; anything missing
 * from a given build is skipped when the deck is filled.
 */
import type { SVClipAssignment } from '../types';

export const STYLE_SETS: Record<string, string[]> = {
  beams: [
    'STAGE-BeamRig', 'STAGE-GoboSpots', 'STAGE-Followspot', 'STAGE-Blinders', 'STAGE-Strobe', 'STAGE-MirrorBall',
    'LIVE-LaserLattice', 'DM-LaserBeams', 'LaserBeams', 'DM-Spotlight', 'DM-Strobe', 'StrobeFlash',
    'NeonPulse', 'DM-NeonLines', 'SM-RicochetLaser', 'LIVE-PrismStorm', 'DM-PrismLight', 'RadialBurst',
    'DM-RadialPulse', 'SM-ElectricFence', 'SM-AsymmetricLightning', 'ElectricStorm', 'DM-ElectricStorm', 'DM-EnergyField',
  ],
  washes: [
    'STAGE-ColourWash', 'STAGE-LiquidSky', 'STAGE-LightCurtain', 'cube shaders/ROOM_02_SmokeLayers', 'cube shaders/ROOM_15_FogCathedral',
    'SM-SmokeChamber', 'SM-AuroraCurtain', 'AuroraWaves', 'CloudFlow', 'DM-AuroraBorealis', 'DM-SmokeWisp', 'SM-Fireflies',
    'cube shaders/ROOM_07_AuroraCurtains', 'cube shaders/ROOM_04_FireflyGarden', 'DM-ColorBreath', 'DM-GradientWave', 'ColorCycle',
    'EmberCloud', 'cube shaders/ROOM_01_EmberDrift', 'FireEmber', 'DM-FireParticles', 'StarDrift', 'DM-Starfield', 'SM-BubbleRise',
  ],
  backdrops: [
    'GA2-Eclipse', 'GA2-Lightbox', 'GA2-ColouredShadows', 'GA2-Cathedral', 'GA2-DriftVeil', 'GA2-DeepDescent',
    'Featured-lumenveil', 'Featured-lumenstrata', 'Featured-aurora', 'Featured-tide', 'Featured-drift', 'LIVE-NebulaCathedral',
    'LIVE-AuroraSpectrum', 'LIVE-ObsidianFlow', 'StellarNursery', '18_SpiralGalaxy', 'cube shaders/ROOM_19_CosmicNebula',
    'cube shaders/3D_14_NebulaCloud', 'PrismaticVoid', 'AstralJellyfish', 'GA2-SoftCells', 'GA2-MinimalSurface', 'OceanWaves', 'TreeRings',
  ],
  flagship: [
    'Featured-tide', 'Featured-prism', 'Featured-pulse', 'Featured-aurora', 'Featured-lumenveil', 'Featured-crystallon',
    'Featured-dispersion', 'Featured-drift', 'Featured-lumenstrata', 'Featured-murmur', 'Featured-quantumchamber', 'Featured-sentinels',
    'Featured-tendril', 'Featured-chrysalis', 'Featured-chladniplate', 'LIVE-NebulaCathedral', 'LIVE-FractalBloom', 'LIVE-PulseHalo',
    'LIVE-TheWitness', 'Quotron', 'GA2-Quasicrystal', 'GA2-HopfFibration', 'GA2-Apollonian', 'GA2-CircleLimit',
    'GA2-PhasePortrait', 'GA2-Kakeya', 'GA2-Murmuration', 'GA2-CapSet', 'GA2-QuaternionJulia', 'GA2-SphericalHarmonics',
    'GA2-MovingSofa', 'GA2-MinimalSurface',
  ],
  audio: [
    'AR-FrequencyRings', 'AR-SpectralAurora', 'AR-Ferrofluid', 'AR-FrequencyTerrain', 'AR-DisplacementSphere', 'AR-WaveformHelix',
    'AR-SDFMorph', 'AR-SmokeTendrils', 'AR-GeodesicBloom', 'AR-HarmonicVoronoi', 'AR-StrangeAttractor', 'AR-SpectralFluid',
    'AR-Lissajous', 'AR-TopoMesh', 'AR-WaveletDecomp', 'AR-ReactionDiffusion', 'AR-MobiusStrip', 'DM-SpectrumWaves',
    'DM-WaveformBars', 'WaveformScope', 'DM-Oscilloscope', 'SM-WaveformWalls', 'SM-SeismicPulse', 'SM-ConcentricEcho',
  ],
  rooms: [
    'cube shaders/ROOM_06_NeonGrid', 'cube shaders/ROOM_08_ElectricTendrils', 'cube shaders/ROOM_09_LiquidChrome', 'cube shaders/ROOM_11_StormCell',
    'cube shaders/ROOM_13_PortalVortex', 'cube shaders/ROOM_14_PlasmaWalls', 'cube shaders/ROOM_16_CascadePour', 'cube shaders/ROOM_17_SporeCloud',
    'cube shaders/ROOM_18_GlitchDepth', 'cube shaders/ROOM_20_MoltenCore', 'cube shaders/3D_01_SphereCluster', 'cube shaders/3D_02_ChromeSpheres',
    'cube shaders/3D_03_WireframeGeo', 'cube shaders/3D_04_CubeField', 'cube shaders/3D_05_NeonCubes', 'cube shaders/3D_06_MetaballBlob',
    'cube shaders/3D_08_OrganicSculpt', 'cube shaders/3D_10_ShatteredCube', 'cube shaders/3D_11_InfiniteHall', 'cube shaders/3D_12_PlasmaSphere',
    'cube shaders/3D_13_TorusKnot', 'cube shaders/3D_15_MorphCube', 'cube shaders/3D_16_VoxelTerrain', 'cube shaders/3D_18_LatticeWorld',
  ],
  geometric: [
    'DM-GlitchBlocks', 'GlitchBlocks', '95_PixelSort', '98_LEDMatrix', 'DataStream', 'DataPulse',
    'CircuitBoard', '90_CircuitTrace', 'HexGrid', 'DM-HexGrid', 'MoirePattern', '40_HolographicMoire',
    'NestedCubes', 'SolLeWittCubes', 'GeometricWall', 'ModularGrid', 'LeWittPyramid', 'TriangleMesh',
    '94_NeonOutline', 'RetroSun', 'DM-RetroSun', 'DM-CircuitBoard', '97_TopoContour', 'DM-NodeNetwork',
  ],
  liquid: [
    'PSY-OilWheel', 'PSY-OilSlick', 'PSY-AcidFlow', 'PSY-TieDye', 'SM-LavaLampBlobs', 'MeltingBlobs',
    'MorphingLava', 'FluidMorph', 'ChromeFlow', 'LiquidMetal', 'MercuryPool', 'cube shaders/ROOM_03_LavaLampDepth',
    'BlobbyMetal', 'DeepMetalBlobs', 'LiquidDepth', 'OrganicMetal', 'TitaniumRipple', 'CopperPatina',
    'DM-LiquidMetal', 'DM-PlasmaFlow', '25_PlasmaTendrils', '78_PlasmaVortex', 'PlasmaCalligraphy', 'DM-VoronoiFlow',
  ],
  mandala: [
    'PSY-Chrysanthemum', 'PSY-FormConstants', 'DM-Kaleidoscope', 'SacredGeometry', 'DM-SacredGeometry', '04_SacredGeometryGlow',
    '51_SacredGeometryCathedral', '91_StainedGlass', 'DM-Spirograph', 'ConcentricRings', 'SpiralVortex', '22_FractalAtomicFlower',
    'MirrorRealm', 'InfiniteOrigami', 'FractalZoom', 'DM-FractalZoom', '47_FractalDimension', 'DM-MandelbrotPulse',
    'TrippyMandala', 'OssiferousRadiolaria', 'AstralCrystal', '16_AtomicOrbital', '37_TorusKnot', 'DM-GeometricPulse',
  ],
  cosmic: [
    'StarDrift', 'StellarNursery', '18_SpiralGalaxy', '43_CosmicWeb', '36_ConstellationMap', '23_StarCluster',
    'cube shaders/ROOM_19_CosmicNebula', 'cube shaders/3D_14_NebulaCloud', 'DM-Starfield', 'AstralJellyfish', 'PrismaticVoid', 'DimensionalRift',
    'AbyssalHelix', 'CosmicVoronoiTunnel', 'VoronoiWarpDrive', '61_SingularityCollapse', '67_ParticleSupernova', 'ThreeBody',
    '31_QuantumField', 'QuantumLattice', 'NeuralVoronoiMatrix', 'MyceliumNetwork', 'DM-ParticleVortex', 'DM-AuroraBorealis',
  ],
};

export function shaderUrl(name: string): string {
  return `./ISF/${`${name}.fs`.split('/').map(encodeURIComponent).join('/')}`;
}

export function shaderDisplayName(name: string): string {
  const base = name.split('/').pop()!.replace(/^(STAGE|GA2|PSY|DM|SM|AR|LIVE|Featured)-/, '').replace(/^\d+_/, '').replace(/^(ROOM|3D)_\d+_/, '');
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

let thumbnailMap: Promise<Record<string, string>> | null = null;
/** Pre-made thumbnails by shader base name (only those that exist). */
export function thumbnailFor(name: string): Promise<string | undefined> {
  thumbnailMap ??= fetch('./ISF/thumbnails/manifest.json')
    .then((r) => (r.ok ? r.json() : { thumbnails: {} }))
    .then((json) => json.thumbnails ?? {})
    .catch(() => ({}));
  return thumbnailMap.then((map) => {
    const file = map[name.split('/').pop()!];
    return file ? `./ISF/thumbnails/${encodeURIComponent(file)}` : undefined;
  });
}

const codeCache = new Map<string, Promise<string | null>>();
export function loadShaderCode(name: string): Promise<string | null> {
  if (!codeCache.has(name)) {
    codeCache.set(name, fetch(shaderUrl(name)).then((r) => (r.ok ? r.text() : null)).catch(() => null));
  }
  return codeCache.get(name)!;
}

/** The Performer's starter keyboard: a style per row of keys.
 *  1-0 flagship visuals, Q-P audio reactive, A-L stage light, Z-M liquid. */
export const PERFORMER_STARTER_ROWS: string[][] = [
  STYLE_SETS.flagship.slice(0, 10),
  STYLE_SETS.audio.slice(0, 10),
  STYLE_SETS.beams.slice(0, 6).concat(STYLE_SETS.washes.slice(0, 3)),
  STYLE_SETS.liquid.slice(0, 7),
];

/** Build the starter keyboard as Performer clip assignments. */
export async function buildPerformerStarterAssignments(): Promise<Record<number, SVClipAssignment>> {
  const assignments: Record<number, SVClipAssignment> = {};
  let position = 0;
  for (const row of PERFORMER_STARTER_ROWS) {
    const entries = await Promise.all(row.map(async (name) => ({
      name,
      code: await loadShaderCode(name),
      thumbnail: await thumbnailFor(name),
    })));
    for (const entry of entries) {
      if (entry.code) {
        assignments[position] = {
          type: 'shader',
          shaderId: `isf:${entry.name}.fs`,
          shaderName: shaderDisplayName(entry.name),
          shaderSrc: shaderUrl(entry.name),
          shaderThumbnail: entry.thumbnail,
          shaderCode: entry.code,
        };
      }
      position++;
    }
  }
  return assignments;
}
