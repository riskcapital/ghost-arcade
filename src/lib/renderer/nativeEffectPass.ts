export type NativeEffectPassId =
  | 'invert'
  | 'grayscale'
  | 'brightness'
  | 'contrast'
  | 'gamma'
  | 'saturation'
  | 'hue'
  | 'posterize'
  | 'noise'
  | 'pixelate'
  | 'vignette'
  | 'rgb-shift'
  | 'scanlines'
  | 'fm-scanlines'
  | 'vhs'
  | 'blur'
  | 'chromatic-aberration'
  | 'glitch'
  | 'exposure'
  | 'vibrance'
  | 'temperature-tint'
  | 'sharpen'
  | 'directional-blur'
  | 'zoom-blur'
  | 'radial-blur'
  | 'kaleidoscope'
  | 'mirror'
  | 'chroma-key'
  | 'luma-key'
  | 'difference-key'
  | 'erode'
  | 'dilate'
  | 'wave'
  | 'fisheye'
  | 'lens-distortion'
  | 'twirl'
  | 'pinch-bulge'
  | 'edge-detect'
  | 'film-grain'
  | 'filmic-tonemap'
  | 'bloom'
  | 'colorama'
  | 'edge-feather'
  | 'dither'
  | 'outline'
  | 'emboss'
  | 'crt'
  | 'thermal'
  | 'night-vision'
  | 'blob-track'
  | 'blob-contour'
  | 'blob-heatmap'
  | 'tilt-shift'
  | 'halation'
  | 'anamorphic-streak'
  | 'heat-haze'
  | 'curves'
  | 'selective-color'
  | 'false-color'
  | 'shadow-recovery'
  | 'highlight-rolloff'
  | 'color-balance'
  | 'lift-gamma-gain'
  | 'strobe-flash'
  | 'plasma'
  | 'halftone'
  | 'toon'
  | 'kuwahara'
  | 'defocus-bokeh'
  | 'god-rays'
  | 'displacement'
  | 'polar-transform'
  | 'oil-paint'
  | 'watercolor'
  | 'comic-ink'
  | 'crosshatch'
  | 'linocut'
  | 'dot-matrix'
  | 'ascii'
  | 'matrix-rain'
  | 'binary-code'
  | 'block-mosaic'
  | 'number-grid'
  | 'braille-pattern'
  | 'circuit-board'
  | 'stained-glass'
  | 'woven-fabric'
  | 'mosaic-tile'
  | 'neon-outline'
  | 'topo-map'
  | 'led-wall'
  | 'hex-grid'
  | 'geometric-tile'
  | 'spiral-tile'
  | 'voronoi-shatter'
  | 'thermal-contour'
  | 'phase-lab'
  | 'lens-dirt'
  | 'diffusion-promist'
  | 'compression-artifacts'
  | 'datamosh-lite'
  | 'scanline-drift'
  | 'tape-dropout'
  | 'ripple-caustics'
  | 'shockwave'
  | 'droste-recursive'
  | 'slit-scan'
  | 'fractal-warp'
  | 'fluid-distort'
  | 'wormhole'
  | 'vhs-full-deck'
  | 'topo-warp'
  | 'strobe-sequencer'
  | 'mirror-shards'
  | 'rorschach-mirror'
  | 'glitch-quilt'
  | 'poster-tear'
  | 'paint-peel'
  | 'liquid-glass'
  | 'crystal-refract'
  | 'infinite-mirror'
  | 'tunnel-flight'
  | 'volumetric-fog-overlay'
  | 'rain-fog-snow-overlay'
  | 'particle-overlay-fx'
  | 'glint-starburst'
  | 'emboss-relight'
  | 'pixel-sort'
  | 'neon-tube-trace'
  | 'hologram-scan'
  | 'laser-slice'
  | 'aura-field'
  | 'smoke-disintegrate'
  | 'shimmer-cloth'
  | 'cellular-automata-burn'
  | 'spectral-prism-tunnel'
  | 'led-volume'
  | 'audio-shock-bloom'
  | 'analog-feedback-rack'
  | 'club-laser-grid'
  | 'ghost-exposure'
  | 'dream-diffusion'
  | 'ghost-double'
  | 'depth-parallax'
  | 'pixel-sand'
  | 'point-cloud-dissolve'
  | 'explode3-d'
  | 'terrain3-d'
  | 'wrapped-terrain'
  | 'string-orb'
  | 'sphere-wireframe'
  | 'voxel-cube-cluster'
  | 'mobius-lattice'
  | 'crystal-shard-field'
  | 'tube-lattice'
  | 'disco-mirror-ball'
  | 'lissajous-knot'
  | 'helix-particle-stream'
  | 'donut-constellation'
  | 'sphere-project'
  | 'cube-project'
  | 'cylinder-wrap'
  | 'torus-tunnel'
  | 'diamond-gem'
  | 'shatter3-d'
  | 'mobius-strip'
  | 'voxel-displace'
  | 'wave-surface'
  | 'prism-split'
  | 'origami-fold'
  | 'mirror-room'
  | 'geometric-tile-pro'
  | 'shingle-stack'
  | 'time-smear'
  | 'chronophoto'
  | 'optical-flow-datamosh'
  | 'flow-field-trails'
  | 'reaction-diffusion'
  | 'feedback-zoom'
  | 'motion-trails'
  | 'echo-repeat'
  | 'light-paint'
  | 'recursive-echo';

export interface NativeEffectPassManifestEntry {
  id: NativeEffectPassId;
  code: number;
  defaultAmount: number;
  amountMin: number;
  amountMax: number;
}

export interface NativeEffectPassOptions {
  sourceId: string;
  targetSourceId: string;
  effect: NativeEffectPassId;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  amount?: number;
  mix?: number;
  params?: Partial<{
    scale: number;
    seed: number;
    amount: number;
    amount2: number;
    mix: number;
    width: number;
    freq: number;
    fmDepth: number;
    amp: number;
    colorMix: number;
    tracking: number;
    noise: number;
    distortion: number;
    colorBleed: number;
    scanlines: number;
    headSwitch: number;
    tapeWobble: number;
    dropout: number;
    chromaDelay: number;
    trackingJump: number;
    saturation: number;
    param0: number;
    param1: number;
    param2: number;
    param3: number;
    mode: number;
    gridLines: number;
    animSpeed: number;
    animAmount: number;
    param4: number;
    param5: number;
    param6: number;
    param7: number;
    param8: number;
    param9: number;
    param10: number;
    param11: number;
    softness: number;
    roundness: number;
    shape: number;
    aspect: number;
    centerX: number;
    centerY: number;
    focusX: number;
    focusY: number;
    focusBand: number;
    maxBlur: number;
    tintAmount: number;
    breathing: number;
    angle: number;
    rotation: number;
    count: number;
    intensity: number;
    speed: number;
    radius: number;
    edgeProtect: number;
    edgeFalloff: number;
    rollingBar: number;
    phosphor: number;
    curvature: number;
    interlace: number;
    rgbSplit: number;
    jitter: number;
    blockSize: number;
    triggerMode: number;
    blockHold: number;
    verticalSlice: number;
    tearChance: number;
    exposure: number;
    rollOff: number;
    highlightProtect: number;
    vibrance: number;
    skinProtect: number;
    ceiling: number;
    temperature: number;
    tint: number;
    shadowTemp: number;
    highlightTemp: number;
    splitTone: number;
    autoCycle: number;
    prismSpread: number;
    outputMix: number;
    samples: number;
    falloff: number;
    centerBias: number;
    chromatic: number;
    radiusInner: number;
    radiusOuter: number;
    segments: number;
    zoom: number;
    spiral: number;
    position: number;
    offset: number;
    flipSide: number;
    keyR: number;
    keyG: number;
    keyB: number;
    tolerance: number;
    lowCut: number;
    highCut: number;
    gamma: number;
    invert: number;
    matte: number;
    premultiply: number;
    refR: number;
    refG: number;
    refB: number;
    spill: number;
    channel: number;
    frequency: number;
    waveform: number;
    phase: number;
    secondary: number;
    chromaSplit: number;
    strength: number;
    contrast: number;
    edgeFade: number;
    cubic: number;
    anamorphicX: number;
    palette: number;
    height: number;
    glow: number;
    vignette: number;
    bloom: number;
    scopeMask: number;
    threshold: number;
    thickness: number;
    edgeTintR: number;
    edgeTintG: number;
    edgeTintB: number;
    tintEdges: number;
    edgeGlow: number;
    edgeOnlyAlpha: number;
    bloomIntensity: number;
    bloomKnee: number;
    bloomRadius: number;
    bloomAnamorphic: number;
    red: number;
    green: number;
    blue: number;
    grainSize: number;
    grainShadow: number;
    grainMid: number;
    grainHigh: number;
    grainMono: number;
    grainStock: number;
    grainColorJitter: number;
    grainAnimSpeed: number;
    tonemapCurve: number;
    tonemapExposure: number;
    tonemapContrast: number;
    tonemapMix: number;
    coloramaPalette: number;
    coloramaOffset: number;
    coloramaSpeed: number;
    coloramaContrast: number;
    coloramaMix: number;
    coloramaBands: number;
    coloramaAudioReact: number;
    coloramaHueShift: number;
    audio: number;
    featherTop: number;
    featherBottom: number;
    featherLeft: number;
    featherRight: number;
    featherSoftness: number;
    featherGamma: number;
    featherMattePreview: number;
    ditherType: number;
    ditherIntensity: number;
    ditherScale: number;
    ditherColorDepth: number;
    ditherPalette: number;
    ditherPixelLock: number;
    outlineThickness: number;
    outlineR: number;
    outlineG: number;
    outlineB: number;
    outlineOnly: number;
    outlineGlow: number;
    outlinePosition: number;
    outlineCrawl: number;
    outlineAlphaAware: number;
    embossStrength: number;
    embossAngle: number;
    embossHeight: number;
    embossHighlightR: number;
    embossHighlightG: number;
    embossHighlightB: number;
    embossShadowR: number;
    embossShadowG: number;
    embossShadowB: number;
    crtScanlines: number;
    crtScanCount: number;
    crtMask: number;
    crtMaskType: number;
    crtCurvature: number;
    crtVignette: number;
    crtGlow: number;
    crtRollingBar: number;
    crtChromatic: number;
    thermalIntensity: number;
    thermalPalette: number;
    thermalShimmer: number;
    thermalSensorNoise: number;
    nightVisionIntensity: number;
    nightVisionNoise: number;
    nightVisionVignette: number;
    nightVisionPhosphor: number;
    nightVisionBloom: number;
    nightVisionScopeMask: number;
    nightVisionRollingNoise: number;
    blobThreshold: number;
    blobShape: number;
    blobColor: number;
    blobThickness: number;
    blobMinSize: number;
    blobMaxBlobs: number;
    blobShowCoords: number;
    blobShowBBox: number;
    blobShowCenter: number;
    blobTrailLength: number;
    trailLength: number;
    blobGridSize: number;
    blobMix: number;
    blobFlags: number;
    tiltShiftMode: number;
    tiltShiftFocusY: number;
    tiltShiftFocusX: number;
    tiltShiftFocusBand: number;
    tiltShiftFalloff: number;
    tiltShiftMaxBlur: number;
    tiltShiftAngle: number;
    tiltShiftSaturation: number;
    halationAmount: number;
    halationRadius: number;
    halationThreshold: number;
    halationTintR: number;
    halationTintG: number;
    halationTintB: number;
    halationMode: number;
    halationMix: number;
    anaIntensity: number;
    anaLength: number;
    anaThreshold: number;
    anaTintR: number;
    anaTintG: number;
    anaTintB: number;
    anaAngle: number;
    anaSamples: number;
    anaMix: number;
    hazeAmount: number;
    hazeScale: number;
    hazeSpeed: number;
    length: number;
    directionY: number;
    turbulence: number;
    hazeDirectionY: number;
    hazeTurbulence: number;
    hazeMode: number;
    hazeFocusY: number;
    hazeFocusBand: number;
    curvesContrast: number;
    curvesToe: number;
    curvesShoulder: number;
    curvesBlackCrush: number;
    curvesMix: number;
    selColorTargetHue: number;
    selColorRange: number;
    selColorFeather: number;
    selColorMode: number;
    selColorReplaceHue: number;
    selColorSatBoost: number;
    falseColorMode: number;
    falseColorMix: number;
    falseColorShowOriginal: number;
    falseColorMidpoint: number;
    falseColorRange: number;
    shadowAmount: number;
    shadowThreshold: number;
    shadowSoftness: number;
    shadowColorRecovery: number;
    shadowHighlightProtect: number;
    shadowMix: number;
    highRolloffAmount: number;
    highRolloffThreshold: number;
    highRolloffSoftness: number;
    highRolloffPreserveHue: number;
    highRolloffMaxValue: number;
    highRolloffMix: number;
    cbShadowR: number;
    cbShadowG: number;
    cbShadowB: number;
    cbMidR: number;
    cbMidG: number;
    cbMidB: number;
    cbHighR: number;
    cbHighG: number;
    cbHighB: number;
    cbPreserveLuma: number;
    cbMix: number;
    lggLiftR: number;
    lggLiftG: number;
    lggLiftB: number;
    lggGammaR: number;
    lggGammaG: number;
    lggGammaB: number;
    lggGainR: number;
    lggGainG: number;
    lggGainB: number;
    lggLumaOnly: number;
    lggMix: number;
    strobeRate: number;
    strobeDuty: number;
    strobeIntensity: number;
    strobeMode: number;
    strobeTintR: number;
    strobeTintG: number;
    strobeTintB: number;
    plasmaMix: number;
    plasmaScale: number;
    plasmaSpeed: number;
    plasmaPalette: number;
    plasmaSourceMix: number;
    sourceMix: number;
    halftoneMix: number;
    halftoneScale: number;
    halftoneAngle: number;
    halftoneDotGain: number;
    halftoneColorMode: number;
    cellSize: number;
    dotGain: number;
    colorMode: number;
    brightWeight: number;
    chromaFringe: number;
    tintR: number;
    tintG: number;
    tintB: number;
    toonMix: number;
    toonLevels: number;
    toonEdgeStrength: number;
    toonSaturation: number;
    toonEdgeThreshold: number;
    levels: number;
    edgeStrength: number;
    kuwaharaMix: number;
    kuwaharaRadius: number;
    kuwaharaEdgeSharpness: number;
    kuwaharaColorPunch: number;
    bokehRadius: number;
    bokehSamples: number;
    bokehBrightWeight: number;
    bokehThreshold: number;
    bokehChromaFringe: number;
    bokehShape: number;
    bokehRotation: number;
    bokehMix: number;
    godRaysIntensity: number;
    godRaysDecay: number;
    godRaysExposure: number;
    godRaysDensity: number;
    godRaysThreshold: number;
    godRaysCenterX: number;
    godRaysCenterY: number;
    godRaysSamples: number;
    godRaysTintR: number;
    godRaysTintG: number;
    godRaysTintB: number;
    godRaysMix: number;
    dispAmount: number;
    dispScale: number;
    dispSpeed: number;
    dispMode: number;
    dispTurbulence: number;
    dispChromatic: number;
    polarMode: number;
    polarRotation: number;
    polarZoom: number;
    polarCenterX: number;
    polarCenterY: number;
    polarMix: number;
    phaseLabMode: number;
    phaseLabIntensity: number;
    phaseLabScale: number;
    phaseLabSpeed: number;
    phaseLabPhase: number;
    phaseLabMix: number;
    phaseLabColorGain: number;
    phaseLabSourceBleed: number;
    phaseLabEdgeBoost: number;
    phaseLabDistortion: number;
    phaseLabLineDensity: number;
    phaseLabPolarizerAngle: number;
    phaseLabSpectralShift: number;
    phaseLabFocus: number;
    dirtAmount: number;
    dirtScale: number;
    dirtThreshold: number;
    dirtTintWarmth: number;
    dirtScratches: number;
    dirtSpots: number;
    dirtMode: number;
    dirtAnimSpeed: number;
    diffAmount: number;
    diffRadius: number;
    diffThreshold: number;
    diffShadowLift: number;
    diffHighlightBloom: number;
    diffHaze: number;
    diffHazeWarmth: number;
    diffMix: number;
    compArtBlockSize: number;
    compArtQuality: number;
    compArtChromaSubsample: number;
    compArtBlockNoise: number;
    compArtMode: number;
    compArtMix: number;
    amount3: number;
    scanDriftIntensity: number;
    scanDriftFrequency: number;
    scanDriftSpeed: number;
    scanDriftWaveform: number;
    scanDriftChromaSplit: number;
    scanDriftChunkiness: number;
    tapeDropoutDensity: number;
    tapeDropoutLength: number;
    tapeDropoutColor: number;
    tapeDropoutSpeed: number;
    tapeDropoutNoise: number;
    tapeDropoutMix: number;
    causticsIntensity: number;
    causticsScale: number;
    causticsSpeed: number;
    causticsRefraction: number;
    causticsTintR: number;
    causticsTintG: number;
    causticsTintB: number;
    causticsMode: number;
    shockTriggerTime: number;
    shockSpeed: number;
    shockAmplitude: number;
    shockRingWidth: number;
    shockCenterX: number;
    shockCenterY: number;
    shockChromatic: number;
    shockMode: number;
    drosteZoom: number;
    drosteRotation: number;
    drosteIterations: number;
    drosteOffsetX: number;
    drosteOffsetY: number;
    drosteFrameSize: number;
    drosteMix: number;
    slitScanIntensity: number;
    slitScanMode: number;
    slitScanPattern: number;
    slitScanSpeed: number;
    slitScanChromaSplit: number;
    fractalWarpAmount: number;
    fractalWarpScale: number;
    fractalWarpOctaves: number;
    fractalWarpSpeed: number;
    fractalWarpChromatic: number;
    fractalWarpMode: number;
    fluidDistAmount: number;
    fluidDistScale: number;
    fluidDistSpeed: number;
    fluidDistTurbulence: number;
    fluidDistMode: number;
    wormholePullStrength: number;
    wormholeRotation: number;
    wormholeCenterX: number;
    wormholeCenterY: number;
    wormholeTwist: number;
    wormholeChromatic: number;
    wormholeAnimSpeed: number;
    vhsFdTracking: number;
    vhsFdHeadSwitch: number;
    vhsFdChromaBleed: number;
    vhsFdDropouts: number;
    vhsFdTapeNoise: number;
    vhsFdScanlines: number;
    vhsFdColorBleed: number;
    vhsFdSaturation: number;
    vhsFdTrackingJump: number;
    vhsFdMode: number;
    twContourCount: number;
    twContourWidth: number;
    twDisplacement: number;
    twChromaticEdge: number;
    twColorR: number;
    twColorG: number;
    twColorB: number;
    twShadowRidges: number;
    twMix: number;
    ssBPM: number;
    ssSteps: number;
    ssPattern: number;
    ssMode: number;
    ssIntensity: number;
    ssTintR: number;
    ssTintG: number;
    ssTintB: number;
    ssSwing: number;
    msShards: number;
    msShardSize: number;
    msRotation: number;
    msDelayAmount: number;
    msChromatic: number;
    msMode: number;
    rmMode: number;
    rmInkAmount: number;
    rmFluidEdges: number;
    rmTintR: number;
    rmTintG: number;
    rmTintB: number;
    rmBgR: number;
    rmBgG: number;
    rmBgB: number;
    rmMixOriginal: number;
    gqTileSize: number;
    gqShuffleAmount: number;
    gqRotateAmount: number;
    gqDelayAmount: number;
    gqChromaSplit: number;
    gqTriggerRate: number;
    gqMode: number;
    ptTearAmount: number;
    ptTearAngle: number;
    ptTearJitter: number;
    ptShiftBelow: number;
    ptOffsetX: number;
    ptOffsetY: number;
    ptTearGlow: number;
    ptMode: number;
    ppAmount: number;
    ppScale: number;
    ppLumaBias: number;
    ppCurl: number;
    ppShadow: number;
    ppBgR: number;
    ppBgG: number;
    ppBgB: number;
    ppMode: number;
    lgBlobs: number;
    lgBlobSize: number;
    lgRefraction: number;
    lgChromatic: number;
    lgSpecular: number;
    lgCausticAmount: number;
    lgSpeed: number;
    lgTintR: number;
    lgTintG: number;
    lgTintB: number;
    crystalScale: number;
    crystalRefraction: number;
    crystalSparkle: number;
    crystalEdgeGlow: number;
    crystalTintR: number;
    crystalTintG: number;
    crystalTintB: number;
    crystalMode: number;
    infMirrorIterations: number;
    infMirrorShrink: number;
    infMirrorRotation: number;
    infMirrorTintFade: number;
    infMirrorHueShift: number;
    infMirrorMode: number;
    infMirrorOffsetX: number;
    infMirrorOffsetY: number;
    tunnelSpeed: number;
    tunnelTwist: number;
    tunnelDepth: number;
    tunnelCenterX: number;
    tunnelCenterY: number;
    tunnelMode: number;
    tunnelChromatic: number;
    fogDensity: number;
    fogScale: number;
    fogSpeed: number;
    fogHeightFalloff: number;
    fogDepthSim: number;
    fogColorR: number;
    fogColorG: number;
    fogColorB: number;
    fogTurbulence: number;
    fogMode: number;
    weatherType: number;
    weatherDensity: number;
    weatherSpeed: number;
    weatherAngle: number;
    weatherSize: number;
    weatherFog: number;
    weatherColorR: number;
    weatherColorG: number;
    weatherColorB: number;
    partMode: number;
    partDensity: number;
    partSize: number;
    partSpeed: number;
    partTwinkle: number;
    partColorR: number;
    partColorG: number;
    partColorB: number;
    partBlend: number;
    glintIntensity: number;
    glintThreshold: number;
    glintLength: number;
    glintPoints: number;
    glintRotation: number;
    glintColorR: number;
    glintColorG: number;
    glintColorB: number;
    embRelStrength: number;
    embRelAngle: number;
    embRelHeight: number;
    embRelDetail: number;
    embRelSpecular: number;
    embRelColorPreserve: number;
    embRelAmbient: number;
    ntEdgeThreshold: number;
    ntTubeWidth: number;
    ntGlow: number;
    ntGlowRadius: number;
    ntTintR: number;
    ntTintG: number;
    ntTintB: number;
    ntChase: number;
    ntChaseSpeed: number;
    ntFlicker: number;
    ntBg: number;
    hsIntensity: number;
    hsScanFreq: number;
    hsScanSpeed: number;
    hsGridSpacing: number;
    hsRGBFlicker: number;
    hsBrokenBands: number;
    hsTintR: number;
    hsTintG: number;
    hsTintB: number;
    hsOpacityFlicker: number;
    hsEdgeGlow: number;
    lsMode: number;
    lsSpeed: number;
    lsBeamWidth: number;
    lsGlow: number;
    lsSparks: number;
    lsEraseAmount: number;
    lsTintR: number;
    lsTintG: number;
    lsTintB: number;
    lsReveal: number;
    lsPersistence: number;
    afIntensity: number;
    afRadius: number;
    afEdgeAmount: number;
    afLumaAmount: number;
    afAudioReact: number;
    afHueShift: number;
    afTintR: number;
    afTintG: number;
    afTintB: number;
    afMode: number;
    smokeAmount: number;
    smokeScale: number;
    smokeSpeed: number;
    smokeDirection: number;
    smokeEdgeFade: number;
    smokeColorR: number;
    smokeColorG: number;
    smokeColorB: number;
    smokeMode: number;
    clothAmplitude: number;
    clothFrequency: number;
    clothSpeed: number;
    clothThreadDensity: number;
    clothThreadDepth: number;
    clothShimmer: number;
    clothMode: number;
    hatchDensity: number;
    hatchAngle: number;
    hatchLineWidth: number;
    hatchContrast: number;
    hatchPaperR: number;
    hatchPaperG: number;
    hatchPaperB: number;
    hatchInkR: number;
    hatchInkG: number;
    hatchInkB: number;
    asciiCellSize: number;
    asciiContrast: number;
    asciiColorMix: number;
    asciiInvert: number;
    asciiMode: number;
    asciiTintR: number;
    asciiTintG: number;
    asciiTintB: number;
    caCellSize: number;
    caSurvivalLow: number;
    caSurvivalHigh: number;
    dcHorizonFade: number;
    lkHorizonFade: number;
    swHorizonFade: number;
    swTileScale: number;
    soHorizonFade: number;
    soTileScale: number;
    soGlowR: number;
    soGlowG: number;
    soGlowB: number;
    wtTileScale: number;
    wtSourceMix: number;
    psPersistence: number;
    recEchoMode: number;
    feedbackZoom: number;
    feedbackRotation: number;
    feedbackDecay: number;
    feedbackHueShift: number;
    feedbackMaskCenter: number;
    rdDiffusionA: number;
    rdDiffusionB: number;
    rdReseed: number;
    phaseLabMirrorRadius: number;
    phaseLabConeLift: number;
    phaseLabAudioReactive: number;
    phaseLabAudioDrive: number;
    audioLevel: number;
    vignetteColorR: number;
    vignetteColorG: number;
    vignetteColorB: number;
    vignetteBreathSpeed: number;
    halftoneMode: number;
    halftoneDotShape: number;
    halftoneDotSize: number;
    halftoneAngleC: number;
    halftoneAngleM: number;
    halftoneAngleY: number;
    halftoneAngleK: number;
    halftoneDrift: number;
    toonSteps: number;
    toonOutline: number;
    toonColorPop: number;
    toonRampSoftness: number;
    toonShadowBand: number;
    plasmaComplexity: number;
    plasmaMode: number;
    plasmaBlendMode: number;
    plasmaWarpAmount: number;
    plasmaAudioReact: number;
    embossNormalMode: number;
    embossMetallicness: number;
    outlineGlowFalloff: number;
    freezeBurst: number;
    glitchFreezeBurst: number;
    gammaShadows: number;
    gammaMids: number;
    gammaHighlights: number;
    gammaMix: number;
    invertMode: number;
    invertThreshold: number;
    invertStrobeRate: number;
    invertAmount: number;
    posterizeDither: number;
    posterizeAnimSpeed: number;
    posterizePalette: number;
    blobColorMode: number;
    blobFixedColorR: number;
    blobFixedColorG: number;
    blobFixedColorB: number;
    blobMarkerSize: number;
    blobBlendMode: number;
    binDensity: number;
    binSpeed: number;
    binCellSize: number;
    binContrast: number;
    binBgMix: number;
    binColorR: number;
    binColorG: number;
    binColorB: number;
    matrixDensity: number;
    matrixSpeed: number;
    matrixCellSize: number;
    matrixTrailLength: number;
    matrixBgMix: number;
    matrixColorR: number;
    matrixColorG: number;
    matrixColorB: number;
    dmDotShape: number;
    dmDotSize: number;
    dmGap: number;
    dmPosterize: number;
    dmGlow: number;
    dmBgR: number;
    dmBgG: number;
    dmBgB: number;
    mosaicMode: number;
    mosaicTileSize: number;
    mosaicGrout: number;
    mosaicColorJitter: number;
    mosaicGroutR: number;
    mosaicGroutG: number;
    mosaicGroutB: number;
    geomMode: number;
    geomTiles: number;
    geomRotation: number;
    geomOffsetX: number;
    geomMix: number;
    comicInkStrength: number;
    comicInkThreshold: number;
    comicInkPosterize: number;
    comicInkHalftone: number;
    comicInkHalftoneSize: number;
    comicInkColorMix: number;
    comicInkR: number;
    comicInkG: number;
    comicInkB: number;
    watercolorBleed: number;
    watercolorEdgeDarken: number;
    watercolorWetness: number;
    watercolorGranulation: number;
    watercolorPaperTexture: number;
    watercolorPaperScale: number;
    watercolorPaperHue: number;
    oilPaintMode: number;
    oilPaintRadius: number;
    oilPaintIntensity: number;
    oilPaintBrushLength: number;
    oilPaintBristle: number;
    oilPaintColorPunch: number;
    oilPaintHighlight: number;
    noiseType: number;
    noiseMode: number;
    noiseAmount: number;
    noiseScale: number;
    noiseMono: number;
    noiseShadow: number;
    noiseMid: number;
    noiseHigh: number;
    noiseAnimSpeed: number;
    tcPalette: number;
    tcContourCount: number;
    tcContourWidth: number;
    tcContourGlow: number;
    tcTrackBlobs: number;
    tcIntensity: number;
    tcMix: number;
    param12: number;
    param13: number;
    param14: number;
    param15: number;
    caBirthThreshold: number;
    caColorR: number;
    caColorG: number;
    caColorB: number;
    caMode: number;
    caMix: number;
    sptTunnelDepth: number;
    sptPrismSpread: number;
    sptRotation: number;
    sptSpeed: number;
    sptSlices: number;
    sptFade: number;
    ledVoxelSize: number;
    ledDepthPulse: number;
    ledDepthSpeed: number;
    ledPosterize: number;
    ledGlow: number;
    ledPerspective: number;
    ledMode: number;
    ledBgR: number;
    ledBgG: number;
    ledBgB: number;
    asbIntensity: number;
    asbBloomThreshold: number;
    asbBloomRadius: number;
    asbShockSpeed: number;
    asbShockAmplitude: number;
    asbChromaSplit: number;
    asbStrobeAmount: number;
    asbTintR: number;
    asbTintG: number;
    asbTintB: number;
    asbAudioGate: number;
    afrMix: number;
    afrZoom: number;
    afrRotation: number;
    afrDecay: number;
    afrHueShift: number;
    afrMaskCenter: number;
    afrChromaSplit: number;
    afrOffsetX: number;
    afrOffsetY: number;
    afrMode: number;
    clgIntensity: number;
    clgGridDensity: number;
    clgPerspective: number;
    clgSpeed: number;
    clgIntersectionGlow: number;
    clgLineWidth: number;
    clgTintR: number;
    clgTintG: number;
    clgTintB: number;
    clgAudioReact: number;
    clgMode: number;
    geExposure: number;
    geDecay: number;
    geHueShiftPerFrame: number;
    geIntensity: number;
    geMode: number;
    geClamp: number;
    ddBloomAmount: number;
    ddBloomRadius: number;
    ddHalation: number;
    ddChromaticBlur: number;
    ddPastelRolloff: number;
    ddShadowLift: number;
    ddSoftness: number;
    ddTintR: number;
    ddTintG: number;
    ddTintB: number;
    ghostOpacity: number;
    ghostOffsetX: number;
    ghostOffsetY: number;
    ghostMirror: number;
    ghostTintR: number;
    ghostTintG: number;
    ghostTintB: number;
    ghostBlend: number;
    dpDepthStrength: number;
    dpPushIn: number;
    dpLayers: number;
    dpChromatic: number;
    dpDepthBoost: number;
    dpMode: number;
    dpPanX: number;
    dpPanY: number;
    psGravity: number;
    psTurbulence: number;
    psThreshold: number;
    psMode: number;
    psReplenish: number;
    psChromaSplit: number;
    psGrainSize: number;
    pcdDissolve: number;
    pcdDotSize: number;
    pcdScatterRadius: number;
    pcdAttract: number;
    pcdTurbulence: number;
    pcdMode: number;
    pcdBgR: number;
    pcdBgG: number;
    pcdBgB: number;
    pcdHueShift: number;
    spinSpeed: number;
    terrainMode: number;
    terrainHeight: number;
    terrainCamHeight: number;
    terrainSpeed: number;
    terrainFog: number;
    terrainYaw: number;
    terrainPitch: number;
    terrainRoll: number;
    terrainFogR: number;
    terrainFogG: number;
    terrainFogB: number;
    terrainHorizonFade: number;
    terrainSourceMix: number;
    wtShape: number;
    wtHeight: number;
    wtRotateX: number;
    wtRotateY: number;
    wtAutoRotate: number;
    wtCamDistance: number;
    wtSpecular: number;
    wtAmbient: number;
    wtFogDistance: number;
    wtFogR: number;
    wtFogG: number;
    wtFogB: number;
    wtHorizonFade: number;
    soRadius: number;
    soHeight: number;
    soLatCount: number;
    soLonCount: number;
    soDiagCount: number;
    soSlope: number;
    soWidth: number;
    soSpin: number;
    soTilt: number;
    soFlow: number;
    soIntensity: number;
    soGlow: number;
    swRadius: number;
    swHeight: number;
    swMeridians: number;
    swParallels: number;
    swWidth: number;
    swSpin: number;
    swTilt: number;
    swIntensity: number;
    swHaloGlow: number;
    swColorR: number;
    swColorG: number;
    swColorB: number;
    swFillSource: number;
    vccGridSize: number;
    vccCubeSize: number;
    vccSpacing: number;
    vccHeight: number;
    vccSpin: number;
    vccTilt: number;
    vccCamDistance: number;
    vccSpecular: number;
    vccAmbient: number;
    vccHorizonFade: number;
    vccBgR: number;
    vccBgG: number;
    vccBgB: number;
    mlMajorR: number;
    mlRibbonW: number;
    mlTwists: number;
    mlSpin: number;
    mlTilt: number;
    mlLineDensity: number;
    mlLineWidth: number;
    mlIntensity: number;
    mlLineR: number;
    mlLineG: number;
    mlLineB: number;
    mlHorizonFade: number;
    csfShardCount: number;
    csfShardSize: number;
    csfSpread: number;
    csfChromaEdge: number;
    csfRefraction: number;
    csfSpin: number;
    csfIntensity: number;
    csfTintR: number;
    csfTintG: number;
    csfTintB: number;
    csfHorizonFade: number;
    tlTubeCount: number;
    tlTubeRadius: number;
    tlSpread: number;
    tlSpin: number;
    tlTilt: number;
    tlTwist: number;
    tlIntensity: number;
    tlRimR: number;
    tlRimG: number;
    tlRimB: number;
    tlHorizonFade: number;
    dmbRadius: number;
    dmbFacetCount: number;
    dmbSpin: number;
    dmbTilt: number;
    dmbChaseSpeed: number;
    dmbChaseHueWidth: number;
    dmbSparkle: number;
    dmbIntensity: number;
    dmbHighlightR: number;
    dmbHighlightG: number;
    dmbHighlightB: number;
    dmbHorizonFade: number;
    lkRatioX: number;
    lkRatioY: number;
    lkRatioZ: number;
    lkPhaseX: number;
    lkPhaseY: number;
    lkTubeRadius: number;
    lkScale: number;
    lkSpin: number;
    lkTilt: number;
    lkIntensity: number;
    lkTubeR: number;
    lkTubeG: number;
    lkTubeB: number;
    hpsHelices: number;
    hpsHelixRadius: number;
    hpsTurns: number;
    hpsHeight: number;
    hpsTubeRadius: number;
    hpsRiseSpeed: number;
    hpsSpin: number;
    hpsTilt: number;
    hpsIntensity: number;
    hpsTintR: number;
    hpsTintG: number;
    hpsTintB: number;
    hpsHorizonFade: number;
    dcMajorR: number;
    dcMinorR: number;
    dcStarCount: number;
    dcStarSize: number;
    dcSpin: number;
    dcTilt: number;
    dcTintIntensity: number;
    dcTorusR: number;
    dcTorusG: number;
    dcTorusB: number;
    dcStarR: number;
    dcStarG: number;
    dcStarB: number;
    geomProTileCount: number;
    geomProFlipRange: number;
    geomProSpeed: number;
    geomProGap: number;
    motionTrailsLength: number;
    motionTrailsAngle: number;
    motionTrailsSamples: number;
    motionTrailsFalloff: number;
    motionTrailsChromaSplit: number;
    motionTrailsMode: number;
    echoCount: number;
    echoOffsetX: number;
    echoOffsetY: number;
    echoDecay: number;
    echoHueShift: number;
    echoMode: number;
    lightPaintIntensity: number;
    lightPaintThreshold: number;
    lightPaintTrailLength: number;
    lightPaintFlowAngle: number;
    lightPaintFlowScale: number;
    lightPaintChromaShift: number;
    lightPaintTintR: number;
    lightPaintTintG: number;
    lightPaintTintB: number;
    recEchoDepth: number;
    recEchoZoom: number;
    recEchoRotation: number;
    recEchoOpacity: number;
    recEchoHueShift: number;
    recEchoOffsetX: number;
    recEchoOffsetY: number;
    ofdmIntensity: number;
    ofdmMotionScale: number;
    ofdmPersistence: number;
    ofdmChromaSplit: number;
    ofdmBlockSize: number;
    ofdmFreeze: number;
    ofdmMode: number;
    fftFlowScale: number;
    fftTrailLength: number;
    fftSamples: number;
    fftSpeed: number;
    fftChromaSplit: number;
    fftContrast: number;
    fftMode: number;
    fftColorCycle: number;
    rdFeedRate: number;
    rdKillRate: number;
    rdPatternScale: number;
    rdLumaMask: number;
    rdMode: number;
    rdColorR: number;
    rdColorG: number;
    rdColorB: number;
    rdMix: number;
  }>;
  clear?: boolean;
  seq?: number;
}

export interface NativeEffectPassChainPass {
  effect: NativeEffectPassId;
  amount?: number;
  mix?: number;
  params?: NativeEffectPassOptions['params'];
}

export interface NativeEffectPassChainOptions extends Omit<NativeEffectPassOptions, 'effect' | 'amount' | 'mix' | 'params'> {
  effects: NativeEffectPassChainPass[];
  intermediatePrefix?: string;
}

export interface NativeEffectPassGraph {
  effect: NativeEffectPassId;
  effects?: NativeEffectPassId[];
  config: {
    buffers: Array<Record<string, unknown>>;
    passes: unknown[];
    readbacks: string[];
    render_passes: Array<Record<string, unknown>>;
  };
}

export type NativeEffectPassPrecompileCommand = {
  type: 'precompile_shader';
  shader_id: string;
  stage: string;
  entry: string;
  source: string;
};

export const NATIVE_EFFECT_PASS_SHADER_ID = 'effect-pass/render';

export const NATIVE_EFFECT_PASS_MANIFEST: NativeEffectPassManifestEntry[] = [
  { id: 'invert', code: 1, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'grayscale', code: 2, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'brightness', code: 3, defaultAmount: 1, amountMin: 0, amountMax: 4 },
  { id: 'contrast', code: 4, defaultAmount: 1, amountMin: 0, amountMax: 4 },
  { id: 'gamma', code: 5, defaultAmount: 1, amountMin: 0.1, amountMax: 4 },
  { id: 'saturation', code: 6, defaultAmount: 1, amountMin: 0, amountMax: 4 },
  { id: 'hue', code: 7, defaultAmount: 0, amountMin: -1, amountMax: 1 },
  { id: 'posterize', code: 8, defaultAmount: 6, amountMin: 2, amountMax: 32 },
  { id: 'noise', code: 9, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'pixelate', code: 10, defaultAmount: 8, amountMin: 1, amountMax: 128 },
  { id: 'vignette', code: 11, defaultAmount: 0.8, amountMin: 0, amountMax: 2 },
  { id: 'rgb-shift', code: 12, defaultAmount: 5, amountMin: 0, amountMax: 80 },
  { id: 'scanlines', code: 13, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'blur', code: 14, defaultAmount: 5, amountMin: 0, amountMax: 48 },
  { id: 'chromatic-aberration', code: 15, defaultAmount: 0.4, amountMin: 0, amountMax: 3 },
  { id: 'glitch', code: 16, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'exposure', code: 17, defaultAmount: 0, amountMin: -4, amountMax: 4 },
  { id: 'vibrance', code: 18, defaultAmount: 0.3, amountMin: -1, amountMax: 2 },
  { id: 'temperature-tint', code: 19, defaultAmount: 0, amountMin: -1, amountMax: 1 },
  { id: 'sharpen', code: 20, defaultAmount: 0.5, amountMin: 0, amountMax: 3 },
  { id: 'directional-blur', code: 21, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'zoom-blur', code: 22, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'radial-blur', code: 23, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'kaleidoscope', code: 24, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'mirror', code: 25, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'chroma-key', code: 26, defaultAmount: 0.25, amountMin: 0, amountMax: 1 },
  { id: 'luma-key', code: 27, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'difference-key', code: 28, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'erode', code: 29, defaultAmount: 2, amountMin: 1, amountMax: 8 },
  { id: 'dilate', code: 30, defaultAmount: 2, amountMin: 1, amountMax: 8 },
  { id: 'wave', code: 31, defaultAmount: 10, amountMin: 0, amountMax: 50 },
  { id: 'fisheye', code: 32, defaultAmount: 0.5, amountMin: -1, amountMax: 1 },
  { id: 'lens-distortion', code: 33, defaultAmount: 0.4, amountMin: -1, amountMax: 1 },
  { id: 'twirl', code: 34, defaultAmount: 1.5, amountMin: -6.28319, amountMax: 6.28319 },
  { id: 'pinch-bulge', code: 35, defaultAmount: 0.4, amountMin: -1, amountMax: 1 },
  { id: 'edge-detect', code: 36, defaultAmount: 0.1, amountMin: 0, amountMax: 1 },
  { id: 'film-grain', code: 37, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'filmic-tonemap', code: 38, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'bloom', code: 39, defaultAmount: 0.6, amountMin: 0, amountMax: 1 },
  { id: 'colorama', code: 40, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'edge-feather', code: 41, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'dither', code: 42, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'outline', code: 43, defaultAmount: 2, amountMin: 0, amountMax: 12 },
  { id: 'emboss', code: 44, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'crt', code: 45, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'thermal', code: 46, defaultAmount: 1, amountMin: 0.05, amountMax: 2 },
  { id: 'night-vision', code: 47, defaultAmount: 1.5, amountMin: 0, amountMax: 2 },
  { id: 'blob-track', code: 48, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'blob-contour', code: 49, defaultAmount: 0.7, amountMin: 0, amountMax: 1 },
  { id: 'blob-heatmap', code: 50, defaultAmount: 0.85, amountMin: 0, amountMax: 1 },
  { id: 'tilt-shift', code: 51, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'halation', code: 52, defaultAmount: 0.6, amountMin: 0, amountMax: 2 },
  { id: 'anamorphic-streak', code: 53, defaultAmount: 0.6, amountMin: 0, amountMax: 2 },
  { id: 'heat-haze', code: 54, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'curves', code: 55, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'selective-color', code: 56, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'false-color', code: 57, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'shadow-recovery', code: 58, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'highlight-rolloff', code: 59, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'color-balance', code: 60, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'lift-gamma-gain', code: 61, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'strobe-flash', code: 62, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'fm-scanlines', code: 63, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'vhs', code: 64, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'plasma', code: 65, defaultAmount: 0.85, amountMin: 0, amountMax: 1 },
  { id: 'halftone', code: 66, defaultAmount: 0.9, amountMin: 0, amountMax: 1 },
  { id: 'toon', code: 67, defaultAmount: 0.85, amountMin: 0, amountMax: 1 },
  { id: 'kuwahara', code: 68, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'defocus-bokeh', code: 69, defaultAmount: 12, amountMin: 0, amountMax: 30 },
  { id: 'god-rays', code: 70, defaultAmount: 0.7, amountMin: 0, amountMax: 2 },
  { id: 'displacement', code: 71, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'polar-transform', code: 72, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'oil-paint', code: 73, defaultAmount: 4, amountMin: 1, amountMax: 8 },
  { id: 'watercolor', code: 74, defaultAmount: 0.6, amountMin: 0, amountMax: 1.5 },
  { id: 'comic-ink', code: 75, defaultAmount: 1, amountMin: 0.2, amountMax: 3 },
  { id: 'crosshatch', code: 76, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'linocut', code: 77, defaultAmount: 1, amountMin: 0.2, amountMax: 1.6 },
  { id: 'dot-matrix', code: 78, defaultAmount: 8, amountMin: 0, amountMax: 16 },
  { id: 'ascii', code: 79, defaultAmount: 8, amountMin: 0, amountMax: 15 },
  { id: 'matrix-rain', code: 80, defaultAmount: 0.6, amountMin: 0, amountMax: 1.5 },
  { id: 'binary-code', code: 81, defaultAmount: 8, amountMin: 0, amountMax: 16 },
  { id: 'block-mosaic', code: 82, defaultAmount: 10, amountMin: 0, amountMax: 17 },
  { id: 'number-grid', code: 83, defaultAmount: 8, amountMin: 0, amountMax: 14 },
  { id: 'braille-pattern', code: 84, defaultAmount: 8, amountMin: 0, amountMax: 15 },
  { id: 'circuit-board', code: 85, defaultAmount: 6, amountMin: 0, amountMax: 11 },
  { id: 'stained-glass', code: 86, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'woven-fabric', code: 87, defaultAmount: 8, amountMin: 0, amountMax: 15 },
  { id: 'mosaic-tile', code: 88, defaultAmount: 15, amountMin: 0, amountMax: 17 },
  { id: 'neon-outline', code: 89, defaultAmount: 1, amountMin: 0, amountMax: 3 },
  { id: 'topo-map', code: 90, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'led-wall', code: 91, defaultAmount: 5, amountMin: 0, amountMax: 20 },
  { id: 'hex-grid', code: 92, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'geometric-tile', code: 93, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'spiral-tile', code: 94, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'voronoi-shatter', code: 95, defaultAmount: 0.6, amountMin: 0, amountMax: 1 },
  { id: 'thermal-contour', code: 96, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'phase-lab', code: 97, defaultAmount: 1.35, amountMin: 0, amountMax: 4 },
  { id: 'lens-dirt', code: 98, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'diffusion-promist', code: 99, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'compression-artifacts', code: 100, defaultAmount: 1, amountMin: 0, amountMax: 1 },
  { id: 'datamosh-lite', code: 101, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'scanline-drift', code: 102, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'tape-dropout', code: 103, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'ripple-caustics', code: 104, defaultAmount: 0.6, amountMin: 0, amountMax: 2 },
  { id: 'shockwave', code: 105, defaultAmount: 0.06, amountMin: 0, amountMax: 0.2 },
  { id: 'droste-recursive', code: 106, defaultAmount: 1.5, amountMin: 1.05, amountMax: 3 },
  { id: 'slit-scan', code: 107, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'fractal-warp', code: 108, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'fluid-distort', code: 109, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'wormhole', code: 110, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'vhs-full-deck', code: 111, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'topo-warp', code: 112, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'strobe-sequencer', code: 113, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'mirror-shards', code: 114, defaultAmount: 0.2, amountMin: 0.05, amountMax: 0.5 },
  { id: 'rorschach-mirror', code: 115, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'glitch-quilt', code: 116, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'poster-tear', code: 117, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'paint-peel', code: 118, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'liquid-glass', code: 119, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'crystal-refract', code: 120, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'infinite-mirror', code: 121, defaultAmount: 0.8, amountMin: 0.5, amountMax: 0.95 },
  { id: 'tunnel-flight', code: 122, defaultAmount: 1, amountMin: 0, amountMax: 3 },
  { id: 'volumetric-fog-overlay', code: 123, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'rain-fog-snow-overlay', code: 124, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'particle-overlay-fx', code: 125, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'glint-starburst', code: 126, defaultAmount: 0.7, amountMin: 0, amountMax: 2 },
  { id: 'emboss-relight', code: 127, defaultAmount: 1, amountMin: 0, amountMax: 3 },
  { id: 'pixel-sort', code: 128, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'neon-tube-trace', code: 129, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'hologram-scan', code: 130, defaultAmount: 0.7, amountMin: 0, amountMax: 1 },
  { id: 'laser-slice', code: 131, defaultAmount: 1.2, amountMin: 0, amountMax: 2 },
  { id: 'aura-field', code: 132, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'smoke-disintegrate', code: 133, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'shimmer-cloth', code: 134, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'cellular-automata-burn', code: 135, defaultAmount: 0.7, amountMin: 0, amountMax: 1 },
  { id: 'spectral-prism-tunnel', code: 136, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'led-volume', code: 137, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'audio-shock-bloom', code: 138, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'analog-feedback-rack', code: 139, defaultAmount: 0.7, amountMin: 0, amountMax: 1 },
  { id: 'club-laser-grid', code: 140, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'ghost-exposure', code: 141, defaultAmount: 0.3, amountMin: 0, amountMax: 1 },
  { id: 'dream-diffusion', code: 142, defaultAmount: 1.2, amountMin: 0, amountMax: 2 },
  { id: 'ghost-double', code: 143, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'depth-parallax', code: 144, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'pixel-sand', code: 145, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'point-cloud-dissolve', code: 146, defaultAmount: 0, amountMin: 0, amountMax: 1 },
  { id: 'explode3-d', code: 147, defaultAmount: 0.3, amountMin: 0, amountMax: 2 },
  { id: 'terrain3-d', code: 148, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'wrapped-terrain', code: 149, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'string-orb', code: 150, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'sphere-wireframe', code: 151, defaultAmount: 1.2, amountMin: 0, amountMax: 2 },
  { id: 'voxel-cube-cluster', code: 152, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'mobius-lattice', code: 153, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'crystal-shard-field', code: 154, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'tube-lattice', code: 155, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'disco-mirror-ball', code: 156, defaultAmount: 1.2, amountMin: 0, amountMax: 2 },
  { id: 'lissajous-knot', code: 157, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'helix-particle-stream', code: 158, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'donut-constellation', code: 159, defaultAmount: 1, amountMin: 0, amountMax: 2 },
  { id: 'sphere-project', code: 160, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'cube-project', code: 161, defaultAmount: 0.6, amountMin: 0, amountMax: 1 },
  { id: 'cylinder-wrap', code: 162, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'torus-tunnel', code: 163, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'diamond-gem', code: 164, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'shatter3-d', code: 165, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'mobius-strip', code: 166, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'voxel-displace', code: 167, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'wave-surface', code: 168, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'prism-split', code: 169, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'origami-fold', code: 170, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'mirror-room', code: 171, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'geometric-tile-pro', code: 172, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'shingle-stack', code: 173, defaultAmount: 0.8, amountMin: 0, amountMax: 1 },
  { id: 'time-smear', code: 174, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'chronophoto', code: 175, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'optical-flow-datamosh', code: 176, defaultAmount: 0.7, amountMin: 0, amountMax: 1 },
  { id: 'flow-field-trails', code: 177, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'reaction-diffusion', code: 178, defaultAmount: 0.6, amountMin: 0, amountMax: 1 },
  { id: 'feedback-zoom', code: 179, defaultAmount: 0.5, amountMin: 0, amountMax: 1 },
  { id: 'motion-trails', code: 180, defaultAmount: 0.4, amountMin: 0, amountMax: 1 },
  { id: 'echo-repeat', code: 181, defaultAmount: 0.7, amountMin: 0.05, amountMax: 0.95 },
  { id: 'light-paint', code: 182, defaultAmount: 0.7, amountMin: 0, amountMax: 2 },
  { id: 'recursive-echo', code: 183, defaultAmount: 0.6, amountMin: 0.05, amountMax: 0.95 },
];

const NATIVE_EFFECT_PASS_BY_ID = new Map(
  NATIVE_EFFECT_PASS_MANIFEST.map((entry) => [entry.id, entry]),
);

const NATIVE_EFFECT_PASS_WGSL = /* wgsl */`
struct EffectPassUniforms {
  resolution_time: vec4<f32>,
  effect: vec4<f32>,
  params0: vec4<f32>,
  params1: vec4<f32>,
  params2: vec4<f32>,
  params3: vec4<f32>,
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var source_tex: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> u: EffectPassUniforms;

fn saturate3(value: vec3<f32>) -> vec3<f32> {
  return clamp(value, vec3<f32>(0.0), vec3<f32>(1.5));
}

fn luma(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

fn hue_rotate(color: vec3<f32>, turns: f32) -> vec3<f32> {
  let angle = turns * 6.28318530718;
  let axis = normalize(vec3<f32>(1.0, 1.0, 1.0));
  return color * cos(angle) + cross(axis, color) * sin(angle) + axis * dot(axis, color) * (1.0 - cos(angle));
}

fn fract1(value: f32) -> f32 {
  return value - floor(value);
}

fn hash21(p: vec2<f32>) -> f32 {
  let q = fract(vec2<f32>(
    p.x * 127.1 + p.y * 311.7,
    p.x * 269.5 + p.y * 183.3,
  ));
  return fract1(sin(q.x + q.y) * 43758.5453123);
}

fn value_noise2d(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  let v = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, v.x), mix(c, d, v.x), v.y);
}

fn fbm2d(p0: vec2<f32>) -> f32 {
  var p = p0;
  var v = 0.0;
  var amp = 0.5;
  for (var i = 0u; i < 4u; i = i + 1u) {
    v += value_noise2d(p) * amp;
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

fn cellular2d(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  var min_d = 1.0;
  for (var yy = -1i; yy <= 1i; yy = yy + 1i) {
    for (var xx = -1i; xx <= 1i; xx = xx + 1i) {
      let g = vec2<f32>(f32(xx), f32(yy));
      let o = vec2<f32>(
        hash21(i + g),
        hash21(i + g + vec2<f32>(13.0)),
      );
      let r = g + o - f;
      min_d = min(min_d, dot(r, r));
    }
  }
  return sqrt(min_d);
}

fn aperture_mask(p: vec2<f32>, shape: u32) -> f32 {
  let r = length(p);
  if (r > 1.0) {
    return 0.0;
  }
  if (shape == 0u) {
    return 1.0;
  }
  let sides = select(8.0, 6.0, shape == 1u);
  let half_ang = 3.14159265 / sides;
  let ang = atan2(p.y, p.x);
  let folded = fract1((ang + half_ang) / (2.0 * half_ang)) * (2.0 * half_ang) - half_ang;
  let poly_r = cos(half_ang) / max(0.001, cos(folded));
  return select(0.0, 1.0, r <= poly_r);
}

fn displacement_offset(uv: vec2<f32>, t: f32, amount: f32) -> vec2<f32> {
  let scale = max(1.0, u.params0.x);
  let mode = u32(round(clamp(u.params0.z, 0.0, 3.0)));
  let turbulence = clamp(u.params0.w, 0.0, 1.0);
  let p = uv * scale + vec2<f32>(t, t * 0.7);
  var nx = 0.0;
  var ny = 0.0;
  if (mode == 0u) {
    nx = mix(value_noise2d(p), fbm2d(p), step(0.5, turbulence)) - 0.5;
    ny = mix(value_noise2d(p + vec2<f32>(71.3)), fbm2d(p + vec2<f32>(71.3)), step(0.5, turbulence)) - 0.5;
  } else if (mode == 1u) {
    nx = cellular2d(p) - 0.5;
    ny = cellular2d(p + vec2<f32>(71.3)) - 0.5;
  } else if (mode == 2u) {
    nx = sin(uv.y * scale * 6.28318530718 + t * 2.0);
    ny = sin(uv.x * scale * 6.28318530718 + t * 2.0);
  } else {
    let d = uv - vec2<f32>(0.5);
    let r = length(d);
    let ripple = sin(r * scale * 6.28318530718 - t * 3.0);
    let dir = select(vec2<f32>(1.0, 0.0), d / r, r > 0.001);
    nx = dir.x * ripple;
    ny = dir.y * ripple;
  }
  return vec2<f32>(nx, ny) * clamp(amount, 0.0, 1.0) * 0.05;
}

fn vhs_hash11(seed: f32) -> f32 {
  return fract1(sin(seed * 12.9898) * 43758.5453123);
}

fn vhs_random(st: vec2<f32>) -> f32 {
  return fract1(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453123);
}

fn vhs_noise(st: vec2<f32>) -> f32 {
  let i = floor(st);
  let f = fract(st);
  let a = vhs_random(i);
  let b = vhs_random(i + vec2<f32>(1.0, 0.0));
  let c = vhs_random(i + vec2<f32>(0.0, 1.0));
  let d = vhs_random(i + vec2<f32>(1.0, 1.0));
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u2.x) + (c - a) * u2.y * (1.0 - u2.x) + (d - b) * u2.x * u2.y;
}

fn sample_clamped(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(source_tex, source_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
}

fn sample_rgb(uv: vec2<f32>) -> vec3<f32> {
  return sample_clamped(uv).rgb;
}

fn rotate2d(value: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(value.x * c - value.y * s, value.x * s + value.y * c);
}

fn rgb_to_ycbcr(c: vec3<f32>) -> vec3<f32> {
  let y = dot(c, vec3<f32>(0.299, 0.587, 0.114));
  let cb = -0.169 * c.r - 0.331 * c.g + 0.5 * c.b;
  let cr = 0.5 * c.r - 0.419 * c.g - 0.081 * c.b;
  return vec3<f32>(y, cb, cr);
}

fn hue_value(c: vec3<f32>) -> f32 {
  let maxc = max(c.r, max(c.g, c.b));
  let minc = min(c.r, min(c.g, c.b));
  let delta = maxc - minc;
  if (delta <= 0.00001) {
    return 0.0;
  }
  var hue = 0.0;
  if (maxc == c.r) {
    hue = (c.g - c.b) / delta;
  } else if (maxc == c.g) {
    hue = 2.0 + (c.b - c.r) / delta;
  } else {
    hue = 4.0 + (c.r - c.g) / delta;
  }
  return fract(hue / 6.0);
}

fn saturation_value(c: vec3<f32>) -> f32 {
  let maxc = max(c.r, max(c.g, c.b));
  let minc = min(c.r, min(c.g, c.b));
  return clamp((maxc - minc) / max(0.0001, maxc), 0.0, 1.0);
}

fn channel_value(c: vec4<f32>, channel: u32) -> f32 {
  if (channel == 1u) {
    return c.r;
  }
  if (channel == 2u) {
    return c.g;
  }
  if (channel == 3u) {
    return c.b;
  }
  if (channel == 4u) {
    return c.a;
  }
  return luma(c.rgb);
}

fn wave_signal(value: f32, waveform: u32) -> f32 {
  if (waveform == 1u) {
    return abs(fract(value / 6.28318530718 + 0.25) * 4.0 - 2.0) - 1.0;
  }
  if (waveform == 2u) {
    return fract(value / 6.28318530718) * 2.0 - 1.0;
  }
  if (waveform == 3u) {
    if (sin(value) >= 0.0) {
      return 1.0;
    }
    return -1.0;
  }
  return sin(value);
}

fn tonemap_aces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + vec3<f32>(0.03))) / (x * (2.43 * x + vec3<f32>(0.59)) + vec3<f32>(0.14)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemap_reinhard(x: vec3<f32>) -> vec3<f32> {
  return x / (vec3<f32>(1.0) + x);
}

fn tonemap_hable(x: vec3<f32>) -> vec3<f32> {
  let A = 0.15;
  let B = 0.50;
  let C = 0.10;
  let D = 0.20;
  let E = 0.02;
  let F = 0.30;
  let W = 11.2;
  let n = ((x * (A * x + vec3<f32>(C * B)) + vec3<f32>(D * E)) / (x * (A * x + vec3<f32>(B)) + vec3<f32>(D * F))) - vec3<f32>(E / F);
  let wn = ((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F;
  return clamp(n / vec3<f32>(wn), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemap_scurve(x: vec3<f32>) -> vec3<f32> {
  let t = smoothstep(vec3<f32>(0.0), vec3<f32>(1.0), x);
  return t * t * (vec3<f32>(3.0) - vec3<f32>(2.0) * t);
}

fn bloom_threshold_knee(col: vec3<f32>, threshold: f32, knee: f32) -> vec3<f32> {
  let br = max(col.r, max(col.g, col.b));
  let knee_amt = max(knee, 0.0001);
  var soft = clamp(br - threshold + knee_amt, 0.0, 2.0 * knee_amt);
  soft = soft * soft / (4.0 * knee_amt + 0.00001);
  let contribution = max(soft, br - threshold) / max(br, 0.00001);
  return col * contribution;
}

fn bloom_ring_sample(uv: vec2<f32>, px: vec2<f32>, radius: f32, anamorphic: f32) -> vec3<f32> {
  let aniso = clamp(anamorphic, 0.0, 1.0);
  let r = px * radius * vec2<f32>(1.0, 1.0 - aniso * 0.92);
  var acc = vec3<f32>(0.0);
  acc += sample_rgb(uv + r * vec2<f32>( 1.0,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>(-1.0,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>( 0.7,  0.7));
  acc += sample_rgb(uv + r * vec2<f32>(-0.7,  0.7));
  acc += sample_rgb(uv + r * vec2<f32>( 0.7, -0.7));
  acc += sample_rgb(uv + r * vec2<f32>(-0.7, -0.7));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0,  1.0));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0, -1.0));
  acc += sample_rgb(uv + r * vec2<f32>( 1.7,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>(-1.7,  0.0));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0,  1.7));
  acc += sample_rgb(uv + r * vec2<f32>( 0.0, -1.7));
  acc += sample_rgb(uv);
  return acc / 13.0;
}

fn colorama_cosine_palette(t: f32, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, d: vec3<f32>) -> vec3<f32> {
  return a + b * cos(6.28318530718 * (c * t + d));
}

fn colorama_palette(t: f32, palette: u32, hue_shift: f32) -> vec3<f32> {
  var a = vec3<f32>(0.5, 0.5, 0.5);
  var b = vec3<f32>(0.5, 0.5, 0.5);
  var c = vec3<f32>(1.0, 1.0, 1.0);
  var d = vec3<f32>(0.0, 0.33, 0.67);

  if (palette == 1u) {
    d = vec3<f32>(0.0, 0.1, 0.2);
  } else if (palette == 2u) {
    d = vec3<f32>(0.3, 0.2, 0.2);
  } else if (palette == 3u) {
    c = vec3<f32>(1.0, 1.0, 0.5);
    d = vec3<f32>(0.8, 0.9, 0.3);
  } else if (palette == 4u) {
    c = vec3<f32>(1.0, 0.7, 0.4);
    d = vec3<f32>(0.0, 0.15, 0.2);
  } else if (palette == 5u) {
    d = vec3<f32>(0.0, 0.1, 0.0);
  } else if (palette == 6u) {
    a = vec3<f32>(0.8, 0.8, 0.9);
    b = vec3<f32>(0.2, 0.4, 0.2);
    d = vec3<f32>(0.0, 0.25, 0.25);
  } else if (palette == 7u) {
    c = vec3<f32>(2.0, 1.0, 0.0);
    d = vec3<f32>(0.5, 0.2, 0.25);
  } else if (palette == 8u) {
    a = vec3<f32>(0.6, 0.4, 0.7);
    b = vec3<f32>(0.4, 0.4, 0.4);
    c = vec3<f32>(1.0, 1.0, 0.5);
    d = vec3<f32>(0.0, 0.15, 0.50);
  } else if (palette == 9u) {
    a = vec3<f32>(0.55, 0.45, 0.55);
    b = vec3<f32>(0.55, 0.5, 0.5);
    c = vec3<f32>(1.5, 1.5, 1.0);
    d = vec3<f32>(0.0, 0.5, 0.85);
  } else if (palette == 10u) {
    a = vec3<f32>(0.85, 0.8, 0.85);
    b = vec3<f32>(0.15, 0.18, 0.15);
    d = vec3<f32>(0.0, 0.33, 0.67);
  } else if (palette == 11u) {
    let h = fract1(hue_shift);
    d = vec3<f32>(h, h + 0.33, h + 0.67);
  }

  return colorama_cosine_palette(t, a, b, c, d);
}

fn dither_palette_snap(c: vec3<f32>, palette: u32) -> vec3<f32> {
  let lum = luma(c);
  if (palette == 1u) {
    let v = select(0.0, 1.0, lum >= 0.5);
    return vec3<f32>(v);
  }
  if (palette == 2u) {
    if (lum < 0.25) { return vec3<f32>(0.0, 0.0, 0.0); }
    if (lum < 0.5) { return vec3<f32>(0.0, 1.0, 1.0); }
    if (lum < 0.75) { return vec3<f32>(1.0, 0.0, 1.0); }
    return vec3<f32>(1.0, 1.0, 1.0);
  }
  if (palette == 3u) {
    let levels = vec3<f32>(2.0, 2.0, 1.0);
    return floor(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * levels + vec3<f32>(0.5)) / max(levels, vec3<f32>(1.0));
  }
  if (palette == 4u) {
    if (lum < 0.25) { return vec3<f32>(0.05, 0.10, 0.03); }
    if (lum < 0.5) { return vec3<f32>(0.19, 0.38, 0.19); }
    if (lum < 0.75) { return vec3<f32>(0.55, 0.67, 0.32); }
    return vec3<f32>(0.80, 0.86, 0.55);
  }
  if (palette == 5u) {
    return vec3<f32>(lum * 1.25, lum * 0.72, lum * 0.18);
  }
  return c;
}

fn dither_threshold(kind: u32, cell: vec2<f32>, uv: vec2<f32>, color: vec3<f32>) -> f32 {
  if (kind == 1u) {
    return hash21(floor(cell * vec2<f32>(0.7, 1.3)) + vec2<f32>(19.0, 3.0));
  }
  if (kind == 2u) {
    let centered = fract(cell * 0.5) - vec2<f32>(0.5);
    return smoothstep(0.08, 0.48, length(centered));
  }
  if (kind == 3u) {
    let a = hash21(cell + vec2<f32>(0.0, 0.0));
    let b = hash21(cell + vec2<f32>(1.0, 0.0));
    let c = hash21(cell + vec2<f32>(0.0, 1.0));
    return (a * 0.55 + b * 0.25 + c * 0.20);
  }
  if (kind == 4u) {
    let n = hash21(floor(cell * 0.5) + vec2<f32>(luma(color) * 7.0, 11.0));
    return mix(fract(cell.x * 0.37 + cell.y * 0.63), n, 0.55);
  }
  let p = floor(cell);
  let base = fract(p.x * 0.125 + p.y * 0.375 + p.x * p.y * 0.0625);
  return mix(base, hash21(p), 0.28);
}

fn thermal_palette_native(t: f32, palette: u32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  if (palette == 1u) {
    if (x < 0.18) { return mix(vec3<f32>(0.0), vec3<f32>(0.28, 0.0, 0.45), x / 0.18); }
    if (x < 0.38) { return mix(vec3<f32>(0.28, 0.0, 0.45), vec3<f32>(0.0, 0.35, 1.0), (x - 0.18) / 0.20); }
    if (x < 0.62) { return mix(vec3<f32>(0.0, 0.35, 1.0), vec3<f32>(0.0, 1.0, 0.55), (x - 0.38) / 0.24); }
    if (x < 0.82) { return mix(vec3<f32>(0.0, 1.0, 0.55), vec3<f32>(1.0, 0.65, 0.0), (x - 0.62) / 0.20); }
    return mix(vec3<f32>(1.0, 0.65, 0.0), vec3<f32>(1.0), (x - 0.82) / 0.18);
  }
  if (palette == 2u) {
    if (x < 0.35) { return mix(vec3<f32>(1.0), vec3<f32>(0.35, 1.0, 1.0), x / 0.35); }
    if (x < 0.70) { return mix(vec3<f32>(0.35, 1.0, 1.0), vec3<f32>(0.0, 0.25, 1.0), (x - 0.35) / 0.35); }
    return mix(vec3<f32>(0.0, 0.25, 1.0), vec3<f32>(1.0, 0.0, 0.65), (x - 0.70) / 0.30);
  }
  if (palette == 3u) {
    if (x < 0.30) { return mix(vec3<f32>(0.0, 0.05, 0.0), vec3<f32>(0.0, 0.62, 0.12), x / 0.30); }
    if (x < 0.62) { return mix(vec3<f32>(0.0, 0.62, 0.12), vec3<f32>(0.95, 0.82, 0.0), (x - 0.30) / 0.32); }
    if (x < 0.86) { return mix(vec3<f32>(0.95, 0.82, 0.0), vec3<f32>(0.95, 0.22, 0.04), (x - 0.62) / 0.24); }
    return mix(vec3<f32>(0.95, 0.22, 0.04), vec3<f32>(1.0, 0.0, 0.65), (x - 0.86) / 0.14);
  }
  if (palette == 4u) {
    return vec3<f32>(x);
  }
  if (x < 0.2) { return mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(0.0, 0.5, 1.0), x * 5.0); }
  if (x < 0.4) { return mix(vec3<f32>(0.0, 0.5, 1.0), vec3<f32>(0.0, 1.0, 0.0), (x - 0.2) * 5.0); }
  if (x < 0.6) { return mix(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), (x - 0.4) * 5.0); }
  if (x < 0.8) { return mix(vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), (x - 0.6) * 5.0); }
  return mix(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0), (x - 0.8) * 5.0);
}

fn rgb_to_hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -0.33333333333, 0.66666666667, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  return vec3<f32>(
    abs(q.z + (q.w - q.y) / (6.0 * d + 0.0000000001)),
    d / (q.x + 0.0000000001),
    q.x,
  );
}

fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 0.66666666667, 0.33333333333, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn false_color_dit_exposure(l: f32) -> vec3<f32> {
  if (l < 0.04) { return vec3<f32>(0.5, 0.0, 0.7); }
  if (l < 0.18) { return vec3<f32>(0.0, 0.0, 0.9); }
  if (l < 0.42) { return vec3<f32>(0.0, 0.8, 0.6); }
  if (l < 0.55) { return vec3<f32>(0.4, 0.8, 0.0); }
  if (l < 0.7) { return vec3<f32>(1.0, 1.0, 0.0); }
  if (l < 0.92) { return vec3<f32>(1.0, 0.5, 0.0); }
  return vec3<f32>(1.0, 0.0, 0.0);
}

fn false_color_zone_heat(l: f32) -> vec3<f32> {
  let n = clamp(l, 0.0, 1.0);
  return mix(
    mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(0.0, 0.7, 1.0), smoothstep(0.0, 0.4, n)),
    mix(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), smoothstep(0.4, 0.7, n)),
    smoothstep(0.4, 0.55, n),
  ) + smoothstep(0.85, 1.0, n) * vec3<f32>(1.0, 0.2, 0.0);
}

fn false_color_resolve(l: f32) -> vec3<f32> {
  if (l < 0.05) { return vec3<f32>(0.0, 0.0, 1.0); }
  if (l > 0.95) { return vec3<f32>(1.0, 0.0, 0.0); }
  return vec3<f32>(l);
}

fn false_color_stripes(l: f32) -> vec3<f32> {
  let h = clamp(l, 0.0, 1.0);
  return vec3<f32>(
    sin(h * 9.42) * 0.5 + 0.5,
    sin(h * 9.42 + 2.094) * 0.5 + 0.5,
    sin(h * 9.42 + 4.189) * 0.5 + 0.5,
  );
}

fn highlight_rolloff_hue(src: vec3<f32>, threshold: f32, max_value: f32, amount: f32) -> vec3<f32> {
  let lum = luma(src);
  let over = max(0.0, lum - threshold);
  var compressed = threshold + over / (1.0 + over * (4.0 * amount));
  compressed = min(compressed, max_value);
  let scale = select(1.0, compressed / lum, lum > 0.001);
  return src * scale;
}

fn highlight_rolloff_channel(value: f32, threshold: f32, amount: f32, weight: f32) -> f32 {
  let denom = 1.0 + (value - threshold) * 4.0 * amount;
  let safe_denom = select(-0.001, 0.001, denom >= 0.0);
  let d = select(denom, safe_denom, abs(denom) < 0.001);
  let compressed = threshold + (value - threshold) / d;
  return min(value, mix(value, compressed, weight));
}

fn night_vision_tint(lum: f32, phosphor: u32) -> vec3<f32> {
  if (phosphor == 1u) {
    return vec3<f32>(lum, lum * 0.65, lum * 0.15);
  }
  if (phosphor == 2u) {
    return vec3<f32>(lum);
  }
  return vec3<f32>(lum * 0.2, lum, lum * 0.2);
}

fn blob_track_color(idx: u32, src_color: vec3<f32>) -> vec3<f32> {
  if (idx == 1u) { return vec3<f32>(0.0, 0.9, 1.0); }
  if (idx == 2u) { return vec3<f32>(1.0, 0.0, 0.8); }
  if (idx == 3u) { return vec3<f32>(1.0, 0.75, 0.0); }
  if (idx == 4u) { return vec3<f32>(1.0, 0.15, 0.15); }
  if (idx == 5u) { return vec3<f32>(0.2, 0.4, 1.0); }
  if (idx == 6u) { return vec3<f32>(1.0); }
  if (idx >= 7u) { return src_color; }
  return vec3<f32>(0.0, 1.0, 0.4);
}

fn blob_heat_color(t: f32, palette: u32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  if (palette == 1u) {
    if (x < 0.33) { return mix(vec3<f32>(0.27, 0.0, 0.33), vec3<f32>(0.28, 0.47, 0.64), x * 3.0); }
    if (x < 0.66) { return mix(vec3<f32>(0.28, 0.47, 0.64), vec3<f32>(0.13, 0.72, 0.55), (x - 0.33) * 3.0); }
    return mix(vec3<f32>(0.13, 0.72, 0.55), vec3<f32>(0.99, 0.91, 0.14), (x - 0.66) * 3.0);
  }
  if (palette == 2u) {
    let a = mix(vec3<f32>(0.05, 0.0, 0.53), vec3<f32>(0.8, 0.12, 0.56), x);
    let b = mix(vec3<f32>(0.8, 0.12, 0.56), vec3<f32>(0.94, 0.98, 0.13), x);
    return mix(a, b, x);
  }
  if (palette >= 3u) {
    let a = mix(vec3<f32>(0.0, 0.0, 0.02), vec3<f32>(0.7, 0.1, 0.45), x);
    let b = mix(vec3<f32>(0.7, 0.1, 0.45), vec3<f32>(1.0, 1.0, 0.75), x);
    return mix(a, b, x);
  }
  if (x < 0.25) { return mix(vec3<f32>(0.0, 0.0, 0.04), vec3<f32>(0.35, 0.0, 0.5), x * 4.0); }
  if (x < 0.5) { return mix(vec3<f32>(0.35, 0.0, 0.5), vec3<f32>(0.85, 0.2, 0.15), (x - 0.25) * 4.0); }
  if (x < 0.75) { return mix(vec3<f32>(0.85, 0.2, 0.15), vec3<f32>(1.0, 0.85, 0.1), (x - 0.5) * 4.0); }
  return mix(vec3<f32>(1.0, 0.85, 0.1), vec3<f32>(1.0, 1.0, 0.85), (x - 0.75) * 4.0);
}

fn blob_cell_bright(cell_idx: vec2<f32>, grid_res: f32) -> f32 {
  let center = (cell_idx + vec2<f32>(0.5)) / grid_res;
  if (center.x < 0.0 || center.x > 1.0 || center.y < 0.0 || center.y > 1.0) {
    return 0.0;
  }
  let half_cell = 0.5 / grid_res;
  var peak = luma(sample_rgb(center));
  peak = max(peak, luma(sample_rgb(center + vec2<f32>( half_cell, 0.0))));
  peak = max(peak, luma(sample_rgb(center + vec2<f32>(-half_cell, 0.0))));
  peak = max(peak, luma(sample_rgb(center + vec2<f32>(0.0,  half_cell))));
  peak = max(peak, luma(sample_rgb(center + vec2<f32>(0.0, -half_cell))));
  return peak;
}

fn blob_is_peak(cell_idx: vec2<f32>, grid_res: f32, threshold: f32) -> bool {
  let b = blob_cell_bright(cell_idx, grid_res);
  if (b < threshold) {
    return false;
  }
  let n1 = blob_cell_bright(cell_idx + vec2<f32>(1.0, 0.0), grid_res);
  let n2 = blob_cell_bright(cell_idx + vec2<f32>(-1.0, 0.0), grid_res);
  let n3 = blob_cell_bright(cell_idx + vec2<f32>(0.0, 1.0), grid_res);
  let n4 = blob_cell_bright(cell_idx + vec2<f32>(0.0, -1.0), grid_res);
  return b >= n1 && b >= n2 && b >= n3 && b >= n4;
}

fn p_or(value: f32, fallback: f32) -> f32 {
  return select(value, fallback, value <= 0.0);
}

fn effect_texel() -> vec2<f32> {
  return vec2<f32>(1.0) / max(u.resolution_time.xy, vec2<f32>(1.0));
}

fn w4_rot_x(a: f32) -> mat3x3<f32> {
  let s = sin(a);
  let c = cos(a);
  return mat3x3<f32>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, c, -s), vec3<f32>(0.0, s, c));
}

fn w4_rot_y(a: f32) -> mat3x3<f32> {
  let s = sin(a);
  let c = cos(a);
  return mat3x3<f32>(vec3<f32>(c, 0.0, s), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(-s, 0.0, c));
}

fn w4_rot_z(a: f32) -> mat3x3<f32> {
  let s = sin(a);
  let c = cos(a);
  return mat3x3<f32>(vec3<f32>(c, -s, 0.0), vec3<f32>(s, c, 0.0), vec3<f32>(0.0, 0.0, 1.0));
}

fn w4_sphere_uv(n: vec3<f32>) -> vec2<f32> {
  return vec2<f32>(atan2(n.z, n.x) / 6.28318530718 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
}

fn w4_fresnel(n: vec3<f32>, rd: vec3<f32>, power: f32) -> f32 {
  return pow(1.0 - max(dot(n, -rd), 0.0), power);
}

fn w4_hash13(p0: vec3<f32>) -> f32 {
  var p = fract(p0 * vec3<f32>(443.8975, 397.2973, 491.1871));
  p = p + vec3<f32>(dot(p, p.yzx + vec3<f32>(19.19)));
  return fract((p.x + p.y) * p.z);
}

fn w4_hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let p = abs(fract(c.xxx + vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3<f32>(3.0));
  return c.z * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// Ray-sphere: returns t, negative on miss
fn w4_isect_sphere(ro: vec3<f32>, rd: vec3<f32>, r: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let h = b * b - c;
  if (h < 0.0) { return -1.0; }
  return -b - sqrt(h);
}

// Ray-AABB: returns vec4(normal.xyz, t); t negative on miss
fn w4_isect_box(ro: vec3<f32>, rd: vec3<f32>, r: vec3<f32>) -> vec4<f32> {
  let m = 1.0 / rd;
  let n = m * ro;
  let k = abs(m) * r;
  let t1 = -n - k;
  let t2 = -n + k;
  let t_n = max(max(t1.x, t1.y), t1.z);
  let t_f = min(min(t2.x, t2.y), t2.z);
  if (t_n > t_f || t_f < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  let normal = -sign(rd) * step(vec3<f32>(t1.y, t1.z, t1.x), t1) * step(vec3<f32>(t1.z, t1.x, t1.y), t1);
  return vec4<f32>(normal, t_n);
}

// Ray-infinite-cylinder along Y: returns vec4(normal.xyz, t); t negative on miss
fn w4_isect_cyl_y(ro: vec3<f32>, rd: vec3<f32>, r: f32) -> vec4<f32> {
  let a = rd.x * rd.x + rd.z * rd.z;
  let b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
  let c = ro.x * ro.x + ro.z * ro.z - r * r;
  let disc = b * b - 4.0 * a * c;
  if (disc < 0.0 || a < 1e-6) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  let t = (-b - sqrt(disc)) / (2.0 * a);
  if (t < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  let hit = ro + rd * t;
  let n = normalize(vec3<f32>(hit.x, 0.0, hit.z));
  return vec4<f32>(n, t);
}

fn w4_sd_torus(p: vec3<f32>, big_r: f32, small_r: f32) -> f32 {
  let q = vec2<f32>(length(p.xz) - big_r, p.y);
  return length(q) - small_r;
}

fn apply_effect(src: vec4<f32>, uv: vec2<f32>) -> vec4<f32> {
  let color = src.rgb;
  let code = u32(round(u.effect.x));
  let amount = u.effect.y;
  if (code == 1u) {
    let inv_mode = u32(round(clamp(u.params0.x, 0.0, 4.0)));
    let inv_threshold = clamp(u.params0.y, 0.0, 1.0);
    let strobe_rate = clamp(u.params0.z, 0.0, 10.0);
    let l = luma(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)));
    var inverted = vec3<f32>(1.0) - color;
    var gate = 1.0;
    if (inv_mode == 1u) {
      // luma-only invert: keep chroma direction, flip brightness
      inverted = clamp(color + vec3<f32>(1.0 - 2.0 * l), vec3<f32>(0.0), vec3<f32>(1.0));
    } else if (inv_mode == 2u) {
      inverted = hue_rotate(color, 3.14159265);
    } else if (inv_mode == 3u) {
      gate = step(0.5, fract(u.resolution_time.z * max(strobe_rate, 0.01)));
    } else if (inv_mode == 4u) {
      gate = smoothstep(inv_threshold, inv_threshold + 0.05, l);
    }
    return vec4<f32>(mix(color, inverted, clamp(amount, 0.0, 1.0) * gate), src.a);
  }
  if (code == 2u) {
    let gray = vec3<f32>(luma(color));
    return vec4<f32>(mix(color, gray, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 3u) {
    return vec4<f32>(color * max(0.0, amount), src.a);
  }
  if (code == 4u) {
    return vec4<f32>((color - vec3<f32>(0.5)) * amount + vec3<f32>(0.5), src.a);
  }
  if (code == 5u) {
    let g_sh = clamp(p_or(u.params0.x, 1.0), 0.2, 3.0);
    let g_mid = clamp(p_or(u.params0.y, 1.0), 0.2, 3.0);
    let g_hi = clamp(p_or(u.params0.z, 1.0), 0.2, 3.0);
    let g_mix = clamp(p_or(u.params0.w, 1.0), 0.0, 1.0);
    let l = luma(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)));
    let w_sh = 1.0 - smoothstep(0.0, 0.45, l);
    let w_hi = smoothstep(0.55, 1.0, l);
    let w_mid = max(0.0, 1.0 - w_sh - w_hi);
    let band_gamma = max(0.05, g_sh * w_sh + g_mid * w_mid + g_hi * w_hi);
    let graded = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / max(0.001, amount * band_gamma)));
    return vec4<f32>(mix(color, graded, g_mix), src.a);
  }
  if (code == 6u) {
    let gray = vec3<f32>(luma(color));
    return vec4<f32>(mix(gray, color, amount), src.a);
  }
  if (code == 7u) {
    return vec4<f32>(hue_rotate(color, amount), src.a);
  }
  if (code == 8u) {
    let dither = clamp(u.params0.x, 0.0, 1.0);
    let anim_speed = clamp(u.params0.y, 0.0, 2.0);
    let palette = u32(round(clamp(u.params0.z, 0.0, 3.0)));
    var levels = max(2.0, floor(amount + 0.5));
    if (anim_speed > 0.001) {
      levels = max(2.0, levels + floor(sin(u.resolution_time.z * anim_speed * 2.0) * 2.0 + 0.5));
    }
    var c = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
    if (dither > 0.001) {
      c = clamp(c + vec3<f32>(hash21(uv * u.resolution_time.xy) - 0.5) * (dither / levels), vec3<f32>(0.0), vec3<f32>(1.0));
    }
    var post = floor(c * levels + vec3<f32>(0.5)) / levels;
    if (palette == 1u) {
      // comic: snap to a bold 6-colour set
      var best = vec3<f32>(0.0);
      var best_d = 1e9;
      for (var i = 0u; i < 6u; i = i + 1u) {
        var pc = vec3<f32>(0.0);
        if (i == 1u) { pc = vec3<f32>(1.0); }
        else if (i == 2u) { pc = vec3<f32>(0.9, 0.12, 0.14); }
        else if (i == 3u) { pc = vec3<f32>(1.0, 0.85, 0.1); }
        else if (i == 4u) { pc = vec3<f32>(0.12, 0.3, 0.9); }
        else if (i == 5u) { pc = vec3<f32>(0.95, 0.75, 0.6); }
        let d = dot(post - pc, post - pc);
        if (d < best_d) { best_d = d; best = pc; }
      }
      post = best;
    } else if (palette == 2u) {
      // thermal: luma through a heatmap ramp
      let hl = luma(post);
      var tc = mix(vec3<f32>(0.0, 0.0, 0.35), vec3<f32>(0.0, 0.75, 0.85), smoothstep(0.0, 0.35, hl));
      tc = mix(tc, vec3<f32>(0.2, 0.85, 0.2), smoothstep(0.3, 0.5, hl));
      tc = mix(tc, vec3<f32>(1.0, 0.85, 0.1), smoothstep(0.5, 0.72, hl));
      tc = mix(tc, vec3<f32>(1.0, 0.2, 0.1), smoothstep(0.7, 0.9, hl));
      tc = mix(tc, vec3<f32>(1.0), smoothstep(0.9, 1.0, hl));
      post = floor(tc * levels + vec3<f32>(0.5)) / levels;
    } else if (palette == 3u) {
      // retro 4-colour (Game Boy greens)
      let gl = floor(luma(post) * 3.999);
      var gb = vec3<f32>(0.06, 0.22, 0.06);
      if (gl >= 3.0) { gb = vec3<f32>(0.61, 0.74, 0.06); }
      else if (gl >= 2.0) { gb = vec3<f32>(0.55, 0.67, 0.06); }
      else if (gl >= 1.0) { gb = vec3<f32>(0.19, 0.38, 0.19); }
      post = gb;
    }
    return vec4<f32>(post, src.a);
  }
  if (code == 9u) {
    // NOISE - procedural noise overlay.
    // params0 = (type, blend mode, scale, mono); params1 = (shadow, mid,
    // high, anim speed); params2.x = seed; amount = noiseAmount.
    let noise_amount = clamp(amount, 0.0, 1.0);
    if (noise_amount < 0.001) {
      return src;
    }
    let noise_type = u32(round(clamp(u.params0.x, 0.0, 4.0)));
    let blend_mode = u32(round(clamp(u.params0.y, 0.0, 4.0)));
    let pattern_scale = clamp(u.params0.z, 0.5, 32.0);
    let mono = u.params0.w >= 0.5;
    let shadow_weight = clamp(u.params1.x, 0.0, 1.0);
    let mid_weight = clamp(u.params1.y, 0.0, 1.0);
    let high_weight = clamp(u.params1.z, 0.0, 1.0);
    let anim_speed = max(0.0, u.params1.w);
    let seed = u.params2.x;
    // Quantize animation to 24fps for a filmic flicker.
    var t = 0.0;
    if (anim_speed > 0.001) {
      t = floor(u.resolution_time.z * anim_speed * 24.0) / 24.0;
    }
    let ts = t * 61.7 + seed * 19.0;
    let p = uv * u.resolution_time.xy / max(0.5, 64.0 / pattern_scale)
      + vec2<f32>(seed * 13.7, seed * 7.19);
    let pd = p + vec2<f32>(u.resolution_time.z * anim_speed * 0.6, -u.resolution_time.z * anim_speed * 0.37);
    var n = vec3<f32>(0.0);
    if (noise_type == 0u) {
      if (mono) {
        n = vec3<f32>(hash21(p + vec2<f32>(ts * 1.13, ts * 2.71)) - 0.5);
      } else {
        n = vec3<f32>(
          hash21(p + vec2<f32>(ts * 1.13, ts * 2.71)),
          hash21(p + vec2<f32>(7.0 + ts * 3.31, ts * 1.97)),
          hash21(p + vec2<f32>(ts * 2.17, 17.0 + ts * 4.41))
        ) - vec3<f32>(0.5);
      }
    } else if (noise_type == 1u) {
      // Blue-style: triangular distribution from two whites.
      if (mono) {
        let a = hash21(p + vec2<f32>(ts, ts * 1.7));
        let b = hash21(p + vec2<f32>(1.0 + ts * 0.5, 1.0 + ts * 0.9));
        n = vec3<f32>((a + b) * 0.5 - 0.5);
      } else {
        n = vec3<f32>(
          (hash21(p + vec2<f32>(ts, ts * 1.7)) + hash21(p + vec2<f32>(1.0 + ts * 0.5, 1.0 + ts * 0.9))) * 0.5,
          (hash21(p + vec2<f32>(7.0 + ts * 0.31, 7.0)) + hash21(p + vec2<f32>(8.0, 8.0 + ts * 0.81))) * 0.5,
          (hash21(p + vec2<f32>(17.0 + ts * 0.71, 17.0)) + hash21(p + vec2<f32>(18.0, 18.0 + ts * 0.91))) * 0.5
        ) - vec3<f32>(0.5);
      }
    } else if (noise_type == 2u) {
      if (mono) {
        n = vec3<f32>(value_noise2d(pd) - 0.5);
      } else {
        n = vec3<f32>(
          value_noise2d(pd),
          value_noise2d(pd + vec2<f32>(13.7, 13.7)),
          value_noise2d(pd + vec2<f32>(71.3, 71.3))
        ) - vec3<f32>(0.5);
      }
    } else if (noise_type == 3u) {
      if (mono) {
        n = vec3<f32>(fbm2d(pd) - 0.5);
      } else {
        n = vec3<f32>(
          fbm2d(pd),
          fbm2d(pd + vec2<f32>(13.7, 13.7)),
          fbm2d(pd + vec2<f32>(71.3, 71.3))
        ) - vec3<f32>(0.5);
      }
    } else {
      if (mono) {
        n = vec3<f32>(cellular2d(pd) - 0.5);
      } else {
        n = vec3<f32>(
          cellular2d(pd),
          cellular2d(pd + vec2<f32>(13.7, 13.7)),
          cellular2d(pd + vec2<f32>(71.3, 71.3))
        ) - vec3<f32>(0.5);
      }
    }
    let l = luma(color);
    let shadow_mask = 1.0 - smoothstep(0.0, 0.4, l);
    let mid_mask = 1.0 - abs(l - 0.5) * 2.0;
    let high_mask = smoothstep(0.6, 1.0, l);
    let zone_amp = max(0.0, shadow_mask * shadow_weight + mid_mask * mid_weight + high_mask * high_weight);
    let nn = n * noise_amount * zone_amp;
    // Blend modes 0 (overlay) and 1 (add) are intentionally identical,
    // mirroring the WebGL hero shader.
    var result = color + nn;
    if (blend_mode == 2u) {
      result = color * (vec3<f32>(1.0) + nn);
    } else if (blend_mode == 3u) {
      let n01 = nn + vec3<f32>(0.5);
      result = vec3<f32>(1.0) - (vec3<f32>(1.0) - color) * (vec3<f32>(1.0) - n01 * noise_amount);
    } else if (blend_mode == 4u) {
      result = nn + vec3<f32>(0.5);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 10u) {
    let mode = u32(round(u.params0.x));
    let grid_lines = clamp(u.params0.y, 0.0, 1.0);
    let anim_speed = max(0.0, u.params0.z);
    let anim_amount = clamp(u.params0.w, 0.0, 1.0);
    var size = max(1.0, amount);
    if (anim_speed > 0.001) {
      let w = sin(u.resolution_time.z * anim_speed * 3.14159) * 0.5 + 0.5;
      size = size * mix(1.0 - anim_amount * 0.5, 1.0 + anim_amount, w);
    }
    let pixel_size = max(vec2<f32>(1.0) / u.resolution_time.xy, vec2<f32>(size) / u.resolution_time.xy);
    let cell_id = floor(uv / pixel_size);
    let cell_uv = clamp((cell_id + vec2<f32>(0.5)) * pixel_size, vec2<f32>(0.0), vec2<f32>(1.0));
    let cell_local = clamp((uv - cell_id * pixel_size) / pixel_size, vec2<f32>(0.0), vec2<f32>(1.0));
    let sample0 = textureSampleLevel(source_tex, source_sampler, cell_uv, 0.0);
    var rgb = sample0.rgb;
    if (mode == 1u) {
      rgb = floor(sample0.rgb * vec3<f32>(4.0)) / vec3<f32>(3.0);
    } else if (mode == 2u) {
      let d = cell_local - vec2<f32>(0.5);
      let hex = max(abs(d.x), max(abs(d.y), abs(d.x) * 0.5 + abs(d.y) * 0.866));
      if (hex > 0.5) {
        rgb = vec3<f32>(0.0);
      }
    } else if (mode == 3u) {
      let disc = smoothstep(0.5, 0.45, length(cell_local - vec2<f32>(0.5)));
      rgb = sample0.rgb * disc;
    }
    if (grid_lines > 0.001) {
      let edge = abs(cell_local - vec2<f32>(0.5));
      let on_edge = step(0.46, max(edge.x, edge.y));
      rgb = rgb * mix(1.0, 0.0, on_edge * grid_lines);
    }
    return vec4<f32>(rgb, src.a);
  }
  if (code == 11u) {
    let softness = clamp(u.params0.x, 0.0, 2.0);
    let roundness = clamp(u.params0.y, 0.0, 1.0);
    let shape = u32(round(clamp(u.params0.z, 0.0, 3.0)));
    let aspect = max(0.0001, u.params0.w);
    let center = clamp(u.params1.xy, vec2<f32>(-2.0), vec2<f32>(3.0));
    let tint_amount = clamp(u.params1.z, 0.0, 1.0);
    let breathing = clamp(u.params1.w, 0.0, 1.0);
    let breath_speed = clamp(p_or(u.params2.w, 0.5), 0.0, 2.0);
    let breath = sin(u.resolution_time.z * breath_speed * 6.28318) * 0.5 + 0.5;
    let effective_size = amount - breathing * 0.15 * (breath - 0.5);
    let pos = uv - center;
    var dist = 1.0;
    if (shape == 0u) {
      let rect_dist = max(abs(pos.x), abs(pos.y)) * 2.0;
      let circ_dist = length(pos) * 2.0;
      dist = mix(rect_dist, circ_dist, roundness);
    } else if (shape == 1u) {
      dist = length(vec2<f32>(pos.x / aspect, pos.y)) * 2.0;
    } else if (shape == 2u) {
      dist = max(abs(pos.x), abs(pos.y)) * 2.0;
    } else {
      let q = vec2<f32>(pos.x / aspect, pos.y) * 2.0;
      dist = pow(pow(abs(q.x), 4.0) + pow(abs(q.y), 4.0), 0.25);
    }
    let vignette = 1.0 - smoothstep(effective_size - softness * 0.5, effective_size + softness * 0.5, dist);
    let tint = clamp(vec3<f32>(u.params2.x, u.params2.y, u.params2.z), vec3<f32>(0.0), vec3<f32>(1.0));
    let final_rgb = mix(src.rgb, tint, (1.0 - vignette) * tint_amount);
    let final_alpha = src.a * mix(vignette, 1.0, tint_amount);
    return vec4<f32>(final_rgb, final_alpha);
  }
  if (code == 12u) {
    let angle = u.params0.x * 0.01745329252;
    let mode = u32(round(clamp(u.params0.y, 0.0, 4.0)));
    let center = clamp(u.params0.zw, vec2<f32>(0.0), vec2<f32>(1.0));
    let prism = clamp(u.params1.x, 0.0, 3.0);
    let px = max(vec2<f32>(1.0), u.resolution_time.xy);
    var dir = vec2<f32>(cos(angle), sin(angle));
    if (mode == 1u || mode == 2u) {
      let radial = uv - center;
      dir = normalize(radial + vec2<f32>(0.0001));
    } else if (mode == 3u) {
      let lum = luma(color);
      dir = normalize((uv - center) * (lum * 2.0 - 1.0) + vec2<f32>(0.0001));
    } else if (mode == 4u) {
      let tx = effect_texel();
      let gx = luma(sample_rgb(uv + vec2<f32>(tx.x, 0.0))) - luma(sample_rgb(uv - vec2<f32>(tx.x, 0.0)));
      let gy = luma(sample_rgb(uv + vec2<f32>(0.0, tx.y))) - luma(sample_rgb(uv - vec2<f32>(0.0, tx.y)));
      dir = normalize(vec2<f32>(gx, gy) + vec2<f32>(0.0001));
    }
    let spread = (amount * (1.0 + prism * 0.35)) / px;
    let off = dir * spread;
    let r = sample_rgb(uv + off).r;
    let g = sample_rgb(uv + off * 0.15).g;
    let b = sample_rgb(uv - off).b;
    return vec4<f32>(vec3<f32>(r, g, b), src.a);
  }
  if (code == 13u) {
    let count = max(1.0, u.params0.x);
    let speed = u.params0.y;
    let phosphor = clamp(u.params0.z, 0.0, 1.0);
    let rolling = clamp(u.params0.w, 0.0, 1.0);
    let curvature = clamp(u.params1.x, 0.0, 1.0);
    let interlace = clamp(u.params1.y, 0.0, 1.0);
    let p = uv * 2.0 - vec2<f32>(1.0);
    let curve_uv = clamp(uv + p * dot(p, p) * curvature * 0.08, vec2<f32>(0.0), vec2<f32>(1.0));
    var rgb = mix(color, sample_rgb(curve_uv), step(0.001, curvature));
    let scanline = sin((curve_uv.y * count + u.resolution_time.z * speed * 50.0) * 3.14159265) * 0.5 + 0.5;
    rgb *= 1.0 - clamp(amount, 0.0, 1.0) * scanline * 0.52;
    if (phosphor > 0.001) {
      let stripe = fract(curve_uv.x * u.resolution_time.x / 3.0);
      let mask = vec3<f32>(
        smoothstep(0.00, 0.18, stripe) * (1.0 - smoothstep(0.31, 0.39, stripe)),
        smoothstep(0.31, 0.40, stripe) * (1.0 - smoothstep(0.63, 0.72, stripe)),
        smoothstep(0.64, 0.73, stripe),
      );
      rgb *= mix(vec3<f32>(1.0), mask * 1.45, phosphor);
    }
    if (rolling > 0.001) {
      let bar = 1.0 - smoothstep(0.0, 0.28, abs(fract(curve_uv.y - u.resolution_time.z * 0.18) - 0.5));
      rgb *= 1.0 + bar * rolling * 0.35;
    }
    if (interlace > 0.001) {
      let field = fract((floor(curve_uv.y * u.resolution_time.y) + u.effect.w) * 0.5) * 2.0;
      rgb *= mix(1.0, mix(0.82, 1.08, field), interlace);
    }
    return vec4<f32>(rgb, src.a);
  }
  if (code == 63u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 2.0)));
    let count = max(4.0, u.params0.y);
    let line_width = clamp(u.params0.z, 0.0, 1.0);
    let base_freq = clamp(u.params0.w, 0.0, 1.0) * 40.0;
    let fm_depth = clamp(u.params1.x, 0.0, 1.0);
    let amp_amount = clamp(u.params1.y, 0.0, 1.0);
    let speed = clamp(u.params1.z, 0.0, 2.0);
    let color_mix = clamp(u.params1.w, 0.0, 1.0);
    let invert_lines = u.params2.x > 0.5;
    let lum = luma(color);
    let spacing = 1.0 / count;
    let freq = base_freq + lum * fm_depth * 140.0;
    let amp = spacing * (0.25 + lum * amp_amount * 6.0);
    let phase = u.resolution_time.z * speed * 3.0;
    var coord = uv.y;
    var along = uv.x;
    if (mode == 1u) {
      coord = uv.x;
      along = uv.y;
    } else if (mode == 2u) {
      var centered = uv - vec2<f32>(0.5);
      centered.x *= u.resolution_time.x / max(u.resolution_time.y, 1.0);
      coord = length(centered) * 1.4;
      along = coord;
    }
    let disp = sin(along * freq + phase) * amp;
    let line_pos = (coord + disp) * count;
    let tri = abs(fract1(line_pos) - 0.5);
    let w = mix(0.04, 0.5, line_width);
    let line_mask = (1.0 - smoothstep(w * 0.6, w, tri)) * clamp(amount, 0.0, 1.0);
    let line_col = mix(vec3<f32>(1.0), color, color_mix);
    if (invert_lines) {
      return vec4<f32>(line_col * (1.0 - line_mask), src.a);
    }
    return vec4<f32>(line_col * line_mask, line_mask * src.a);
  }
  if (code == 64u) {
    let tracking = clamp(u.params0.x, 0.0, 1.0);
    let noise_amount = clamp(u.params0.y, 0.0, 1.0);
    let distortion = clamp(u.params0.z, 0.0, 1.0);
    let color_bleed = clamp(u.params0.w, 0.0, 1.0);
    let scanline_amount = clamp(u.params1.x, 0.0, 1.0);
    let head_switch = clamp(u.params1.y, 0.0, 1.0);
    let tape_wobble = clamp(u.params1.z, 0.0, 1.0);
    let dropout = clamp(u.params1.w, 0.0, 1.0);
    let chroma_delay = clamp(u.params2.x, 0.0, 1.0);
    let tracking_jump = clamp(u.params2.y, 0.0, 1.0);
    let saturation = clamp(u.params2.z, 0.0, 1.5);
    let t = u.resolution_time.z;
    var tape_uv = uv;
    let jump_trigger = step(0.985, vhs_hash11(floor(t * 1.3))) * tracking_jump;
    let jump_amount = tracking_jump * 0.08 * (sin(t * 0.7) * 0.5 + 0.5);
    tape_uv.y = fract1(tape_uv.y + jump_amount + jump_trigger * 0.4);
    let wobble = sin(tape_uv.y * 4.0 + t * 1.5) * 0.6 + sin(tape_uv.y * 11.0 + t * 0.7) * 0.4;
    tape_uv.x += wobble * tape_wobble * 0.012;
    var tracking_offset = sin(tape_uv.y * 10.0 + t * 3.0) * tracking * 0.02;
    tracking_offset += step(0.99, vhs_random(vec2<f32>(t * 0.1, tape_uv.y))) * tracking * 0.1;
    tape_uv.x += tracking_offset;
    tape_uv.x += sin(tape_uv.y * 50.0 + t * 10.0) * distortion * 0.003;
    tape_uv.y += sin(tape_uv.x * 30.0 + t * 8.0) * distortion * 0.002;
    let head_band = smoothstep(0.06, 0.0, tape_uv.y);
    let head_tear = (vhs_random(vec2<f32>(floor(tape_uv.y * 200.0), floor(t * 30.0))) - 0.5) * head_band * head_switch * 0.06;
    tape_uv.x += head_tear;
    let bleed_amount = color_bleed * 0.005;
    let chroma_lag = chroma_delay * 0.012;
    var tape_rgb = vec3<f32>(
      sample_clamped(vec2<f32>(tape_uv.x + bleed_amount + chroma_lag, tape_uv.y)).r,
      sample_clamped(tape_uv).g,
      sample_clamped(vec2<f32>(tape_uv.x - bleed_amount - chroma_lag, tape_uv.y)).b,
    );
    let tape_alpha = sample_clamped(tape_uv).a;
    let dropout_seed = floor(tape_uv.y * u.resolution_time.y * 0.5) + floor(t * 4.0);
    let dropout_hit = step(1.0 - dropout * 0.04, vhs_hash11(dropout_seed));
    if (dropout_hit > 0.5) {
      let dropout_kind = vhs_hash11(dropout_seed + 7.3);
      tape_rgb = mix(tape_rgb, select(vec3<f32>(0.0), vec3<f32>(1.0), dropout_kind > 0.5), 0.85);
    }
    let n = vhs_noise(tape_uv * u.resolution_time.xy * 0.5 + vec2<f32>(t * 100.0));
    tape_rgb += (n - 0.5) * noise_amount * 0.3;
    let scanline = sin(uv.y * u.resolution_time.y * 2.0) * 0.5 + 0.5;
    tape_rgb *= 1.0 - scanline_amount * 0.3 * scanline;
    let tape_luma = dot(tape_rgb, vec3<f32>(0.299, 0.587, 0.114));
    let sat_mix = clamp(1.0 - saturation, 0.0, 1.0);
    tape_rgb = mix(tape_rgb, vec3<f32>(tape_luma), sat_mix * 0.6 + tracking * 0.2);
    return vec4<f32>(mix(color, clamp(tape_rgb, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(amount, 0.0, 1.0)), tape_alpha);
  }
  if (code == 65u) {
    let scale = max(0.1, u.params0.x);
    let speed = clamp(u.params0.y, 0.0, 3.0);
    let palette = u32(round(clamp(u.params0.z, 0.0, 11.0)));
    let source_mix = clamp(u.params0.w, 0.0, 1.0);
    let complexity = clamp(p_or(u.params1.x, 3.0), 1.0, 5.0);
    let p_mode = u32(round(clamp(u.params1.y, 0.0, 2.0)));
    let blend_mode = u32(round(clamp(u.params1.z, 0.0, 4.0)));
    let warp_amt = clamp(u.params1.w, 0.0, 1.0);
    let audio_boost = clamp(u.params2.x, 0.0, 1.5);
    let aspect = u.resolution_time.x / max(u.resolution_time.y, 1.0);
    let p = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0) * scale;
    let t = u.resolution_time.z * speed * (1.0 + audio_boost * 1.2);
    // complexity 3 reproduces the legacy four-term field
    var field =
      sin(p.x * 3.10 + t) +
      sin(p.y * 2.70 - t * 1.13);
    var weight = 2.0;
    if (complexity >= 2.0) {
      field = field + sin((p.x + p.y) * 2.10 + t * 0.71);
      weight = weight + 1.0;
    }
    if (complexity >= 3.0) {
      field = field + sin(length(p) * 4.20 - t * 1.37);
      weight = weight + 1.0;
    }
    if (complexity >= 4.0) {
      field = field + sin(length(p - vec2<f32>(1.3, 0.7)) * 5.10 + t * 0.93);
      weight = weight + 1.0;
    }
    if (complexity >= 5.0) {
      field = field + sin(p.y * 7.90 + sin(p.x * 2.20 + t) * 2.0);
      weight = weight + 1.0;
    }
    let plasma = clamp(field * (0.5 / weight) * (1.0 + audio_boost * 0.4) + 0.5, 0.0, 1.0);
    let plasma_rgb = colorama_palette(plasma, palette, t * 0.04);
    // turbulence warp displaces the source lookup by the field
    var src_col = color;
    if (p_mode >= 1u && warp_amt > 0.001) {
      let warp_off = vec2<f32>(sin(field * 2.3 + t * 0.4), cos(field * 1.7 - t * 0.3)) * warp_amt * 0.06;
      src_col = sample_rgb(clamp(uv + warp_off, vec2<f32>(0.0), vec2<f32>(1.0)));
    }
    var lit = vec3<f32>(0.0);
    if (p_mode == 1u) {
      // warp only: plasma drives displacement, not colour
      lit = src_col;
    } else if (blend_mode == 1u) {
      lit = vec3<f32>(1.0) - (vec3<f32>(1.0) - plasma_rgb) * (vec3<f32>(1.0) - src_col);
    } else if (blend_mode == 2u) {
      lit = plasma_rgb + src_col * source_mix;
    } else if (blend_mode == 3u) {
      let base = src_col;
      lit = mix(
        2.0 * plasma_rgb * base,
        vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - plasma_rgb) * (vec3<f32>(1.0) - base),
        step(vec3<f32>(0.5), base),
      );
    } else if (blend_mode == 4u) {
      lit = plasma_rgb;
    } else {
      lit = plasma_rgb * mix(vec3<f32>(1.0), src_col * 1.65, source_mix);
    }
    lit = clamp(lit, vec3<f32>(0.0), vec3<f32>(1.5));
    return vec4<f32>(mix(color, lit, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 66u) {
    // params0 = (cell px, legacy angle, dot gain, legacy color mode)
    // params1 = (mode 0 grey/1 CMYK/2 spot, dot shape, angle C, angle M)
    // params2 = (angle Y, angle K, drift, -)
    let cell_px = max(2.0, u.params0.x);
    let dot_gain = clamp(u.params0.z, 0.25, 2.0);
    let color_mode = clamp(u.params0.w, 0.0, 1.0);
    let ht_mode = u32(round(clamp(u.params1.x, 0.0, 2.0)));
    let dot_shape = u32(round(clamp(u.params1.y, 0.0, 3.0)));
    let drift = clamp(u.params2.z, 0.0, 2.0) * u.resolution_time.z * 0.12;
    let aa = 1.5 / cell_px;
    let lum = clamp(luma(color), 0.0, 1.0);
    if (ht_mode == 1u) {
      // CMYK: four screens at their own angles, subtractive composite
      let c_rgb = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
      let k_val = 1.0 - max(c_rgb.r, max(c_rgb.g, c_rgb.b));
      let denom = max(1.0 - k_val, 0.001);
      let cov = vec4<f32>(
        (1.0 - c_rgb.r - k_val) / denom,
        (1.0 - c_rgb.g - k_val) / denom,
        (1.0 - c_rgb.b - k_val) / denom,
        k_val,
      );
      var angs = array<f32, 4>(u.params1.z, u.params1.w, u.params2.x, u.params2.y);
      var result = vec3<f32>(1.0);
      for (var i = 0u; i < 4u; i = i + 1u) {
        let ang = angs[i] * 0.01745329252 + drift;
        let pp = rotate2d(uv * u.resolution_time.xy, ang) / cell_px;
        let cc = fract(pp) - vec2<f32>(0.5);
        let coverage = clamp(cov[i], 0.0, 1.0);
        let rad = clamp(sqrt(coverage) * 0.58 * dot_gain, 0.0, 0.75);
        var d = length(cc);
        if (dot_shape == 1u) { d = max(abs(cc.x), abs(cc.y)); }
        else if (dot_shape == 2u) { d = abs(cc.y); }
        else if (dot_shape == 3u) { d = min(abs(cc.x), abs(cc.y)); }
        let mask = 1.0 - smoothstep(rad, rad + aa, d);
        var absorb = vec3<f32>(1.0, 0.0, 0.0);
        if (i == 1u) { absorb = vec3<f32>(0.0, 1.0, 0.0); }
        else if (i == 2u) { absorb = vec3<f32>(0.0, 0.0, 1.0); }
        else if (i == 3u) { absorb = vec3<f32>(1.0); }
        result = result * (vec3<f32>(1.0) - absorb * mask * 0.92);
      }
      return vec4<f32>(mix(color, result, clamp(amount, 0.0, 1.0)), src.a);
    }
    // greyscale / spot: single screen at the K angle (falls back to legacy angle)
    let base_ang = select(u.params0.y, u.params2.y, u.params2.y > 0.001) * 0.01745329252 + drift;
    let pixel_pos = rotate2d(uv * u.resolution_time.xy, base_ang) / cell_px;
    let cell = fract(pixel_pos) - vec2<f32>(0.5);
    let radius = clamp((1.0 - lum) * 0.58 * dot_gain, 0.0, 0.7);
    var d0 = length(cell);
    if (dot_shape == 1u) { d0 = max(abs(cell.x), abs(cell.y)); }
    else if (dot_shape == 2u) { d0 = abs(cell.y); }
    else if (dot_shape == 3u) { d0 = min(abs(cell.x), abs(cell.y)); }
    let dot_mask = 1.0 - smoothstep(radius, radius + aa, d0);
    var paper = mix(vec3<f32>(1.0), color, color_mode);
    var ink = mix(vec3<f32>(0.0), color * 0.35, color_mode);
    if (ht_mode == 2u) {
      // spot colour: ink takes the source hue at full saturation
      let mx = max(color.r, max(color.g, color.b));
      ink = clamp(color / max(mx, 0.001), vec3<f32>(0.0), vec3<f32>(1.0)) * 0.85;
      paper = vec3<f32>(0.98);
    }
    let halftone = mix(paper, ink, dot_mask);
    return vec4<f32>(mix(color, halftone, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 67u) {
    let levels = max(2.0, floor(u.params0.x + 0.5));
    let edge_strength = clamp(u.params0.y, 0.0, 2.0);
    let saturation_boost = clamp(u.params0.z, 0.0, 2.0);
    let edge_threshold = clamp(u.params0.w, 0.0, 1.0);
    let ramp_soft = clamp(u.params1.x, 0.0, 1.0);
    let shadow_band = clamp(u.params1.y, 0.0, 1.0);
    let tx = effect_texel();
    let l = luma(sample_rgb(uv - vec2<f32>(tx.x, 0.0)));
    let r = luma(sample_rgb(uv + vec2<f32>(tx.x, 0.0)));
    let b = luma(sample_rgb(uv - vec2<f32>(0.0, tx.y)));
    let top = luma(sample_rgb(uv + vec2<f32>(0.0, tx.y)));
    let edge = smoothstep(edge_threshold, edge_threshold + 0.25, length(vec2<f32>(r - l, top - b)) * 2.0);
    let gray = vec3<f32>(luma(color));
    let saturated = mix(gray, color, saturation_boost);
    let q = clamp(saturated, vec3<f32>(0.0), vec3<f32>(1.0)) * levels;
    // ramp softness widens the band transitions (0 = hard steps)
    let half_soft = vec3<f32>(max(ramp_soft * 0.5, 0.0001));
    var poster = (floor(q) + smoothstep(vec3<f32>(0.5) - half_soft, vec3<f32>(0.5) + half_soft, fract(q))) / levels;
    if (shadow_band > 0.001) {
      // crush the darkest band toward ink
      let shadow_mask = 1.0 - smoothstep(shadow_band * 0.35, shadow_band, luma(poster));
      poster = poster * (1.0 - shadow_mask * 0.65);
    }
    let toon_rgb = poster * (1.0 - edge * edge_strength * 0.8);
    return vec4<f32>(mix(color, toon_rgb, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 68u) {
    let radius = max(1.0, u.params0.x);
    let edge_sharpness = clamp(u.params0.y, 0.0, 1.0);
    let color_punch = clamp(u.params0.z, 0.0, 1.0);
    let wet = clamp(amount, 0.0, 1.0);
    let tx = effect_texel() * radius;
    var best_mean = color;
    var best_var = 1000000.0;
    for (var q = 0u; q < 4u; q = q + 1u) {
      var dir = vec2<f32>(1.0, 1.0);
      if (q == 0u || q == 2u) {
        dir.x = -1.0;
      }
      if (q >= 2u) {
        dir.y = -1.0;
      }
      var sum = vec3<f32>(0.0);
      var sum_sq = vec3<f32>(0.0);
      var n = 0.0;
      for (var i = 0u; i <= 2u; i = i + 1u) {
        for (var j = 0u; j <= 2u; j = j + 1u) {
          let off = vec2<f32>(f32(i), f32(j)) * dir * tx;
          let c = sample_rgb(uv + off);
          sum += c;
          sum_sq += c * c;
          n += 1.0;
        }
      }
      let mean = sum / n;
      let variance = sum_sq / n - mean * mean;
      let v = variance.r + variance.g + variance.b;
      if (v < best_var) {
        best_var = v;
        best_mean = mean;
      }
    }
    var result = best_mean;
    if (edge_sharpness > 0.001) {
      result = mix(result, result + (result - color) * 0.5, edge_sharpness);
    }
    if (color_punch > 0.001) {
      let lum = luma(result);
      result = mix(vec3<f32>(lum), result, 1.0 + color_punch);
    }
    return vec4<f32>(mix(color, clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), wet), src.a);
  }
  if (code == 14u) {
    let radius = max(0.0, amount);
    if (radius < 0.001) {
      return src;
    }
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let angle = u.params0.y * 0.01745329252;
    let edge_protect = clamp(u.params0.w, 0.0, 1.0);
    let wet = clamp(u.params1.x, 0.0, 1.0);
    let tx = effect_texel();
    var acc = color * 0.22;
    var wsum = 0.22;
    var dir_x = vec2<f32>(tx.x, 0.0);
    var dir_y = vec2<f32>(0.0, tx.y);
    if (mode == 2u) {
      let dir = vec2<f32>(cos(angle), sin(angle));
      dir_x = dir * tx * radius;
      dir_y = -dir_x;
    } else {
      dir_x *= radius;
      dir_y *= radius;
    }
    let diag_a = dir_x + dir_y;
    let diag_b = dir_x - dir_y;
    let samples = array<vec2<f32>, 8>(
      dir_x, -dir_x, dir_y, -dir_y,
      diag_a, -diag_a, diag_b, -diag_b,
    );
    for (var i = 0u; i < 8u; i = i + 1u) {
      let s = sample_rgb(uv + samples[i]);
      let dl = abs(luma(s) - luma(color));
      let edge_w = mix(1.0, 1.0 - smoothstep(0.05, 0.28, dl), edge_protect);
      let diag_w = select(0.095, 0.14, i < 4u);
      acc += s * diag_w * edge_w;
      wsum += diag_w * edge_w;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet), src.a);
  }
  if (code == 15u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let angle = u.params0.y * 0.01745329252;
    let center = clamp(u.params0.zw, vec2<f32>(0.0), vec2<f32>(1.0));
    let edge_falloff = clamp(u.params1.x, 0.0, 1.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    var dir = vec2<f32>(cos(angle), sin(angle));
    let radial = uv - center;
    if (mode == 1u || mode == 2u) {
      dir = normalize(radial + vec2<f32>(0.0001));
    } else if (mode == 3u) {
      dir = normalize(vec2<f32>(radial.x * 0.35 + radial.y, radial.y * 0.35 - radial.x) + vec2<f32>(0.0001));
    }
    let dist = clamp(length(radial) * 1.4142, 0.0, 1.0);
    let edge_gain = mix(1.0, smoothstep(0.05, 1.0, dist), edge_falloff);
    let px_amount = amount * mix(18.0, 40.0, step(2.0, f32(mode))) * edge_gain;
    let off = dir * (px_amount / max(vec2<f32>(1.0), u.resolution_time.xy));
    let shifted = vec3<f32>(
      sample_rgb(uv + off).r,
      sample_rgb(uv).g,
      sample_rgb(uv - off).b,
    );
    return vec4<f32>(mix(color, shifted, wet), src.a);
  }
  if (code == 16u) {
    let intensity = clamp(amount, 0.0, 1.0);
    let speed = max(0.0, u.params0.x);
    let block_size = clamp(u.params0.y, 0.0, 1.0);
    let rgb_split = clamp(u.params0.z, 0.0, 1.0);
    let jitter = clamp(u.params0.w, 0.0, 1.0);
    let vertical_slice = clamp(u.params1.x, 0.0, 1.0);
    let block_hold = clamp(u.params1.y, 0.0, 1.0);
    let tear_chance = clamp(u.params1.z, 0.0, 1.0);
    let freeze_burst = clamp(u.params2.x, 0.0, 1.0);
    var t = floor(u.resolution_time.z * mix(8.0, 28.0, speed) / max(0.08, block_hold + 0.08));
    if (freeze_burst > 0.001) {
      // Burst gate: whole stretches reuse one glitch pattern, then release.
      let gate = step(1.0 - freeze_burst * 0.65, hash21(vec2<f32>(floor(u.resolution_time.z * 0.9), 3.7)));
      t = mix(t, floor(t / 7.0) * 7.0, gate);
    }
    let row_count = mix(12.0, 96.0, 1.0 - block_size);
    let row = floor(uv.y * row_count);
    let block = vec2<f32>(row, t);
    let row_hit = step(1.0 - intensity * 0.45, hash21(block));
    let tear_hit = step(1.0 - tear_chance * intensity, hash21(block + vec2<f32>(19.1, 4.7)));
    let slice_gate = mix(1.0, step(0.5, hash21(vec2<f32>(floor(uv.x * 10.0), t + 3.0))), vertical_slice);
    let shift = (hash21(block + vec2<f32>(2.7, 8.3)) - 0.5) * 0.18 * intensity * row_hit * slice_gate;
    let fine = (value_noise2d(vec2<f32>(uv.y * 160.0, t)) - 0.5) * 0.025 * jitter * intensity;
    let tear = tear_hit * intensity * 0.08 * sign(hash21(block + vec2<f32>(7.0, 11.0)) - 0.5);
    let warped_uv = uv + vec2<f32>(shift + fine + tear, 0.0);
    let split = rgb_split * intensity * (0.004 + row_hit * 0.018 + tear_hit * 0.04);
    let r = sample_rgb(warped_uv + vec2<f32>(split, 0.0)).r;
    let g = sample_rgb(warped_uv).g;
    let b = sample_rgb(warped_uv - vec2<f32>(split, 0.0)).b;
    var rgb = vec3<f32>(r, g, b);
    let block_noise = (hash21(floor(warped_uv * vec2<f32>(24.0, row_count)) + vec2<f32>(t)) - 0.5) * intensity * row_hit;
    rgb += block_noise * vec3<f32>(0.22, -0.04, 0.18);
    return vec4<f32>(mix(color, rgb, intensity), src.a);
  }
  if (code == 17u) {
    let rolloff = clamp(u.params0.x, 0.0, 1.0);
    let protect = clamp(u.params0.y, 0.0, 1.0);
    let gain = pow(2.0, amount);
    let exposed = color * gain;
    let compressed = exposed / (vec3<f32>(1.0) + exposed * rolloff);
    let highlight = smoothstep(0.55, 1.05, luma(color));
    let protected_color = mix(exposed, compressed, rolloff);
    return vec4<f32>(mix(protected_color, color, protect * highlight), src.a);
  }
  if (code == 18u) {
    let skin_protect = clamp(u.params0.x, 0.0, 1.0);
    let highlight_protect = clamp(u.params0.y, 0.0, 1.0);
    let ceiling = max(0.05, u.params0.z);
    let gray = vec3<f32>(luma(color));
    let maxc = max(color.r, max(color.g, color.b));
    let minc = min(color.r, min(color.g, color.b));
    let sat = clamp((maxc - minc) / max(0.001, maxc), 0.0, 1.0);
    let warm_skin = smoothstep(0.25, 0.75, color.r - color.b) * smoothstep(0.08, 0.45, color.g);
    let high = smoothstep(0.62, 1.05, luma(color));
    let protect = (1.0 - skin_protect * warm_skin) * (1.0 - highlight_protect * high);
    let boost = amount * (1.0 - sat) * protect;
    let vibrant = gray + (color - gray) * (1.0 + boost);
    return vec4<f32>(min(max(vibrant, vec3<f32>(0.0)), vec3<f32>(ceiling)), src.a);
  }
  if (code == 19u) {
    let tint = clamp(u.params0.x, -1.0, 1.0);
    let shadow_temp = clamp(u.params0.y, -1.0, 1.0);
    let highlight_temp = clamp(u.params0.z, -1.0, 1.0);
    let split_tone = clamp(u.params0.w, 0.0, 1.0);
    let auto_cycle = clamp(u.params1.x, 0.0, 1.0);
    let cycle = sin(u.resolution_time.z * 0.18 * 6.28318) * auto_cycle;
    let temp = clamp(amount + cycle, -1.0, 1.0);
    let warmth = vec3<f32>(0.16, 0.055, -0.14);
    let magenta_green = vec3<f32>(0.08, -0.12, 0.08);
    let lum = luma(color);
    let shadow_mask = 1.0 - smoothstep(0.18, 0.58, lum);
    let high_mask = smoothstep(0.45, 0.92, lum);
    let split = warmth * (shadow_temp * shadow_mask + highlight_temp * high_mask) * split_tone;
    let corrected = color + warmth * temp + magenta_green * tint + split;
    return vec4<f32>(max(corrected, vec3<f32>(0.0)), src.a);
  }
  if (code == 20u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 1.0)));
    let radius = max(1.0, u.params0.y);
    let edge_protect = clamp(u.params0.z, 0.0, 1.0);
    let clarity = clamp(u.params0.w, 0.0, 1.0);
    let tx = effect_texel() * radius;
    let north = sample_rgb(uv + vec2<f32>(0.0, tx.y));
    let south = sample_rgb(uv - vec2<f32>(0.0, tx.y));
    let east = sample_rgb(uv + vec2<f32>(tx.x, 0.0));
    let west = sample_rgb(uv - vec2<f32>(tx.x, 0.0));
    let avg = (north + south + east + west) * 0.25;
    let detail = color - avg;
    let edge_weight = mix(1.0, smoothstep(0.015, 0.22, length(detail)), edge_protect);
    var mode_gain = 1.0;
    if (mode == 1u) {
      mode_gain = 0.68;
    }
    let sharpened = color + detail * amount * 2.4 * mode_gain * edge_weight;
    let clarity_rgb = (sharpened - vec3<f32>(0.5)) * (1.0 + clarity * 0.55) + vec3<f32>(0.5);
    return vec4<f32>(clarity_rgb, src.a);
  }
  if (code == 21u) {
    let angle = u.params0.x * 0.01745329252;
    let samples = clamp(u.params0.y, 4.0, 32.0);
    let falloff = clamp(u.params0.z, 0.0, 1.0);
    let center_bias = clamp(u.params0.w, 0.0, 1.0);
    let wet = clamp(u.params1.x, 0.0, 1.0);
    let dir = vec2<f32>(cos(angle), sin(angle));
    let reach = amount * 72.0 / max(u.resolution_time.xy, vec2<f32>(1.0));
    var acc = color * (1.0 + center_bias * 2.0);
    var wsum = 1.0 + center_bias * 2.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
      let fi = f32(i) - 5.5;
      let norm = abs(fi) / 6.0;
      let sample_enabled = step(norm * 12.0, samples);
      let weight = sample_enabled * mix(1.0, 1.0 - norm, falloff);
      let sample_uv = uv + dir * reach * fi / 6.0;
      acc += sample_rgb(sample_uv) * weight;
      wsum += weight;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet), src.a);
  }
  if (code == 22u) {
    let center = clamp(u.params0.xy, vec2<f32>(0.0), vec2<f32>(1.0));
    let samples = clamp(u.params0.z, 4.0, 32.0);
    let falloff = clamp(u.params0.w, 0.0, 1.0);
    let chromatic = clamp(u.params1.x, 0.0, 1.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    let dir = uv - center;
    var acc = color;
    var wsum = 1.0;
    for (var i = 1u; i <= 12u; i = i + 1u) {
      let fi = f32(i);
      let norm = fi / 12.0;
      let sample_enabled = step(norm * 24.0, samples);
      let weight = sample_enabled * mix(1.0, 1.0 - norm, falloff);
      let offset = dir * amount * norm * 0.62;
      let sample_uv = uv - offset;
      var sample_col = sample_rgb(sample_uv);
      if (chromatic > 0.001) {
        let c_off = offset * chromatic * 0.18;
        sample_col = vec3<f32>(
          sample_rgb(sample_uv + c_off).r,
          sample_col.g,
          sample_rgb(sample_uv - c_off).b,
        );
      }
      acc += sample_col * weight;
      wsum += weight;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet), src.a);
  }
  if (code == 23u) {
    let center = clamp(u.params0.xy, vec2<f32>(0.0), vec2<f32>(1.0));
    let samples = clamp(u.params0.z, 4.0, 32.0);
    let falloff = clamp(u.params0.w, 0.0, 1.0);
    let radius_inner = clamp(u.params1.x, 0.0, 1.0);
    let radius_outer = max(radius_inner + 0.001, clamp(u.params1.y, 0.001, 1.5));
    let wet = clamp(u.params1.z, 0.0, 1.0);
    let radial = uv - center;
    let dist = length(radial) * 1.4142;
    let mask = smoothstep(radius_inner, radius_outer, dist);
    var acc = color;
    var wsum = 1.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
      let fi = f32(i) - 5.5;
      let norm = abs(fi) / 6.0;
      let sample_enabled = step(norm * 12.0, samples);
      let weight = sample_enabled * mix(1.0, 1.0 - norm, falloff);
      let angle = amount * mask * fi * 0.14;
      acc += sample_rgb(center + rotate2d(radial, angle)) * weight;
      wsum += weight;
    }
    let blurred = acc / max(0.0001, wsum);
    return vec4<f32>(mix(color, blurred, wet * mask), src.a);
  }
  if (code == 24u) {
    let segments = max(2.0, floor(u.params0.x + 0.5));
    let base_angle = (u.params0.y + u.resolution_time.z * u.params1.w * 45.0) * 0.01745329252;
    let center = clamp(u.params0.zw, vec2<f32>(0.0), vec2<f32>(1.0));
    let zoom = max(0.01, u.params1.x);
    let mode = u32(round(clamp(u.params1.y, 0.0, 2.0)));
    let spiral = clamp(u.params1.z, 0.0, 2.0);
    let p = (uv - center) / zoom;
    let r = length(p);
    var a = atan2(p.y, p.x) + base_angle + r * spiral;
    let seg_angle = 6.28318530718 / segments;
    a = abs((a - floor(a / seg_angle) * seg_angle) - seg_angle * 0.5);
    var sample_uv = center + vec2<f32>(cos(a), sin(a)) * r * zoom;
    if (mode == 1u) {
      sample_uv = fract(sample_uv);
    } else if (mode == 2u) {
      sample_uv = center + rotate2d(sample_uv - center, r * spiral * 2.4);
    }
    let kaleido = sample_rgb(sample_uv);
    return vec4<f32>(mix(color, kaleido, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 25u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let position = clamp(u.params0.y, 0.0, 1.0);
    let offset = (clamp(u.params0.z, 0.0, 1.0) - 0.5) * 0.5;
    let flip_side = u.params0.w > 0.5;
    var sample_uv = uv;
    if (mode == 0u) {
      let on_side = uv.x > position;
      if (on_side != flip_side) {
        sample_uv.x = position - (uv.x - position);
      }
      sample_uv.x += offset;
    } else if (mode == 1u) {
      let on_side = uv.y > position;
      if (on_side != flip_side) {
        sample_uv.y = position - (uv.y - position);
      }
      sample_uv.y += offset;
    } else if (mode == 2u) {
      sample_uv = vec2<f32>(
        position - abs(uv.x - position),
        position - abs(uv.y - position),
      ) + vec2<f32>(offset);
    } else {
      if (uv.x + uv.y > 1.0) {
        sample_uv = vec2<f32>(1.0 - uv.y, 1.0 - uv.x);
      }
      sample_uv += vec2<f32>(offset, -offset);
    }
    let mirrored = sample_rgb(sample_uv);
    return vec4<f32>(mix(color, mirrored, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 26u) {
    let key = clamp(u.params0.xyz, vec3<f32>(0.0), vec3<f32>(1.0));
    let softness = clamp(u.params0.w, 0.0, 1.0);
    let spill = clamp(u.params1.x, 0.0, 1.0);
    let show_matte = u.params1.y > 0.5;
    let mode = u32(round(clamp(u.params1.z, 0.0, 2.0)));
    var dist = 0.0;
    if (mode == 0u) {
      let src_hue = hue_value(color);
      let key_hue = hue_value(key);
      var hue_dist = abs(src_hue - key_hue);
      hue_dist = min(hue_dist, 1.0 - hue_dist);
      dist = hue_dist * 2.0 + (1.0 - saturation_value(color)) * 0.3;
    } else if (mode == 1u) {
      let src_yc = rgb_to_ycbcr(color);
      let key_yc = rgb_to_ycbcr(key);
      dist = length(src_yc.yz - key_yc.yz) * 2.0;
    } else {
      dist = length(color - key);
    }
    let matte = smoothstep(amount, amount + softness + 0.001, dist);
    var result = color;
    if (spill > 0.001) {
      let spill_amount = spill * (1.0 - matte);
      if (key.g >= max(key.r, key.b)) {
        result.g = min(result.g, mix(result.g, (result.r + result.b) * 0.5, spill_amount));
      } else if (key.r >= max(key.g, key.b)) {
        result.r = min(result.r, mix(result.r, (result.g + result.b) * 0.5, spill_amount));
      } else {
        result.b = min(result.b, mix(result.b, (result.r + result.g) * 0.5, spill_amount));
      }
    }
    if (show_matte) {
      return vec4<f32>(vec3<f32>(matte), src.a);
    }
    return vec4<f32>(result, src.a * matte);
  }
  if (code == 27u) {
    let high_cut = max(amount + 0.001, clamp(u.params0.x, 0.0, 1.0));
    let invert = u.params0.y > 0.5;
    let gamma = max(0.001, u.params0.z);
    let show_matte = u.params0.w > 0.5;
    let premultiply = u.params1.x > 0.5;
    var matte = smoothstep(amount, high_cut, luma(color));
    if (invert) {
      matte = 1.0 - matte;
    }
    matte = pow(clamp(matte, 0.0, 1.0), gamma);
    if (show_matte) {
      return vec4<f32>(vec3<f32>(matte), src.a);
    }
    var result = color;
    if (premultiply) {
      result = color * matte;
    }
    return vec4<f32>(result, src.a * matte);
  }
  if (code == 28u) {
    let ref_color = clamp(u.params0.xyz, vec3<f32>(0.0), vec3<f32>(1.0));
    let softness = clamp(u.params0.w, 0.0, 1.0);
    let invert = u.params1.x > 0.5;
    let show_matte = u.params1.y > 0.5;
    let mode = u32(round(clamp(u.params1.z, 0.0, 2.0)));
    let diff = abs(color - ref_color);
    var dist = length(diff);
    if (mode == 1u) {
      dist = diff.r + diff.g + diff.b;
    } else if (mode == 2u) {
      dist = max(diff.r, max(diff.g, diff.b));
    }
    var matte = smoothstep(amount, amount + softness + 0.001, dist);
    if (invert) {
      matte = 1.0 - matte;
    }
    if (show_matte) {
      return vec4<f32>(vec3<f32>(matte), src.a);
    }
    return vec4<f32>(color, src.a * matte);
  }
  if (code == 29u || code == 30u) {
    let radius = clamp(amount, 1.0, 8.0);
    let shape = u32(round(clamp(u.params0.x, 0.0, 2.0)));
    let channel = u32(round(clamp(u.params0.y, 0.0, 4.0)));
    let wet = clamp(u.params0.z, 0.0, 1.0);
    let tx = effect_texel();
    var chosen = src;
    var chosen_value = channel_value(src, channel);
    if (code == 29u) {
      chosen = vec4<f32>(1.0);
      chosen_value = 1.0;
    } else {
      chosen = vec4<f32>(0.0);
      chosen_value = 0.0;
    }
    for (var y = 0u; y < 17u; y = y + 1u) {
      let fy = f32(y) - 8.0;
      let ay = abs(fy);
      for (var x = 0u; x < 17u; x = x + 1u) {
        let fx = f32(x) - 8.0;
        let ax = abs(fx);
        var inside = ax <= radius && ay <= radius;
        if (shape == 0u) {
          inside = ax + ay <= radius + 0.001;
        } else if (shape == 2u) {
          inside = ax * ax + ay * ay <= radius * radius + 0.001;
        }
        if (inside) {
          let sample_col = sample_clamped(uv + vec2<f32>(fx, fy) * tx);
          let sample_value = channel_value(sample_col, channel);
          if (code == 29u) {
            if (sample_value < chosen_value) {
              chosen = sample_col;
              chosen_value = sample_value;
            }
          } else if (sample_value > chosen_value) {
            chosen = sample_col;
            chosen_value = sample_value;
          }
        }
      }
    }
    return vec4<f32>(mix(color, chosen.rgb, wet), mix(src.a, chosen.a, wet));
  }
  if (code == 31u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let waveform = u32(round(clamp(u.params0.y, 0.0, 3.0)));
    let frequency = max(0.01, u.params0.z);
    let speed = clamp(u.params0.w, 0.0, 3.0);
    let phase = u.params1.x * 0.01745329252 + u.resolution_time.z * speed * 6.28318530718;
    let secondary = clamp(u.params1.y, 0.0, 1.0);
    let chroma_split = clamp(u.params1.z, 0.0, 1.0);
    let amp = amount / max(u.resolution_time.xy, vec2<f32>(1.0));
    let centered = uv - vec2<f32>(0.5);
    var offset = vec2<f32>(0.0);
    if (mode == 1u) {
      let signal = wave_signal((uv.x * frequency + phase) * 6.28318530718, waveform);
      let harmonic = wave_signal((uv.x * frequency * 2.0 + phase * 1.37) * 6.28318530718, waveform);
      offset.y = (signal + harmonic * secondary * 0.5) * amp.y;
    } else if (mode == 2u) {
      let r = length(centered);
      let signal = wave_signal((r * frequency + phase) * 6.28318530718, waveform);
      let dir = normalize(centered + vec2<f32>(0.0001, 0.0));
      offset = dir * signal * length(amp) * 0.7;
    } else if (mode == 3u) {
      let r = length(centered);
      let signal = wave_signal((r * frequency + phase) * 6.28318530718, waveform);
      offset = rotate2d(centered, signal * amount * 0.004) - centered;
    } else {
      let signal = wave_signal((uv.y * frequency + phase) * 6.28318530718, waveform);
      let harmonic = wave_signal((uv.y * frequency * 2.0 + phase * 1.37) * 6.28318530718, waveform);
      offset.x = (signal + harmonic * secondary * 0.5) * amp.x;
    }
    let sample_uv = uv + offset;
    var waved = sample_rgb(sample_uv);
    if (chroma_split > 0.001) {
      let chroma_offset = offset * chroma_split * 1.5;
      waved = vec3<f32>(
        sample_rgb(sample_uv + chroma_offset).r,
        waved.g,
        sample_rgb(sample_uv - chroma_offset).b,
      );
    }
    return vec4<f32>(waved, src.a);
  }
  if (code == 32u) {
    let radius = max(0.05, u.params0.x);
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let zoom = max(0.05, u.params0.w);
    let mode = u32(round(clamp(u.params1.x, 0.0, 2.0)));
    let chroma_edge = clamp(u.params1.y, 0.0, 1.0);
    let p = (uv - center) / radius;
    let dist = length(p);
    var strength = amount;
    if (mode == 2u) {
      strength = -abs(amount);
    } else if (mode == 1u) {
      strength = abs(amount);
    }
    let mask = 1.0 - smoothstep(0.92, 1.0, dist);
    let factor = max(0.05, 1.0 + strength * dist * dist);
    let sample_uv = center + p * radius * factor / zoom;
    var fish = sample_rgb(mix(uv, sample_uv, mask));
    if (chroma_edge > 0.001) {
      let edge = smoothstep(0.35, 1.0, dist) * chroma_edge;
      let chroma_dir = normalize(p + vec2<f32>(0.0001, 0.0)) * edge * 0.018;
      fish = vec3<f32>(
        sample_rgb(sample_uv + chroma_dir).r,
        fish.g,
        sample_rgb(sample_uv - chroma_dir).b,
      );
    }
    return vec4<f32>(mix(color, fish, mask), src.a);
  }
  if (code == 33u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let cubic = clamp(u.params0.w, -0.5, 0.5);
    let anamorphic_x = max(0.1, u.params1.x);
    let edge_fade = clamp(u.params1.y, 0.0, 1.0);
    let chroma = clamp(u.params1.z, 0.0, 1.0);
    var p = uv - center;
    p.x *= anamorphic_x;
    let r2 = dot(p, p);
    var k = amount;
    if (mode == 1u) {
      k = -abs(amount);
    } else if (mode == 3u) {
      k = amount * 1.35;
    }
    let factor = max(0.05, 1.0 + k * r2 + cubic * r2 * r2);
    var warped = p * factor;
    warped.x /= anamorphic_x;
    let sample_uv = center + warped;
    let mask = mix(1.0, 1.0 - smoothstep(0.78, 1.15, length(p)), edge_fade);
    var lens = sample_rgb(sample_uv);
    if (chroma > 0.001) {
      let dir = normalize(warped + vec2<f32>(0.0001, 0.0)) * chroma * r2 * 0.035;
      lens = vec3<f32>(
        sample_rgb(sample_uv + dir).r,
        lens.g,
        sample_rgb(sample_uv - dir).b,
      );
    }
    return vec4<f32>(mix(color, lens, clamp(mask, 0.0, 1.0)), src.a);
  }
  if (code == 34u) {
    let radius = max(0.01, u.params0.x);
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let falloff = max(0.1, u.params0.w);
    let speed = clamp(u.params1.x, 0.0, 2.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    let p = uv - center;
    let dist = length(p);
    let influence = pow(1.0 - smoothstep(0.0, radius, dist), falloff);
    let angle = (amount + u.resolution_time.z * speed * 6.28318530718) * influence;
    let twirled = sample_rgb(center + rotate2d(p, angle));
    return vec4<f32>(mix(color, twirled, wet * influence), src.a);
  }
  if (code == 35u) {
    let radius = max(0.01, u.params0.x);
    let center = clamp(u.params0.yz, vec2<f32>(0.0), vec2<f32>(1.0));
    let falloff = max(0.1, u.params0.w);
    let chroma = clamp(u.params1.x, 0.0, 1.0);
    let wet = clamp(u.params1.y, 0.0, 1.0);
    let p = uv - center;
    let dist = length(p);
    let influence = pow(1.0 - smoothstep(0.0, radius, dist), falloff);
    let factor = max(0.05, 1.0 - amount * influence * 0.75);
    let sample_uv = center + p * factor;
    var pinched = sample_rgb(sample_uv);
    if (chroma > 0.001) {
      let dir = normalize(p + vec2<f32>(0.0001, 0.0)) * chroma * influence * 0.02;
      pinched = vec3<f32>(
        sample_rgb(sample_uv + dir).r,
        pinched.g,
        sample_rgb(sample_uv - dir).b,
      );
    }
    return vec4<f32>(mix(color, pinched, wet * influence), src.a);
  }
  if (code == 36u) {
    let threshold = clamp(amount, 0.0, 1.0);
    let thickness = max(0.25, u.params0.x);
    let mode = u32(round(clamp(u.params0.y, 0.0, 3.0)));
    let flags = u32(round(clamp(u.params0.z, 0.0, 3.0)));
    let invert_edges = (flags & 1u) == 1u;
    let edge_only = (flags & 2u) == 2u;
    let edge_tint = clamp(vec3<f32>(u.params0.w, u.params1.x, u.params1.y), vec3<f32>(0.0), vec3<f32>(1.5));
    let tint_edges = clamp(u.params1.z, 0.0, 1.0);
    let glow = clamp(u.params1.w, 0.0, 2.0);
    let tx = effect_texel() * thickness;

    let tl = sample_rgb(uv + vec2<f32>(-tx.x, -tx.y));
    let tc = sample_rgb(uv + vec2<f32>(0.0, -tx.y));
    let tr = sample_rgb(uv + vec2<f32>(tx.x, -tx.y));
    let ml = sample_rgb(uv + vec2<f32>(-tx.x, 0.0));
    let mr = sample_rgb(uv + vec2<f32>(tx.x, 0.0));
    let bl = sample_rgb(uv + vec2<f32>(-tx.x, tx.y));
    let bc = sample_rgb(uv + vec2<f32>(0.0, tx.y));
    let br = sample_rgb(uv + vec2<f32>(tx.x, tx.y));

    let gx_rgb = tr + mr * 2.0 + br - tl - ml * 2.0 - bl;
    let gy_rgb = bl + bc * 2.0 + br - tl - tc * 2.0 - tr;
    let gx_l = luma(gx_rgb);
    let gy_l = luma(gy_rgb);
    var edge_strength = length(vec2<f32>(gx_l, gy_l));
    if (mode == 1u) {
      edge_strength = length(gx_rgb) * 0.58 + length(gy_rgb) * 0.58;
    } else if (mode == 2u) {
      let lap = abs(luma(tl + tc + tr + ml + mr + bl + bc + br - color * 8.0));
      edge_strength = max(edge_strength, lap);
    } else if (mode == 3u) {
      let local_max = max(max(luma(tl), luma(tc)), max(max(luma(tr), luma(ml)), max(max(luma(mr), luma(bl)), max(luma(bc), luma(br)))));
      let local_min = min(min(luma(tl), luma(tc)), min(min(luma(tr), luma(ml)), min(min(luma(mr), luma(bl)), min(luma(bc), luma(br)))));
      edge_strength = max(edge_strength, local_max - local_min);
    }

    let feather = max(0.01, 0.18 / max(1.0, thickness));
    var edge_mask = smoothstep(threshold, threshold + feather, edge_strength);
    if (invert_edges) {
      edge_mask = 1.0 - edge_mask;
    }
    let edge_color = mix(vec3<f32>(edge_mask), edge_tint * edge_mask, tint_edges);
    let glow_color = edge_tint * edge_mask * glow * 0.65;
    if (edge_only) {
      return vec4<f32>(edge_color + glow_color, src.a * edge_mask);
    }
    let composited = mix(color, edge_color + glow_color, edge_mask);
    return vec4<f32>(composited, src.a);
  }
  if (code == 37u) {
    let grain_amount = clamp(amount, 0.0, 1.0);
    let grain_size = max(0.25, u.params0.x);
    let shadow_weight = clamp(u.params0.y, 0.0, 2.0);
    let mid_weight = clamp(u.params0.z, 0.0, 2.0);
    let high_weight = clamp(u.params0.w, 0.0, 2.0);
    let mono = u.params1.x >= 0.5;
    let stock = u32(round(clamp(u.params1.y, 0.0, 3.0)));
    let color_jitter = clamp(u.params1.z, 0.0, 1.0);
    let anim_speed = max(0.0, u.params1.w);
    let lum = luma(color);
    let shadow_mask = 1.0 - smoothstep(0.12, 0.55, lum);
    let mid_mask = 1.0 - smoothstep(0.0, 0.55, abs(lum - 0.5));
    let high_mask = smoothstep(0.48, 0.95, lum);
    let tonal_weight = max(0.0, shadow_mask * shadow_weight + mid_mask * mid_weight + high_mask * high_weight);
    let frame_seed = floor(u.effect.w + u.resolution_time.z * anim_speed * 24.0);
    let cell = floor(uv * u.resolution_time.xy / grain_size);
    let n0 = hash21(cell + vec2<f32>(frame_seed * 1.71, frame_seed * 0.37));
    var grain = n0 - 0.5;
    if (stock == 1u) {
      let fine = hash21(cell * 1.73 + vec2<f32>(frame_seed * 2.11, 19.0)) - 0.5;
      grain = grain * 0.62 + fine * 0.38;
    } else if (stock == 2u) {
      grain = sign(grain) * pow(abs(grain) * 2.0, 1.35) * 0.5;
    } else if (stock == 3u) {
      let coarse = hash21(floor(cell * 0.42) + vec2<f32>(frame_seed, 31.0)) - 0.5;
      grain = grain * 0.48 + coarse * 0.52;
    }
    let strength = grain_amount * tonal_weight * 0.42;
    var grain_rgb = vec3<f32>(grain);
    if (!mono) {
      let nr = hash21(cell + vec2<f32>(frame_seed * 3.1, 7.0)) - 0.5;
      let ng = hash21(cell + vec2<f32>(frame_seed * 4.7, 13.0)) - 0.5;
      let nb = hash21(cell + vec2<f32>(frame_seed * 5.3, 23.0)) - 0.5;
      grain_rgb = mix(vec3<f32>(grain), vec3<f32>(nr, ng, nb), color_jitter);
    }
    let grained = color + grain_rgb * strength;
    return vec4<f32>(max(grained, vec3<f32>(0.0)), src.a);
  }
  if (code == 38u) {
    let tonemap_mix = clamp(amount, 0.0, 1.0);
    let curve = u32(round(clamp(u.params0.x, 0.0, 5.0)));
    let exposure = clamp(u.params0.y, 0.25, 4.0);
    let contrast = clamp(u.params0.z, 0.0, 1.0);
    let gained = max(color * exposure, vec3<f32>(0.0));
    var mapped = tonemap_aces(gained);
    if (curve == 1u) {
      mapped = tonemap_reinhard(gained);
    } else if (curve == 2u) {
      mapped = tonemap_hable(gained);
    } else if (curve == 3u) {
      let gray = vec3<f32>(luma(gained));
      mapped = tonemap_aces(clamp(mix(gained, gray * 1.4, 0.5), vec3<f32>(0.0), vec3<f32>(1.0)));
    } else if (curve == 4u) {
      mapped = pow(tonemap_aces(gained * vec3<f32>(0.95, 0.97, 1.05)), vec3<f32>(1.0 / 1.1));
    } else if (curve == 5u) {
      mapped = gained / (vec3<f32>(1.0) + gained * 0.5);
    }
    if (contrast > 0.001) {
      mapped = mix(mapped, tonemap_scurve(mapped), contrast);
    }
    return vec4<f32>(mix(color, mapped, tonemap_mix), src.a);
  }
  if (code == 39u) {
    let bloom_mix = clamp(amount, 0.0, 1.0);
    let intensity = clamp(u.params0.x, 0.0, 2.0);
    let threshold = clamp(u.params0.y, 0.0, 1.0);
    let knee = clamp(u.params0.z, 0.0, 1.0);
    let radius = clamp(u.params0.w, 0.0, 1.0);
    let anamorphic = clamp(u.params1.x, 0.0, 1.0);
    let tint = clamp(u.params1.yzw, vec3<f32>(0.0), vec3<f32>(1.5));
    let px = effect_texel();
    let base_radius = radius * 9.0 + 1.5;
    let ring1 = bloom_ring_sample(uv, px, base_radius, anamorphic);
    let ring2 = bloom_ring_sample(uv, px, base_radius * 2.2, anamorphic);
    let ring3 = bloom_ring_sample(uv, px, base_radius * 4.5, anamorphic);
    let blurred = ring1 * 0.55 + ring2 * 0.30 + ring3 * 0.15;
    let bloom = bloom_threshold_knee(blurred, threshold, knee) * intensity * tint;
    let composited = vec3<f32>(1.0) - (vec3<f32>(1.0) - color) * (vec3<f32>(1.0) - bloom);
    return vec4<f32>(mix(color, composited, bloom_mix), src.a);
  }
  if (code == 40u) {
    let palette = u32(round(clamp(u.params0.x, 0.0, 11.0)));
    let offset = clamp(u.params0.y, 0.0, 1.0);
    let speed = clamp(u.params0.z, 0.0, 2.0);
    let contrast = clamp(u.params0.w, 0.5, 2.0);
    let bands = clamp(u.params1.x, 0.0, 32.0);
    let audio_react = clamp(u.params1.y, 0.0, 1.0);
    let hue_shift = clamp(u.params1.z, 0.0, 1.0);
    let audio = clamp(u.params1.w, 0.0, 1.5);
    var lum = clamp((luma(color) - 0.5) * contrast + 0.5, 0.0, 1.0);
    if (bands >= 0.5) {
      let steps = floor(bands + 0.5);
      lum = clamp(floor(lum * steps) / max(steps - 1.0, 1.0), 0.0, 1.0);
    }
    let t = lum + offset + u.resolution_time.z * speed + hue_shift + audio * audio_react;
    let palette_color = colorama_palette(t, palette, hue_shift);
    return vec4<f32>(mix(color, palette_color, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 41u) {
    let top = clamp(u.params0.x, 0.0, 1.0);
    let bottom = clamp(u.params0.y, 0.0, 1.0);
    let left = clamp(u.params0.z, 0.0, 1.0);
    let right = clamp(u.params0.w, 0.0, 1.0);
    let softness = clamp(u.params1.x, 0.0, 2.0);
    let feather_gamma = max(0.0001, u.params1.y);
    let matte_preview = u.params1.z > 0.5;
    var alpha = 1.0;
    if (top > 0.0001) {
      alpha *= 1.0 - smoothstep(1.0 - top, 1.0, uv.y);
    }
    if (bottom > 0.0001) {
      alpha *= smoothstep(0.0, bottom, uv.y);
    }
    if (left > 0.0001) {
      alpha *= smoothstep(0.0, left, uv.x);
    }
    if (right > 0.0001) {
      alpha *= 1.0 - smoothstep(1.0 - right, 1.0, uv.x);
    }
    alpha = pow(clamp(alpha, 0.0, 1.0), 1.0 / max(softness + 0.5, 0.1));
    alpha = pow(alpha, feather_gamma) * clamp(amount, 0.0, 1.0);
    if (matte_preview) {
      return vec4<f32>(mix(vec3<f32>(0.0), vec3<f32>(1.0, 0.0, 0.0), 1.0 - alpha), src.a);
    }
    return vec4<f32>(color, src.a * alpha);
  }
  if (code == 42u) {
    let kind = u32(round(clamp(u.params0.x, 0.0, 4.0)));
    let scale = max(0.5, u.params0.y);
    let depth = max(1.0, floor(u.params0.z + 0.5));
    let palette = u32(round(clamp(u.params0.w, 0.0, 5.0)));
    let pixel_lock = u.params1.x > 0.5;
    var cell = uv * u.resolution_time.xy / scale;
    if (pixel_lock) {
      cell = floor(cell);
    }
    let threshold = (dither_threshold(kind, floor(cell), uv, color) - 0.5) * clamp(amount, 0.0, 1.0);
    let levels = max(2.0, pow(2.0, depth));
    var dithered = color + vec3<f32>(threshold / levels);
    dithered = floor(clamp(dithered, vec3<f32>(0.0), vec3<f32>(1.0)) * levels + vec3<f32>(0.5)) / levels;
    dithered = dither_palette_snap(dithered, palette);
    return vec4<f32>(clamp(dithered, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 43u) {
    let thickness = max(0.25, amount);
    let outline_color = clamp(u.params0.xyz, vec3<f32>(0.0), vec3<f32>(1.5));
    let only = u.params0.w > 0.5;
    let glow = clamp(u.params1.x, 0.0, 1.0);
    let position = u32(round(clamp(u.params1.y, 0.0, 2.0)));
    let crawl = clamp(u.params1.z, 0.0, 1.0);
    let alpha_aware = clamp(u.params1.w, 0.0, 1.0);
    let glow_falloff = clamp(p_or(u.params2.x, 1.0), 0.1, 4.0);
    let tx = effect_texel() * thickness;
    let center_value = mix(luma(color), src.a, alpha_aware);
    var edge = 0.0;
    var inside_sum = 0.0;
    var outside_sum = 0.0;
    for (var yy = 0u; yy < 3u; yy = yy + 1u) {
      let fy = f32(yy) - 1.0;
      for (var xx = 0u; xx < 3u; xx = xx + 1u) {
        let fx = f32(xx) - 1.0;
        if (!(xx == 1u && yy == 1u)) {
          let nb4 = sample_clamped(uv + vec2<f32>(fx, fy) * tx);
          let nb = mix(luma(nb4.rgb), nb4.a, alpha_aware);
          let diff = nb - center_value;
          edge += abs(diff);
          if (diff < 0.0) {
            inside_sum += -diff;
          } else {
            outside_sum += diff;
          }
        }
      }
    }
    edge = smoothstep(0.05, 0.15, edge / 8.0);
    if (position == 0u) {
      edge *= smoothstep(0.0, 0.1, outside_sum / 8.0);
    } else if (position == 1u) {
      edge *= smoothstep(0.0, 0.1, inside_sum / 8.0);
    }
    if (crawl > 0.001) {
      let ants = sin((uv.x + uv.y) * 80.0 - u.resolution_time.z * crawl * 6.0) * 0.5 + 0.5;
      edge *= ants;
    }
    var glow_edge = 0.0;
    if (glow > 0.001) {
      for (var gy = 0u; gy < 5u; gy = gy + 1u) {
        let fy = f32(gy) - 2.0;
        for (var gx = 0u; gx < 5u; gx = gx + 1u) {
          let fx = f32(gx) - 2.0;
          let nb4 = sample_clamped(uv + vec2<f32>(fx, fy) * tx * 2.0);
          let nb = mix(luma(nb4.rgb), nb4.a, alpha_aware);
          glow_edge += abs(nb - center_value);
        }
      }
      glow_edge = pow(smoothstep(0.02, 0.1, glow_edge / 24.0), glow_falloff) * glow * 0.7;
    }
    let outline_mask = max(edge, glow_edge);
    let outlined = outline_color * outline_mask;
    if (only) {
      return vec4<f32>(outlined, src.a * outline_mask);
    }
    return vec4<f32>(color + outlined, src.a);
  }
  if (code == 44u) {
    let angle = u.params0.x * 0.01745329252;
    let height = clamp(u.params0.y, 0.0, 4.0);
    let normal_preview = u.params2.x >= 0.5;
    let metallic = clamp(u.params2.y, 0.0, 1.0);
    let highlight = clamp(vec3<f32>(u.params0.z, u.params0.w, u.params1.x), vec3<f32>(0.0), vec3<f32>(1.5));
    let shadow = clamp(u.params1.yzw, vec3<f32>(0.0), vec3<f32>(1.5));
    let tx = effect_texel();
    let l_l = luma(sample_rgb(uv - vec2<f32>(tx.x, 0.0)));
    let l_r = luma(sample_rgb(uv + vec2<f32>(tx.x, 0.0)));
    let l_d = luma(sample_rgb(uv - vec2<f32>(0.0, tx.y)));
    let l_u = luma(sample_rgb(uv + vec2<f32>(0.0, tx.y)));
    let dir = vec2<f32>(cos(angle), sin(angle));
    let dx = (l_r - l_l) * (1.0 + height * 4.0);
    let dy = (l_u - l_d) * (1.0 + height * 4.0);
    let normal = normalize(vec3<f32>(-dx, -dy, 1.0));
    if (normal_preview) {
      return vec4<f32>(normal * 0.5 + vec3<f32>(0.5), src.a);
    }
    let light = normalize(vec3<f32>(dir.x, dir.y, 0.5));
    let diff = max(dot(normal, light), 0.0);
    let along = (l_r - l_l) * dir.x + (l_u - l_d) * dir.y;
    let embossed = clamp(along * amount + 0.5, 0.0, 1.0);
    let spec = pow(diff, mix(18.0, 5.0, metallic)) * mix(0.18, 0.55, metallic);
    let relit = color * mix(0.48, 0.3, metallic) + mix(shadow, highlight, embossed) + vec3<f32>(spec);
    return vec4<f32>(clamp(relit, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 45u) {
    let scan_count = max(32.0, u.params0.x);
    let mask_amount = clamp(u.params0.y, 0.0, 1.0);
    let mask_type = u32(round(clamp(u.params0.z, 0.0, 2.0)));
    let curvature = clamp(u.params0.w, 0.0, 1.0);
    let vignette = clamp(u.params1.x, 0.0, 1.0);
    let glow = clamp(u.params1.y, 0.0, 1.0);
    let rolling = clamp(u.params1.z, 0.0, 1.0);
    let chromatic = clamp(u.params1.w, 0.0, 1.0);
    var crt_uv = uv;
    if (curvature > 0.001) {
      var p = uv * 2.0 - vec2<f32>(1.0);
      let offset = abs(p.yx) / vec2<f32>(6.0, 4.0);
      p = p + p * offset * offset * curvature;
      crt_uv = p * 0.5 + vec2<f32>(0.5);
      if (crt_uv.x < 0.0 || crt_uv.x > 1.0 || crt_uv.y < 0.0 || crt_uv.y > 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, src.a);
      }
    }
    var crt_col = sample_rgb(crt_uv);
    if (chromatic > 0.001) {
      let cd = (crt_uv - vec2<f32>(0.5)) * chromatic * 0.01;
      crt_col = vec3<f32>(
        sample_rgb(crt_uv + cd).r,
        sample_rgb(crt_uv).g,
        sample_rgb(crt_uv - cd).b,
      );
    }
    if (mask_amount > 0.001) {
      let px = crt_uv * u.resolution_time.xy;
      let stripe = fract(px.x / 3.0) * 3.0;
      var mask_col = vec3<f32>(0.62);
      if (stripe < 1.0) {
        mask_col = vec3<f32>(1.4, 0.62, 0.62);
      } else if (stripe < 2.0) {
        mask_col = vec3<f32>(0.62, 1.4, 0.62);
      } else {
        mask_col = vec3<f32>(0.62, 0.62, 1.4);
      }
      if (mask_type == 2u) {
        mask_col *= mix(0.75, 1.0, step(0.5, fract(px.y * 0.5)));
      } else if (mask_type == 1u) {
        mask_col *= 1.0 - step(0.96, fract(px.y * 0.02)) * 0.3;
      }
      crt_col = mix(crt_col, crt_col * mask_col, mask_amount);
    }
    let scan = sin(crt_uv.y * scan_count * 3.14159) * 0.5 + 0.5;
    crt_col *= mix(1.0, scan, clamp(amount, 0.0, 1.0));
    if (glow > 0.001) {
      let tx = effect_texel();
      let g = sample_rgb(crt_uv + vec2<f32>(tx.x, 0.0)) +
        sample_rgb(crt_uv - vec2<f32>(tx.x, 0.0)) +
        sample_rgb(crt_uv + vec2<f32>(0.0, tx.y)) +
        sample_rgb(crt_uv - vec2<f32>(0.0, tx.y));
      crt_col += g * glow * 0.05;
    }
    if (rolling > 0.001) {
      let bar = smoothstep(0.7, 1.0, sin(crt_uv.y * 6.0 - u.resolution_time.z * 1.5));
      crt_col += vec3<f32>(bar * rolling * 0.18);
    }
    if (vignette > 0.001) {
      let d = distance(crt_uv, vec2<f32>(0.5));
      crt_col *= 1.0 - smoothstep(0.3, 0.78, d) * vignette;
    }
    return vec4<f32>(crt_col, src.a);
  }
  if (code == 46u) {
    let palette = u32(round(clamp(u.params0.x, 0.0, 4.0)));
    let shimmer = clamp(u.params0.y, 0.0, 1.0);
    let sensor_noise = clamp(u.params0.z, 0.0, 1.0);
    var thermal_uv = uv;
    if (shimmer > 0.001) {
      let lum0 = luma(color);
      let wobble = sin(uv.y * 60.0 + u.resolution_time.z * 4.0) * 0.5 + sin(uv.x * 35.0 + u.resolution_time.z * 3.0) * 0.5;
      thermal_uv += vec2<f32>(wobble * shimmer * lum0 * 0.006, wobble * shimmer * lum0 * 0.003);
    }
    let thermal_src = sample_clamped(thermal_uv);
    var temp = pow(luma(thermal_src.rgb), 1.0 / max(amount, 0.05));
    if (sensor_noise > 0.001) {
      let band = hash21(vec2<f32>(floor(uv.y * u.resolution_time.y * 0.5), floor(u.resolution_time.z * 8.0)));
      temp = clamp(temp + (band - 0.5) * sensor_noise * 0.18, 0.0, 1.0);
    }
    return vec4<f32>(thermal_palette_native(temp, palette), thermal_src.a);
  }
  if (code == 47u) {
    let noise_amount = clamp(u.params0.x, 0.0, 1.0);
    let vignette = clamp(u.params0.y, 0.0, 1.0);
    let phosphor = u32(round(clamp(u.params0.z, 0.0, 2.0)));
    let bloom = clamp(u.params0.w, 0.0, 2.0);
    let scope_mask = u32(round(clamp(u.params1.x, 0.0, 2.0)));
    let rolling_noise = clamp(u.params1.y, 0.0, 1.0);
    var lum = pow(luma(color), 0.8) * amount;
    var nv = night_vision_tint(lum, phosphor);
    let scanline = sin(uv.y * u.resolution_time.y * 2.0) * 0.5 + 0.5;
    nv *= 0.95 + scanline * 0.05;
    if (rolling_noise > 0.001) {
      let band_y = floor((uv.y + u.resolution_time.z * 0.15) * 80.0);
      let band_rand = hash21(vec2<f32>(band_y, floor(u.resolution_time.z * 4.0)));
      nv += vec3<f32>(band_rand - 0.5) * rolling_noise * 0.4 * vec3<f32>(0.0, 1.0, 0.0);
    }
    if (noise_amount > 0.001) {
      let n = hash21(uv * u.resolution_time.xy + vec2<f32>(u.resolution_time.z * 1000.0));
      nv += vec3<f32>(n - 0.5) * noise_amount * 0.2;
    }
    if (bloom > 0.001) {
      let tx = effect_texel() * (3.0 + bloom * 2.0);
      var glow_sum = 0.0;
      for (var by = 0u; by < 5u; by = by + 1u) {
        let fy = f32(by) - 2.0;
        for (var bx = 0u; bx < 5u; bx = bx + 1u) {
          let fx = f32(bx) - 2.0;
          glow_sum += luma(sample_rgb(uv + vec2<f32>(fx, fy) * tx));
        }
      }
      nv += night_vision_tint(glow_sum / 25.0, phosphor) * bloom * 0.45;
    }
    let dist = distance(uv, vec2<f32>(0.5));
    if (vignette > 0.001) {
      nv *= 1.0 - smoothstep(0.35, 0.78, dist) * vignette;
    }
    if (scope_mask == 1u) {
      nv *= 1.0 - smoothstep(0.47, 0.50, dist);
    } else if (scope_mask == 2u) {
      let circle = 1.0 - smoothstep(0.47, 0.50, dist);
      let cross = 1.0 - min(step(0.005, abs(uv.x - 0.5)), step(0.005, abs(uv.y - 0.5)));
      nv = mix(nv * circle, vec3<f32>(0.0, 1.0, 0.0), cross * 0.35);
    }
    return vec4<f32>(clamp(nv, vec3<f32>(0.0), vec3<f32>(1.5)), src.a);
  }
  if (code == 48u) {
    let threshold = clamp(u.params0.x, 0.0, 1.0);
    let shape_idx = u32(round(clamp(u.params0.y, 0.0, 4.0)));
    let color_idx = u32(round(clamp(u.params0.z, 0.0, 7.0)));
    let thickness = clamp(u.params0.w, 0.25, 8.0);
    let grid_res = max(4.0, floor(u.params1.x + 0.5));
    let flags = u32(round(clamp(u.params1.y, 0.0, 7.0)));
    let trail = clamp(u.params1.z, 0.0, 1.0);
    let min_size = clamp(u.params1.w, 0.0, 1.0);
    let bt_color_mode = u32(round(clamp(u.params2.x, 0.0, 2.0)));
    let bt_fixed_color = clamp(vec3<f32>(u.params2.y, u.params2.z, u.params2.w), vec3<f32>(0.0), vec3<f32>(1.0));
    let marker_scale = clamp(p_or(u.params3.x, 1.0), 0.2, 3.0);
    let bt_blend_mode = u32(round(clamp(u.params3.y, 0.0, 4.0)));
    let aspect = u.resolution_time.x / max(1.0, u.resolution_time.y);
    let pix_w = thickness / max(1.0, u.resolution_time.x);
    let cell_size = 1.0 / grid_res;
    let my_cell = floor(uv * grid_res);
    let show_bbox = (flags & 2u) == 2u;
    let show_center = (flags & 4u) == 4u;
    var overlay = vec3<f32>(0.0);

    for (var dy: i32 = -3; dy <= 3; dy = dy + 1) {
      for (var dx: i32 = -3; dx <= 3; dx = dx + 1) {
        let c_idx = my_cell + vec2<f32>(f32(dx), f32(dy));
        if (c_idx.x < 0.0 || c_idx.y < 0.0 || c_idx.x >= grid_res || c_idx.y >= grid_res) {
          continue;
        }
        let brightness = blob_cell_bright(c_idx, grid_res);
        if (brightness < threshold || !blob_is_peak(c_idx, grid_res, threshold)) {
          continue;
        }
        let center = (c_idx + vec2<f32>(0.5)) / grid_res;
        let blob_r = cell_size * mix(0.25, 0.7, brightness) * (0.6 + thickness * 0.2);
        if (blob_r < min_size * cell_size) {
          continue;
        }
        let pulse = 1.0 + 0.1 * sin(u.resolution_time.z * 3.0 + c_idx.x * 3.7 + c_idx.y * 5.3);
        let r = blob_r * pulse * marker_scale;
        let source_color = sample_rgb(center);
        var track_color = blob_track_color(color_idx, source_color);
        if (bt_color_mode == 1u) {
          track_color = bt_fixed_color;
        } else if (bt_color_mode == 2u) {
          track_color = hue_rotate(vec3<f32>(1.0, 0.25, 0.25), hash21(c_idx) * 6.28318);
        }
        track_color *= mix(1.8, 0.9, brightness);

        var diff = uv - center;
        diff.x *= aspect;
        let dist = length(diff);
        var marker_alpha = 0.0;
        if (shape_idx == 0u) {
          marker_alpha = smoothstep(pix_w, 0.0, abs(dist - r));
        } else if (shape_idx == 1u) {
          let ad = abs(diff);
          let box_dist = max(ad.x - r, ad.y - r);
          marker_alpha = smoothstep(pix_w, 0.0, abs(box_dist));
        } else if (shape_idx == 2u) {
          let k = 1.7320508;
          let e1 = diff.y + r * 0.5;
          let e2 = -0.5 * diff.y + k * 0.5 * diff.x - r * 0.5;
          let e3 = -0.5 * diff.y - k * 0.5 * diff.x - r * 0.5;
          let min_e = min(min(abs(e1), abs(e2)), abs(e3));
          marker_alpha = smoothstep(pix_w * 1.5, 0.0, min_e) * step(dist, r * 2.0);
        } else if (shape_idx == 3u) {
          let diamond_dist = abs(diff.x) + abs(diff.y) - r;
          marker_alpha = smoothstep(pix_w, 0.0, abs(diamond_dist));
        } else {
          let arm_h = smoothstep(pix_w * 1.2, 0.0, abs(diff.y)) * step(dist, r * 1.3);
          let arm_v = smoothstep(pix_w * 1.2, 0.0, abs(diff.x)) * step(dist, r * 1.3);
          let ring = smoothstep(pix_w, 0.0, abs(dist - r * 0.7));
          marker_alpha = max(max(arm_h, arm_v), ring);
        }
        overlay += track_color * marker_alpha;

        if (show_center) {
          let center_dot = smoothstep(pix_w * 3.0, 0.0, dist);
          overlay += track_color * center_dot * 0.9;
        }
        if (show_bbox) {
          let bbox_r = r * 1.6;
          let b_min = center - vec2<f32>(bbox_r / aspect, bbox_r);
          let b_max = center + vec2<f32>(bbox_r / aspect, bbox_r);
          let in_x = step(b_min.x, uv.x) * step(uv.x, b_max.x);
          let in_y = step(b_min.y, uv.y) * step(uv.y, b_max.y);
          let b_l = smoothstep(pix_w * 0.6, 0.0, abs(uv.x - b_min.x)) * in_y;
          let b_r = smoothstep(pix_w * 0.6, 0.0, abs(uv.x - b_max.x)) * in_y;
          let b_t = smoothstep(pix_w * 0.6, 0.0, abs(uv.y - b_max.y)) * in_x;
          let b_b = smoothstep(pix_w * 0.6, 0.0, abs(uv.y - b_min.y)) * in_x;
          overlay += track_color * min(max(max(b_l, b_r), max(b_t, b_b)), 1.0) * 0.5;
        }
        if (trail > 0.01) {
          let line_w = pix_w * mix(2.0, 8.0, clamp((thickness - 0.5) / 4.5, 0.0, 1.0));
          let max_dist = trail * 0.5;
          for (var cy: i32 = -2; cy <= 2; cy = cy + 1) {
            for (var cx: i32 = -2; cx <= 2; cx = cx + 1) {
              if ((cx == 0 && cy == 0) || cy < 0 || (cy == 0 && cx < 0)) {
                continue;
              }
              let other_cell = c_idx + vec2<f32>(f32(cx), f32(cy));
              if (other_cell.x < 0.0 || other_cell.y < 0.0 || other_cell.x >= grid_res || other_cell.y >= grid_res) {
                continue;
              }
              let other_b = blob_cell_bright(other_cell, grid_res);
              if (other_b < threshold || !blob_is_peak(other_cell, grid_res, threshold)) {
                continue;
              }
              let other_center = (other_cell + vec2<f32>(0.5)) / grid_res;
              let ab = other_center - center;
              let ab_len = length(ab * vec2<f32>(aspect, 1.0));
              if (ab_len > max_dist || ab_len < 0.001) {
                continue;
              }
              let pa = uv - center;
              let t = clamp(dot(pa, ab) / max(0.00001, dot(ab, ab)), 0.0, 1.0);
              let closest = center + ab * t;
              let ld = length((uv - closest) * vec2<f32>(aspect, 1.0));
              let fade = 1.0 - ab_len / max_dist;
              let dash = step(0.4, fract(t * 8.0 + u.resolution_time.z * 2.0));
              overlay += track_color * smoothstep(line_w, 0.0, ld) * fade * dash * 0.7;
            }
          }
        }
      }
    }
    let o_clamped = clamp(overlay, vec3<f32>(0.0), vec3<f32>(1.0));
    let o_mask = clamp(length(overlay) * 2.0, 0.0, 1.0);
    var blended = color + overlay;
    if (bt_blend_mode == 1u) {
      blended = vec3<f32>(1.0) - (vec3<f32>(1.0) - color) * (vec3<f32>(1.0) - o_clamped);
    } else if (bt_blend_mode == 2u) {
      blended = mix(color, color * o_clamped, o_mask);
    } else if (bt_blend_mode == 3u) {
      let over = mix(
        2.0 * color * o_clamped,
        vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - color) * (vec3<f32>(1.0) - o_clamped),
        step(vec3<f32>(0.5), color),
      );
      blended = mix(color, over, o_mask);
    } else if (bt_blend_mode == 4u) {
      blended = mix(color, o_clamped, o_mask);
    }
    let final_rgb = mix(color, blended, clamp(amount, 0.0, 1.0));
    let overlay_presence = step(0.001, length(overlay));
    return vec4<f32>(final_rgb, max(src.a, overlay_presence * clamp(amount, 0.0, 1.0)));
  }
  if (code == 49u) {
    let threshold = clamp(u.params0.x, 0.0, 1.0);
    let style = u32(round(clamp(u.params0.y, 0.0, 2.0)));
    let color_idx = u32(round(clamp(u.params0.z, 0.0, 7.0)));
    let thickness = clamp(u.params0.w, 0.25, 8.0);
    let flags = u32(round(clamp(u.params1.y, 0.0, 7.0)));
    let glow = clamp(u.params1.z, 0.0, 1.0);
    let levels = max(1.0, floor(clamp(u.params1.w, 0.0, 1.0) * 20.0 + 0.5));
    let tx = effect_texel();
    let tl = luma(sample_rgb(uv + vec2<f32>(-tx.x, tx.y)));
    let t = luma(sample_rgb(uv + vec2<f32>(0.0, tx.y)));
    let tr = luma(sample_rgb(uv + vec2<f32>(tx.x, tx.y)));
    let l = luma(sample_rgb(uv + vec2<f32>(-tx.x, 0.0)));
    let c = luma(color);
    let r = luma(sample_rgb(uv + vec2<f32>(tx.x, 0.0)));
    let bl = luma(sample_rgb(uv + vec2<f32>(-tx.x, -tx.y)));
    let b = luma(sample_rgb(uv + vec2<f32>(0.0, -tx.y)));
    let br = luma(sample_rgb(uv + vec2<f32>(tx.x, -tx.y)));
    let gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    let gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    let edge = sqrt(gx * gx + gy * gy);
    let line_w = thickness * 0.3 * tx.x * 0.5;
    var contour = 0.0;
    for (var i = 1u; i <= 20u; i = i + 1u) {
      let fi = f32(i);
      let enabled = step(fi, levels);
      let level_value = fi / (levels + 1.0);
      let dist = abs(c - level_value);
      var line = 0.0;
      if (style == 0u) {
        line = smoothstep(line_w, 0.0, dist);
      } else if (style == 1u) {
        line = step(dist, line_w);
      } else {
        let dash_phase = fract(uv.x * u.resolution_time.x * 0.05 + u.resolution_time.z * 2.0);
        line = smoothstep(line_w, 0.0, dist) * step(0.4, dash_phase);
      }
      contour = max(contour, line * enabled);
    }
    let edge_line = smoothstep(threshold * 0.5, threshold, edge);
    contour = max(contour * 0.8, edge_line * 0.6);
    let track_color = blob_track_color(color_idx, color);
    var overlay = track_color * contour * (1.0 + glow * 2.0 * contour);
    if ((flags & 1u) == 1u) {
      let cell_uv = fract(uv * 20.0);
      let grid_line = 1.0 - smoothstep(0.0, 0.04, min(min(cell_uv.x, cell_uv.y), min(1.0 - cell_uv.x, 1.0 - cell_uv.y)));
      overlay += track_color * grid_line * 0.12;
    }
    let final_rgb = mix(color, color + overlay, clamp(amount, 0.0, 1.0));
    let overlay_presence = step(0.001, contour + length(overlay));
    return vec4<f32>(final_rgb, max(src.a, overlay_presence * clamp(amount, 0.0, 1.0)));
  }
  if (code == 50u) {
    let threshold = clamp(u.params0.x, 0.0, 1.0);
    let style = u32(round(clamp(u.params0.y, 0.0, 2.0)));
    let palette = u32(round(clamp(u.params0.z, 0.0, 3.0)));
    let thickness = clamp(u.params0.w, 0.25, 8.0);
    let grid_res = max(4.0, floor(u.params1.x + 0.5));
    let flags = u32(round(clamp(u.params1.y, 0.0, 7.0)));
    let cell_idx = floor(uv * grid_res);
    let cell_center = (cell_idx + vec2<f32>(0.5)) / grid_res;
    let cell_b = luma(sample_rgb(cell_center));
    var intensity = smoothstep(threshold * 0.5, threshold + 0.3, cell_b);
    if (style == 1u) {
      intensity = floor(intensity * 8.0) / 8.0;
    }
    var heat = blob_heat_color(intensity, palette);
    if (style >= 2u) {
      heat += vec3<f32>(hash21(uv * u.resolution_time.xy + vec2<f32>(u.resolution_time.z)) * 0.05);
    }
    heat *= intensity;
    let cell_uv = fract(uv * grid_res);
    var overlay = heat;
    if ((flags & 2u) == 2u) {
      let lw = thickness * 0.002;
      let grid_overlay = min(
        step(cell_uv.x, lw) + step(1.0 - lw, cell_uv.x) + step(cell_uv.y, lw) + step(1.0 - lw, cell_uv.y),
        1.0,
      ) * 0.3;
      overlay += blob_heat_color(1.0, palette) * grid_overlay;
    }
    if ((flags & 4u) == 4u && intensity > 0.8) {
      let cu = cell_uv - vec2<f32>(0.5);
      var peak = smoothstep(0.003, 0.0, abs(length(cu) - 0.15));
      peak += smoothstep(0.003, 0.0, abs(cu.x)) * step(abs(cu.y), 0.2);
      peak += smoothstep(0.003, 0.0, abs(cu.y)) * step(abs(cu.x), 0.2);
      overlay += blob_heat_color(1.0, palette) * peak * 0.8;
    }
    let final_rgb = mix(color, overlay, clamp(amount, 0.0, 1.0));
    let overlay_presence = step(0.001, length(overlay));
    return vec4<f32>(final_rgb, max(src.a, overlay_presence * clamp(amount, 0.0, 1.0)));
  }
  if (code == 51u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let focus_y = clamp(u.params0.y, 0.0, 1.0);
    let focus_x = clamp(u.params0.z, 0.0, 1.0);
    let band = max(0.001, u.params0.w);
    let falloff = max(0.001, u.params1.x);
    let max_blur = clamp(u.params1.y, 0.0, 1.0);
    let angle = u.params1.z * 0.01745329252;
    let saturation = clamp(u.params1.w, 0.0, 2.0);
    var blur_mask = 0.0;
    if (mode == 0u) {
      blur_mask = smoothstep(band * 0.5, band * 0.5 + falloff, abs(uv.y - focus_y));
    } else if (mode == 1u) {
      blur_mask = smoothstep(band * 0.5, band * 0.5 + falloff, abs(uv.x - focus_x));
    } else if (mode == 2u) {
      blur_mask = smoothstep(band * 0.5, band * 0.5 + falloff, length(uv - vec2<f32>(focus_x, focus_y)));
    } else {
      let dir = vec2<f32>(cos(angle), sin(angle));
      let t = abs(dot(uv - vec2<f32>(focus_x, focus_y), dir));
      blur_mask = smoothstep(band * 0.5, band * 0.5 + falloff, t);
    }
    let radius = blur_mask * max_blur * 14.0;
    let tx = effect_texel() * radius;
    var acc = color * 0.22;
    var wsum = 0.22;
    let offsets = array<vec2<f32>, 12>(
      vec2<f32>( 1.0,  0.0), vec2<f32>(-1.0,  0.0),
      vec2<f32>( 0.0,  1.0), vec2<f32>( 0.0, -1.0),
      vec2<f32>( 0.7,  0.7), vec2<f32>(-0.7,  0.7),
      vec2<f32>( 0.7, -0.7), vec2<f32>(-0.7, -0.7),
      vec2<f32>( 1.6,  0.0), vec2<f32>(-1.6,  0.0),
      vec2<f32>( 0.0,  1.6), vec2<f32>( 0.0, -1.6),
    );
    for (var i = 0u; i < 12u; i = i + 1u) {
      let weight = select(0.055, 0.095, i < 8u);
      acc += sample_rgb(uv + offsets[i] * tx) * weight;
      wsum += weight;
    }
    var blurred = acc / max(0.0001, wsum);
    let gray = vec3<f32>(luma(blurred));
    blurred = mix(gray, blurred, saturation);
    return vec4<f32>(mix(color, blurred, blur_mask * clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 52u) {
    let radius = max(0.0, u.params0.x);
    let threshold = clamp(u.params0.y, 0.0, 1.0);
    let tint = clamp(u.params0.zw, vec2<f32>(0.0), vec2<f32>(1.5));
    let tint_b = clamp(u.params1.x, 0.0, 1.5);
    let mode = u32(round(clamp(u.params1.y, 0.0, 2.0)));
    let wet = clamp(u.params1.z, 0.0, 1.0);
    let tx = effect_texel();
    let r = radius * mix(0.35, 1.1, clamp(amount * 0.5, 0.0, 1.0));
    var bleed = bloom_threshold_knee(color, threshold, 0.18) * 0.20;
    var wsum = 0.20;
    let offsets = array<vec2<f32>, 12>(
      vec2<f32>( 1.0,  0.0), vec2<f32>(-1.0,  0.0),
      vec2<f32>( 0.0,  1.0), vec2<f32>( 0.0, -1.0),
      vec2<f32>( 0.7,  0.7), vec2<f32>(-0.7,  0.7),
      vec2<f32>( 0.7, -0.7), vec2<f32>(-0.7, -0.7),
      vec2<f32>( 1.7,  0.0), vec2<f32>(-1.7,  0.0),
      vec2<f32>( 0.0,  1.7), vec2<f32>( 0.0, -1.7),
    );
    for (var i = 0u; i < 12u; i = i + 1u) {
      let weight = select(0.055, 0.095, i < 8u);
      bleed += bloom_threshold_knee(sample_rgb(uv + offsets[i] * tx * r), threshold, 0.18) * weight;
      wsum += weight;
    }
    bleed = (bleed / max(0.0001, wsum)) * vec3<f32>(tint.x, tint.y, tint_b) * amount * 1.7;
    var result = color + bleed;
    if (mode == 0u) {
      result = vec3<f32>(1.0) - (vec3<f32>(1.0) - color) * (vec3<f32>(1.0) - bleed);
    } else if (mode == 2u) {
      let a = 2.0 * color * bleed + color * color * (vec3<f32>(1.0) - 2.0 * bleed);
      let b = sqrt(max(color, vec3<f32>(0.0))) * (2.0 * bleed - vec3<f32>(1.0)) + 2.0 * color * (vec3<f32>(1.0) - bleed);
      result = mix(a, b, step(vec3<f32>(0.5), bleed));
    }
    return vec4<f32>(mix(color, result, wet), src.a);
  }
  if (code == 53u) {
    let streak_len = clamp(u.params0.x, 0.0, 1.0);
    let threshold = clamp(u.params0.y, 0.0, 1.0);
    let tint = clamp(vec3<f32>(u.params0.z, u.params0.w, u.params1.x), vec3<f32>(0.0), vec3<f32>(1.5));
    let angle = u.params1.y * 0.01745329252;
    let samples = max(8.0, floor(clamp(u.params1.z, 8.0, 64.0) + 0.5));
    let wet = clamp(u.params1.w, 0.0, 1.0);
    let dir = vec2<f32>(cos(angle), sin(angle));
    var streak = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var i: i32 = -64; i <= 64; i = i + 1) {
      let fi = f32(i);
      if (abs(fi) > samples) {
        continue;
      }
      let t = fi / samples;
      let s = sample_rgb(uv + dir * t * streak_len);
      let gate = smoothstep(threshold, threshold + 0.15, luma(s));
      let weight = exp(-abs(t) * 2.0);
      streak += s * gate * weight;
      wsum += weight;
    }
    streak = (streak / max(0.0001, wsum)) * tint * amount;
    let result = vec3<f32>(1.0) - (vec3<f32>(1.0) - color) * (vec3<f32>(1.0) - streak);
    return vec4<f32>(mix(color, result, wet), src.a);
  }
  if (code == 54u) {
    let scale = max(1.0, u.params0.x);
    let speed = max(0.0, u.params0.y);
    let direction_y = clamp(u.params0.z, -1.0, 1.0);
    let turbulence = clamp(u.params0.w, 0.0, 1.0);
    let mode = u32(round(clamp(u.params1.x, 0.0, 2.0)));
    let focus_y = clamp(u.params1.y, 0.0, 1.0);
    let focus_band = max(0.05, u.params1.z);
    var p = uv * scale + vec2<f32>(0.0, -u.resolution_time.z * speed * 0.5);
    p.y += direction_y * u.resolution_time.z * speed * 0.3;
    let n0 = value_noise2d(p) - 0.5;
    let n1 = value_noise2d(p * mix(1.0, 2.25, turbulence) + vec2<f32>(123.4, 56.7)) - 0.5;
    var nx = mix(n0, n0 + n1 * 0.5, turbulence);
    var ny = mix(n1, n1 + n0 * 0.35, turbulence);
    var strength = amount * 0.055;
    if (mode == 0u) {
      ny *= 0.4;
      let band_mask = exp(-pow((uv.y - focus_y) / focus_band, 2.0));
      strength *= band_mask;
    } else if (mode == 1u) {
      let wave = sin(u.resolution_time.z * speed + uv.y * 8.0) * 0.5;
      nx *= 1.0 + wave * 0.5;
      ny *= 1.0 + wave * 0.5;
    } else {
      nx = nx * 0.65 + sin((uv.y + u.resolution_time.z * speed) * 40.0) * 0.18;
      ny = ny * 0.35;
    }
    let warped = clamp(uv + vec2<f32>(nx, ny) * strength, vec2<f32>(0.0), vec2<f32>(1.0));
    return sample_clamped(warped);
  }
  if (code == 55u) {
    let contrast = clamp(u.params0.x, 0.0, 1.0);
    let toe = clamp(u.params0.y, 0.0, 1.0);
    let shoulder = clamp(u.params0.z, 0.0, 1.0);
    let black_crush = clamp(u.params0.w, 0.0, 1.0);
    var graded = color;
    if (black_crush > 0.001) {
      let threshold = black_crush * 0.15;
      graded = max(graded - vec3<f32>(threshold), vec3<f32>(0.0)) / max(1.0 - threshold, 0.001);
    }
    let t = smoothstep(vec3<f32>(0.0), vec3<f32>(1.0), graded);
    let s_curve = t * t * (vec3<f32>(3.0) - vec3<f32>(2.0) * t);
    graded = mix(graded, s_curve, contrast);
    if (toe > 0.001) {
      graded = pow(max(graded, vec3<f32>(0.0)), vec3<f32>(1.0 - toe * 0.5));
    }
    if (shoulder > 0.001) {
      let sho = vec3<f32>(1.0) - exp(-graded * (1.0 + shoulder * 2.0));
      graded = mix(graded, sho, shoulder);
    }
    return vec4<f32>(mix(color, graded, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 56u) {
    let target_hue = fract1(u.params0.x);
    let hue_range = clamp(u.params0.y, 0.0, 1.0);
    let feather = clamp(u.params0.z, 0.0, 1.0);
    let mode = u32(round(clamp(u.params0.w, 0.0, 1.0)));
    let replace_hue = fract1(u.params1.x);
    let sat_boost = clamp(u.params1.y, 0.0, 1.0);
    var hsv = rgb_to_hsv(color);
    var hue_dist = abs(hsv.x - target_hue);
    hue_dist = min(hue_dist, 1.0 - hue_dist);
    let band = 1.0 - smoothstep(hue_range, hue_range + feather, hue_dist);
    if (mode == 0u) {
      hsv.y *= mix(0.0, 1.0, band);
      hsv.y = clamp(hsv.y + band * sat_boost * 0.5, 0.0, 1.0);
    } else {
      var hue_delta = replace_hue - target_hue;
      if (hue_delta > 0.5) {
        hue_delta -= 1.0;
      }
      if (hue_delta < -0.5) {
        hue_delta += 1.0;
      }
      hsv.x = fract1(hsv.x + hue_delta * band);
      hsv.y = clamp(hsv.y + band * sat_boost * 0.5, 0.0, 1.0);
    }
    let graded = hsv_to_rgb(hsv);
    return vec4<f32>(mix(color, graded, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 57u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let show_original = clamp(u.params0.y, 0.0, 1.0);
    let midpoint = clamp(u.params0.z, 0.0, 1.0);
    let range = clamp(u.params0.w, 0.0, 0.5);
    let lum = luma(color);
    var fc = false_color_stripes(lum);
    if (mode == 0u) {
      fc = false_color_dit_exposure(lum);
    } else if (mode == 1u) {
      fc = false_color_zone_heat(lum);
    } else if (mode == 2u) {
      fc = false_color_resolve(lum);
    }
    if (range > 0.001) {
      let zone_mask = smoothstep(range, 0.0, abs(lum - midpoint));
      fc = mix(fc, vec3<f32>(0.0, 1.0, 0.0), zone_mask * 0.4);
    }
    let result = mix(color, fc, show_original);
    return vec4<f32>(mix(color, result, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 58u) {
    let threshold = clamp(u.params0.x, 0.0, 1.0);
    let softness = clamp(u.params0.y, 0.0, 1.0);
    let color_recovery = clamp(u.params0.z, 0.0, 1.0);
    let highlight_protect = clamp(u.params0.w, 0.0, 1.0);
    let wet = clamp(u.params1.x, 0.0, 1.0);
    let lum = luma(color);
    let shadow_weight = 1.0 - smoothstep(threshold, threshold + softness + 0.001, lum);
    let lift_pow = mix(1.0, 0.45, clamp(amount, 0.0, 1.0));
    let lifted = pow(max(color, vec3<f32>(0.0001)), vec3<f32>(lift_pow));
    let high_weight = smoothstep(0.7, 1.0, lum);
    let effect_weight = shadow_weight * (1.0 - high_weight * highlight_protect);
    var result = mix(color, lifted, effect_weight);
    if (color_recovery > 0.001) {
      let result_luma = luma(result);
      let boosted = mix(vec3<f32>(result_luma), result, 1.0 + color_recovery * 0.6);
      result = mix(result, boosted, effect_weight);
    }
    return vec4<f32>(mix(color, result, wet), src.a);
  }
  if (code == 59u) {
    let threshold = clamp(u.params0.x, 0.0, 1.0);
    let softness = clamp(u.params0.y, 0.0, 1.0);
    let preserve_hue = clamp(u.params0.z, 0.0, 1.0);
    let max_value = clamp(u.params0.w, 0.7, 1.5);
    let wet = clamp(u.params1.x, 0.0, 1.0);
    let lum = luma(color);
    let weight = smoothstep(threshold - softness, threshold + softness * 0.5 + 0.001, lum);
    let rolled_hue = highlight_rolloff_hue(color, threshold, max_value, clamp(amount, 0.0, 1.0));
    let rolled_rgb = vec3<f32>(
      highlight_rolloff_channel(color.r, threshold, clamp(amount, 0.0, 1.0), weight),
      highlight_rolloff_channel(color.g, threshold, clamp(amount, 0.0, 1.0), weight),
      highlight_rolloff_channel(color.b, threshold, clamp(amount, 0.0, 1.0), weight),
    );
    let result = mix(rolled_rgb, rolled_hue, preserve_hue);
    return vec4<f32>(mix(color, result, wet * weight), src.a);
  }
  if (code == 60u) {
    let shadow = clamp(u.params0.xyz, vec3<f32>(-1.0), vec3<f32>(1.0));
    let preserve_luma = clamp(u.params0.w, 0.0, 1.0);
    let mid = clamp(u.params1.xyz, vec3<f32>(-1.0), vec3<f32>(1.0));
    let high = clamp(u.params2.xyz, vec3<f32>(-1.0), vec3<f32>(1.0));
    let lum = luma(color);
    let shadow_weight = 1.0 - smoothstep(0.0, 0.5, lum);
    let high_weight = smoothstep(0.5, 1.0, lum);
    let mid_weight = 1.0 - shadow_weight - high_weight;
    let shift = shadow * shadow_weight * 0.3 + mid * mid_weight * 0.3 + high * high_weight * 0.3;
    var graded = color + shift;
    if (preserve_luma > 0.001) {
      let new_luma = luma(graded);
      graded += vec3<f32>((lum - new_luma) * preserve_luma);
    }
    return vec4<f32>(mix(color, clamp(graded, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 61u) {
    var lift = clamp(u.params0.xyz, vec3<f32>(-0.5), vec3<f32>(0.5));
    let luma_only = u.params0.w > 0.5;
    var gamma = clamp(u.params1.xyz, vec3<f32>(0.05), vec3<f32>(4.0));
    var gain = clamp(u.params2.xyz, vec3<f32>(0.05), vec3<f32>(4.0));
    if (luma_only) {
      lift = vec3<f32>((lift.r + lift.g + lift.b) / 3.0);
      gamma = vec3<f32>((gamma.r + gamma.g + gamma.b) / 3.0);
      gain = vec3<f32>((gain.r + gain.g + gain.b) / 3.0);
    }
    let lifted = color + lift * (vec3<f32>(1.0) - color) * 0.5;
    let gained = lifted * gain;
    let graded = pow(max(gained, vec3<f32>(0.0)), vec3<f32>(1.0) / max(gamma, vec3<f32>(0.05)));
    return vec4<f32>(mix(color, clamp(graded, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 62u) {
    let rate = max(0.001, u.params0.x);
    let duty = clamp(u.params0.y, 0.0, 1.0);
    let mode = u32(round(clamp(u.params0.z, 0.0, 2.0)));
    let tint = clamp(vec3<f32>(u.params0.w, u.params1.x, u.params1.y), vec3<f32>(0.0), vec3<f32>(1.0));
    let phase = fract1(u.resolution_time.z * rate);
    let gate = step(phase, duty);
    var result = color;
    if (mode == 0u) {
      result = mix(color, color + vec3<f32>(amount * gate), gate);
    } else if (mode == 1u) {
      result = mix(color, vec3<f32>(1.0) - color, gate * amount);
    } else {
      result = mix(color, color * tint + tint * 0.4, gate * amount);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 69u) {
    let radius = max(0.0, amount);
    if (radius < 0.5) {
      return src;
    }
    let samples = clamp(u.params0.x, 8.0, 48.0);
    let bright_weight = clamp(u.params0.y, 0.0, 2.0);
    let threshold = clamp(u.params0.z, 0.0, 1.0);
    let chroma = clamp(u.params0.w, 0.0, 1.0);
    let shape = u32(round(clamp(u.params1.x, 0.0, 2.0)));
    let rot = u.params1.y * 0.01745329252;
    let wet = clamp(u.params1.z, 0.0, 1.0);
    let c = cos(rot);
    let s = sin(rot);
    let texel = effect_texel();
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var i = 0u; i < 48u; i = i + 1u) {
      let fi = f32(i);
      if (fi < samples) {
        let t = fi / max(samples, 1.0);
        let angle = fi * 2.39996323;
        let disc = vec2<f32>(cos(angle), sin(angle)) * sqrt(t);
        let rot_disc = vec2<f32>(disc.x * c - disc.y * s, disc.x * s + disc.y * c);
        let mask = aperture_mask(rot_disc, shape);
        if (mask > 0.5) {
          let off = rot_disc * radius * texel;
          var sample_col = vec3<f32>(0.0);
          if (chroma > 0.001) {
            let dir = normalize(rot_disc + vec2<f32>(0.000001));
            let r_off = radius * (1.0 + chroma * 0.05);
            let b_off = radius * (1.0 - chroma * 0.05);
            sample_col = vec3<f32>(
              sample_rgb(uv + dir * r_off * texel + (off - dir * radius * texel)).r,
              sample_rgb(uv + off).g,
              sample_rgb(uv + dir * b_off * texel + (off - dir * radius * texel)).b,
            );
          } else {
            sample_col = sample_rgb(uv + off);
          }
          let hi = smoothstep(threshold, threshold + 0.2, luma(sample_col));
          let w = mix(1.0, 1.0 + bright_weight * 6.0, hi);
          acc += sample_col * w;
          wsum += w;
        }
      }
    }
    let blurred = select(color, acc / max(0.0001, wsum), wsum > 0.0);
    return vec4<f32>(mix(color, blurred, wet), src.a);
  }
  if (code == 70u) {
    let intensity = clamp(amount, 0.0, 2.0);
    if (intensity < 0.001) {
      return src;
    }
    let decay = clamp(u.params0.x, 0.85, 1.0);
    let exposure = clamp(u.params0.y, 0.1, 1.0);
    let density = clamp(u.params0.z, 0.0, 1.0);
    let threshold = clamp(u.params0.w, 0.0, 1.0);
    let sun = clamp(u.params1.xy, vec2<f32>(0.0), vec2<f32>(1.0));
    let samples = clamp(u.params1.z, 8.0, 128.0);
    let tint = clamp(vec3<f32>(u.params1.w, u.params2.x, u.params2.y), vec3<f32>(0.0), vec3<f32>(1.5));
    let wet = clamp(u.params2.z, 0.0, 1.0);
    let delta_uv = (uv - sun) * (density / max(samples, 1.0));
    var cur = uv;
    var illum = 1.0;
    var acc = vec3<f32>(0.0);
    for (var i = 0u; i < 128u; i = i + 1u) {
      if (f32(i) < samples) {
        cur -= delta_uv;
        let s_col = sample_rgb(cur);
        let gate = smoothstep(threshold, threshold + 0.15, luma(s_col));
        acc += s_col * gate * illum;
        illum *= decay;
      }
    }
    let rays = acc * exposure * intensity * tint;
    return vec4<f32>(color + rays * wet, src.a);
  }
  if (code == 71u) {
    let speed = clamp(u.params0.y, 0.0, 3.0);
    let chromatic = clamp(u.params1.x, 0.0, 1.0);
    let t = u.resolution_time.z * speed;
    let base_off = displacement_offset(uv, t, amount);
    var displaced = vec3<f32>(0.0);
    if (chromatic > 0.001) {
      let off_r = displacement_offset(uv, t + 0.3 * chromatic, amount);
      let off_b = displacement_offset(uv, t - 0.3 * chromatic, amount);
      displaced = vec3<f32>(
        sample_rgb(uv + off_r).r,
        sample_rgb(uv + base_off).g,
        sample_rgb(uv + off_b).b,
      );
    } else {
      displaced = sample_rgb(uv + base_off);
    }
    return vec4<f32>(displaced, src.a);
  }
  if (code == 72u) {
    let mode = u32(round(clamp(u.params0.x, 0.0, 2.0)));
    let rotation = u.params0.y / 360.0;
    let zoom = max(0.25, u.params0.z);
    let center = clamp(vec2<f32>(u.params0.w, u.params1.x), vec2<f32>(0.0), vec2<f32>(1.0));
    let wet = clamp(amount, 0.0, 1.0);
    let aspect = u.resolution_time.x / max(u.resolution_time.y, 1.0);
    var sample_uv = uv;
    if (mode == 0u) {
      var d = uv - center;
      d.x *= aspect;
      let r = length(d) * 2.0;
      let a = fract1(atan2(d.y, d.x) / 6.28318530718 + 0.5 + rotation);
      sample_uv = vec2<f32>(a, r * zoom);
    } else if (mode == 1u) {
      let a = (uv.x - 0.5 + rotation) * 6.28318530718;
      let r = uv.y * zoom;
      var d = vec2<f32>(cos(a), sin(a)) * r * 0.5;
      d.x /= aspect;
      sample_uv = center + d;
    } else {
      var d = uv - center;
      d.x *= aspect;
      let r = log(length(d) * 2.0 + 1.0);
      let a = fract1(atan2(d.y, d.x) / 6.28318530718 + 0.5 + rotation);
      sample_uv = vec2<f32>(a, r * zoom);
    }
    let mapped = sample_rgb(clamp(sample_uv, vec2<f32>(0.0), vec2<f32>(1.0)));
    return vec4<f32>(mix(color, mapped, wet), src.a);
  }
  // ── Wave 1: stylize / pattern passes (codes 73-96) ────────────────────
  if (code == 73u) {
    // OIL PAINT - dual-algorithm painterly pass.
    // amount = brush radius px; params0 = (quantize bins, brush length,
    // bristle, color punch); params1 = (wet highlight, mode, -, -)
    let px = 1.0 / u.resolution_time.xy;
    let radius = clamp(amount, 1.0, 8.0);
    let bins = clamp(u.params0.x, 4.0, 24.0);
    let brush_len = clamp(u.params0.y, 0.0, 2.0);
    let bristle = clamp(u.params0.z, 0.0, 1.0);
    let punch = clamp(u.params0.w, 0.0, 1.0);
    let highlight = clamp(u.params1.x, 0.0, 1.0);
    let mode = u32(round(clamp(u.params1.y, 0.0, 1.0)));
    var result = color;
    if (mode == 1u) {
      // Variance pick: 4-quadrant Kuwahara.
      var best = color;
      var best_var = 1e9;
      for (var q = 0u; q < 4u; q = q + 1u) {
        let dir = vec2<f32>(select(-1.0, 1.0, (q & 1u) == 1u), select(-1.0, 1.0, (q & 2u) == 2u));
        var mean = vec3<f32>(0.0);
        var m2 = 0.0;
        for (var j = 0u; j < 3u; j = j + 1u) {
          for (var i = 0u; i < 3u; i = i + 1u) {
            let o = dir * vec2<f32>(f32(i), f32(j)) * radius * px * 0.5;
            let sm = sample_rgb(uv + o);
            mean += sm;
            m2 += luma(sm) * luma(sm);
          }
        }
        mean /= 9.0;
        let variance = m2 / 9.0 - luma(mean) * luma(mean);
        if (variance < best_var) { best_var = variance; best = mean; }
      }
      result = floor(best * bins + vec3<f32>(0.5)) / bins;
    } else {
      // Bin pick: dominant-luma-bin averaging with directional brush stretch.
      let l00 = luma(sample_rgb(uv + px * vec2<f32>(-1.0, -1.0)));
      let l10 = luma(sample_rgb(uv + px * vec2<f32>(0.0, -1.0)));
      let l20 = luma(sample_rgb(uv + px * vec2<f32>(1.0, -1.0)));
      let l01 = luma(sample_rgb(uv + px * vec2<f32>(-1.0, 0.0)));
      let l21 = luma(sample_rgb(uv + px * vec2<f32>(1.0, 0.0)));
      let l02 = luma(sample_rgb(uv + px * vec2<f32>(-1.0, 1.0)));
      let l12 = luma(sample_rgb(uv + px * vec2<f32>(0.0, 1.0)));
      let l22 = luma(sample_rgb(uv + px * vec2<f32>(1.0, 1.0)));
      let gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
      let gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
      let grad_mag = length(vec2<f32>(gx, gy));
      var brush_dir = vec2<f32>(1.0, 0.0);
      if (grad_mag > 0.001) {
        brush_dir = vec2<f32>(-gy, gx) / grad_mag;
      }
      var bin_count: array<f32, 24>;
      var bin_color: array<vec3<f32>, 24>;
      let stride = radius * 0.5;
      for (var j = -2; j <= 2; j = j + 1) {
        for (var i = -2; i <= 2; i = i + 1) {
          let cell = vec2<f32>(f32(i), f32(j));
          var stretch = 1.0;
          var w = 1.0;
          if (i != 0 || j != 0) {
            let along = dot(normalize(cell), brush_dir);
            stretch = 1.0 + brush_len * abs(along);
            w = mix(1.0, 0.5 + 0.5 * sin(dot(cell, brush_dir) * 6.28318), bristle);
          }
          let sm = sample_rgb(uv + cell * px * stride * stretch);
          var bin = i32(luma(sm) * (bins - 1.0));
          bin = clamp(bin, 0, 23);
          bin_count[bin] += w;
          bin_color[bin] += sm * w;
        }
      }
      var max_idx = 0;
      var max_count = 0.0;
      for (var b = 0; b < 24; b = b + 1) {
        if (bin_count[b] > max_count) { max_count = bin_count[b]; max_idx = b; }
      }
      result = bin_color[max_idx] / max(max_count, 0.0001);
    }
    let lum = luma(result);
    result = mix(vec3<f32>(lum), result, 1.0 + punch * 0.6);
    result += vec3<f32>(smoothstep(0.7, 0.95, luma(result)) * highlight);
    let grain = value_noise2d(uv * u.resolution_time.xy * 0.5) * 0.06 - 0.03;
    result *= 1.0 + grain;
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 74u) {
    // WATERCOLOR - fbm-bled pigment, wet-edge darkening, granulation, paper.
    // amount = pigment bleed; params0 = (edge darken, wetness, granulation,
    // paper texture); params1 = (paper scale, paper hue, -, -)
    let px = 1.0 / u.resolution_time.xy;
    let edge_darken = clamp(u.params0.x, 0.0, 1.0);
    let wetness = clamp(u.params0.y, 0.0, 1.0);
    let granulation_amt = clamp(u.params0.z, 0.0, 1.0);
    let paper_amt = clamp(u.params0.w, 0.0, 1.0);
    let paper_scale = clamp(u.params1.x, 1.0, 32.0);
    let paper_hue = clamp(u.params1.y, 0.0, 2.0);
    let bleed = clamp(amount, 0.0, 1.5) * 8.0;
    let warp = vec2<f32>(
      fbm2d(uv * 9.0 + vec2<f32>(0.0, u.resolution_time.z * 0.05)) - 0.5,
      fbm2d(uv * 9.0 + vec2<f32>(7.3, 2.1)) - 0.5,
    ) * bleed * px * 14.0;
    let blur_r = 1.0 + bleed * 0.35;
    var wc = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var yy = -1; yy <= 1; yy = yy + 1) {
      for (var xx = -1; xx <= 1; xx = xx + 1) {
        let o = vec2<f32>(f32(xx), f32(yy));
        let w = exp(-dot(o, o) * 0.55);
        wc += sample_rgb(uv + warp + o * px * blur_r) * w;
        wsum += w;
      }
    }
    wc /= wsum;
    let bins = 9.0;
    wc = floor(wc * bins + vec3<f32>(0.5)) / bins;
    let edge_l = abs(luma(sample_rgb(uv + vec2<f32>(px.x * 2.0, 0.0))) - luma(sample_rgb(uv - vec2<f32>(px.x * 2.0, 0.0))))
               + abs(luma(sample_rgb(uv + vec2<f32>(0.0, px.y * 2.0))) - luma(sample_rgb(uv - vec2<f32>(0.0, px.y * 2.0))));
    wc *= 1.0 - clamp(edge_l * 2.4, 0.0, 0.9) * edge_darken;
    let lum = luma(wc);
    wc = mix(vec3<f32>(lum), wc, 1.0 + wetness * 0.5);
    let gran = value_noise2d(uv * u.resolution_time.xy * 0.8 + vec2<f32>(u.resolution_time.z * 0.05));
    wc += vec3<f32>(gran - 0.5) * granulation_amt * 0.3;
    var tone = vec3<f32>(0.96, 0.93, 0.86);
    if (paper_hue >= 1.5) {
      tone = vec3<f32>(0.82, 0.72, 0.55);
    } else if (paper_hue >= 0.5) {
      tone = vec3<f32>(0.88, 0.90, 0.93);
    }
    let paper_n = value_noise2d(uv * paper_scale * 16.0) * 0.5 + value_noise2d(uv * paper_scale * 32.0) * 0.5;
    let paper = tone * (0.85 + paper_n * 0.3);
    let result = wc * mix(vec3<f32>(1.0), paper, paper_amt);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 75u) {
    // COMIC INK - flat cel colors, sobel ink lines, shadow halftone dots.
    // amount = ink strength; params0 = (edge threshold, posterize levels,
    // halftone shadow, halftone size); params1 = (color mix, ink rgb)
    let px = 1.0 / u.resolution_time.xy;
    let threshold = clamp(u.params0.x, 0.0, 1.0);
    let bins = clamp(u.params0.y, 2.0, 12.0);
    let halftone = clamp(u.params0.z, 0.0, 1.0);
    let halftone_size = clamp(u.params0.w, 2.0, 16.0);
    let color_mix = clamp(u.params1.x, 0.0, 1.0);
    let ink_rgb = clamp(vec3<f32>(u.params1.y, u.params1.z, u.params1.w), vec3<f32>(0.0), vec3<f32>(1.0));
    let l00 = luma(sample_rgb(uv + px * vec2<f32>(-1.0, -1.0)));
    let l10 = luma(sample_rgb(uv + px * vec2<f32>(0.0, -1.0)));
    let l20 = luma(sample_rgb(uv + px * vec2<f32>(1.0, -1.0)));
    let l01 = luma(sample_rgb(uv + px * vec2<f32>(-1.0, 0.0)));
    let l21 = luma(sample_rgb(uv + px * vec2<f32>(1.0, 0.0)));
    let l02 = luma(sample_rgb(uv + px * vec2<f32>(-1.0, 1.0)));
    let l12 = luma(sample_rgb(uv + px * vec2<f32>(0.0, 1.0)));
    let l22 = luma(sample_rgb(uv + px * vec2<f32>(1.0, 1.0)));
    let gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    let gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    let edge = clamp(length(vec2<f32>(gx, gy)) * amount, 0.0, 1.0);
    let ink = smoothstep(threshold, threshold + 0.05, edge);
    let quant = floor(color * bins + vec3<f32>(0.5)) / bins;
    let cel = quant * 1.1 + vec3<f32>(0.02);
    var colored = mix(cel, color, color_mix);
    let shade = luma(quant);
    let grid_uv = fract(vec2<f32>(uv.x + uv.y * 0.5, uv.y) * u.resolution_time.xy / halftone_size) - vec2<f32>(0.5);
    let dot_r = 0.4 * (1.0 - smoothstep(0.1, 0.75, shade));
    let dots = 1.0 - smoothstep(dot_r - 0.08, dot_r, length(grid_uv));
    colored = mix(colored, colored * 0.45, dots * halftone);
    let result = mix(colored, ink_rgb, ink);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 76u) {
    // CROSSHATCH — layered pencil strokes by tone.
    // params0 = (density, angle deg, line width, contrast)
    // params1 = (paper r, paper g, paper b, ink r); params2 = (ink g, ink b, -, -)
    let density = max(0.1, u.params0.x);
    let hatch_ang = u.params0.y * 0.0174533;
    let line_w = max(0.5, u.params0.z);
    let contrast = u.params0.w;
    let paper = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let inkcol = vec3<f32>(u.params1.w, u.params2.x, u.params2.y);

    var l = clamp((luma(color) - 0.5) * max(contrast, 0.0) + 0.5, 0.0, 1.0);
    // Rotate the stroke basis so Angle turns the whole hatch pattern.
    let ca = cos(hatch_ang);
    let sa = sin(hatch_ang);
    let px = uv * u.resolution_time.xy;
    let rp = vec2<f32>(px.x * ca - px.y * sa, px.x * sa + px.y * ca);
    let sp = rp / max(1.2, (8.0 - amount * 5.0) / density);
    let jitter = value_noise2d(sp * 0.35) * 2.0;
    // Line width widens each stroke's dark band.
    let wscale = 1.0 / line_w;
    var tone = 1.0;
    if (l < 0.85) { tone = min(tone, 1.0 - (1.0 - clamp(0.72 + 0.28 * abs(sin(sp.x + sp.y + jitter)) * wscale, 0.0, 1.0))); }
    if (l < 0.62) { tone = min(tone, clamp(0.55 + 0.45 * abs(sin(sp.x - sp.y + jitter)) * wscale, 0.0, 1.0)); }
    if (l < 0.40) { tone = min(tone, clamp(0.42 + 0.58 * abs(sin(sp.x * 0.5 + sp.y + jitter)) * wscale, 0.0, 1.0)); }
    if (l < 0.22) { tone = min(tone, clamp(0.30 + 0.70 * abs(sin(sp.x + sp.y * 0.5 - jitter)) * wscale, 0.0, 1.0)); }
    let tinted = mix(inkcol, paper, clamp(tone * (0.5 + l * 0.7), 0.0, 1.0));
    return vec4<f32>(mix(tinted, tinted * (color / max(l, 0.05)), 0.25), src.a);
  }
  if (code == 77u) {
    // LINOCUT — two-tone carve with directional gouge streaks.
    // Generic family slots: params0 = (streak scale, softness, threshold, angle deg)
    // params1.zw + params2.x = ink rgb (slots 6..8 -> params1.z, params1.w, params2.x)
    let streak_scale = mix(0.4, 2.4, clamp(u.params0.x, 0.0, 1.0));
    let softness = mix(0.015, 0.18, clamp(u.params0.y, 0.0, 1.0));
    let base_threshold = clamp(u.params0.z, 0.05, 0.95);
    let streak_ang = 0.6 + u.params0.w * 0.0174533;
    let inkcol = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);

    let l = luma(color);
    let sd = vec2<f32>(cos(streak_ang), sin(streak_ang));
    let carve = value_noise2d(vec2<f32>(
      dot(uv * u.resolution_time.xy, sd) * 0.12 * streak_scale,
      dot(uv * u.resolution_time.xy, vec2<f32>(-sd.y, sd.x)) * 0.9 * streak_scale));
    let threshold = clamp(base_threshold + (carve - 0.5) * 0.35, 0.05, 0.95) * clamp(amount, 0.2, 1.6);
    let cut = smoothstep(threshold - softness, threshold + softness, l);
    let paper = vec3<f32>(0.93, 0.9, 0.84);
    return vec4<f32>(mix(inkcol, paper, cut), src.a);
  }
  if (code == 78u) {
    // DOT MATRIX - shaped sample dots on a coarse grid over a flat background.
    // params0 = (dotShape, dotSize, gap, posterize)
    // params1 = (glow, bgR, bgG, bgB)
    let shape = u32(clamp(u.params0.x, 0.0, 2.0) + 0.5);
    let cell = max(2.0, u.params0.y);
    let gap = clamp(u.params0.z, 0.0, 1.0);
    let posterize = clamp(u.params0.w, 1.0, 8.0);
    let glow = clamp(u.params1.x, 0.0, 1.0);
    let bg = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let gridp = uv * u.resolution_time.xy / cell;
    let cuv = fract(gridp) - vec2<f32>(0.5);
    var base = sample_rgb((floor(gridp) + vec2<f32>(0.5)) * cell / u.resolution_time.xy);
    if (posterize > 1.001) {
      base = floor(base * posterize + vec3<f32>(0.5)) / posterize;
    }
    let dot_r = (0.475 - gap * 0.25) * clamp(amount / 8.0, 0.2, 1.4);
    var dotmask = 0.0;
    if (shape == 0u) {
      dotmask = smoothstep(dot_r + 0.05, dot_r - 0.05, length(cuv));
    } else if (shape == 1u) {
      let ad = abs(cuv);
      dotmask = smoothstep(dot_r + 0.02, dot_r - 0.02, max(ad.x, ad.y));
    } else {
      let ad = abs(cuv);
      dotmask = smoothstep(dot_r + 0.02, dot_r - 0.02, max(ad.x * 0.866 + ad.y * 0.5, ad.y));
    }
    var result = mix(bg, base, dotmask);
    if (glow > 0.001) {
      result += base * smoothstep(0.7, 0.45, length(cuv)) * glow * 0.4;
    }
    return vec4<f32>(result, src.a);
  }
  if (code == 79u) {
    // ASCII — luma-ranked procedural glyph masks per character cell.
    // params0 = (cell size, contrast, colour mix, invert)
    // params1 = (style, tint r, tint g, tint b)
    let cell = max(4.0, u.params0.x);
    let contrast = u.params0.y;
    let color_mix = clamp(u.params0.z, 0.0, 1.0);
    let invert = clamp(u.params0.w, 0.0, 1.0);
    let style = i32(floor(clamp(u.params1.x, 0.0, 3.0) + 0.5));
    let tint = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);

    let gridp = uv * u.resolution_time.xy / cell;
    let base = sample_rgb((floor(gridp) + 0.5) * cell / u.resolution_time.xy);
    // Contrast is applied around mid grey BEFORE ranking, so it changes which
    // glyph a cell picks rather than just tinting the result.
    var l = clamp((luma(base) - 0.5) * max(contrast, 0.0) + 0.5, 0.0, 1.0);
    l = mix(l, 1.0 - l, invert);
    let g = fract(gridp) * 2.0 - 1.0;

    var glyph = 0.0;
    if (style == 1) {
      // Stipple — dot radius tracks luma.
      glyph = step(length(g), clamp(l, 0.0, 1.0) * 0.9);
    } else if (style == 2) {
      // Solid block — filled cell above a luma floor.
      glyph = step(0.12, l) * step(abs(g.x), 0.82) * step(abs(g.y), 0.82);
    } else if (style == 3) {
      // Line hatching — denser lines as luma rises.
      let freq = 1.0 + floor(l * 4.0);
      glyph = step(abs(fract((g.x + g.y) * freq) - 0.5), 0.22);
    } else {
      // Density ramp — the original luma-ranked glyph ladder.
      if (l > 0.85)      { glyph = step(abs(g.x), 0.75) * step(abs(g.y), 0.75); }
      else if (l > 0.65) { glyph = max(step(abs(g.x), 0.16), step(abs(g.y), 0.16)); }
      else if (l > 0.45) { glyph = step(abs(abs(g.x) - abs(g.y)), 0.22); }
      else if (l > 0.28) { glyph = step(abs(g.y), 0.16); }
      else if (l > 0.14) { glyph = step(length(g), 0.28); }
    }

    // Colour mix blends the glyph between the flat tint and the cell's own
    // colour, so 0 is a classic monochrome terminal and 1 keeps the source.
    let glyph_rgb = mix(tint * (0.3 + l), base * (0.35 + l * 0.9), color_mix);
    return vec4<f32>(mix(base * 0.12, glyph_rgb, glyph), src.a);
  }
  if (code == 80u) {
    // MATRIX RAIN - glyph columns raining over the source.
    // params0 = (density, speed, cellSize, trailLength)
    // params1 = (bgMix, colorR, colorG, colorB)
    let density = clamp(u.params0.x, 0.0, 1.0);
    let fall_rate = clamp(u.params0.y, 0.0, 3.0);
    let cell = max(4.0, u.params0.z);
    let trail_length = clamp(u.params0.w, 0.0, 1.0);
    let bg_mix = clamp(u.params1.x, 0.0, 1.0);
    let rain_tint = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let t = u.resolution_time.z;
    let gridp = uv * u.resolution_time.xy / cell;
    let cellid = floor(gridp);
    let cuv = fract(gridp);
    let col_seed = hash21(vec2<f32>(cellid.x, 0.0));
    let fall_speed = (0.5 + col_seed * 1.5) * fall_rate;
    let period = u.resolution_time.y / cell + 30.0;
    let phase = t * fall_speed - col_seed * 50.0;
    let trail_head = phase - floor(phase / period) * period;
    let dist = trail_head - cellid.y;
    let trail_len = max(2.0, trail_length * 30.0);
    var intensity = 0.0;
    if (dist > 0.0 && dist < trail_len) {
      intensity = (1.0 - dist / trail_len)
        * step(1.0 - density, hash21(cellid + vec2<f32>(floor(t * fall_speed * 0.05))));
    }
    if (dist >= 0.0 && dist < 1.0) { intensity = 1.5; }
    let glyph_seed = hash21(cellid + vec2<f32>(floor(t * fall_speed * 0.5 + cellid.y * 0.1)));
    let g_mask = step(0.55, hash21(floor(cuv * 5.0) + vec2<f32>(glyph_seed * 13.0)));
    let rain = rain_tint * intensity * g_mask * clamp(amount / 0.6, 0.0, 2.5);
    return vec4<f32>(mix(rain, color + rain, bg_mix), src.a);
  }
  if (code == 81u) {
    // BINARY CODE - scrolling 0/1 glyph columns brightness-tied to the source.
    // params0 = (density, speed, cellSize, contrast)
    // params1 = (bgMix, colorR, colorG, colorB)
    let density = clamp(u.params0.x, 0.0, 1.0);
    let scroll_speed = clamp(u.params0.y, 0.0, 3.0);
    let cell = max(4.0, u.params0.z);
    let contrast = clamp(u.params0.w, 0.0, 2.0);
    let bg_mix = clamp(u.params1.x, 0.0, 1.0);
    let bin_color = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let gridp = uv * u.resolution_time.xy / cell;
    let cellid = floor(gridp);
    let cuv = fract(gridp) - vec2<f32>(0.5);
    let col_seed = hash21(vec2<f32>(cellid.x, 0.0));
    let y_off = floor(u.resolution_time.z * scroll_speed + col_seed * 50.0);
    let bit = step(0.5, hash21(vec2<f32>(cellid.x, cellid.y + y_off)));
    // '0' is an elliptical ring; '1' is a bar with a serif foot.
    let ring_r = length(cuv * vec2<f32>(1.0, 0.7));
    let zero_glyph = smoothstep(0.42, 0.38, ring_r) - smoothstep(0.30, 0.26, ring_r);
    let one_glyph = max(step(abs(cuv.x + 0.05), 0.05) * step(abs(cuv.y), 0.4),
                        step(abs(cuv.y + 0.4), 0.05) * step(abs(cuv.x), 0.2));
    var char_mask = select(zero_glyph, one_glyph, bit > 0.5);
    char_mask *= step(1.0 - density, hash21(cellid + vec2<f32>(y_off * 0.137)));
    let src_l = luma(sample_rgb((cellid + vec2<f32>(0.5)) * cell / u.resolution_time.xy));
    char_mask *= mix(1.0, src_l, contrast * 0.5);
    let char_rgb = bin_color * char_mask * clamp(amount / 8.0, 0.0, 2.0);
    return vec4<f32>(mix(char_rgb, color + char_rgb, bg_mix), src.a);
  }
  if (code == 82u) {
    // BLOCK MOSAIC - beveled color blocks in square/voronoi/hex/brick layouts.
    // params0 = (mode 0..3, tile size px, grout width 0..1, color jitter 0..1)
    // params1 = (grout r, grout g, grout b, -)
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let tile_size = clamp(u.params0.y, 4.0, 128.0);
    let grout_w = clamp(u.params0.z, 0.0, 1.0);
    let jitter_amt = clamp(u.params0.w, 0.0, 1.0);
    let grout_col = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    // Amount keeps its legacy block-density role as a scale on the explicit
    // tile size (amount 10 = manifest default = 1.0x).
    let cell = max(4.0, tile_size * clamp((40.0 - amount * 2.0) / 20.0, 0.25, 2.0));
    let px = uv * u.resolution_time.xy / cell;
    var cid = vec2<f32>(0.0);
    var cuv = vec2<f32>(0.0);
    if (mode == 1u) {
      let i = floor(px);
      let f = fract(px);
      var md = 9.0;
      for (var yy = -1; yy <= 1; yy = yy + 1) {
        for (var xx = -1; xx <= 1; xx = xx + 1) {
          let g = vec2<f32>(f32(xx), f32(yy));
          let o = vec2<f32>(hash21(i + g), hash21(i + g + vec2<f32>(13.7)));
          let r = g + o - f;
          let d = dot(r, r);
          if (d < md) { md = d; cid = i + g; cuv = r; }
        }
      }
    } else if (mode == 2u) {
      var q = vec2<f32>(px.x * 1.1547, px.y);
      q.x = q.x + 0.5 * floor(q.y);
      let i = floor(q);
      cid = vec2<f32>(i.x - floor(i.y / 2.0), i.y);
      cuv = fract(q) - vec2<f32>(0.5);
    } else if (mode == 3u) {
      var q = px;
      let row = floor(q.y);
      let odd = row - 2.0 * floor(row * 0.5);
      q.x = q.x + odd * 0.5;
      cid = vec2<f32>(floor(q.x), row);
      cuv = fract(q) - vec2<f32>(0.5);
    } else {
      cid = floor(px);
      cuv = fract(px) - vec2<f32>(0.5);
    }
    let center = clamp((cid + vec2<f32>(0.5)) * cell / u.resolution_time.xy, vec2<f32>(0.0), vec2<f32>(1.0));
    var tile = sample_rgb(center);
    if (jitter_amt > 0.001) {
      let j = vec3<f32>(hash21(cid), hash21(cid + vec2<f32>(7.3)), hash21(cid + vec2<f32>(13.7))) - vec3<f32>(0.5);
      tile = tile + j * jitter_amt * 0.4;
    }
    var bevel = 1.0;
    if (mode != 1u) {
      let f = cuv + vec2<f32>(0.5);
      bevel = clamp(1.0 + (f.x - f.y) * 0.35 - smoothstep(0.86, 1.0, max(f.x, f.y)) * 0.4
                    + smoothstep(0.14, 0.0, min(f.x, f.y)) * 0.22, 0.4, 1.4);
    }
    var dist = max(abs(cuv.x), abs(cuv.y));
    if (mode == 1u) { dist = sqrt(length(cuv)); }
    let grout = step(0.5 - grout_w * 0.5, dist);
    let result = mix(tile * bevel, grout_col, grout);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 83u) {
    // NUMBER GRID - seven-segment digits ranked by cell luma.
    // Generic family slots: amount = cell size; params0.x = amount2
    // (contrast), params0.y = amount3 (color mix).
    let contrast = 0.5 + clamp(u.params0.x, 0.0, 1.0) * 1.5;
    let color_mix = clamp(u.params0.y, 0.0, 1.0);
    let cell = max(10.0, 30.0 - amount * 1.4);
    let gridp = uv * u.resolution_time.xy / cell;
    let base = sample_rgb((floor(gridp) + vec2<f32>(0.5)) * cell / u.resolution_time.xy);
    // Contrast reshapes luma BEFORE digit ranking so it changes which digit
    // a cell picks, not just its brightness.
    let l = clamp((luma(base) - 0.5) * contrast + 0.5, 0.0, 1.0);
    let digit = u32(clamp(floor(l * 9.99), 0.0, 9.0));
    var masks = array<u32, 10>(119u, 36u, 93u, 109u, 46u, 107u, 123u, 37u, 127u, 111u);
    let segs = masks[digit];
    let g = fract(gridp) * vec2<f32>(2.0, 2.0) - vec2<f32>(1.0);
    var seg = 0.0;
    if ((segs & 1u) != 0u)  { seg = max(seg, step(abs(g.y - 0.8), 0.12) * step(abs(g.x), 0.5)); }
    if ((segs & 2u) != 0u)  { seg = max(seg, step(abs(g.x - 0.55), 0.12) * step(abs(g.y - 0.4), 0.4)); }
    if ((segs & 4u) != 0u)  { seg = max(seg, step(abs(g.x - 0.55), 0.12) * step(abs(g.y + 0.4), 0.4)); }
    if ((segs & 8u) != 0u)  { seg = max(seg, step(abs(g.y + 0.8), 0.12) * step(abs(g.x), 0.5)); }
    if ((segs & 16u) != 0u) { seg = max(seg, step(abs(g.x + 0.55), 0.12) * step(abs(g.y + 0.4), 0.4)); }
    if ((segs & 32u) != 0u) { seg = max(seg, step(abs(g.x + 0.55), 0.12) * step(abs(g.y - 0.4), 0.4)); }
    if ((segs & 64u) != 0u) { seg = max(seg, step(abs(g.y), 0.12) * step(abs(g.x), 0.5)); }
    let digit_col = mix(vec3<f32>(1.0, 0.55, 0.2), base * 1.4, color_mix);
    return vec4<f32>(base * 0.12 + digit_col * seg * (0.25 + l * 1.1), src.a);
  }
  if (code == 84u) {
    // BRAILLE — 2x3 dot cells, dots raised by local luma bits.
    let cell = max(8.0, 24.0 - amount * 1.0);
    let gridp = uv * u.resolution_time.xy / cell;
    let cid = floor(gridp);
    let f = fract(gridp);
    let sub = vec2<f32>(floor(f.x * 2.0), floor(f.y * 3.0));
    let subCenter = (cid + (sub + 0.5) / vec2<f32>(2.0, 3.0)) * cell / u.resolution_time.xy;
    let l = luma(sample_rgb(subCenter));
    let bit = step(hash21(cid + sub * 0.37) * 0.55 + 0.2, l);
    let d = length(fract(f * vec2<f32>(2.0, 3.0)) - 0.5);
    let dotm = smoothstep(0.42, 0.3, d) * bit;
    let base = sample_rgb((cid + 0.5) * cell / u.resolution_time.xy);
    return vec4<f32>(base * 0.15 + (base / max(luma(base), 0.1)) * dotm * (0.2 + l), src.a);
  }
  if (code == 85u) {
    // CIRCUIT BOARD — traces and pads etched from the image, signal pulses.
    let sp = uv * u.resolution_time.xy / max(6.0, 18.0 - amount);
    let cid = floor(sp);
    let f = fract(sp);
    let l = luma(sample_rgb((cid + 0.5) * max(6.0, 18.0 - amount) / u.resolution_time.xy));
    let h = hash21(cid);
    var trace = 0.0;
    if (h < 0.4) { trace = step(abs(f.y - 0.5), 0.08); }
    else if (h < 0.8) { trace = step(abs(f.x - 0.5), 0.08); }
    else { trace = step(abs(f.x - f.y), 0.11); }
    trace *= step(0.25, l);
    let pad = smoothstep(0.16, 0.10, length(f - 0.5)) * step(0.55, l);
    let pulse = pow(fract1(h * 7.0 - u.resolution_time.z * (0.4 + h)), 8.0);
    let board = vec3<f32>(0.02, 0.10, 0.05) + color * 0.08;
    let copper = vec3<f32>(0.75, 0.55, 0.25) * (0.5 + l);
    let glow = vec3<f32>(0.3, 1.0, 0.55) * pulse * 1.6;
    return vec4<f32>(board + copper * max(trace, pad) + glow * trace, src.a);
  }
  if (code == 86u) {
    // STAINED GLASS - voronoi panes, lead came, angled light.
    // Generic family slots: params0.x = amount2 (lead width), params0.y =
    // amount3 (saturation). amount = cell count.
    let lead_thick = mix(0.02, 0.22, clamp(u.params0.x, 0.0, 1.0));
    let sat_boost = clamp(u.params0.y, 0.0, 1.0) * 1.5;
    let cell_scale = (3.0 + amount * 5.0) * vec2<f32>(u.resolution_time.x / u.resolution_time.y, 1.0);
    let sp = uv * cell_scale;
    let i = floor(sp);
    let f = fract(sp);
    var md = 8.0; var md2 = 8.0; var mc = vec2<f32>(0.0);
    for (var yy = -1; yy <= 1; yy = yy + 1) {
      for (var xx = -1; xx <= 1; xx = xx + 1) {
        let g = vec2<f32>(f32(xx), f32(yy));
        let o = vec2<f32>(hash21(i + g), hash21(i + g + vec2<f32>(19.7)));
        let r = g + o - f;
        let d = dot(r, r);
        if (d < md) { md2 = md; md = d; mc = i + g + o; }
        else if (d < md2) { md2 = d; }
      }
    }
    let edge = sqrt(md2) - sqrt(md);
    let pane = sample_rgb(clamp(mc / cell_scale, vec2<f32>(0.0), vec2<f32>(1.0)));
    var glass = pow(pane, vec3<f32>(0.75)) * 1.15;
    glass = max(mix(vec3<f32>(luma(glass)), glass, 1.0 + sat_boost), vec3<f32>(0.0));
    glass *= 0.85 + 0.3 * hash21(mc);
    let lead = smoothstep(lead_thick, lead_thick * 0.25, edge);
    let light_angle = 0.65 + 0.35 * sin(dot(mc, vec2<f32>(0.7, 1.3)) + u.resolution_time.z * 0.1);
    return vec4<f32>(mix(glass * light_angle, vec3<f32>(0.05, 0.05, 0.06), lead), src.a);
  }
  if (code == 87u) {
    // WOVEN FABRIC — over/under warp and weft strips carrying the image.
    let stripe = max(4.0, 20.0 - amount);
    let sp = uv * u.resolution_time.xy / stripe;
    let wx = floor(sp.x); let wy = floor(sp.y);
    let over = step(0.5, fract((wx + wy) * 0.5));
    let fx2 = fract(sp.x); let fy2 = fract(sp.y);
    let warp_shade = 0.72 + 0.28 * sin(fx2 * 3.14159);
    let weft_shade = 0.72 + 0.28 * sin(fy2 * 3.14159);
    let cw = sample_rgb(vec2<f32>((wx + 0.5) * stripe / u.resolution_time.x, uv.y));
    let cf = sample_rgb(vec2<f32>(uv.x, (wy + 0.5) * stripe / u.resolution_time.y));
    let thread = select(cf * weft_shade, cw * warp_shade, over > 0.5);
    let gap = smoothstep(0.02, 0.12, fx2) * smoothstep(1.0 - 0.02, 1.0 - 0.12, fx2)
            * smoothstep(0.02, 0.12, fy2) * smoothstep(1.0 - 0.02, 1.0 - 0.12, fy2);
    return vec4<f32>(thread * max(gap, 0.25), src.a);
  }
  if (code == 88u) {
    // MOSAIC TILE — grouted tiles with glaze specular.
    let cell = max(8.0, 42.0 - amount * 2.0);
    let gridp = uv * u.resolution_time.xy / cell;
    let cid = floor(gridp);
    let f = fract(gridp);
    var tile = sample_rgb((cid + 0.5) * cell / u.resolution_time.xy);
    tile *= 0.9 + hash21(cid) * 0.2;
    let grout = smoothstep(0.04, 0.10, f.x) * smoothstep(0.96, 0.90, f.x)
              * smoothstep(0.04, 0.10, f.y) * smoothstep(0.96, 0.90, f.y);
    let spec = pow(max(0.0, 1.0 - length(f - vec2<f32>(0.35, 0.3)) * 1.8), 3.0) * 0.35;
    return vec4<f32>(mix(vec3<f32>(0.82, 0.8, 0.76), tile + spec, grout), src.a);
  }
  if (code == 89u) {
    // NEON OUTLINE — edges as glowing tubes over darkness.
    let px = 1.0 / u.resolution_time.xy;
    var gx = 0.0; var gy = 0.0;
    gx = luma(sample_rgb(uv + px * vec2<f32>(1.5, 0.0))) - luma(sample_rgb(uv - px * vec2<f32>(1.5, 0.0)));
    gy = luma(sample_rgb(uv + px * vec2<f32>(0.0, 1.5))) - luma(sample_rgb(uv - px * vec2<f32>(0.0, 1.5)));
    let e = length(vec2<f32>(gx, gy));
    let core = smoothstep(0.10, 0.5, e * (1.0 + amount * 2.0));
    var halo = 0.0;
    for (var k = 0u; k < 4u; k = k + 1u) {
      let a = f32(k) * 1.5707963;
      let off = vec2<f32>(cos(a), sin(a)) * px * 3.0;
      let hgx = luma(sample_rgb(uv + off + px * vec2<f32>(1.5, 0.0))) - luma(sample_rgb(uv + off - px * vec2<f32>(1.5, 0.0)));
      let hgy = luma(sample_rgb(uv + off + px * vec2<f32>(0.0, 1.5))) - luma(sample_rgb(uv + off - px * vec2<f32>(0.0, 1.5)));
      halo += smoothstep(0.10, 0.5, length(vec2<f32>(hgx, hgy)) * (1.0 + amount * 2.0));
    }
    halo *= 0.25;
    let neon = normalize(color + vec3<f32>(0.15, 0.1, 0.3)) * 1.4;
    return vec4<f32>(color * 0.06 + neon * (core * 1.5 + halo * 0.6), src.a);
  }
  if (code == 90u) {
    // TOPO MAP - hypsometric tint + contour lines from luma elevation.
    // Generic family slots: amount = contour density; params0.x = amount2
    // (line thickness), params0.y = amount3 (color fill), params1.zw +
    // params2.x = red/green/blue contour ink.
    let line_thick = clamp(u.params0.x, 0.0, 1.0);
    let color_fill = clamp(u.params0.y, 0.0, 1.0);
    let user_ink = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let elev = luma(sample_rgb(uv)) + fbm2d(uv * 5.0) * 0.06;
    let bands = 8.0 + amount * 10.0;
    let w_hi = mix(0.04, 0.16, line_thick);
    let w_lo = w_hi * 0.2;
    let contour = abs(fract(elev * bands) - 0.5);
    let line = smoothstep(w_hi, w_lo, contour);
    let major = smoothstep(w_hi * 1.4, w_lo, abs(fract(elev * bands / 5.0) - 0.5)) * 0.6;
    var terrain = mix(vec3<f32>(0.15, 0.32, 0.22), vec3<f32>(0.75, 0.68, 0.5), elev);
    terrain = mix(terrain, vec3<f32>(0.9, 0.9, 0.92), smoothstep(0.8, 0.98, elev));
    terrain = mix(terrain, color * 0.8 + terrain * 0.2, color_fill);
    // The pack's unset colour default is 0.5-grey; treat that as "no user
    // colour" and keep the classic dark-brown ink.
    let ink_dev = abs(user_ink - vec3<f32>(0.5));
    let has_ink = step(0.004, max(max(ink_dev.x, ink_dev.y), ink_dev.z));
    let inkline = mix(vec3<f32>(0.25, 0.16, 0.1), user_ink, has_ink);
    return vec4<f32>(mix(terrain, inkline, clamp(max(line * 0.75, major), 0.0, 1.0)), src.a);
  }
  if (code == 91u) {
    // LED WALL - RGB triads, panel seams, hot pixel bloom.
    // Generic family slots: amount = LED pitch; params0.x = amount2
    // (roundness), params0.y = amount3 (bloom).
    let roundness = clamp(u.params0.x, 0.0, 1.0);
    let bloom_amt = clamp(u.params0.y, 0.0, 1.0);
    let pitch = max(3.0, 14.0 - amount * 0.5);
    let gridp = uv * u.resolution_time.xy / pitch;
    let base = sample_rgb((floor(gridp) + vec2<f32>(0.5)) * pitch / u.resolution_time.xy);
    let f = fract(gridp);
    let led_gap = 0.08;
    let corner = mix(0.001, 0.42, roundness);
    let hp = abs(f - vec2<f32>(0.5)) - (vec2<f32>(0.5 - led_gap) - vec2<f32>(corner));
    let rr = length(max(hp, vec2<f32>(0.0))) + min(max(hp.x, hp.y), 0.0) - corner;
    let led_mask = 1.0 - smoothstep(-0.02, 0.02, rr);
    let sub = u32(floor(f.x * 3.0));
    var channel = vec3<f32>(0.0);
    if (sub == 0u) { channel = vec3<f32>(1.0, 0.0, 0.0); }
    else if (sub == 1u) { channel = vec3<f32>(0.0, 1.0, 0.0); }
    else { channel = vec3<f32>(0.0, 0.0, 1.0); }
    let px_mask = smoothstep(0.5, 0.32, abs(fract(f.x * 3.0) - 0.5))
                * smoothstep(0.5, 0.3, abs(f.y - 0.5)) * led_mask;
    let panel = step(0.02, fract(gridp.x / 16.0)) * step(0.02, fract(gridp.y / 16.0));
    let lit = dot(base, channel);
    let gd = length(f - vec2<f32>(0.5));
    let bloom = base * (0.44 * bloom_amt)
              + base * exp(-gd * gd * 8.0) * luma(base) * bloom_amt * 0.5;
    return vec4<f32>((channel * lit * px_mask * 2.1 + bloom) * panel, src.a);
  }
  if (code == 92u) {
    // HEX GRID - hexagonal mosaic with edge glow.
    // Generic family slots: amount = blend; params0.x = amount2 (hex size),
    // params0.y = amount3 (pop speed), params0.z = threshold (gap).
    let hex_size = clamp(u.params0.x, 0.0, 1.0);
    let pop_slider = clamp(u.params0.y, 0.0, 1.0);
    let gap_amt = clamp(u.params0.z, 0.0, 1.0);
    let blend = clamp(amount, 0.0, 1.0);
    let scale = 6.0 + hex_size * 14.0;
    let aspect2 = u.resolution_time.x / u.resolution_time.y;
    let p = uv * vec2<f32>(aspect2, 1.0) * scale;
    let hx = vec2<f32>(p.x * 1.1547, p.y + p.x * 0.5774);
    let a2 = fract(hx) - vec2<f32>(0.5);
    let id_a = floor(hx);
    let hb = vec2<f32>(hx.x - 0.5, hx.y - 0.5);
    let b2 = fract(hb) - vec2<f32>(0.5);
    let id_b = floor(hb);
    var hid = id_a; var hf = a2;
    if (dot(b2, b2) < dot(a2, a2)) { hid = id_b + vec2<f32>(0.5); hf = b2; }
    let center = (hid + vec2<f32>(0.5)) / scale;
    let hexuv = clamp(vec2<f32>(center.x / 1.1547, center.y - center.x / 1.1547 * 0.5774) / vec2<f32>(aspect2, 1.0), vec2<f32>(0.0), vec2<f32>(1.0));
    let hex_col = sample_rgb(hexuv);
    let hd = max(abs(hf.x) * 1.1547, abs(hf.x) * 0.5774 + abs(hf.y));
    let hex_edge = 0.5 - 0.02 - gap_amt * 0.16;
    let in_hex = smoothstep(hex_edge + 0.015, hex_edge - 0.015, hd);
    let rim = smoothstep(hex_edge - 0.06, hex_edge, hd);
    let rnd = hash21(hid);
    let pop = sin(u.resolution_time.z * pop_slider * 3.0 + rnd * 6.2831853) * 0.5 + 0.5;
    let pop_str = clamp(pop_slider * 3.0, 0.0, 1.0);
    let lighting = mix(1.0, 0.66 + pop * 0.5, pop_str);
    var hcol = hex_col * lighting;
    hcol = mix(hcol, hcol * 0.3 + vec3<f32>(0.05, 0.1, 0.14), rim);
    hcol += vec3<f32>(0.4, 0.5, 0.7) * rim * 0.3 * pop * pop_str;
    hcol = mix(vec3<f32>(0.012), hcol, in_hex);
    return vec4<f32>(mix(color, hcol, blend), src.a);
  }
  if (code == 93u) {
    // GEOMETRIC TILE - mirror/rotate/tile/quilt square tiling.
    // params0 = (mode 0..3, tile count 1..16, rotation deg, row offset 0..1)
    // params1 = (mix 0..1, -, -, -)
    let mode = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let tiles_in = clamp(u.params0.y, 1.0, 16.0);
    let rot_amt = u.params0.z * 0.0174533;
    let row_off = clamp(u.params0.w, 0.0, 1.0);
    let tile_mix = clamp(u.params1.x, 0.0, 1.0);
    // Amount keeps its legacy density role on top of the explicit tile count.
    let reps = max(1.0, floor(tiles_in * (0.5 + amount) + 0.5));
    let t = uv * reps;
    let cellid = floor(t);
    var cuv = fract(t);
    let odd_x = fract(cellid.x * 0.5) * 2.0;
    let odd_y = fract(cellid.y * 0.5) * 2.0;
    if (mode == 0u) {
      if (odd_x > 0.5) { cuv.x = 1.0 - cuv.x; }
      if (odd_y > 0.5) { cuv.y = 1.0 - cuv.y; }
    } else if (mode == 1u) {
      let rot = fract((cellid.x + cellid.y) * 0.5) * 2.0 * rot_amt;
      let d = cuv - vec2<f32>(0.5);
      let c = cos(rot); let sn = sin(rot);
      cuv = vec2<f32>(d.x * c - d.y * sn, d.x * sn + d.y * c) + vec2<f32>(0.5);
    } else if (mode == 2u) {
      cuv.x = fract(cuv.x + odd_y * row_off);
    } else {
      if (odd_x > 0.5) { cuv.x = 1.0 - cuv.x; }
      let rot = odd_y * rot_amt;
      let d = cuv - vec2<f32>(0.5);
      let c = cos(rot); let sn = sin(rot);
      cuv = vec2<f32>(d.x * c - d.y * sn, d.x * sn + d.y * c) + vec2<f32>(0.5);
    }
    // Legacy slow drift keeps the native pass's kaleidoscopic motion.
    let rot_t = u.resolution_time.z * 0.05;
    let cs = cos(rot_t); let sn2 = sin(rot_t);
    let dd = cuv - vec2<f32>(0.5);
    let c2 = vec2<f32>(dd.x * cs - dd.y * sn2, dd.x * sn2 + dd.y * cs) + vec2<f32>(0.5);
    let tiled = sample_rgb(clamp(c2, vec2<f32>(0.0), vec2<f32>(1.0)));
    return vec4<f32>(mix(color, tiled, tile_mix), src.a);
  }
  if (code == 94u) {
    // SPIRAL TILE - log-spiral remap of the frame.
    // Generic family slots: amount = blend; params0.x = amount2 (arms/rings),
    // params0.y = amount3 (spin speed), params0.z = threshold (gap).
    let arms_t = clamp(u.params0.x, 0.0, 1.0);
    let spin_rate = clamp(u.params0.y, 0.0, 1.0) * 0.35;
    let gap = clamp(u.params0.z, 0.0, 1.0) * 0.08 + 1e-4;
    let blend = clamp(amount, 0.0, 1.0);
    let centered = (uv - vec2<f32>(0.5)) * vec2<f32>(u.resolution_time.x / u.resolution_time.y, 1.0);
    let r = max(length(centered), 1e-4);
    let theta = atan2(centered.y, centered.x);
    let twist = 1.0 + arms_t * 2.0;
    let arms = 2.0 + floor(arms_t * 3.0);
    let spiral = log(r) * twist + theta / 6.2831853 * arms;
    let sx = fract(spiral - u.resolution_time.z * spin_rate);
    let sy = fract(theta / 6.2831853 + 0.5 + r * 0.3);
    var col2 = sample_rgb(vec2<f32>(sx, sy));
    let seam = (smoothstep(0.0, gap, sx) * smoothstep(1.0, 1.0 - gap, sx))
             * (smoothstep(0.0, gap * 2.0, sy) * smoothstep(1.0, 1.0 - gap * 2.0, sy));
    col2 = mix(vec3<f32>(0.015), col2, seam);
    return vec4<f32>(mix(color, col2 * (0.65 + 0.35 * smoothstep(1.3, 0.2, r)), blend), src.a);
  }
  if (code == 95u) {
    // VORONOI SHATTER - drifting glass shards, dark gaps, crack glints.
    // Generic family slots: params0.x = amount2 (cell count), params0.y =
    // amount3 (drift speed), params0.z = threshold (gap). amount = blend.
    let blend = clamp(amount, 0.0, 1.0);
    let scale = mix(4.0, 24.0, clamp(u.params0.x, 0.0, 1.0));
    let drift = clamp(u.params0.y, 0.0, 1.0) * 1.5;
    let gap = clamp(u.params0.z, 0.0, 1.0) * 0.06;
    let aspect = vec2<f32>(u.resolution_time.x / u.resolution_time.y, 1.0);
    let sp = uv * scale * aspect;
    let i = floor(sp);
    var md = 8.0; var md2 = 8.0; var mc = vec2<f32>(0.0); var mp = vec2<f32>(0.0);
    for (var yy = -1; yy <= 1; yy = yy + 1) {
      for (var xx = -1; xx <= 1; xx = xx + 1) {
        let g = vec2<f32>(f32(xx), f32(yy));
        let cell_id = i + g;
        let rnd = vec2<f32>(hash21(cell_id), hash21(cell_id + vec2<f32>(11.3)));
        let p = cell_id + vec2<f32>(0.5) + 0.35 * sin(vec2<f32>(u.resolution_time.z * drift) + rnd * 6.2831853);
        let r = p - sp;
        let d = dot(r, r);
        if (d < md) { md2 = md; md = d; mc = cell_id; mp = p; }
        else if (d < md2) { md2 = d; }
      }
    }
    let edge_d = sqrt(md2) - sqrt(md);
    let edge = smoothstep(gap, gap + 0.04, edge_d);
    let cell_rnd = vec2<f32>(hash21(mc + vec2<f32>(5.1)), hash21(mc + vec2<f32>(9.7)));
    let shard_ang = sin(u.resolution_time.z * drift * 0.7 + cell_rnd.x * 6.2831853) * 0.2;
    let ca = cos(shard_ang); let sa = sin(shard_ang);
    let local = (sp - mp) / scale / aspect;
    let rl = vec2<f32>(local.x * ca - local.y * sa, local.x * sa + local.y * ca);
    let cell_uv = mp / scale / aspect;
    let shard = sample_rgb(clamp(cell_uv + rl, vec2<f32>(0.0), vec2<f32>(1.0)));
    let lighting = 0.6 + cell_rnd.y * 0.4 + (mp.x - sp.x) * 0.2;
    let glint = pow(1.0 - clamp(sqrt(md), 0.0, 1.0), 6.0) * 0.15;
    let highlight = smoothstep(gap + 0.06, gap + 0.01, edge_d) * edge;
    var col = shard * lighting * edge + vec3<f32>(0.3, 0.35, 0.5) * highlight * 0.4 + vec3<f32>(0.9, 0.95, 1.0) * glint;
    col = mix(vec3<f32>(0.01), col, edge);
    return vec4<f32>(mix(color, clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), blend), src.a);
  }
  if (code == 96u) {
    // THERMAL CONTOUR - palette-mapped heat with isotherm rings.
    // params0 = (palette, contour count, contour width, contour glow);
    // params1.x = track blobs; amount = intensity; pass mix carries tcMix.
    let palette = u32(round(clamp(u.params0.x, 0.0, 3.0)));
    let contour_count = clamp(u.params0.y, 1.0, 12.0);
    let contour_width = max(0.001, u.params0.z);
    let contour_glow = clamp(u.params0.w, 0.0, 1.0);
    let track_blobs = clamp(u.params1.x, 0.0, 1.0);
    let intensity = clamp(amount, 0.0, 2.0);
    let heat = luma(color);
    var thermal = vec3<f32>(0.0);
    if (palette == 1u) {
      thermal = vec3<f32>(
        smoothstep(0.35, 0.65, heat) - smoothstep(0.85, 1.0, heat),
        smoothstep(0.0, 0.35, heat) - smoothstep(0.65, 1.0, heat),
        smoothstep(0.0, 0.15, heat) - smoothstep(0.5, 0.7, heat)
      );
    } else if (palette == 2u) {
      thermal = vec3<f32>(0.27 + 0.5 * heat, 0.005 + 0.9 * heat, 0.33 + 0.5 * (1.0 - heat));
    } else if (palette == 3u) {
      var c = mix(vec3<f32>(0.0), vec3<f32>(0.4, 0.0, 0.4), smoothstep(0.0, 0.3, heat));
      c = mix(c, vec3<f32>(0.95, 0.4, 0.1), smoothstep(0.3, 0.65, heat));
      c = mix(c, vec3<f32>(1.0, 1.0, 0.6), smoothstep(0.65, 1.0, heat));
      thermal = c;
    } else {
      var c = mix(vec3<f32>(0.0, 0.0, 0.3), vec3<f32>(0.5, 0.0, 0.5), smoothstep(0.0, 0.25, heat));
      c = mix(c, vec3<f32>(1.0, 0.3, 0.0), smoothstep(0.25, 0.55, heat));
      c = mix(c, vec3<f32>(1.0, 1.0, 0.2), smoothstep(0.55, 0.85, heat));
      c = mix(c, vec3<f32>(1.0), smoothstep(0.85, 1.0, heat));
      thermal = c;
    }
    thermal = thermal * intensity;
    let band_pos = fract(heat * contour_count);
    let contour = smoothstep(contour_width, 0.0, abs(band_pos - 0.5)) * contour_glow;
    thermal = thermal + vec3<f32>(contour);
    if (track_blobs > 0.001) {
      // Stateless luma-cluster highlight: bright low-gradient regions lift.
      let texel = vec2<f32>(1.0) / max(u.resolution_time.xy, vec2<f32>(2.0));
      let l_n = luma(sample_rgb(uv + texel * vec2<f32>(0.0, 4.0)));
      let l_s = luma(sample_rgb(uv - texel * vec2<f32>(0.0, 4.0)));
      let l_e = luma(sample_rgb(uv + texel * vec2<f32>(4.0, 0.0)));
      let l_w = luma(sample_rgb(uv - texel * vec2<f32>(4.0, 0.0)));
      let grad_mag = abs(heat - l_n) + abs(heat - l_s) + abs(heat - l_e) + abs(heat - l_w);
      thermal = thermal + vec3<f32>(0.2, 1.0, 0.8) * smoothstep(0.6, 1.0, heat) * track_blobs * max(0.0, 1.0 - grad_mag);
    }
    return vec4<f32>(clamp(thermal, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 97u) {
    // phase-lab: scientific-imaging false-color modes (BOS/photoelastic/Lippmann/InSAR/catoptric/DTI)
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let mode = u32(round(u.params0.x));
    let pl_scale = max(0.1, u.params0.y);
    let pl_speed = u.params0.z;
    let pl_phase = u.params0.w;
    let color_gain = max(0.0, u.params1.x);
    let source_bleed = clamp(u.params1.y, 0.0, 1.0);
    let edge_boost = max(0.0, u.params1.z);
    let distortion = u.params1.w;
    let line_density = max(0.1, u.params2.x);
    let polarizer_deg = u.params2.y;
    let spectral_shift = u.params2.z;
    let pl_focus = max(0.08, u.params2.w);
    let intensity = amount * (1.0 + clamp(u.params3.z, 0.0, 4.5));
    let tau = 6.283185307179586;
    let texel = 1.0 / max(res, vec2<f32>(2.0));

    // luma gradient (BT.709)
    let g_step = texel * max(1.0, 1.0 + pl_scale * 0.08);
    let lum_l = dot(sample_rgb(uv - vec2<f32>(g_step.x, 0.0)), vec3<f32>(0.2126, 0.7152, 0.0722));
    let lum_r = dot(sample_rgb(uv + vec2<f32>(g_step.x, 0.0)), vec3<f32>(0.2126, 0.7152, 0.0722));
    let lum_d = dot(sample_rgb(uv - vec2<f32>(0.0, g_step.y)), vec3<f32>(0.2126, 0.7152, 0.0722));
    let lum_u = dot(sample_rgb(uv + vec2<f32>(0.0, g_step.y)), vec3<f32>(0.2126, 0.7152, 0.0722));
    let lum_c = dot(src.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let grad = vec2<f32>(lum_r - lum_l, lum_u - lum_d) * 0.5;
    let lapl = lum_l + lum_r + lum_d + lum_u - 4.0 * lum_c;

    var col = src.rgb;
    if (mode == 0u || mode >= 7u) {
      // BOS schlieren
      let g = grad * edge_boost * 4.0;
      let curl = vec2<f32>(
        fbm2d(uv * pl_scale + vec2<f32>(0.0, time * pl_speed)) - 0.5,
        fbm2d(uv.yx * pl_scale + vec2<f32>(4.7, -time * pl_speed * 0.77)) - 0.5
      );
      let flow = g + 0.18 * curl;
      let refracted = sample_rgb(uv + flow * distortion * intensity);
      let edge = pow(clamp(length(g) * intensity * 5.0 + abs(lapl) * 2.0, 0.0, 1.0), 0.55);
      let angle01 = atan2(flow.y, flow.x) / tau + 0.5;
      let hh = fract(angle01 + edge * 0.32 + pl_phase + time * pl_speed * 0.05);
      let false_color = clamp(vec3<f32>(0.55, 0.48, 0.42) + vec3<f32>(0.48, 0.54, 0.58) * cos(tau * (vec3<f32>(hh) + vec3<f32>(0.0, 0.22, 0.58))), vec3<f32>(0.0), vec3<f32>(1.0));
      let ca = vec3<f32>(
        sample_rgb(uv + flow * distortion * 1.35).r,
        sample_rgb(uv + flow * distortion * 0.70).g,
        sample_rgb(uv - flow * distortion * 1.10).b
      );
      col = clamp(false_color * edge * color_gain + ca * (0.25 + 0.55 * edge), vec3<f32>(0.0), vec3<f32>(1.0));
      col = mix(refracted, col, 0.92);
    } else if (mode == 1u) {
      // Photoelastic stress fringes
      let g = grad * edge_boost;
      let angle = atan2(g.y, g.x) + polarizer_deg * 0.017453292;
      let stress = length(g) * intensity * 14.0 + fbm2d(uv * pl_scale + vec2<f32>(time * pl_speed * 0.15, 0.0)) * 2.2;
      let ph = stress * line_density + pl_phase + 1.8 * sin(angle * 2.0 + time * pl_speed);
      let iso = 0.5 + 0.5 * cos(vec3<f32>(0.0, 2.15, 4.32) + vec3<f32>(ph));
      let isoclinic = pow(abs(sin(2.0 * angle)), 0.55);
      let fringe = clamp(iso * (0.25 + 0.85 * isoclinic), vec3<f32>(0.0), vec3<f32>(1.0));
      let dark = smoothstep(0.04, 0.42, abs(sin(ph * 0.5)));
      let gh = fract(ph / tau + spectral_shift);
      let glow = clamp(vec3<f32>(0.55, 0.48, 0.42) + vec3<f32>(0.48, 0.54, 0.58) * cos(tau * (vec3<f32>(gh) + vec3<f32>(0.0, 0.22, 0.58))), vec3<f32>(0.0), vec3<f32>(1.0)) * (0.25 + length(g) * 3.0);
      col = clamp((fringe * dark + glow * 0.28) * color_gain, vec3<f32>(0.0), vec3<f32>(1.0));
    } else if (mode == 2u) {
      // Lippmann interference iridescence
      let view = (uv.x - 0.5) * 2.0 + sin(time * pl_speed) * 0.25 + spectral_shift;
      let micro = fbm2d(uv * pl_scale * 2.0 + vec2<f32>(time * pl_speed * 0.05, 0.0));
      let standing = vec3<f32>(
        cos(lum_c * 42.0 + view * 5.5 + micro * 6.0 + pl_phase),
        cos(lum_c * 55.0 + view * 7.0 + micro * 4.5 + pl_phase + 1.8),
        cos(lum_c * 69.0 + view * 8.5 + micro * 3.5 + pl_phase + 3.4)
      ) * 0.5 + vec3<f32>(0.5);
      let sh = fract(lum_c * 1.8 + view * 0.22 + micro * 0.35);
      let spectral = clamp(vec3<f32>(0.55, 0.48, 0.42) + vec3<f32>(0.48, 0.54, 0.58) * cos(tau * (vec3<f32>(sh) + vec3<f32>(0.0, 0.22, 0.58))), vec3<f32>(0.0), vec3<f32>(1.0));
      let irid = clamp(src.rgb * (vec3<f32>(0.35) + 0.9 * standing) + spectral * 0.45, vec3<f32>(0.0), vec3<f32>(1.0));
      let glint = pow(clamp(standing.r * standing.g * standing.b, 0.0, 1.0), 3.0);
      col = clamp((irid + glint * vec3<f32>(0.9, 0.95, 1.0)) * color_gain, vec3<f32>(0.0), vec3<f32>(1.0));
    } else if (mode == 3u) {
      // InSAR wrapped-phase fringes
      let p = (uv - vec2<f32>(0.5)) * vec2<f32>(res.x / max(1.0, res.y), 1.0);
      let elev = lum_c * intensity * 7.0 + fbm2d(uv * pl_scale + vec2<f32>(time * pl_speed * 0.08, 1.7)) * 2.0 + length(p) * 5.0;
      let ph = elev * line_density + pl_phase + time * pl_speed;
      let wrapped = fract(ph / tau);
      let hp = abs(fract(vec3<f32>(wrapped) + vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3<f32>(3.0));
      let fringe = 1.0 * mix(vec3<f32>(1.0), clamp(hp - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), 0.86);
      let contour = 1.0 - smoothstep(0.0, 0.055, abs(wrapped - 0.5));
      let speckle_cell = floor(uv * res / max(1.0, pl_scale * 0.25));
      let speckle = pow(hash21(speckle_cell + floor(time * 12.0)), 1.8);
      col = clamp((fringe * (0.62 + speckle * 0.55) + contour * vec3<f32>(0.9, 1.0, 1.0) * 0.35) * color_gain, vec3<f32>(0.0), vec3<f32>(1.0));
    } else if (mode == 4u || mode == 5u) {
      // Catoptric anamorphic mirror
      let p = uv - vec2<f32>(0.5);
      let r = length(p);
      let a = atan2(p.y, p.x);
      let radius = clamp(p_or(u.params3.x, 0.16), 0.03, 0.45);
      let ring_start = radius * 1.05;
      let ring_end = 0.72;
      let ring_t = clamp((r - ring_start) / max(0.001, ring_end - ring_start), 0.0, 1.0);
      let exponent = select(pl_focus, max(0.08, p_or(u.params3.y, 1.2)), mode == 5u);
      let y = pow(ring_t, exponent);
      let x = fract(a / tau + 0.5 + 0.03 * sin(time * pl_speed + y * tau));
      let warped = sample_rgb(vec2<f32>(x, 1.0 - y));
      let annulus = smoothstep(ring_start, ring_start + 0.02, r) * (1.0 - smoothstep(ring_end - 0.02, ring_end, r));
      let mirror_body = 1.0 - smoothstep(radius * 0.85, radius, r);
      let metal = vec3<f32>(0.78, 0.82, 0.86) * (0.35 + 0.65 * pow(1.0 - clamp(r / radius, 0.0, 1.0), 1.8));
      let reflected = sample_rgb(vec2<f32>(fract(a / tau + 0.5), clamp(r / radius, 0.0, 1.0)));
      let grid = 0.18 * (1.0 - smoothstep(0.01, 0.035, abs(fract(x * 24.0) - 0.5)));
      let ph2 = fract(a / tau + time * 0.02);
      let pal = clamp(vec3<f32>(0.55, 0.48, 0.42) + vec3<f32>(0.48, 0.54, 0.58) * cos(tau * (vec3<f32>(ph2) + vec3<f32>(0.0, 0.22, 0.58))), vec3<f32>(0.0), vec3<f32>(1.0));
      let gh = fract(x + y + pl_phase);
      let glow_pal = clamp(vec3<f32>(0.55, 0.48, 0.42) + vec3<f32>(0.48, 0.54, 0.58) * cos(tau * (vec3<f32>(gh) + vec3<f32>(0.0, 0.22, 0.58))), vec3<f32>(0.0), vec3<f32>(1.0));
      col = clamp((warped * annulus + (mix(metal, reflected, 0.35) + pal * 0.18) * mirror_body + glow_pal * grid * annulus) * color_gain, vec3<f32>(0.0), vec3<f32>(1.0));
    } else {
      // DTI fiber-orientation ribbons
      let g = grad * edge_boost;
      let n = fbm2d(uv * pl_scale + vec2<f32>(time * pl_speed * 0.08, 0.0));
      let angle = atan2(g.y, g.x) + (n - 0.5) * 3.14159265 * 1.2 + pl_phase;
      let dir = vec2<f32>(cos(angle), sin(angle));
      let normal = vec2<f32>(-dir.y, dir.x);
      let along = dot(uv - vec2<f32>(0.5), dir);
      let across = dot(uv - vec2<f32>(0.5), normal);
      let ribbon_phase = across * line_density + sin(along * pl_scale * 8.0 + time * pl_speed) * 0.9;
      let stripe = pow(1.0 - smoothstep(0.0, 0.42, abs(fract(ribbon_phase) - 0.5)), 1.7);
      let anisotropy = clamp(length(g) * intensity * 7.0 + n * 0.4, 0.0, 1.0);
      let twist = 0.5 + 0.5 * sin(along * line_density * 0.7 + time * pl_speed + angle * 2.0);
      let fh = fract(angle / tau + twist * 0.18 + spectral_shift);
      let fiber = clamp(vec3<f32>(0.55, 0.48, 0.42) + vec3<f32>(0.48, 0.54, 0.58) * cos(tau * (vec3<f32>(fh) + vec3<f32>(0.0, 0.22, 0.58))), vec3<f32>(0.0), vec3<f32>(1.0)) * stripe * (0.25 + anisotropy);
      col = clamp((src.rgb * (0.18 + source_bleed) + fiber * (1.0 + anisotropy)) * color_gain, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 98u) {
    // lens-dirt: dust/scratch overlay gated on bright areas
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let d_scale = max(0.5, u.params0.x);
    let threshold = u.params0.y;
    let tint_warmth = clamp(u.params0.z, 0.0, 1.0);
    let scratches_amt = u.params0.w;
    let spots_amt = u.params1.x;
    let d_mode = u32(round(u.params1.y));
    let anim_speed = u.params1.z;
    let drift_uv = uv + vec2<f32>(time * anim_speed * 0.01, time * anim_speed * 0.005);
    var spots = 0.0;
    if (spots_amt > 0.001) {
      let n1 = value_noise2d(drift_uv * d_scale * 4.0);
      let n2 = value_noise2d(drift_uv * d_scale * 8.0 + vec2<f32>(13.7, 9.1));
      let n3 = value_noise2d(drift_uv * d_scale * 12.0 + vec2<f32>(45.2, 71.3));
      spots = smoothstep(0.3, 0.6, n1 * n2 * n3 * 4.0) * spots_amt;
    }
    var scratches = 0.0;
    if (scratches_amt > 0.001) {
      let xn = hash21(vec2<f32>(floor(drift_uv.x * res.x * 0.05), 0.0));
      scratches = step(0.97, xn) * scratches_amt * 0.7;
    }
    var dirt = clamp(spots + scratches, 0.0, 1.0);
    let bright = smoothstep(threshold, threshold + 0.2, luma(src.rgb));
    dirt = dirt * bright * amount;
    let dust_color = mix(vec3<f32>(0.9, 0.95, 1.0), vec3<f32>(1.0, 0.85, 0.65), tint_warmth);
    let dirt_rgb = dust_color * dirt;
    var result = src.rgb;
    if (d_mode == 0u) {
      result = vec3<f32>(1.0) - (vec3<f32>(1.0) - src.rgb) * (vec3<f32>(1.0) - dirt_rgb);
    } else if (d_mode == 1u) {
      result = src.rgb + dirt_rgb;
    } else {
      result = src.rgb * (1.0 - dirt * 0.5);
    }
    return vec4<f32>(result, src.a);
  }
  if (code == 99u) {
    // diffusion-promist: highlight bloom + shadow lift + haze
    let res = u.resolution_time.xy;
    let radius = max(1.0, u.params0.x);
    let threshold = u.params0.y;
    let shadow_lift = u.params0.z;
    let highlight_bloom = u.params0.w;
    let haze = u.params1.x;
    let haze_warmth = clamp(u.params1.y, 0.0, 1.0);
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    var bloom = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var y = -5; y <= 5; y = y + 1) {
      for (var x = -5; x <= 5; x = x + 1) {
        if (abs(x) + abs(y) > 7) { continue; }
        let off = vec2<f32>(f32(x), f32(y)) * texel * radius * 0.4;
        let s_col = sample_rgb(uv + off);
        let gate = smoothstep(threshold, threshold + 0.2, luma(s_col));
        let w = exp(-f32(x * x + y * y) / (2.0 * radius * radius));
        bloom = bloom + s_col * gate * w;
        wsum = wsum + w;
      }
    }
    if (wsum > 0.0) { bloom = bloom / wsum; }
    bloom = bloom * highlight_bloom * 1.5;
    let lifted = src.rgb + (vec3<f32>(1.0) - src.rgb) * shadow_lift * 0.15;
    let haze_color = mix(vec3<f32>(0.7, 0.75, 0.8), vec3<f32>(0.95, 0.85, 0.7), haze_warmth);
    let hazed = mix(lifted, haze_color, haze * 0.3);
    let screened = vec3<f32>(1.0) - (vec3<f32>(1.0) - hazed) * (vec3<f32>(1.0) - bloom);
    return vec4<f32>(mix(src.rgb, screened, clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 100u) {
    // compression-artifacts: block quantize + chroma subsample + banding
    let res = u.resolution_time.xy;
    let block_size = max(2.0, u.params0.x);
    let quality = clamp(u.params0.y, 0.0, 1.0);
    let chroma_subsample = u.params0.z;
    let block_noise = u.params0.w;
    let c_mode = u32(round(u.params1.x));
    let px = uv * res;
    let block_id = floor(px / block_size);
    var avg = vec3<f32>(0.0);
    for (var y = 0; y < 4; y = y + 1) {
      for (var x = 0; x < 4; x = x + 1) {
        let sp = (block_id * block_size + vec2<f32>(f32(x), f32(y)) * block_size * 0.25) / res;
        avg = avg + sample_rgb(sp);
      }
    }
    avg = avg / 16.0;
    var result = src.rgb;
    if (c_mode == 0u || c_mode == 1u) {
      let q_step = mix(0.01, 0.2, 1.0 - quality);
      let quant = floor(src.rgb / q_step) * q_step;
      let block_bias = select(0.45, 0.65, c_mode == 1u);
      result = mix(quant, avg, block_bias * (1.0 - quality));
      if (block_noise > 0.001) {
        let bn = (hash21(block_id) - 0.5) * block_noise * 0.15;
        result = result + vec3<f32>(bn);
      }
    } else {
      let ycc = vec3<f32>(
        0.299 * src.r + 0.587 * src.g + 0.114 * src.b,
        -0.169 * src.r - 0.331 * src.g + 0.5 * src.b + 0.5,
        0.5 * src.r - 0.419 * src.g - 0.081 * src.b + 0.5
      );
      let y_step = mix(0.005, 0.05, 1.0 - quality);
      let c_step = mix(0.02, 0.2, 1.0 - quality);
      let qy = floor(ycc.x / y_step) * y_step;
      let qcb = floor(ycc.y / c_step) * c_step - 0.5;
      let qcr = floor(ycc.z / c_step) * c_step - 0.5;
      result = vec3<f32>(qy + 1.402 * qcr, qy - 0.344 * qcb - 0.714 * qcr, qy + 1.772 * qcb);
    }
    if (chroma_subsample > 0.001) {
      let sub_y = 0.299 * avg.r + 0.587 * avg.g + 0.114 * avg.b;
      let sub_cb = -0.169 * avg.r - 0.331 * avg.g + 0.5 * avg.b;
      let sub_cr = 0.5 * avg.r - 0.419 * avg.g - 0.081 * avg.b;
      let here_y = 0.299 * result.r + 0.587 * result.g + 0.114 * result.b;
      let here_cb = -0.169 * result.r - 0.331 * result.g + 0.5 * result.b;
      let here_cr = 0.5 * result.r - 0.419 * result.g - 0.081 * result.b;
      let cb = mix(here_cb, sub_cb, chroma_subsample);
      let cr = mix(here_cr, sub_cr, chroma_subsample);
      result = vec3<f32>(here_y + 1.402 * cr, here_y - 0.344 * cb - 0.714 * cr, here_y + 1.772 * cb);
    }
    return vec4<f32>(mix(src.rgb, clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(amount, 0.0, 1.0)), src.a);
  }
  if (code == 101u) {
    // datamosh-lite: pixel-sort-style offset by luminance bands
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let intensity = amount;
    let band_width = 5.0 + u.params0.x * 30.0;
    let color_shift = u.params0.y;
    let l = dot(src.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let band = floor(l * band_width) / band_width;
    let sort_offset = (band - 0.5) * intensity * 0.15;
    let jitter = hash21(vec2<f32>(floor(uv.y * res.y * 0.5), floor(time * 3.0))) * 0.02 * intensity;
    let sample_uv = uv + vec2<f32>(sort_offset + jitter, 0.0);
    var col = sample_rgb(sample_uv);
    if (color_shift > 0.01) {
      col.r = sample_rgb(sample_uv + vec2<f32>(color_shift * 0.01, 0.0)).r;
      col.b = sample_rgb(sample_uv - vec2<f32>(color_shift * 0.01, 0.0)).b;
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 102u) {
    // scanline-drift: per-line horizontal drift with waveform select
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let frequency = max(1.0, u.params0.x);
    let speed = u.params0.y;
    let waveform = u32(round(u.params0.z));
    let chroma_split = u.params0.w;
    let chunkiness = u.params1.x;
    var y_line = uv.y;
    if (chunkiness > 0.001) {
      let chunk = mix(1.0, 32.0, chunkiness);
      y_line = floor(uv.y * res.y / chunk) * chunk / res.y;
    }
    let t = time * speed;
    var drift = 0.0;
    if (waveform == 0u) {
      drift = sin(y_line * frequency + t);
    } else if (waveform == 1u) {
      drift = (hash21(vec2<f32>(floor(y_line * frequency) + floor(t * 8.0), 0.0)) - 0.5) * 2.0;
    } else {
      drift = fract(y_line * frequency + t) * 2.0 - 1.0;
    }
    drift = drift * amount * 0.05;
    var col = vec3<f32>(0.0);
    if (chroma_split > 0.001) {
      col.r = sample_rgb(vec2<f32>(uv.x + drift * (1.0 + chroma_split * 0.3), uv.y)).r;
      col.g = sample_rgb(vec2<f32>(uv.x + drift, uv.y)).g;
      col.b = sample_rgb(vec2<f32>(uv.x + drift * (1.0 - chroma_split * 0.3), uv.y)).b;
    } else {
      col = sample_rgb(vec2<f32>(uv.x + drift, uv.y));
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 103u) {
    // tape-dropout: random horizontal noise stripes
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let stripe_len = u.params0.x;
    let color_mode = u32(round(u.params0.y));
    let speed = u.params0.z;
    let noise_amp = u.params0.w;
    let t = floor(time * speed * 8.0) / 8.0;
    let y_bucket = floor(uv.y * 80.0);
    let trigger = hash21(vec2<f32>(y_bucket, t));
    let len_h = hash21(vec2<f32>(y_bucket + 13.0, t));
    let start_x = hash21(vec2<f32>(y_bucket + 27.0, t));
    let seg_len = stripe_len * mix(0.05, 0.5, len_h);
    let in_stripe = step(1.0 - amount * 0.4, trigger) * step(start_x, uv.x) * step(uv.x, start_x + seg_len);
    if (in_stripe < 0.5) { return src; }
    let n = hash21(vec2<f32>(uv.x * res.x, t * 100.0));
    var stripe = vec3<f32>(n);
    if (color_mode == 1u) {
      stripe = vec3<f32>(n * 0.6 + 0.2);
    } else if (color_mode >= 2u) {
      let hue = hash21(vec2<f32>(y_bucket, t * 13.0));
      stripe = mix(vec3<f32>(1.0, 0.0, 0.4), vec3<f32>(0.0, 1.0, 0.6), hue);
      stripe = mix(stripe, vec3<f32>(0.4, 0.4, 1.0), n);
    }
    stripe = mix(stripe, src.rgb, 1.0 - noise_amp);
    return vec4<f32>(mix(src.rgb, stripe, in_stripe), src.a);
  }
  if (code == 104u) {
    // ripple-caustics: voronoi-ridge caustic light + refraction
    let time = u.resolution_time.z;
    let c_scale = max(0.5, u.params0.x);
    let speed = u.params0.y;
    let refraction = u.params0.z;
    let tint = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let c_mode = u32(round(u.params1.z));
    let p = uv * c_scale;
    let t = time * speed;
    var min_d1a = 9.0; var min_d2a = 9.0;
    var min_d1b = 9.0; var min_d2b = 9.0;
    let pb = p + vec2<f32>(17.3);
    let tb = t * 1.3 + 1.7;
    let ia = floor(p); let fa = fract(p);
    let ib = floor(pb); let fb = fract(pb);
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let g = vec2<f32>(f32(x), f32(y));
        var oa = vec2<f32>(hash21(ia + g), fract(sin(dot(ia + g, vec2<f32>(269.5, 183.3))) * 43758.5453));
        oa = vec2<f32>(0.5) + 0.5 * sin(t + 6.28 * oa);
        let ra = g + oa - fa;
        let da = dot(ra, ra);
        if (da < min_d1a) { min_d2a = min_d1a; min_d1a = da; } else if (da < min_d2a) { min_d2a = da; }
        var ob = vec2<f32>(hash21(ib + g), fract(sin(dot(ib + g, vec2<f32>(269.5, 183.3))) * 43758.5453));
        ob = vec2<f32>(0.5) + 0.5 * sin(tb + 6.28 * ob);
        let rb = g + ob - fb;
        let db = dot(rb, rb);
        if (db < min_d1b) { min_d2b = min_d1b; min_d1b = db; } else if (db < min_d2b) { min_d2b = db; }
      }
    }
    let c1 = sqrt(min_d2a) - sqrt(min_d1a);
    let c2 = sqrt(min_d2b) - sqrt(min_d1b);
    let c = pow(max(0.0, min(c1, c2)), 1.5) * amount;
    var s_uv = uv;
    if (refraction > 0.001) {
      s_uv = s_uv + vec2<f32>(c1 - c2, c2 - c1) * refraction * 0.04;
    }
    let base = sample_rgb(s_uv);
    let caust_color = tint * c;
    var result = base + caust_color;
    if (c_mode == 1u) {
      result = base + caust_color * 1.5;
    } else if (c_mode >= 2u) {
      result = vec3<f32>(1.0) - (vec3<f32>(1.0) - base) * (vec3<f32>(1.0) - caust_color);
    }
    return vec4<f32>(result, src.a);
  }
  if (code == 105u) {
    // shockwave: expanding refraction ring (looping or one-shot)
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let trigger_time = u.params0.x;
    let speed = max(0.1, u.params0.y);
    let ring_width = max(0.01, u.params0.z);
    let center = vec2<f32>(u.params0.w, u.params1.x);
    let chromatic = u.params1.y;
    let s_mode = u32(round(u.params1.z));
    var wave_time = time - floor(time * speed * 0.5) * (2.0 / speed);
    if (s_mode == 0u) {
      wave_time = time - floor(time / (2.0 / speed)) * (2.0 / speed);
    } else {
      wave_time = max(0.0, time - trigger_time);
    }
    let aspect = res.x / max(1.0, res.y);
    var d0 = uv - center;
    d0.x = d0.x * aspect;
    let r = length(d0);
    var dir = vec2<f32>(1.0, 0.0);
    if (r > 0.001) { dir = d0 / r; }
    dir.x = dir.x / aspect;
    let ring_r0 = wave_time * speed;
    let band0 = smoothstep(ring_width * 0.5, 0.0, abs(r - ring_r0));
    let base_off = dir * band0 * amount;
    var col = vec3<f32>(0.0);
    if (chromatic > 0.001) {
      let ring_rr = (wave_time + 0.05 * chromatic) * speed;
      let ring_rb = (wave_time - 0.05 * chromatic) * speed;
      let band_r = smoothstep(ring_width * 0.5, 0.0, abs(r - ring_rr));
      let band_b = smoothstep(ring_width * 0.5, 0.0, abs(r - ring_rb));
      col.r = sample_rgb(uv + dir * band_r * amount).r;
      col.g = sample_rgb(uv + base_off).g;
      col.b = sample_rgb(uv + dir * band_b * amount).b;
    } else {
      col = sample_rgb(uv + base_off);
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 106u) {
    // droste-recursive: iterative zoom-rotate toward center
    let rotation_deg = u.params0.x;
    let iterations = u32(clamp(round(u.params0.y), 1.0, 12.0));
    let center = vec2<f32>(u.params0.z, u.params0.w);
    let frame_size = u.params1.x;
    let zoom = max(1.01, amount);
    var s_uv = uv;
    let ang = rotation_deg * 0.017453292;
    let ca = cos(ang); let sa = sin(ang);
    for (var i = 0u; i < 12u; i = i + 1u) {
      if (i >= iterations) { break; }
      var d = s_uv - center;
      let r = length(d - vec2<f32>(0.5) + center);
      if (r > frame_size) {
        d = d * zoom;
        d = vec2<f32>(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
        s_uv = center + d;
      }
    }
    let droste = sample_rgb(clamp(s_uv, vec2<f32>(0.0), vec2<f32>(1.0)));
    return vec4<f32>(droste, src.a);
  }
  if (code == 107u) {
    // slit-scan: sweeping displacement bands
    let time = u.resolution_time.z;
    let s_mode = u32(round(u.params0.x));
    let pattern = u32(round(u.params0.y));
    let speed = u.params0.z;
    let chroma_split = u.params0.w;
    var col = vec3<f32>(0.0);
    for (var ch = 0; ch < 3; ch = ch + 1) {
      var phase_shift = 0.0;
      if (chroma_split > 0.001) {
        if (ch == 0) { phase_shift = 0.3 * chroma_split; }
        if (ch == 2) { phase_shift = -0.3 * chroma_split; }
      }
      let coord = select(uv.y, uv.x, s_mode == 1u);
      let t = time * speed + phase_shift;
      var p = coord + t * 0.3;
      if (pattern == 1u) {
        p = sin(coord * 8.0 + t * 2.0);
      } else if (pattern >= 2u) {
        p = (hash21(vec2<f32>(floor(coord * 50.0) + floor(t * 8.0), 0.0)) - 0.5) * 2.0;
      }
      var off = vec2<f32>(0.0);
      if (s_mode == 0u) {
        off.x = p * amount * 0.3;
      } else if (s_mode == 1u) {
        off.y = p * amount * 0.3;
      } else if (s_mode == 2u) {
        let d = uv - vec2<f32>(0.5);
        let r = length(d);
        var dir = vec2<f32>(1.0, 0.0);
        if (r > 0.001) { dir = d / r; }
        off = dir * p * amount * 0.3;
      } else {
        off.x = (uv.y - 0.5) * amount * 0.5;
        off.y = sin(t + uv.x * 6.28) * amount * 0.1;
      }
      let s = sample_rgb(uv + off);
      if (ch == 0) { col.r = s.r; }
      if (ch == 1) { col.g = s.g; }
      if (ch == 2) { col.b = s.b; }
      if (chroma_split <= 0.001) { col = s; break; }
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 108u) {
    // fractal-warp: fbm/ridged domain warp
    let time = u.resolution_time.z;
    let w_scale = max(0.1, u.params0.x);
    let octaves = u32(clamp(round(u.params0.y), 1.0, 6.0));
    let speed = u.params0.z;
    let chromatic = u.params0.w;
    let w_mode = u32(round(u.params1.x));
    let t = time * speed * 0.2;
    var col = vec3<f32>(0.0);
    for (var ch = 0; ch < 3; ch = ch + 1) {
      var chroma_shift = 0.0;
      if (chromatic > 0.001) {
        if (ch == 0) { chroma_shift = chromatic * 0.5; }
        if (ch == 2) { chroma_shift = -chromatic * 0.5; }
      }
      let p = uv * w_scale + vec2<f32>(t + chroma_shift);
      var nx = 0.0; var ny = 0.0;
      var fx = 0.0; var fy = 0.0; var rx = 0.0; var ry = 0.0;
      var amp = 0.5;
      var pp = p;
      var pq = p + vec2<f32>(31.7);
      for (var i = 0u; i < 6u; i = i + 1u) {
        if (i >= octaves) { break; }
        let n1 = value_noise2d(pp);
        let n2 = value_noise2d(pq);
        fx = fx + n1 * amp;
        fy = fy + n2 * amp;
        rx = rx + (1.0 - abs(n1 - 0.5) * 2.0) * amp;
        ry = ry + (1.0 - abs(n2 - 0.5) * 2.0) * amp;
        pp = pp * 2.0;
        pq = pq * 2.0;
        amp = amp * 0.5;
      }
      if (w_mode == 0u) {
        nx = fx - 0.5; ny = fy - 0.5;
      } else if (w_mode == 1u) {
        nx = rx - 0.5; ny = ry - 0.5;
      } else {
        nx = (fx + rx) * 0.5 - 0.5; ny = (fy + ry) * 0.5 - 0.5;
      }
      let off = vec2<f32>(nx, ny) * amount * 0.1;
      let s = sample_rgb(uv + off);
      if (ch == 0) { col.r = s.r; }
      if (ch == 1) { col.g = s.g; }
      if (ch == 2) { col.b = s.b; }
      if (chromatic <= 0.001) { col = s; break; }
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 109u) {
    // fluid-distort: curl-noise flow displacement
    let time = u.resolution_time.z;
    let f_scale = max(0.1, u.params0.x);
    let speed = u.params0.y;
    let turbulence = u.params0.z;
    let f_mode = u32(round(u.params0.w));
    let p = uv * f_scale + vec2<f32>(time * speed * 0.1);
    let e = 0.05;
    var c = vec2<f32>(
      value_noise2d(p + vec2<f32>(0.0, e)) - value_noise2d(p - vec2<f32>(0.0, e)),
      -(value_noise2d(p + vec2<f32>(e, 0.0)) - value_noise2d(p - vec2<f32>(e, 0.0)))
    );
    if (turbulence > 0.001) {
      let p2 = p * 2.0 + vec2<f32>(13.7);
      let c2 = vec2<f32>(
        value_noise2d(p2 + vec2<f32>(0.0, e)) - value_noise2d(p2 - vec2<f32>(0.0, e)),
        -(value_noise2d(p2 + vec2<f32>(e, 0.0)) - value_noise2d(p2 - vec2<f32>(e, 0.0)))
      );
      c = c + c2 * turbulence * 0.5;
    }
    var off = c * amount * 0.1;
    if (f_mode == 1u) {
      let d = uv - vec2<f32>(0.5);
      off = (c + normalize(d + vec2<f32>(1e-6)) * 0.3) * amount * 0.08;
    } else if (f_mode >= 2u) {
      off = clamp(c, vec2<f32>(-0.5), vec2<f32>(0.5)) * amount * 0.15;
    }
    return vec4<f32>(sample_rgb(uv + off), src.a);
  }
  if (code == 110u) {
    // wormhole: twist + pull toward center
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let center = vec2<f32>(u.params0.y, u.params0.z);
    let twist = u.params0.w;
    let chromatic = u.params1.x;
    let anim_speed = u.params1.y;
    let aspect = res.x / max(1.0, res.y);
    var col = vec3<f32>(0.0);
    for (var ch = 0; ch < 3; ch = ch + 1) {
      var chroma_shift = 0.0;
      if (chromatic > 0.001) {
        if (ch == 0) { chroma_shift = chromatic * 0.1; }
        if (ch == 2) { chroma_shift = -chromatic * 0.1; }
      }
      var d = uv - center;
      d.x = d.x * aspect;
      var r = length(d);
      var ang = atan2(d.y, d.x);
      ang = ang + twist / max(0.05, r) + time * anim_speed * 0.3 + chroma_shift;
      r = r * mix(1.0, 0.5 + 0.5 * (r * r), amount);
      d = vec2<f32>(cos(ang), sin(ang)) * r;
      d.x = d.x / aspect;
      let s_uv = clamp(center + d, vec2<f32>(0.0), vec2<f32>(1.0));
      let s = sample_rgb(s_uv);
      if (ch == 0) { col.r = s.r; }
      if (ch == 1) { col.g = s.g; }
      if (ch == 2) { col.b = s.b; }
      if (chromatic <= 0.001) { col = s; break; }
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 111u) {
    // vhs-full-deck: tracking + head switch + chroma bleed + dropouts + noise
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let head_switch = u.params0.x;
    let chroma_bleed = u.params0.y;
    let dropouts = u.params0.z;
    let tape_noise = u.params0.w;
    let scanlines_amt = u.params1.x;
    let color_bleed = u.params1.y;
    let saturation = u.params1.z;
    let tracking_jump = u.params1.w;
    let v_mode = u32(round(u.params2.x));
    var mode_boost = 1.0;
    if (v_mode == 1u) { mode_boost = 1.3; }
    if (v_mode >= 2u) { mode_boost = 1.8; }
    var s_uv = uv;
    s_uv.x = s_uv.x + sin(uv.y * 30.0 + time * 2.0) * 0.005 * amount * mode_boost;
    if (tracking_jump > 0.001) {
      let jump = step(0.97, hash21(vec2<f32>(floor(time * 4.0), 0.0))) * tracking_jump;
      if (s_uv.y < 0.4) { s_uv.x = s_uv.x + jump * 0.05; }
    }
    let head_band = smoothstep(0.05, 0.0, s_uv.y) * head_switch * mode_boost;
    if (head_band > 0.01) {
      s_uv.x = s_uv.x + (hash21(vec2<f32>(s_uv.y * 100.0, floor(time * 8.0))) - 0.5) * 0.04;
    }
    let cb = chroma_bleed * mode_boost * 0.04;
    var col = vec3<f32>(
      sample_rgb(s_uv + vec2<f32>(cb, 0.0)).r,
      sample_rgb(s_uv).g,
      sample_rgb(s_uv - vec2<f32>(cb, 0.0)).b
    );
    if (color_bleed > 0.001) {
      let bleed = color_bleed * mode_boost;
      col.r = mix(col.r, sample_rgb(s_uv + vec2<f32>(0.02 * bleed, 0.0)).r, 0.4);
    }
    let l = luma(col);
    col = mix(vec3<f32>(l), col, saturation);
    if (tape_noise > 0.001) {
      let n = (hash21(uv * res + vec2<f32>(time * 60.0)) - 0.5) * tape_noise * mode_boost * 0.4;
      col = col + vec3<f32>(n);
    }
    if (scanlines_amt > 0.001) {
      let sl = sin(s_uv.y * 800.0) * 0.5 + 0.5;
      col = col * mix(1.0, sl * 0.6 + 0.4, scanlines_amt * mode_boost);
    }
    if (dropouts > 0.001) {
      let y_b = floor(s_uv.y * 60.0);
      let drop = step(0.93, hash21(vec2<f32>(y_b, floor(time * 6.0))));
      col = col + vec3<f32>(drop * dropouts * mode_boost * 0.6);
    }
    col = col + vec3<f32>(head_band * 0.5);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 112u) {
    // topo-warp: luma contour bands with displacement + line overlay
    let res = u.resolution_time.xy;
    let contour_count = max(1.0, u.params0.x);
    let contour_width = u.params0.y;
    let chromatic_edge = u.params0.z;
    let line_color = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let shadow_ridges = u.params1.z;
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    let l = luma(src.rgb);
    let l_e = luma(sample_rgb(uv + texel * vec2<f32>(1.0, 0.0)));
    let l_n = luma(sample_rgb(uv + texel * vec2<f32>(0.0, 1.0)));
    let grad = vec2<f32>(l_e - l, l_n - l);
    let band_pos = fract(l * contour_count);
    let ridge = smoothstep(contour_width * 5.0, 0.0, abs(band_pos - 0.5));
    let disp = grad * ridge * amount * 0.3;
    var col = vec3<f32>(0.0);
    if (chromatic_edge > 0.001) {
      col.r = sample_rgb(uv + disp * (1.0 + chromatic_edge * 0.5)).r;
      col.g = sample_rgb(uv + disp).g;
      col.b = sample_rgb(uv + disp * (1.0 - chromatic_edge * 0.5)).b;
    } else {
      col = sample_rgb(uv + disp);
    }
    if (shadow_ridges > 0.001) {
      let side = step(0.5, band_pos);
      col = col * (1.0 - side * ridge * shadow_ridges * 0.5);
    }
    let result = col + line_color * ridge;
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 113u) {
    // strobe-sequencer: BPM step-gated flash/invert/tint/zoom
    let time = u.resolution_time.z;
    let bpm = max(1.0, u.params0.x);
    let steps = clamp(round(u.params0.y), 1.0, 16.0);
    let pattern = u.params0.z;
    let s_mode = u32(round(u.params0.w));
    let tint = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let swing = u.params1.w;
    let beat_len = 60.0 / bpm;
    let step_len = beat_len / steps * 4.0;
    let step_f = (time / step_len) - floor(time / step_len / steps) * steps;
    let step_idx = floor(step_f);
    var frac_part = fract(step_f);
    if (floor(step_idx * 0.5) * 2.0 != step_idx) {
      frac_part = clamp(frac_part - swing, 0.0, 1.0);
    }
    let bit_val = floor(pattern / exp2(step_idx)) - floor(floor(pattern / exp2(step_idx)) * 0.5) * 2.0;
    var gate = 0.0;
    if (bit_val > 0.5 && frac_part < 0.5) { gate = 1.0; }
    var result = src.rgb;
    if (s_mode == 0u) {
      result = mix(src.rgb, src.rgb + tint * amount, gate);
    } else if (s_mode == 1u) {
      result = mix(src.rgb, vec3<f32>(1.0) - src.rgb, gate * amount);
    } else if (s_mode == 2u) {
      result = mix(src.rgb, src.rgb * tint + tint * 0.4, gate * amount);
    } else {
      let d = uv - vec2<f32>(0.5);
      let zoom = 1.0 + gate * amount * 0.1;
      let s_uv = clamp(vec2<f32>(0.5) + d / zoom, vec2<f32>(0.0), vec2<f32>(1.0));
      result = sample_rgb(s_uv);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 114u) {
    // mirror-shards: voronoi/hex/tri cells sampled with per-shard rotation
    let time = u.resolution_time.z;
    let shards = max(2.0, u.params0.x);
    let rotation_deg = u.params0.y;
    let chromatic = u.params0.z;
    let m_mode = u32(round(u.params0.w));
    let ms_delay = clamp(u.params1.x, 0.0, 1.0);
    var cell_id = vec2<f32>(0.0);
    var cell_center = vec2<f32>(0.5);
    var cell_uv = vec2<f32>(0.0);
    if (m_mode == 0u) {
      let p = uv * shards;
      let i = floor(p); let f = fract(p);
      var min_d = 9.0;
      for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
          let g = vec2<f32>(f32(x), f32(y));
          let o = vec2<f32>(hash21(i + g), hash21(i + g + vec2<f32>(13.7)));
          let r = g + o - f;
          let d = dot(r, r);
          if (d < min_d) { min_d = d; cell_id = i + g; cell_uv = r; }
        }
      }
      cell_center = (cell_id + vec2<f32>(0.5)) / shards;
    } else if (m_mode == 1u) {
      var q = vec2<f32>(uv.x * 1.1547, uv.y) * shards;
      q.x = q.x + 0.5 * floor(q.y);
      let i = floor(q);
      cell_id = vec2<f32>(i.x - floor(i.y / 2.0), i.y);
      cell_center = (cell_id + vec2<f32>(0.5)) / shards;
      cell_uv = fract(q) - vec2<f32>(0.5);
    } else {
      let p = uv * shards;
      cell_id = floor(p);
      cell_center = (cell_id + vec2<f32>(0.5)) / shards;
      cell_uv = fract(p) - vec2<f32>(0.5);
    }
    var ang = (hash21(cell_id) - 0.5) * rotation_deg * 0.017453292;
    ang = ang + time * 0.1 * (hash21(cell_id + vec2<f32>(7.3)) - 0.5);
    let ca = cos(ang); let sa = sin(ang);
    let s_uv = clamp(cell_center + vec2<f32>(cell_uv.x * ca - cell_uv.y * sa, cell_uv.x * sa + cell_uv.y * ca) * amount, vec2<f32>(0.0), vec2<f32>(1.0));
    var col = vec3<f32>(0.0);
    if (chromatic > 0.001) {
      let cd = vec2<f32>(chromatic * 0.005, 0.0);
      col.r = sample_rgb(s_uv + cd).r;
      col.g = sample_rgb(s_uv).g;
      col.b = sample_rgb(s_uv - cd).b;
    } else {
      col = sample_rgb(s_uv);
    }
    if (ms_delay > 0.001) {
      // echo of the shard field from a moment ago
      var ang_d = (hash21(cell_id) - 0.5) * rotation_deg * 0.017453292;
      ang_d = ang_d + (time - 0.45) * 0.1 * (hash21(cell_id + vec2<f32>(7.3)) - 0.5);
      let ca2 = cos(ang_d); let sa2 = sin(ang_d);
      let s_uv2 = clamp(cell_center + vec2<f32>(cell_uv.x * ca2 - cell_uv.y * sa2, cell_uv.x * sa2 + cell_uv.y * ca2) * amount, vec2<f32>(0.0), vec2<f32>(1.0));
      col = mix(col, max(col, sample_rgb(s_uv2)), ms_delay * 0.6);
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 115u) {
    // rorschach-mirror: fold mirror + ink threshold
    let time = u.resolution_time.z;
    let r_mode = u32(round(u.params0.x));
    let fluid_edges = u.params0.y;
    let ink_tint = vec3<f32>(u.params0.z, u.params0.w, u.params1.x);
    let bg = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let mix_original = u.params2.x;
    var s_uv = uv;
    let wobble = fluid_edges * (value_noise2d(uv * 8.0 + vec2<f32>(time * 0.5)) - 0.5) * 0.04;
    if (r_mode == 0u || r_mode == 2u || r_mode == 3u) {
      if (s_uv.x > 0.5 + wobble) { s_uv.x = 1.0 - s_uv.x; }
    }
    if (r_mode == 1u || r_mode == 2u || r_mode == 3u) {
      if (s_uv.y > 0.5 + wobble) { s_uv.y = 1.0 - s_uv.y; }
    }
    if (r_mode == 3u) {
      if (s_uv.x > s_uv.y) { s_uv = vec2<f32>(s_uv.y, s_uv.x); }
    }
    let mirrored = sample_rgb(clamp(s_uv, vec2<f32>(0.0), vec2<f32>(1.0)));
    let ink = smoothstep(amount, 1.0, luma(mirrored));
    let ink_color = mix(bg, ink_tint, ink);
    let result = mix(ink_color, src.rgb, mix_original);
    return vec4<f32>(result, src.a);
  }
  if (code == 116u) {
    // glitch-quilt: tile shuffle + per-tile rotation + chroma split
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let tile_size = max(4.0, u.params0.x);
    let rotate_amount = u.params0.y;
    let chroma_split = u.params0.z;
    let trigger_rate = u.params0.w;
    let gq_mode = u32(round(u.params1.x));
    let gq_delay = clamp(u.params1.y, 0.0, 1.0);
    let cell = floor(uv * res / tile_size);
    let cell_origin = cell * tile_size / res;
    let cell_size = vec2<f32>(tile_size) / res;
    let cell_uv = (uv - cell_origin) / cell_size;
    let t = floor(time * trigger_rate * 2.0);
    let h = hash21(cell + vec2<f32>(t));
    let h2 = hash21(cell + vec2<f32>(t + 13.7));
    var src_cell = cell;
    if (gq_mode == 1u) {
      // swap: adjacent tile pairs exchange places
      let pair_base = vec2<f32>(floor(cell.x / 2.0), cell.y);
      if (hash21(pair_base + vec2<f32>(t + 3.1)) < amount) {
        src_cell.x = cell.x + select(-1.0, 1.0, (cell.x - 2.0 * floor(cell.x / 2.0)) < 0.5);
      }
    } else if (gq_mode == 2u) {
      // mosh: tiles drift by a small random offset instead of teleporting
      if (h < amount) {
        let drift = (vec2<f32>(hash21(cell + vec2<f32>(t + 7.3)), hash21(cell + vec2<f32>(t + 17.5))) - vec2<f32>(0.5)) * 5.0;
        src_cell = cell + floor(drift);
      }
    } else if (h < amount) {
      src_cell.x = floor(hash21(cell + vec2<f32>(t + 7.3)) * res.x / tile_size);
      src_cell.y = floor(hash21(cell + vec2<f32>(t + 17.5)) * res.y / tile_size);
    }
    var s_uv = cell_uv;
    if (h2 < rotate_amount) {
      let rot = u32(hash21(cell + vec2<f32>(t + 27.3)) * 4.0);
      if (rot == 1u) { s_uv = vec2<f32>(s_uv.y, 1.0 - s_uv.x); }
      else if (rot == 2u) { s_uv = vec2<f32>(1.0 - s_uv.x, 1.0 - s_uv.y); }
      else if (rot == 3u) { s_uv = vec2<f32>(1.0 - s_uv.y, s_uv.x); }
    }
    let final_uv = clamp((src_cell * tile_size + s_uv * tile_size) / res, vec2<f32>(0.0), vec2<f32>(1.0));
    var col = vec3<f32>(0.0);
    if (chroma_split > 0.001) {
      let cd = vec2<f32>(chroma_split * 0.005, 0.0);
      col.r = sample_rgb(final_uv + cd).r;
      col.g = sample_rgb(final_uv).g;
      col.b = sample_rgb(final_uv - cd).b;
    } else {
      col = sample_rgb(final_uv);
    }
    if (gq_delay > 0.001) {
      // ghost of the previous shuffle step
      let tp = t - 1.0;
      var prev_cell = cell;
      if (hash21(cell + vec2<f32>(tp)) < amount) {
        prev_cell.x = floor(hash21(cell + vec2<f32>(tp + 7.3)) * res.x / tile_size);
        prev_cell.y = floor(hash21(cell + vec2<f32>(tp + 17.5)) * res.y / tile_size);
      }
      let prev_uv = clamp((prev_cell * tile_size + cell_uv * tile_size) / res, vec2<f32>(0.0), vec2<f32>(1.0));
      col = mix(col, sample_rgb(prev_uv), gq_delay * 0.5);
    }
    return vec4<f32>(col, src.a);
  }
  if (code == 117u) {
    // poster-tear: torn-poster reveal with ragged edge + glow
    let angle_deg = u.params0.x;
    let tear_jitter = u.params0.y;
    let shift_below = u.params0.z;
    let offset_xy = vec2<f32>(u.params0.w, u.params1.x);
    let tear_glow = u.params1.y;
    let p_mode = u32(round(u.params1.z));
    let ang = angle_deg * 0.017453292;
    let dir = vec2<f32>(cos(ang), sin(ang));
    let norm = vec2<f32>(-dir.y, dir.x);
    let d = uv - vec2<f32>(0.5);
    let dist_to_line = dot(d, norm);
    let jit = tear_jitter * (value_noise2d(uv * 30.0) - 0.5) * 0.05;
    var teared = step(amount - 0.5, dist_to_line + jit);
    if (p_mode == 1u) {
      teared = step(amount * 0.7, length(d) + jit);
    } else if (p_mode >= 2u) {
      let ad = abs(d);
      teared = step(amount * 0.5, max(ad.x, ad.y) + jit);
    }
    let below_uv = clamp(uv + offset_xy * shift_below, vec2<f32>(0.0), vec2<f32>(1.0));
    let above = src.rgb;
    let below = sample_rgb(below_uv) * 0.7;
    var result = mix(above, below, 1.0 - teared);
    if (tear_glow > 0.001) {
      let edge = smoothstep(0.04, 0.0, abs(dist_to_line - (amount - 0.5)));
      result = result + vec3<f32>(1.0, 0.95, 0.7) * edge * tear_glow;
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 118u) {
    // paint-peel: noise-field peel reveal with curl shading
    let time = u.resolution_time.z;
    let p_scale = max(0.5, u.params0.x);
    let luma_bias = u.params0.y;
    let curl_amt = u.params0.z;
    let shadow_amt = u.params0.w;
    let bg = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let p_mode = u32(round(u.params1.w));
    let p = uv * p_scale;
    var field = fbm2d(p + vec2<f32>(time * 0.05));
    if (p_mode == 1u) {
      field = cellular2d(p);
    } else if (p_mode >= 2u) {
      field = abs(fbm2d(p) - fbm2d(p + vec2<f32>(13.7))) * 4.0;
    }
    let l = luma(src.rgb);
    let luma_weight = mix(l, 1.0 - l, luma_bias);
    let peel = step(field, amount * luma_weight + 0.1);
    let lift = smoothstep(amount - 0.05, amount + 0.05, field) * curl_amt;
    var above = src.rgb * (1.0 - lift * 0.4);
    let shadow_edge = smoothstep(0.05, 0.0, abs(field - amount));
    above = above * (1.0 - shadow_edge * shadow_amt * 0.6);
    let result = mix(above, bg, peel);
    return vec4<f32>(result, src.a);
  }
  if (code == 119u) {
    // liquid-glass: moving refraction blobs with specular + caustics
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let blobs = clamp(round(u.params0.x), 1.0, 8.0);
    let blob_size = max(0.02, u.params0.y);
    let chromatic = u.params0.z;
    let specular = u.params0.w;
    let caustic_amount = u.params1.x;
    let speed = u.params1.y;
    let tint = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let aspect = res.x / max(1.0, res.y);
    var field = 0.0;
    var grad = vec2<f32>(0.0);
    for (var i = 0u; i < 8u; i = i + 1u) {
      if (f32(i) >= blobs) { break; }
      let fi = f32(i);
      let c = vec2<f32>(
        0.5 + 0.35 * sin(time * speed * 0.3 + fi * 1.7),
        0.5 + 0.35 * cos(time * speed * 0.4 + fi * 2.3)
      );
      var d = uv - c;
      d.x = d.x * aspect;
      let r = length(d);
      let w = exp(-r * r / (blob_size * blob_size));
      field = field + w;
      grad = grad - d * w / (blob_size * blob_size) * 2.0;
    }
    let blob = smoothstep(0.7, 1.3, field);
    let refract_dir = -grad * amount * 0.04;
    var col = vec3<f32>(0.0);
    if (chromatic > 0.001) {
      col.r = sample_rgb(uv + refract_dir * (1.0 + chromatic * 0.5)).r;
      col.g = sample_rgb(uv + refract_dir).g;
      col.b = sample_rgb(uv + refract_dir * (1.0 - chromatic * 0.5)).b;
    } else {
      col = sample_rgb(uv + refract_dir);
    }
    col = col * mix(vec3<f32>(1.0), tint, blob * 0.5);
    if (specular > 0.001) {
      let n = normalize(vec3<f32>(grad, 1.0));
      let l_dir = normalize(vec3<f32>(-0.4, -0.6, 0.6));
      let spec = pow(max(0.0, dot(n, l_dir)), 32.0);
      col = col + vec3<f32>(spec) * specular * blob * 1.5;
    }
    if (caustic_amount > 0.001) {
      let caust = (1.0 - blob) * (sin(field * 30.0 + time) * 0.5 + 0.5);
      col = col + vec3<f32>(caustic_amount) * tint * caust * 0.4;
    }
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 120u) {
    // crystal-refract: voronoi/hex facets refracting toward cell centers
    let time = u.resolution_time.z;
    let c_scale = max(0.5, u.params0.x);
    let sparkle = u.params0.y;
    let edge_glow = u.params0.z;
    let tint = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let c_mode = u32(round(u.params1.z));
    let p = uv * c_scale;
    var cell_center = vec2<f32>(0.5);
    var min_d = 9.0;
    var second_d = 9.0;
    if (c_mode == 0u) {
      let i = floor(p); let f = fract(p);
      var best = vec2<f32>(0.0);
      for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
          let g = vec2<f32>(f32(x), f32(y));
          var o = vec2<f32>(hash21(i + g), hash21(i + g + vec2<f32>(13.7)));
          o = vec2<f32>(0.5) + 0.45 * sin(time * 0.4 + 6.28 * o);
          let r = g + o - f;
          let d = dot(r, r);
          if (d < min_d) { second_d = min_d; min_d = d; best = i + g; }
          else if (d < second_d) { second_d = d; }
        }
      }
      cell_center = (best + vec2<f32>(0.5)) / c_scale;
    } else {
      var q = vec2<f32>(p.x * 1.1547, p.y);
      q.x = q.x + 0.5 * floor(q.y);
      let i = floor(q);
      cell_center = (vec2<f32>(i.x - floor(i.y / 2.0), i.y) + vec2<f32>(0.5)) / vec2<f32>(c_scale * 1.1547, c_scale);
      let f = fract(q) - vec2<f32>(0.5);
      min_d = dot(f, f);
      second_d = min_d + 0.3;
    }
    let dir = uv - cell_center;
    let s_uv = clamp(uv - dir * amount, vec2<f32>(0.0), vec2<f32>(1.0));
    var col = sample_rgb(s_uv);
    let edge = smoothstep(0.04, 0.0, sqrt(second_d) - sqrt(min_d));
    col = col + tint * edge * edge_glow;
    if (sparkle > 0.001) {
      let d_center = length(uv - cell_center);
      let spark = step(1.0 - sparkle * 0.3, hash21(floor(cell_center * 100.0)));
      col = col + vec3<f32>(1.0) * smoothstep(0.04, 0.0, d_center) * spark * sparkle;
    }
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 121u) {
    // infinite-mirror: recursive shrink/rotate accumulation with hue drift
    let iterations = u32(clamp(round(u.params0.x), 1.0, 12.0));
    let rotation_deg = u.params0.y;
    let tint_fade = u.params0.z;
    let hue_shift = u.params0.w;
    let i_mode = u32(round(u.params1.x));
    var center = vec2<f32>(0.5);
    if (i_mode == 1u) { center = vec2<f32>(u.params1.y, u.params1.z); }
    let ang = rotation_deg * 0.017453292;
    let ca = cos(ang); let sa = sin(ang);
    var acc = vec3<f32>(0.0);
    var weight = 0.0;
    var scale = 1.0;
    var hue_off = 0.0;
    var tint = 1.0;
    for (var i = 0u; i < 12u; i = i + 1u) {
      if (i >= iterations) { break; }
      var d = (uv - center) / scale;
      d = vec2<f32>(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      let s_uv = clamp(center + d, vec2<f32>(0.0), vec2<f32>(1.0));
      var s_col = sample_rgb(s_uv);
      if (hue_shift > 0.001) {
        s_col = hue_rotate(s_col, hue_off);
      }
      acc = acc + s_col * tint;
      weight = weight + tint;
      scale = scale * amount;
      hue_off = hue_off + hue_shift;
      tint = tint * (1.0 - tint_fade * 0.5);
    }
    return vec4<f32>(acc / max(weight, 0.0001), src.a);
  }
  if (code == 122u) {
    // tunnel-flight: polar tunnel fly-through
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let twist = u.params0.x;
    let depth = max(0.05, u.params0.y);
    let center = vec2<f32>(u.params0.z, u.params0.w);
    let t_mode = u32(round(u.params1.x));
    let chromatic = u.params1.y;
    let aspect = res.x / max(1.0, res.y);
    var col = vec3<f32>(0.0);
    for (var ch = 0; ch < 3; ch = ch + 1) {
      var z_offset = 0.0;
      if (chromatic > 0.001) {
        if (ch == 0) { z_offset = 0.05 * chromatic; }
        if (ch == 2) { z_offset = -0.05 * chromatic; }
      }
      var d = uv - center;
      d.x = d.x * aspect;
      var r = length(d);
      var a = atan2(d.y, d.x);
      a = a + twist * (time * amount * 0.5);
      var depth_scale = depth;
      if (t_mode == 1u) { depth_scale = r * depth; }
      var z = (time * amount + z_offset) / max(0.05, r * depth_scale);
      if (t_mode >= 2u) {
        let sq = abs(d);
        r = max(sq.x, sq.y);
        z = (time * amount + z_offset) / max(0.05, r);
      }
      let s_uv = vec2<f32>(a / 6.28318 + 0.5, fract(z));
      let s = sample_rgb(s_uv);
      if (ch == 0) { col.r = s.r; }
      if (ch == 1) { col.g = s.g; }
      if (ch == 2) { col.b = s.b; }
      if (chromatic <= 0.001) { col = s; break; }
    }
    let r_fade = length(uv - center);
    col = col * smoothstep(0.0, 0.7, r_fade);
    return vec4<f32>(col, src.a);
  }
  if (code == 123u) {
    // volumetric-fog-overlay: animated noise fog with height falloff + fake depth
    let time = u.resolution_time.z;
    let f_scale = max(0.5, u.params0.x);
    let speed = u.params0.y;
    let height_falloff = u.params0.z;
    let depth_sim = u.params0.w;
    let fog_color = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let turbulence = u.params1.w;
    let f_mode = u32(round(u.params2.x));
    let p = uv * f_scale + vec2<f32>(time * speed * 0.1, -time * speed * 0.05);
    var fog = value_noise2d(p);
    if (turbulence > 0.5) { fog = fbm2d(p); }
    fog = fog * amount;
    let height_w = mix(1.0 - uv.y, uv.y, (height_falloff + 1.0) * 0.5);
    fog = fog * height_w;
    if (depth_sim > 0.001) {
      let fake_depth = 1.0 - luma(src.rgb);
      fog = fog * mix(1.0, fake_depth, depth_sim);
    }
    fog = clamp(fog, 0.0, 1.0);
    var result = src.rgb + fog_color * fog;
    if (f_mode == 1u) {
      result = mix(src.rgb, fog_color, fog);
    } else if (f_mode >= 2u) {
      result = src.rgb - fog_color * fog * 0.5;
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 124u) {
    // rain-fog-snow-overlay: cell-based weather particles
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let w_type = u32(round(u.params0.x));
    let speed = u.params0.y;
    let angle_deg = u.params0.z;
    let size = u.params0.w;
    let fog_amount = u.params1.x;
    let part_color = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let ang = angle_deg * 0.017453292;
    var wind = vec2<f32>(sin(ang), -cos(ang));
    if (w_type == 2u) { wind = wind * 0.3; }
    if (w_type >= 3u) { wind = wind * -0.6; }
    let t = time * speed;
    var scale = 120.0;
    if (w_type == 1u) { scale = 80.0; }
    if (w_type == 2u) { scale = 30.0; }
    if (w_type >= 3u) { scale = 90.0; }
    scale = scale / max(0.5, size);
    let p = uv * vec2<f32>(res.x / max(1.0, res.y), 1.0) * scale;
    let cell_id = floor(p);
    let life_time = hash21(cell_id) * 10.0;
    let phase = fract(t * 0.5 + life_time);
    var cell_uv = fract(p) - vec2<f32>(0.5);
    cell_uv = cell_uv - wind * phase * 1.5;
    cell_uv = vec2<f32>(cell_uv.x, fract(cell_uv.y + 0.5) - 0.5);
    let d = length(cell_uv);
    var particle = smoothstep(0.05, 0.0, abs(cell_uv.x)) * smoothstep(0.5, 0.0, abs(cell_uv.y));
    if (w_type == 1u) {
      particle = smoothstep(0.15, 0.0, d);
    } else if (w_type == 2u) {
      particle = smoothstep(0.3, 0.0, d) * 0.5;
    } else if (w_type >= 3u) {
      particle = smoothstep(0.05, 0.0, d) + smoothstep(0.2, 0.05, d) * 0.3;
    }
    let spawn = step(1.0 - amount, hash21(cell_id + vec2<f32>(17.0)));
    particle = particle * spawn;
    var result = src.rgb + part_color * particle;
    if (fog_amount > 0.001) {
      result = mix(result, part_color * 0.5, fog_amount * 0.4);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 125u) {
    // particle-overlay-fx: stars/bokeh/sparkles/fireflies/dust overlay
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let p_mode = u32(round(u.params0.x));
    let size = u.params0.y;
    let speed = u.params0.z;
    let twinkle = u.params0.w;
    let part_color = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let blend = u32(round(u.params1.w));
    var scale = 60.0;
    if (p_mode == 1u) { scale = 25.0; }
    if (p_mode == 2u) { scale = 80.0; }
    if (p_mode == 3u) { scale = 35.0; }
    if (p_mode >= 4u) { scale = 100.0; }
    scale = scale / max(0.5, size);
    let p = uv * vec2<f32>(res.x / max(1.0, res.y), 1.0) * scale;
    let cell_id = floor(p);
    var cell_uv = fract(p) - vec2<f32>(0.5);
    let spawn = step(1.0 - amount, hash21(cell_id));
    if (spawn < 0.5) { return src; }
    let t = time * speed;
    let drift = vec2<f32>(hash21(cell_id + vec2<f32>(7.3)) - 0.5, hash21(cell_id + vec2<f32>(13.7)) - 0.5) * t * 0.05;
    cell_uv = cell_uv - drift;
    let d = length(cell_uv);
    var particle = smoothstep(0.05, 0.0, d)
      + smoothstep(0.02, 0.0, abs(cell_uv.x)) * smoothstep(0.3, 0.0, abs(cell_uv.y)) * 0.5
      + smoothstep(0.02, 0.0, abs(cell_uv.y)) * smoothstep(0.3, 0.0, abs(cell_uv.x)) * 0.5;
    if (p_mode == 1u) {
      particle = smoothstep(0.4, 0.1, d) * 0.6 + smoothstep(0.45, 0.4, d) * 0.4;
    } else if (p_mode == 2u) {
      particle = smoothstep(0.04, 0.0, d) * 1.5;
    } else if (p_mode == 3u) {
      particle = smoothstep(0.15, 0.0, d) * 0.8;
    } else if (p_mode >= 4u) {
      particle = smoothstep(0.025, 0.0, d) * 0.6;
    }
    if (twinkle > 0.001) {
      let blink = sin(t * 4.0 + hash21(cell_id) * 6.28) * 0.5 + 0.5;
      particle = particle * mix(1.0, blink, twinkle);
    }
    var result = src.rgb + part_color * particle;
    if (blend >= 1u) {
      result = vec3<f32>(1.0) - (vec3<f32>(1.0) - src.rgb) * (vec3<f32>(1.0) - part_color * particle);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 126u) {
    // glint-starburst: star flares marching outward from highlights
    let threshold = u.params0.x;
    let flare_len = u.params0.y;
    let points = u32(clamp(round(u.params0.z), 2.0, 12.0)) * 2u;
    let rotation_deg = u.params0.w;
    let tint = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let max_len = flare_len * 0.15;
    var burst = vec3<f32>(0.0);
    for (var i = 0u; i < 24u; i = i + 1u) {
      if (i >= points) { break; }
      let ang = rotation_deg * 0.017453292 + f32(i) * 6.28318 / f32(points);
      let dir = vec2<f32>(cos(ang), sin(ang));
      for (var s = 1; s <= 12; s = s + 1) {
        let t = f32(s) / 12.0;
        let sc = sample_rgb(uv + dir * max_len * t);
        let gate = smoothstep(threshold, threshold + 0.15, luma(sc));
        burst = burst + sc * gate * (1.0 - t) * (1.0 - t);
      }
    }
    burst = burst / f32(points);
    burst = burst * amount * tint;
    let result = vec3<f32>(1.0) - (vec3<f32>(1.0) - src.rgb) * (vec3<f32>(1.0) - burst);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 127u) {
    // emboss-relight: height-field relighting from luma gradient
    let res = u.resolution_time.xy;
    let angle_deg = u.params0.x;
    let height = u.params0.y;
    let detail = max(1.0, u.params0.z);
    let specular = u.params0.w;
    let color_preserve = u.params1.x;
    let ambient = u.params1.y;
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    let c = src.rgb;
    let ll = sample_rgb(uv + texel * vec2<f32>(-detail, 0.0));
    let rr = sample_rgb(uv + texel * vec2<f32>(detail, 0.0));
    let tt = sample_rgb(uv + texel * vec2<f32>(0.0, detail));
    let bb = sample_rgb(uv + texel * vec2<f32>(0.0, -detail));
    let h0 = luma(c);
    let gx = (luma(rr) - luma(ll)) * height;
    let gy = (luma(tt) - luma(bb)) * height;
    let n = normalize(vec3<f32>(-gx, -gy, 1.0));
    let ang = angle_deg * 0.017453292;
    let l_dir = normalize(vec3<f32>(cos(ang), sin(ang), 0.7));
    let diff = max(0.0, dot(n, l_dir));
    let h_vec = normalize(l_dir + vec3<f32>(0.0, 0.0, 1.0));
    let spec = pow(max(0.0, dot(n, h_vec)), 32.0) * specular;
    let lit = ambient + diff * amount + spec;
    let surface_color = mix(vec3<f32>(h0), c, color_preserve);
    return vec4<f32>(clamp(surface_color * lit, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 128u) {
    // pixel-sort: vertical luminance-sort simulation with streaks
    let res = u.resolution_time.xy;
    let sort_dist = mix(0.0, 60.0, amount);
    let sort_thresh = clamp(u.params0.x, 0.0, 1.0);
    let chrom_sep = mix(0.0, 5.0, u.params0.y);
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    let src_luma = dot(src.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let sort_active = step(sort_thresh, src_luma);
    var best_luma = src_luma;
    var best_color = src.rgb;
    for (var i = 1; i <= 60; i = i + 1) {
      if (f32(i) > sort_dist) { break; }
      let up_uv = uv - vec2<f32>(0.0, f32(i) * texel.y);
      if (up_uv.y < 0.0) { break; }
      let up_sample = sample_rgb(up_uv);
      let up_luma = dot(up_sample, vec3<f32>(0.2126, 0.7152, 0.0722));
      if (up_luma > sort_thresh && up_luma > best_luma) {
        best_luma = up_luma;
        best_color = up_sample;
      }
    }
    let sort_strength = sort_active * smoothstep(sort_thresh, sort_thresh + 0.1, src_luma);
    let sorted = mix(src.rgb, best_color, sort_strength * 0.6);
    let chrom_offset = chrom_sep * texel.y * sort_strength;
    let r_channel = sample_rgb(uv - vec2<f32>(0.0, chrom_offset)).r;
    let b_channel = sample_rgb(uv + vec2<f32>(0.0, chrom_offset)).b;
    var streak = 0.0;
    for (var i = 1; i <= 60; i = i + 1) {
      if (f32(i) > sort_dist * 0.5) { break; }
      let above_uv = uv - vec2<f32>(0.0, f32(i) * texel.y);
      if (above_uv.y < 0.0) { break; }
      let above_luma = dot(sample_rgb(above_uv), vec3<f32>(0.2126, 0.7152, 0.0722));
      if (above_luma > sort_thresh) {
        let falloff = 1.0 - f32(i) / max(1.0, sort_dist * 0.5);
        streak = max(streak, above_luma * falloff * 0.3);
      }
    }
    var final_color = vec3<f32>(r_channel, sorted.g, b_channel) + vec3<f32>(streak) * sort_strength;
    final_color = mix(src.rgb, final_color, sort_active * 0.8 + 0.2);
    return vec4<f32>(final_color, src.a);
  }
  if (code == 129u) {
    // neon-tube-trace: sobel edges as glowing neon tubes
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let edge_threshold = u.params0.x;
    let tube_width = u.params0.y;
    let glow_radius = u.params0.z;
    let tint = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let chase = u.params1.z;
    let chase_speed = u.params1.w;
    let flicker = u.params2.x;
    let bg_mode = u32(round(u.params2.y));
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    let l00 = luma(sample_rgb(uv + texel * vec2<f32>(-1.0, -1.0)));
    let l10 = luma(sample_rgb(uv + texel * vec2<f32>(0.0, -1.0)));
    let l20 = luma(sample_rgb(uv + texel * vec2<f32>(1.0, -1.0)));
    let l01 = luma(sample_rgb(uv + texel * vec2<f32>(-1.0, 0.0)));
    let l21 = luma(sample_rgb(uv + texel * vec2<f32>(1.0, 0.0)));
    let l02 = luma(sample_rgb(uv + texel * vec2<f32>(-1.0, 1.0)));
    let l12 = luma(sample_rgb(uv + texel * vec2<f32>(0.0, 1.0)));
    let l22 = luma(sample_rgb(uv + texel * vec2<f32>(1.0, 1.0)));
    let gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    let gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    let e = length(vec2<f32>(gx, gy));
    var tube = smoothstep(edge_threshold, edge_threshold + 0.05 * tube_width, e);
    var halo = 0.0;
    if (amount > 0.001) {
      for (var y = -3; y <= 3; y = y + 1) {
        for (var x = -3; x <= 3; x = x + 1) {
          let off = vec2<f32>(f32(x), f32(y)) * texel * glow_radius * 0.4;
          let suv = uv + off;
          let e00 = luma(sample_rgb(suv + texel * vec2<f32>(-1.0, 0.0)));
          let e01 = luma(sample_rgb(suv + texel * vec2<f32>(1.0, 0.0)));
          let e10 = luma(sample_rgb(suv + texel * vec2<f32>(0.0, -1.0)));
          let e11 = luma(sample_rgb(suv + texel * vec2<f32>(0.0, 1.0)));
          let ee = length(vec2<f32>(e01 - e00, e11 - e10)) * 2.0;
          let w = exp(-f32(x * x + y * y) / 8.0);
          halo = halo + smoothstep(edge_threshold, edge_threshold + 0.1, ee) * w;
        }
      }
      halo = halo * amount / 16.0;
    }
    if (chase > 0.001 && tube > 0.5) {
      let chase_v = sin(uv.x * 60.0 + time * chase_speed * 4.0) * 0.5 + 0.5;
      tube = tube * mix(0.5, 1.0 + chase_v * 0.6, chase);
    }
    if (flicker > 0.001) {
      let f = step(0.92, hash21(vec2<f32>(floor(time * 12.0), floor(time * 12.0))));
      tube = tube * (1.0 - f * flicker * 0.4);
    }
    let neon = tint * (tube * 1.8 + halo);
    var base_color = vec3<f32>(0.0);
    if (bg_mode == 1u) { base_color = src.rgb; }
    if (bg_mode >= 2u) { base_color = src.rgb * 0.25; }
    let result = vec3<f32>(1.0) - (vec3<f32>(1.0) - base_color) * (vec3<f32>(1.0) - neon);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 130u) {
    // hologram-scan: scanlines + scan beam + grid + tint + flicker
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let scan_freq = max(1.0, u.params0.x);
    let scan_speed = u.params0.y;
    let grid_spacing = u.params0.z;
    let rgb_flicker = u.params0.w;
    let broken_bands = u.params1.x;
    let tint = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let opacity_flicker = u.params2.x;
    let edge_glow = u.params2.y;
    var col = src.rgb;
    if (rgb_flicker > 0.001) {
      let t = floor(time * 30.0);
      let r = (hash21(vec2<f32>(t, 0.0)) - 0.5) * rgb_flicker * 0.04;
      let g = (hash21(vec2<f32>(t, 1.0)) - 0.5) * rgb_flicker * 0.04;
      let b = (hash21(vec2<f32>(t, 2.0)) - 0.5) * rgb_flicker * 0.04;
      col = vec3<f32>(
        sample_rgb(uv + vec2<f32>(r, 0.0)).r,
        sample_rgb(uv + vec2<f32>(g, 0.0)).g,
        sample_rgb(uv + vec2<f32>(b, 0.0)).b
      );
    }
    var scan = sin(uv.y * scan_freq * 3.14159 - time * scan_speed * 4.0);
    scan = mix(1.0, scan * 0.4 + 0.6, amount);
    col = col * scan;
    let beam = smoothstep(0.04, 0.0, abs(uv.y - fract(time * scan_speed * 0.3)));
    col = col + beam * tint * amount * 1.5;
    if (grid_spacing > 0.5) {
      let g = (uv * res) - floor(uv * res / grid_spacing) * grid_spacing;
      let grid_line = step(grid_spacing - 1.0, max(g.x, g.y));
      col = col + grid_line * tint * 0.2 * amount;
    }
    if (broken_bands > 0.001) {
      let band_y = floor(uv.y * 60.0 + time * 2.0);
      let dropout = step(0.94, hash21(vec2<f32>(band_y, floor(time * 4.0))));
      col = col * (1.0 - dropout * broken_bands * 0.6);
    }
    col = mix(col, col * tint + tint * 0.15, amount * 0.5);
    if (edge_glow > 0.001) {
      let texel = 1.0 / max(res, vec2<f32>(2.0));
      let l = luma(src.rgb);
      let l_n = luma(sample_rgb(uv + texel * vec2<f32>(0.0, 1.0)));
      let l_e = luma(sample_rgb(uv + texel * vec2<f32>(1.0, 0.0)));
      let edge = abs(l - l_n) + abs(l - l_e);
      col = col + tint * edge * edge_glow * 2.0;
    }
    if (opacity_flicker > 0.001) {
      col = col * (1.0 - (sin(time * 8.0) * 0.5 + 0.5) * opacity_flicker * 0.3);
    }
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 131u) {
    // laser-slice: sweeping laser beam with glow + sparks + erase side
    let time = u.resolution_time.z;
    let l_mode = u32(round(u.params0.x));
    let speed = u.params0.y;
    let beam_width = max(0.003, u.params0.z);
    let sparks = u.params0.w;
    let erase_amount = u.params1.x;
    let tint = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let reveal = u.params2.x;
    let persistence = clamp(u.params2.y, 0.0, 1.0);
    let pos = (time * speed * 0.3) - floor(time * speed * 0.3 / 1.4) * 1.4 - 0.2;
    var coord = uv.y;
    var sweep_at = pos;
    if (l_mode == 1u) {
      coord = uv.x;
    } else if (l_mode == 2u) {
      coord = (uv.x + uv.y) * 0.5;
    } else if (l_mode >= 3u) {
      coord = length(uv - vec2<f32>(0.5));
      sweep_at = pos * 0.7;
    }
    let d_signed = sweep_at - coord;
    let d = abs(d_signed);
    let side = step(coord, sweep_at);
    let beam = smoothstep(beam_width * 1.5, 0.0, d);
    let halo = exp(-d * d / (beam_width * beam_width * 8.0)) * amount;
    var mask = 1.0 - side;
    if (reveal > 0.5) { mask = side; }
    var base = mix(vec3<f32>(0.0), src.rgb, mask);
    base = mix(src.rgb, base, erase_amount);
    var result = base + tint * (beam + halo);
    if (persistence > 0.001) {
      // trailing afterglow behind the sweep; higher persistence = longer tail
      let trail = exp(-max(d_signed, 0.0) * mix(80.0, 5.0, persistence)) * side;
      result = result + tint * trail * amount * 0.35;
    }
    if (sparks > 0.001 && beam > 0.001) {
      let sp = step(0.97, hash21(floor(uv * 300.0) + vec2<f32>(floor(time * 30.0))));
      result = result + sp * tint * 2.0 * sparks;
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 132u) {
    // aura-field: edge/brightness-weighted glow field (time-pulsed stand-in for audio)
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let radius = u.params0.x;
    let edge_amount = u.params0.y;
    let luma_amount = u.params0.z;
    let audio_react = u.params0.w;
    let hue_shift = u.params1.x;
    let tint = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let a_mode = u32(round(u.params2.x));
    let audio = (0.5 + 0.5 * sin(time * 2.6)) * 0.5;
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    var aura = vec3<f32>(0.0);
    var wsum = 0.0;
    let r = radius * (1.0 + audio * audio_react * 0.6);
    for (var y = -4; y <= 4; y = y + 1) {
      for (var x = -4; x <= 4; x = x + 1) {
        if (abs(x) + abs(y) > 6) { continue; }
        let off = vec2<f32>(f32(x), f32(y)) * texel * r * 0.4;
        let s = sample_rgb(uv + off);
        let dd = abs(s - src.rgb);
        let edge_w = (dd.r + dd.g + dd.b) * edge_amount;
        let luma_w = luma(s) * luma_amount;
        let w = exp(-f32(x * x + y * y) / 8.0) * (edge_w + luma_w);
        aura = aura + s * w;
        wsum = wsum + w;
      }
    }
    if (wsum > 0.0001) { aura = aura / wsum; }
    aura = aura * amount * (1.0 + audio * audio_react);
    if (hue_shift > 0.001) {
      aura = mix(aura, hue_rotate(aura, fract(time * 0.1 + hue_shift)), hue_shift);
    }
    aura = aura * tint;
    var result = src.rgb + aura;
    if (a_mode == 1u) {
      result = vec3<f32>(1.0) - (vec3<f32>(1.0) - src.rgb) * (vec3<f32>(1.0) - aura);
    } else if (a_mode >= 2u) {
      result = mix(src.rgb, aura, clamp(amount * 0.5, 0.0, 1.0));
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 133u) {
    // smoke-disintegrate: noise-driven dissolve into drifting smoke
    let time = u.resolution_time.z;
    let s_scale = max(0.5, u.params0.x);
    let speed = u.params0.y;
    let direction_deg = u.params0.z;
    let edge_fade = u.params0.w;
    let smoke_color_base = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let s_mode = u32(round(u.params1.w));
    let ang = direction_deg * 0.017453292;
    let wind_dir = vec2<f32>(cos(ang), sin(ang));
    var threshold = uv.y;
    if (s_mode == 1u) {
      threshold = 1.0 - length(uv - vec2<f32>(0.5)) * 1.4;
    } else if (s_mode >= 2u) {
      threshold = fbm2d(uv * 2.0);
    }
    let p = uv * s_scale + wind_dir * time * speed * 0.2;
    var smoke = fbm2d(p);
    smoke = smoke * 0.6 + fbm2d(p * 2.5 + vec2<f32>(time * speed * 0.15)) * 0.4;
    let dissolve_edge = amount + smoke * 0.5 - 0.5;
    let dissolve_mask = smoothstep(threshold - edge_fade * 0.2, threshold + edge_fade * 0.2, dissolve_edge);
    let smoke_color = smoke_color_base * (0.6 + smoke * 0.4);
    let result = mix(src.rgb, smoke_color, dissolve_mask);
    let alpha = 1.0 - dissolve_mask * 0.6;
    return vec4<f32>(result, src.a * alpha);
  }
  if (code == 134u) {
    // shimmer-cloth: waving fabric with thread weave + silk shimmer
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let frequency = u.params0.x;
    let speed = u.params0.y;
    let thread_density = u.params0.z;
    let thread_depth = u.params0.w;
    let shimmer = u.params1.x;
    let c_mode = u32(round(u.params1.y));
    let t = time * speed;
    let wave = vec2<f32>(
      sin(uv.y * frequency + t) * amount * 0.04,
      cos(uv.x * frequency * 0.8 + t * 0.7) * amount * 0.03
    );
    let s_uv = clamp(uv + wave, vec2<f32>(0.0), vec2<f32>(1.0));
    var col = sample_rgb(s_uv);
    let px = s_uv * res;
    var thread = sin(px.y * thread_density * 0.1) * 0.5 + 0.5;
    if (c_mode == 1u) {
      thread = (sin(px.x * thread_density * 0.07) + sin(px.y * thread_density * 0.07)) * 0.25 + 0.5;
    } else if (c_mode >= 2u) {
      thread = sin((px.x + px.y) * thread_density * 0.06) * 0.5 + 0.5;
    }
    col = col * mix(1.0, thread, thread_depth * 0.4);
    if (shimmer > 0.001) {
      let specular = pow(max(0.0, sin(px.x * 0.1 + px.y * 0.05 + t * 1.5)), 8.0);
      col = col + vec3<f32>(specular) * shimmer * 0.3;
    }
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 135u) {
    // cellular-automata-burn: stateless burn frontier from luma seed
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let cell_size = max(1.0, u.params0.x);
    let birth_threshold = u.params0.y;
    let cell_color = vec3<f32>(u.params0.z, u.params0.w, u.params1.x);
    let survival_low = clamp(p_or(u.params1.z, 1.5), 0.0, 8.0);
    let survival_high = clamp(max(p_or(u.params1.w, 3.5), survival_low), 0.0, 8.0);
    let texel = vec2<f32>(cell_size) / max(res, vec2<f32>(2.0));
    let alive = step(birth_threshold, luma(src.rgb));
    var n = 0.0;
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        if (x == 0 && y == 0) { continue; }
        n = n + step(birth_threshold, luma(sample_rgb(uv + texel * vec2<f32>(f32(x), f32(y)))));
      }
    }
    // burn frontier: cells at the alive/dead boundary, flickered by noise
    let survives = step(survival_low, n) * (1.0 - step(survival_high + 0.001, n));
    let frontier = alive * (1.0 - survives) + (1.0 - alive) * step(survival_low + 1.0, n);
    let flicker = 0.7 + 0.3 * value_noise2d(uv * res / cell_size * 0.5 + vec2<f32>(time * 3.0));
    let burn = cell_color * frontier * flicker + cell_color * alive * 0.25;
    let result = mix(src.rgb, src.rgb + burn, clamp(amount, 0.0, 1.0));
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 136u) {
    // spectral-prism-tunnel: recursive rotated slices with prism tint
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let tunnel_depth = u.params0.x;
    let rotation = u.params0.y;
    let speed = u.params0.z;
    let slices = u32(clamp(round(u.params0.w), 4.0, 32.0));
    let fade = u.params1.x;
    var d = uv - vec2<f32>(0.5);
    d.x = d.x * (res.x / max(1.0, res.y));
    let a = atan2(d.y, d.x);
    let t = time * speed;
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var i = 0u; i < 32u; i = i + 1u) {
      if (i >= slices) { break; }
      let fi = f32(i) / f32(slices);
      let depth = exp(-fi * tunnel_depth);
      var td = d / depth;
      td.x = td.x * (res.y / max(1.0, res.x));
      let ang = a + rotation * fi + t * 0.3;
      var rot_d = vec2<f32>(cos(ang), sin(ang)) * length(td);
      rot_d.x = rot_d.x * (res.y / max(1.0, res.x));
      let s_uv = clamp(vec2<f32>(0.5) + rot_d, vec2<f32>(0.0), vec2<f32>(1.0));
      let s_col = sample_rgb(s_uv);
      let hh = fract(fi * amount + t * 0.1);
      let hp = abs(fract(vec3<f32>(hh) + vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3<f32>(3.0));
      let prism_tint = mix(vec3<f32>(1.0), clamp(hp - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
      let c = mix(s_col, s_col * prism_tint, amount * 0.5);
      let w = 1.0 - fi * fade;
      acc = acc + c * w;
      wsum = wsum + w;
    }
    return vec4<f32>(clamp(acc / max(wsum, 0.0001), vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 137u) {
    // led-volume: voxel LED wall with depth pulse + posterize + glow
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let voxel_size = max(2.0, u.params0.x);
    let depth_pulse = u.params0.y;
    let depth_speed = u.params0.z;
    let posterize = max(1.0, u.params0.w);
    let perspective = u.params1.x;
    let v_mode = u32(round(u.params1.y));
    let bg = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let cell = floor(uv * res / voxel_size);
    let cell_origin = cell * voxel_size / res;
    let cell_size = vec2<f32>(voxel_size) / res;
    let cell_uv = (uv - cell_origin) / cell_size - vec2<f32>(0.5);
    var sample_col = sample_rgb(cell_origin + cell_size * 0.5);
    sample_col = floor(sample_col * posterize + vec3<f32>(0.5)) / posterize;
    var depth = luma(sample_col);
    if (depth_pulse > 0.001) {
      depth = depth + sin(time * depth_speed * 2.0 + depth * 8.0) * depth_pulse * 0.2;
    }
    let scale = 0.45 - perspective * 0.3 * (1.0 - depth);
    let r = length(cell_uv);
    let ad = abs(cell_uv);
    var voxel = step(max(ad.x, ad.y), scale);
    if (v_mode == 1u) {
      voxel = smoothstep(scale + 0.05, scale - 0.05, r);
    } else if (v_mode >= 2u) {
      voxel = step(max(ad.x * 0.866 + ad.y * 0.5, ad.y), scale);
    }
    var result = mix(bg, sample_col, voxel);
    if (amount > 0.001) {
      let halo = smoothstep(scale * 1.6, scale, r);
      result = result + sample_col * halo * amount * 0.4;
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 138u) {
    // audio-shock-bloom: beat-pulsed shockwave + bloom (time-pulsed audio stand-in)
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let bloom_threshold = u.params0.x;
    let bloom_radius = u.params0.y;
    let shock_speed = max(0.1, u.params0.z);
    let shock_amplitude = u.params0.w;
    let chroma_split = u.params1.x;
    let strobe_amount = u.params1.y;
    let tint = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let audio_gate = u.params2.y;
    let audio_raw = 0.5 + 0.5 * sin(time * 3.2);
    let audio = max(0.0, audio_raw - audio_gate) * (1.0 / max(0.01, 1.0 - audio_gate));
    let kick = audio * amount;
    let d = uv - vec2<f32>(0.5);
    let dist = length(d);
    let ring_r = (time * shock_speed * 0.5) - floor(time * shock_speed * 0.5 / 1.4) * 1.4 - 0.2;
    let band = smoothstep(0.06, 0.0, abs(dist - ring_r));
    let dir = normalize(d + vec2<f32>(1e-6));
    let shock_off = dir * band * shock_amplitude * (0.4 + kick);
    var col = vec3<f32>(0.0);
    let cs = chroma_split * (0.4 + kick * 0.8);
    if (cs > 0.001) {
      col.r = sample_rgb(uv + dir * cs * 0.025 + shock_off).r;
      col.g = sample_rgb(uv + shock_off).g;
      col.b = sample_rgb(uv - dir * cs * 0.025 + shock_off).b;
    } else {
      col = sample_rgb(uv + shock_off);
    }
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    var bloom = vec3<f32>(0.0);
    var wsum = 0.0;
    let br = bloom_radius * (0.5 + kick * 1.5);
    for (var y = -3; y <= 3; y = y + 1) {
      for (var x = -3; x <= 3; x = x + 1) {
        if (abs(x) + abs(y) > 4) { continue; }
        let off = vec2<f32>(f32(x), f32(y)) * texel * br * 0.4;
        let s = sample_rgb(uv + off);
        let gate = smoothstep(bloom_threshold, bloom_threshold + 0.15, luma(s));
        let w = exp(-f32(x * x + y * y) / 8.0);
        bloom = bloom + s * gate * w;
        wsum = wsum + w;
      }
    }
    if (wsum > 0.001) { bloom = bloom / wsum; }
    bloom = bloom * tint * (1.0 + kick * 2.0);
    col = col * (1.0 + strobe_amount * kick * 1.2);
    let result = vec3<f32>(1.0) - (vec3<f32>(1.0) - col) * (vec3<f32>(1.0) - bloom);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 139u) {
    // analog-feedback-rack: unrolled video-feedback echo stack
    let zoom = clamp(u.params0.x, 0.85, 1.15);
    let rotation = u.params0.y;
    let decay = u.params0.z;
    let hue_shift = u.params0.w;
    let mask_center = u.params1.x;
    let chroma_split = u.params1.y;
    let offset_xy = vec2<f32>(u.params1.z, u.params1.w);
    let fb_mode = u32(round(u.params2.x));
    var fb = vec3<f32>(0.0);
    var d = uv - vec2<f32>(0.5);
    var gain = 1.0;
    var hue_acc = 0.0;
    for (var i = 1u; i <= 8u; i = i + 1u) {
      d = d * zoom;
      let ca = cos(rotation); let sa = sin(rotation);
      d = vec2<f32>(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      let fb_uv = vec2<f32>(0.5) + d - offset_xy * f32(i);
      gain = gain * (1.0 - decay) * 0.72;
      hue_acc = hue_acc + hue_shift;
      var tap = vec3<f32>(0.0);
      if (chroma_split > 0.001) {
        tap.r = sample_rgb(fb_uv + vec2<f32>(chroma_split * 0.005, 0.0)).r;
        tap.g = sample_rgb(fb_uv).g;
        tap.b = sample_rgb(fb_uv - vec2<f32>(chroma_split * 0.005, 0.0)).b;
      } else {
        tap = sample_rgb(fb_uv);
      }
      if (hue_shift > 0.001) {
        tap = hue_rotate(tap, hue_acc);
      }
      fb = fb + tap * gain;
    }
    fb = fb * 0.45;
    if (mask_center > 0.001) {
      let mask = 1.0 - smoothstep(0.2, 0.8, length(uv - vec2<f32>(0.5)));
      fb = fb * mix(1.0, mask, mask_center);
    }
    var result = mix(src.rgb, src.rgb + fb, amount);
    if (fb_mode == 1u) {
      result = mix(src.rgb, vec3<f32>(1.0) - (vec3<f32>(1.0) - src.rgb) * (vec3<f32>(1.0) - fb), amount);
    } else if (fb_mode >= 2u) {
      result = mix(src.rgb, src.rgb * (vec3<f32>(1.0) + fb), amount);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 140u) {
    // club-laser-grid: perspective laser grid overlay (time-pulsed audio stand-in)
    let time = u.resolution_time.z;
    let grid_density = max(1.0, u.params0.x);
    let perspective = u.params0.y;
    let speed = u.params0.z;
    let intersection_glow = u.params0.w;
    let line_width = u.params1.x;
    let tint = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let audio_react = u.params2.x;
    let g_mode = u32(round(u.params2.y));
    let audio = (0.5 + 0.5 * sin(time * 2.8)) * 0.5;
    var g_uv = uv;
    if (g_mode == 0u) {
      let persp = mix(1.0, 0.2, g_uv.y * perspective);
      g_uv.x = (g_uv.x - 0.5) / persp + 0.5;
      g_uv.y = mix(g_uv.y, pow(g_uv.y, 2.0), perspective);
    } else if (g_mode == 1u) {
      let persp = mix(1.0, 0.2, (1.0 - g_uv.y) * perspective);
      g_uv.x = (g_uv.x - 0.5) / persp + 0.5;
      g_uv.y = mix(g_uv.y, 1.0 - pow(1.0 - g_uv.y, 2.0), perspective);
    } else {
      let d = g_uv - vec2<f32>(0.5);
      let r = length(d);
      g_uv = vec2<f32>(0.5) + d / max(0.01, r * perspective + (1.0 - perspective));
    }
    let t = time * speed;
    let audio_boost = 1.0 + audio * audio_react;
    let grid = abs(fract(g_uv * grid_density * audio_boost - vec2<f32>(0.0, t * 0.3)) - vec2<f32>(0.5));
    let line_x = smoothstep(line_width * 0.02, 0.0, grid.x);
    let line_y = smoothstep(line_width * 0.02, 0.0, grid.y);
    let grid_line = max(line_x, line_y);
    let intersect = line_x * line_y * intersection_glow * (1.0 + audio_boost);
    let grid3 = tint * (grid_line + intersect * 2.0) * amount;
    let result = vec3<f32>(1.0) - (vec3<f32>(1.0) - src.rgb) * (vec3<f32>(1.0) - grid3);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 141u) {
    // ghost-exposure: unrolled long-exposure trail with hue drift
    let decay = u.params0.x;
    let hue_shift_per_frame = u.params0.y;
    let intensity = u.params0.z;
    let g_mode = u32(round(u.params0.w));
    let clamp_amt = u.params1.x;
    var acc = vec3<f32>(0.0);
    var gain = 1.0;
    var hue_acc = 0.0;
    for (var i = 0u; i < 6u; i = i + 1u) {
      let z = 1.0 + f32(i) * 0.012;
      let s_uv = vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) * z;
      var tap = sample_rgb(s_uv) * amount;
      if (hue_shift_per_frame > 0.001 && i > 0u) {
        tap = hue_rotate(tap, hue_acc);
      }
      if (g_mode == 1u) {
        acc = max(acc, tap * gain);
      } else if (g_mode >= 2u) {
        acc = vec3<f32>(1.0) - (vec3<f32>(1.0) - acc) * (vec3<f32>(1.0) - tap * gain);
      } else {
        acc = acc + tap * gain;
      }
      gain = gain * (1.0 - decay) * 0.62;
      hue_acc = hue_acc + hue_shift_per_frame * 8.0;
    }
    var result = acc;
    if (clamp_amt > 0.001) {
      result = clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    result = result * intensity;
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 142u) {
    // dream-diffusion: pastel bloom + halation + chromatic softness
    let res = u.resolution_time.xy;
    let bloom_radius = u.params0.x;
    let halation = u.params0.y;
    let chromatic_blur = u.params0.z;
    let pastel_rolloff = u.params0.w;
    let shadow_lift = u.params1.x;
    let softness = u.params1.y;
    let tint = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    var cb_col = src.rgb;
    if (chromatic_blur > 0.001) {
      let cb = chromatic_blur * 6.0;
      var acc = vec3<f32>(0.0);
      var wsum = 0.0;
      for (var y = -2; y <= 2; y = y + 1) {
        for (var x = -2; x <= 2; x = x + 1) {
          let off = vec2<f32>(f32(x), f32(y)) * texel * cb;
          let w = exp(-f32(x * x + y * y) / 4.0);
          acc.r = acc.r + sample_rgb(uv + off * 1.05).r * w;
          acc.g = acc.g + sample_rgb(uv + off).g * w;
          acc.b = acc.b + sample_rgb(uv + off * 0.95).b * w;
          wsum = wsum + w;
        }
      }
      cb_col = acc / wsum;
    }
    var bloom = vec3<f32>(0.0);
    var wsum2 = 0.0;
    for (var y = -3; y <= 3; y = y + 1) {
      for (var x = -3; x <= 3; x = x + 1) {
        if (abs(x) + abs(y) > 4) { continue; }
        let off = vec2<f32>(f32(x), f32(y)) * texel * bloom_radius * 0.4;
        let s = sample_rgb(uv + off);
        let gate = smoothstep(0.55, 0.85, luma(s));
        let w = exp(-f32(x * x + y * y) / 8.0);
        bloom = bloom + s * gate * w;
        wsum2 = wsum2 + w;
      }
    }
    if (wsum2 > 0.001) { bloom = bloom / wsum2; }
    bloom = bloom * amount;
    let halo = bloom * vec3<f32>(1.0, 0.6, 0.4) * halation;
    let l = luma(cb_col);
    if (pastel_rolloff > 0.001) {
      cb_col = mix(cb_col, vec3<f32>(1.0), smoothstep(0.7, 1.0, l) * pastel_rolloff);
    }
    cb_col = cb_col + vec3<f32>(shadow_lift) * (1.0 - smoothstep(0.0, 0.4, l));
    var result = (cb_col + bloom + halo) * tint;
    result = mix(result, mix(result, src.rgb, 0.5), softness * 0.3);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 143u) {
    // ghost-double: offset (optionally mirrored) tinted double exposure
    let offset_xy = vec2<f32>(u.params0.x, u.params0.y);
    let mirror = u.params0.z;
    let tint = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let blend = u32(round(u.params1.z));
    var ghost_uv = uv - offset_xy;
    if (mirror > 0.5) { ghost_uv.x = 1.0 - ghost_uv.x; }
    ghost_uv = clamp(ghost_uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let ghost = sample_rgb(ghost_uv) * tint * amount;
    var result = vec3<f32>(1.0) - (vec3<f32>(1.0) - src.rgb) * (vec3<f32>(1.0) - ghost);
    if (blend == 1u) {
      result = src.rgb + ghost;
    } else if (blend >= 2u) {
      result = src.rgb * (vec3<f32>(1.0) + ghost);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 144u) {
    // depth-parallax: luma-depth layered parallax
    let time = u.resolution_time.z;
    let push_in = u.params0.x;
    let layers = u32(clamp(round(u.params0.y), 1.0, 8.0));
    let chromatic = u.params0.z;
    let depth_boost = max(0.1, u.params0.w);
    let dp_mode = u32(round(u.params1.x));
    let pan = vec2<f32>(u.params1.y, u.params1.z);
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var i = 0u; i < 8u; i = i + 1u) {
      if (i >= layers) { break; }
      let layer = f32(i) / max(1.0, f32(layers - 1u));
      let slice_depth = mix(0.2, 0.95, layer);
      var s_uv = uv;
      if (dp_mode == 0u) {
        let scale = 1.0 + (slice_depth - 0.5) * amount * 0.5 + push_in * 0.3 * (1.0 + layer * 0.1);
        s_uv = vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) / scale;
      } else if (dp_mode == 1u) {
        s_uv = uv + pan * (slice_depth - 0.5) * amount * 0.2 * (1.0 + layer * 0.2);
      } else {
        let sw = sin(time * 0.5 + layer * 0.3) * 0.5;
        s_uv = uv + vec2<f32>(sw, sw * 0.4) * (slice_depth - 0.5) * amount * 0.15;
      }
      s_uv = clamp(s_uv, vec2<f32>(0.0), vec2<f32>(1.0));
      var s_col = vec3<f32>(0.0);
      if (chromatic > 0.001) {
        let cd = (s_uv - vec2<f32>(0.5)) * chromatic * 0.04 * (1.0 - layer);
        s_col.r = sample_rgb(s_uv + cd).r;
        s_col.g = sample_rgb(s_uv).g;
        s_col.b = sample_rgb(s_uv - cd).b;
      } else {
        s_col = sample_rgb(s_uv);
      }
      let pix_depth = pow(luma(s_col), depth_boost);
      let w = exp(-pow((pix_depth - slice_depth) * 4.0, 2.0));
      acc = acc + s_col * w;
      wsum = wsum + w;
    }
    var result = src.rgb;
    if (wsum > 0.0001) { result = acc / wsum; }
    return vec4<f32>(result, src.a);
  }
  if (code == 145u) {
    // pixel-sand: granular falling-sand look (stateless time-driven)
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let turbulence = u.params0.x;
    let threshold = u.params0.y;
    let s_mode = u32(round(u.params0.z));
    let replenish = u.params0.w;
    let chroma_split = u.params1.x;
    let grain_size = max(1.0, u.params1.y);
    let persistence = clamp(p_or(u.params1.z, 0.92), 0.0, 1.0);
    let grain = floor(uv * res / grain_size);
    let grain_center = (grain * grain_size + vec2<f32>(grain_size * 0.5)) / res;
    let grain_seed = hash21(grain);
    var dir = vec2<f32>(0.0, -1.0);
    if (s_mode == 1u) { dir = vec2<f32>(0.0, 1.0); }
    if (s_mode >= 2u) { dir = vec2<f32>(sin(time * 0.4 + grain_center.y * 6.28), 0.6); }
    if (turbulence > 0.001) {
      let jit = vec2<f32>(hash21(grain + vec2<f32>(time * 0.05)), hash21(grain * 1.3 + vec2<f32>(time * 0.05 + 7.3))) - vec2<f32>(0.5);
      dir = dir + jit * turbulence;
    }
    // fall distance grows with time per grain (looping)
    let fall_progress = fract(time * 0.15 + grain_seed);
    let fall = fall_progress * amount * 0.25;
    let grain_fade = pow(1.0 - fall_progress * 0.999, (1.0 - persistence) * 6.0);
    let fb_uv = clamp(grain_center - dir * fall, vec2<f32>(0.0), vec2<f32>(1.0));
    var fallen = vec3<f32>(0.0);
    if (chroma_split > 0.001) {
      fallen.r = sample_rgb(fb_uv + dir * chroma_split * 0.003).r;
      fallen.g = sample_rgb(fb_uv).g;
      fallen.b = sample_rgb(fb_uv - dir * chroma_split * 0.003).b;
    } else {
      fallen = sample_rgb(fb_uv);
    }
    let fallen_gate = smoothstep(threshold, threshold + 0.05, luma(fallen));
    let sparkle = step(1.0 - replenish, grain_seed);
    let sand = fallen * fallen_gate * sparkle * grain_fade;
    let sand_alpha = fallen_gate * sparkle * grain_fade;
    let src_dimmed = src.rgb * (1.0 - sand_alpha * 0.4);
    let disp = mix(src_dimmed, sand, sand_alpha);
    return vec4<f32>(clamp(disp, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 146u) {
    // point-cloud-dissolve: image scatters into drifting dots
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let dot_size = max(1.0, u.params0.x);
    let scatter_radius = u.params0.y;
    let attract = u.params0.z;
    let turbulence = u.params0.w;
    let d_mode = u32(round(u.params1.x));
    let bg = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    let hue_shift = u.params2.x;
    let cell = floor(uv * res / dot_size);
    let cell_origin = cell * dot_size / res;
    let cell_size = vec2<f32>(dot_size) / res;
    let home = cell_origin + cell_size * 0.5;
    var sample_col = sample_rgb(home);
    var dir = normalize(vec2<f32>(hash21(cell) - 0.5, hash21(cell + vec2<f32>(13.7)) - 0.5) + vec2<f32>(1e-6));
    if (attract > 0.001) {
      dir = mix(dir, normalize(vec2<f32>(0.5) - home + vec2<f32>(1e-6)), attract);
    }
    if (turbulence > 0.001) {
      let wob = sin(time + hash21(cell + vec2<f32>(71.3)) * 6.28) * turbulence;
      dir = normalize(dir + vec2<f32>(wob * 0.3, wob * 0.4));
    }
    let dot_pos = home + dir * amount * scatter_radius;
    let to_dot = (uv - dot_pos) / cell_size;
    let dot_r = mix(0.72, 0.42, amount);
    let ad = abs(to_dot);
    var mask = step(max(ad.x, ad.y), max(0.5, dot_r));
    if (d_mode == 1u) {
      mask = smoothstep(dot_r + 0.05, dot_r - 0.05, length(to_dot));
    } else if (d_mode >= 2u) {
      mask = max(
        step(ad.x, dot_r * 0.2) * step(ad.y, dot_r),
        step(ad.y, dot_r * 0.2) * step(ad.x, dot_r)
      );
    }
    if (hue_shift > 0.001) {
      sample_col = hue_rotate(sample_col, amount * hue_shift);
    }
    let dot_result = mix(bg, sample_col, mask);
    let result = mix(src.rgb, dot_result, smoothstep(0.0, 0.05, amount));
    return vec4<f32>(result, src.a);
  }
  if (code == 147u) {
    // explode-3d: image particles on a 3D shape, scattered outward
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let scatter = amount;
    let shape_id = floor(clamp(u.params0.x, 0.0, 0.999) * 5.99);
    let spin_speed = u.params0.y * 2.0;
    let bright = 0.5 + u.params0.z;
    let cam_angle = u.params0.w + time * spin_speed;
    let tint = vec3<f32>(u.params1.x, u.params1.y, u.params1.z);
    let tau = 6.28318530718;
    let grid_res = mix(25.0, 70.0, 1.0 - u.params0.x * 0.3);
    let cell_count = vec2<f32>(grid_res, grid_res * res.y / max(1.0, res.x));
    let cell_size = 1.0 / cell_count;
    var final_color = vec3<f32>(0.0);
    var total_weight = 0.0;
    for (var ox = -2; ox <= 2; ox = ox + 1) {
      for (var oy = -2; oy <= 2; oy = oy + 1) {
        let cell_id = floor(uv * cell_count) + vec2<f32>(f32(ox), f32(oy));
        if (cell_id.x < 0.0 || cell_id.y < 0.0 || cell_id.x >= cell_count.x || cell_id.y >= cell_count.y) { continue; }
        let cell_center = (cell_id + vec2<f32>(0.5)) * cell_size;
        let cell_color = sample_rgb(cell_center);
        let rnd1 = hash21(cell_id);
        let rnd2 = hash21(cell_id + vec2<f32>(137.0));
        let rnd3 = hash21(cell_id + vec2<f32>(271.0));
        let theta = cell_center.x * tau;
        let phi = cell_center.y * 3.14159265;
        var shape_pos = vec3<f32>(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
        if (shape_id >= 1.0 && shape_id < 2.0) {
          let face = floor(rnd1 * 6.0);
          let p3 = vec3<f32>(cell_center.x * 2.0 - 1.0, cell_center.y * 2.0 - 1.0, 1.0);
          if (face < 1.0) { shape_pos = p3; }
          else if (face < 2.0) { shape_pos = vec3<f32>(-p3.z, p3.y, p3.x); }
          else if (face < 3.0) { shape_pos = vec3<f32>(p3.z, p3.y, -p3.x); }
          else if (face < 4.0) { shape_pos = vec3<f32>(p3.x, p3.z, -p3.y); }
          else if (face < 5.0) { shape_pos = vec3<f32>(p3.x, -p3.z, p3.y); }
          else { shape_pos = vec3<f32>(p3.x, p3.y, -p3.z); }
          shape_pos = normalize(shape_pos);
        } else if (shape_id >= 2.0 && shape_id < 3.0) {
          let h = cell_center.y;
          let r = (1.0 - h) * 0.8;
          let a = cell_center.x * tau;
          let sides = floor(a / (tau / 4.0)) * (tau / 4.0) + tau / 8.0;
          shape_pos = vec3<f32>(cos(sides) * r, h * 2.0 - 1.0, sin(sides) * r);
        } else if (shape_id >= 3.0 && shape_id < 4.0) {
          let big_r = 0.7; let r2 = 0.3;
          shape_pos = vec3<f32>((big_r + r2 * cos(phi)) * cos(theta), r2 * sin(phi), (big_r + r2 * cos(phi)) * sin(theta));
        } else if (shape_id >= 4.0 && shape_id < 5.0) {
          shape_pos = vec3<f32>(0.6 * cos(theta), cell_center.y * 2.0 - 1.0, 0.6 * sin(theta));
        } else if (shape_id >= 5.0) {
          let tt = cell_center.y * 4.0 * 3.14159265;
          shape_pos = vec3<f32>(0.5 * cos(tt + theta), cell_center.y * 2.0 - 1.0, 0.5 * sin(tt + theta));
        }
        let ca = cos(cam_angle); let sa = sin(cam_angle);
        shape_pos = vec3<f32>(shape_pos.x * ca - shape_pos.z * sa, shape_pos.y, shape_pos.x * sa + shape_pos.z * ca);
        let scatter_dir = normalize(shape_pos + vec3<f32>(rnd1 - 0.5, rnd2 - 0.5, rnd3 - 0.5) * 0.5);
        let pos3d = shape_pos + scatter_dir * scatter * (0.5 + rnd1) * 1.5;
        let z = pos3d.z + 3.0;
        let proj = pos3d.xy / z * 0.5 + vec2<f32>(0.5);
        let p_size = cell_size.x * (1.0 + u.params0.x) / max(z * 0.4, 0.1);
        let diff2 = (uv - proj) / vec2<f32>(1.0, res.x / max(1.0, res.y));
        let dist = length(diff2);
        let particle = smoothstep(p_size, p_size * 0.2, dist);
        if (particle > 0.01) {
          let light_dir = normalize(vec3<f32>(0.5, 0.7, 1.0));
          let diffuse = max(dot(normalize(shape_pos), light_dir), 0.0) * 0.7 + 0.3;
          let lit = cell_color * diffuse * bright * tint;
          let depth_fade = 1.0 / (1.0 + max(z - 2.0, 0.0) * 0.3);
          final_color = final_color + lit * particle * depth_fade;
          total_weight = total_weight + particle * depth_fade;
        }
      }
    }
    if (total_weight > 0.01) {
      let base = src.rgb * (1.0 - scatter * 0.5);
      return vec4<f32>(mix(base, final_color / total_weight, clamp(total_weight, 0.0, 1.0)), src.a);
    }
    return vec4<f32>(src.rgb * (1.0 - scatter * 0.5), src.a);
  }
  if (code == 148u) {
    // terrain-3d: luma heightfield fly-over raymarch
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let height_scale = amount * 0.8;
    let cam_height = 0.08 + u.params0.y * 0.35;
    let speed = u.params0.z * 0.5;
    let fog_density = u.params0.w * 3.0;
    let cam_yaw = u.params1.x;
    let cam_pitch = (u.params1.y - 0.5) * 3.14159265 * 0.5;
    let cam_roll = u.params1.z * 6.28318530718;
    let fog_color = vec3<f32>(u.params1.w, u.params2.x, u.params2.y);
    let horizon_fade = u.params2.z;
    let t_mode = u32(round(u.params0.x));
    let forward = vec2<f32>(cos(cam_yaw), sin(cam_yaw));
    let cam_pos_2d = forward * time * speed;
    var screen_pos = uv * 2.0 - vec2<f32>(1.0);
    screen_pos.x = screen_pos.x * (res.x / max(1.0, res.y));
    let ro = vec3<f32>(cam_pos_2d.x, cam_height, cam_pos_2d.y);
    var rd = normalize(vec3<f32>(screen_pos.x, screen_pos.y * 0.5 - 0.3, 1.5));
    let crl = cos(cam_roll); let srl = sin(cam_roll);
    rd = vec3<f32>(crl * rd.x - srl * rd.y, srl * rd.x + crl * rd.y, rd.z);
    let cp = cos(cam_pitch); let sp = sin(cam_pitch);
    rd = vec3<f32>(rd.x, cp * rd.y - sp * rd.z, sp * rd.y + cp * rd.z);
    let cy = cos(cam_yaw); let sy = sin(cam_yaw);
    let rd_xz = vec2<f32>(cy * rd.x - sy * rd.z, sy * rd.x + cy * rd.z);
    rd = vec3<f32>(rd_xz.x, rd.y, rd_xz.y);
    var t = 0.01;
    var hit = false;
    var hit_pos = ro;
    let max_dist = 8.0;
    for (var i = 0; i < 80; i = i + 1) {
      hit_pos = ro + rd * t;
      let sample_uv = fract(hit_pos.xz * 0.3);
      let h = dot(sample_rgb(sample_uv), vec3<f32>(0.2126, 0.7152, 0.0722)) * height_scale;
      if (hit_pos.y < h) { hit = true; break; }
      t = t + max(0.005, (hit_pos.y - h) * 0.4);
      if (t > max_dist) { break; }
    }
    let horizon_w = smoothstep(0.0, 0.4, rd.y);
    let dist_fade = clamp(t / max_dist, 0.0, 1.0);
    var terrain_alpha = 1.0;
    var color = vec3<f32>(0.0);
    if (hit) {
      let s_uv = fract(hit_pos.xz * 0.3);
      let tex_color = sample_rgb(s_uv);
      let eps = 0.005;
      let h_l = dot(sample_rgb(fract((hit_pos.xz + vec2<f32>(-eps, 0.0)) * 0.3)), vec3<f32>(0.2126, 0.7152, 0.0722)) * height_scale;
      let h_r = dot(sample_rgb(fract((hit_pos.xz + vec2<f32>(eps, 0.0)) * 0.3)), vec3<f32>(0.2126, 0.7152, 0.0722)) * height_scale;
      let h_d = dot(sample_rgb(fract((hit_pos.xz + vec2<f32>(0.0, -eps)) * 0.3)), vec3<f32>(0.2126, 0.7152, 0.0722)) * height_scale;
      let h_u = dot(sample_rgb(fract((hit_pos.xz + vec2<f32>(0.0, eps)) * 0.3)), vec3<f32>(0.2126, 0.7152, 0.0722)) * height_scale;
      let normal = normalize(vec3<f32>(h_l - h_r, 2.0 * eps, h_d - h_u));
      let light_dir = normalize(vec3<f32>(0.5, 0.8, 0.3));
      let diff = max(dot(normal, light_dir), 0.0) * 0.8 + 0.2;
      color = tex_color * diff;
      let fog_factor = 1.0 - exp(-t * fog_density * 0.5);
      color = mix(color, fog_color, fog_factor);
      terrain_alpha = mix(1.0, 1.0 - dist_fade, horizon_fade * 0.85);
    } else {
      let sky_grad = max(rd.y, 0.0);
      color = mix(fog_color, fog_color * 1.3, sky_grad);
      if (t_mode != 0u) { terrain_alpha = mix(1.0, 1.0 - horizon_w, horizon_fade); }
    }
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), terrain_alpha * src.a);
  }
  if (code == 149u) {
    // wrapped-terrain: luma-bumped sphere/cube raymarch
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let shape = u32(round(u.params0.x));
    let rot_x_amt = u.params0.y;
    let rot_y_amt = u.params0.z;
    let auto_rotate = u.params0.w;
    let cam_distance = max(1.5, u.params1.x);
    let specular = u.params1.y;
    let ambient = u.params1.z;
    let fog_distance = u.params1.w;
    let fog_color = vec3<f32>(u.params2.x, u.params2.y, u.params2.z);
    let horizon_fade = u.params2.w;
    let tile_scale = max(0.5, p_or(u.params3.x, 1.0));
    let source_mix = clamp(u.params3.y, 0.0, 1.0);
    var screen_pos = uv * 2.0 - vec2<f32>(1.0);
    screen_pos.x = screen_pos.x * (res.x / max(1.0, res.y));
    let ang_y = rot_y_amt * 6.28318530718 + time * auto_rotate * 0.4;
    let ang_x = (rot_x_amt - 0.5) * 3.14159265;
    let rot_mat = w4_rot_y(ang_y) * w4_rot_x(ang_x);
    var ro = rot_mat * vec3<f32>(0.0, 0.0, cam_distance);
    var rd = rot_mat * normalize(vec3<f32>(screen_pos, -1.5));
    let base_r = 0.85;
    var t = 0.0;
    var hit = false;
    var hp = ro;
    for (var i = 0; i < 72; i = i + 1) {
      hp = ro + rd * t;
      var suv = w4_sphere_uv(normalize(hp + vec3<f32>(1e-6)));
      if (shape >= 1u) {
        let ap = abs(hp);
        if (ap.x > ap.y && ap.x > ap.z) { suv = vec2<f32>(hp.z * sign(hp.x), hp.y) * 0.5 + vec2<f32>(0.5); }
        else if (ap.y > ap.z) { suv = vec2<f32>(hp.x, hp.z * sign(hp.y)) * 0.5 + vec2<f32>(0.5); }
        else { suv = vec2<f32>(hp.x * sign(hp.z), hp.y) * 0.5 + vec2<f32>(0.5); }
        suv = clamp(suv, vec2<f32>(0.0), vec2<f32>(1.0));
      }
      let h = dot(sample_rgb(fract(suv * tile_scale)), vec3<f32>(0.2126, 0.7152, 0.0722)) * amount * 0.5;
      var base_sdf = length(hp) - base_r;
      if (shape >= 1u) {
        let bd = abs(hp) - vec3<f32>(base_r);
        base_sdf = length(max(bd, vec3<f32>(0.0))) + min(max(bd.x, max(bd.y, bd.z)), 0.0);
      }
      let d = base_sdf - h;
      if (d < 0.002) { hit = true; break; }
      t = t + max(d * 0.7, 0.005);
      if (t > 8.0) { break; }
    }
    if (!hit) {
      return vec4<f32>(fog_color, (1.0 - horizon_fade) * src.a);
    }
    let n_approx = normalize(hp + vec3<f32>(1e-6));
    var suv = w4_sphere_uv(n_approx);
    if (shape >= 1u) {
      let ap = abs(hp);
      if (ap.x > ap.y && ap.x > ap.z) { suv = vec2<f32>(hp.z * sign(hp.x), hp.y) * 0.5 + vec2<f32>(0.5); }
      else if (ap.y > ap.z) { suv = vec2<f32>(hp.x, hp.z * sign(hp.y)) * 0.5 + vec2<f32>(0.5); }
      else { suv = vec2<f32>(hp.x * sign(hp.z), hp.y) * 0.5 + vec2<f32>(0.5); }
      suv = clamp(suv, vec2<f32>(0.0), vec2<f32>(1.0));
    }
    let tex_col = sample_rgb(fract(suv * tile_scale));
    let light_dir = normalize(rot_mat * vec3<f32>(0.5, 0.7, 0.5));
    let diff = max(dot(n_approx, light_dir), 0.0);
    let spec = pow(max(dot(reflect(-light_dir, n_approx), -rd), 0.0), 32.0) * specular;
    var lit = tex_col * (ambient + diff * 0.85) + vec3<f32>(spec);
    let fog_factor = 1.0 - exp(-t * fog_distance * 0.3);
    lit = mix(lit, fog_color, fog_factor);
    lit = mix(lit, tex_col, source_mix);
    let fres = 1.0 - max(dot(n_approx, -rd), 0.0);
    let sil_alpha = 1.0 - smoothstep(0.7, 1.0, fres) * horizon_fade;
    return vec4<f32>(clamp(lit, vec3<f32>(0.0), vec3<f32>(1.0)), sil_alpha * src.a);
  }
  if (code == 150u) {
    // string-orb: bumped sphere with lat/lon/diagonal string lattice
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let radius = u.params0.x;
    let height = u.params0.y;
    let lat_count = u.params0.z;
    let lon_count = u.params0.w;
    let diag_count = u.params1.x;
    let slope = u.params1.y;
    let width = max(0.002, u.params1.z);
    let spin = u.params1.w;
    let tilt = u.params2.x;
    let flow = u.params2.y;
    let glow = u.params2.z;
    let glow_color = vec3<f32>(max(0.0, u.params3.y), max(0.0, u.params3.z), max(0.0, u.params3.w));
    let horizon_fade = clamp(p_or(u.params3.x, 0.7), 0.0, 1.0);
    let tile_scale = max(0.5, p_or(u.params2.w, 1.0));
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin) * w4_rot_x(tilt * 3.14159265 * 0.5);
    var ro = rot * vec3<f32>(0.0, 0.0, 2.8);
    var rd = rot * normalize(vec3<f32>(p, -1.8));
    var t = 0.0;
    var hit = false;
    var hp = ro;
    for (var i = 0; i < 72; i = i + 1) {
      hp = ro + rd * t;
      let dir0 = normalize(hp + vec3<f32>(1e-6));
      let suv0 = w4_sphere_uv(dir0);
      let h = dot(sample_rgb(fract(suv0 * tile_scale)), vec3<f32>(0.2126, 0.7152, 0.0722)) * height * 0.4;
      let d = length(hp) - (radius + h);
      if (d < 0.002) { hit = true; break; }
      t = t + max(d * 0.7, 0.005);
      if (t > 6.0) { break; }
    }
    if (!hit) {
      return vec4<f32>(glow_color * 0.05, (1.0 - horizon_fade) * src.a);
    }
    let n = normalize(hp + vec3<f32>(1e-6));
    let suv = w4_sphere_uv(n);
    let lat = 1.0 - smoothstep(width, width * 2.0, abs(fract(suv.y * lat_count) - 0.5));
    let lon = 1.0 - smoothstep(width, width * 2.0, abs(fract(suv.x * lon_count) - 0.5));
    var diag = 0.0;
    if (diag_count > 0.5) {
      diag = 1.0 - smoothstep(width, width * 2.0, abs(fract((suv.x + suv.y * slope + time * flow) * diag_count) - 0.5));
    }
    let strings = max(max(lat, lon), diag);
    let tex = sample_rgb(fract(suv * tile_scale));
    let rim = w4_fresnel(n, rd, 2.2);
    let col = tex * strings * amount + glow_color * (rim + strings * strings) * glow;
    let alpha = clamp(max(strings * 0.95, rim * horizon_fade) + horizon_fade * 0.05, 0.0, 1.0);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 151u) {
    // sphere-wireframe: bumped sphere with meridian/parallel wireframe
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let radius = u.params0.x;
    let height = u.params0.y;
    let meridians = u.params0.z;
    let parallels = u.params0.w;
    let width = max(0.002, u.params1.x);
    let spin = u.params1.y;
    let tilt = u.params1.z;
    let halo_glow = u.params1.w;
    let wire_color = vec3<f32>(u.params2.x, u.params2.y, u.params2.z);
    let fill_source = u.params2.w;
    let horizon_fade = clamp(p_or(u.params3.x, 0.7), 0.0, 1.0);
    let tile_scale = max(0.5, p_or(u.params3.y, 1.0));
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin) * w4_rot_x(tilt * 3.14159265 * 0.5);
    var ro = rot * vec3<f32>(0.0, 0.0, 2.8);
    var rd = rot * normalize(vec3<f32>(p, -1.7));
    var t = 0.0;
    var hit = false;
    var hp = ro;
    for (var i = 0; i < 72; i = i + 1) {
      hp = ro + rd * t;
      let dir0 = normalize(hp + vec3<f32>(1e-6));
      let suv0 = w4_sphere_uv(dir0);
      let h = dot(sample_rgb(fract(suv0 * tile_scale)), vec3<f32>(0.2126, 0.7152, 0.0722)) * height * 0.4;
      let d = length(hp) - (radius + h);
      if (d < 0.002) { hit = true; break; }
      t = t + max(d * 0.7, 0.005);
      if (t > 6.0) { break; }
    }
    if (!hit) {
      return vec4<f32>(wire_color * 0.04, (1.0 - horizon_fade) * src.a);
    }
    let n = normalize(hp + vec3<f32>(1e-6));
    let suv = w4_sphere_uv(n);
    let merid = 1.0 - smoothstep(width, width * 1.8, abs(fract(suv.x * meridians) - 0.5));
    let parll = 1.0 - smoothstep(width, width * 1.8, abs(fract(suv.y * parallels) - 0.5));
    let wire = max(merid, parll);
    let tex = sample_rgb(fract(suv * tile_scale));
    var fill = mix(wire_color * 0.15, tex * 0.5, fill_source);
    let light_dir = normalize(rot * vec3<f32>(0.5, 0.7, 0.5));
    let diff = max(dot(n, light_dir), 0.0);
    fill = fill * (0.4 + diff * 0.7);
    let rim = w4_fresnel(n, rd, 2.5);
    let col = mix(fill, wire_color, wire * amount) + wire_color * rim * halo_glow;
    let alpha = clamp(max(wire, max(rim * horizon_fade, fill_source * 0.5)), 0.0, 1.0);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 152u) {
    // voxel-cube-cluster: grid of luma-displaced cubes
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let grid_f = clamp(round(u.params0.x), 1.0, 6.0);
    let cube_size = u.params0.y;
    let spacing = u.params0.z;
    let spin = u.params0.w;
    let tilt = u.params1.x;
    let cam_distance = u.params1.y;
    let specular = u.params1.z;
    let ambient = u.params1.w;
    let bg_color = vec3<f32>(u.params2.x, u.params2.y, u.params2.z);
    let horizon_fade = u.params2.w;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin * 0.3) * w4_rot_x((tilt - 0.5) * 3.14159265 * 0.6);
    var ro = rot * vec3<f32>(0.0, 0.0, cam_distance);
    var rd = rot * normalize(vec3<f32>(p, -1.5));
    let grid = i32(grid_f);
    var best_t = 1e9;
    var best_n = vec3<f32>(0.0);
    var best_center = vec3<f32>(0.0);
    let half_grid = f32(grid - 1) * 0.5 * spacing;
    for (var i = 0; i < 6; i = i + 1) {
      if (i >= grid) { break; }
      for (var j = 0; j < 6; j = j + 1) {
        if (j >= grid) { break; }
        for (var k = 0; k < 6; k = k + 1) {
          if (k >= grid) { break; }
          let cell_center = vec3<f32>(f32(i) * spacing - half_grid, f32(j) * spacing - half_grid, f32(k) * spacing - half_grid);
          let s_uv = vec2<f32>(f32(i) / max(1.0, f32(grid - 1)), f32(j) / max(1.0, f32(grid - 1)));
          let c = sample_rgb(s_uv);
          let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
          let dir0 = normalize(cell_center + vec3<f32>(1e-4));
          let cube_pos = cell_center + dir0 * l * amount * 0.8;
          let box = w4_isect_box(ro - cube_pos, rd, vec3<f32>(cube_size));
          if (box.w > 0.0 && box.w < best_t) {
            best_t = box.w;
            best_n = box.xyz;
            best_center = cube_pos;
          }
        }
      }
    }
    if (best_t > 1e8) {
      return vec4<f32>(bg_color, (1.0 - horizon_fade) * src.a);
    }
    let hit = ro + rd * best_t;
    let local_pos = hit - best_center;
    let an = abs(best_n);
    var face_uv = (local_pos.xy / cube_size) * 0.5 + vec2<f32>(0.5);
    if (an.x > 0.5) { face_uv = (local_pos.zy / cube_size) * 0.5 + vec2<f32>(0.5); }
    else if (an.y > 0.5) { face_uv = (local_pos.xz / cube_size) * 0.5 + vec2<f32>(0.5); }
    let face_col = sample_rgb(clamp(face_uv, vec2<f32>(0.0), vec2<f32>(1.0)));
    let light_dir = normalize(vec3<f32>(0.5, 0.7, 0.5));
    let diff = max(dot(best_n, light_dir), 0.0);
    let spec = pow(max(dot(reflect(-light_dir, best_n), -rd), 0.0), 32.0) * specular;
    let col = face_col * (ambient + diff * 0.85) + vec3<f32>(spec);
    let fade = 1.0 - clamp((best_t - cam_distance + 2.0) / 4.0, 0.0, 1.0);
    let alpha = mix(1.0, fade, horizon_fade);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 153u) {
    // mobius-lattice: ribbon of boxes along a mobius loop with lattice lines
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let major_r = u.params0.x;
    let ribbon_w = u.params0.y;
    let twists = u.params0.z;
    let spin = u.params0.w;
    let tilt = u.params1.x;
    let line_density = u.params1.y;
    let line_width = max(0.002, u.params1.z);
    let line_color = vec3<f32>(u.params1.w, u.params2.x, u.params2.y);
    let horizon_fade = u.params2.z;
    let tau = 6.28318530718;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin * 0.3) * w4_rot_x(tilt * 3.14159265 * 0.6);
    var ro = rot * vec3<f32>(0.0, 0.0, 3.0);
    var rd = rot * normalize(vec3<f32>(p, -1.5));
    var best_t = 1e9;
    var best_uv = vec2<f32>(0.0);
    for (var i = 0; i < 24; i = i + 1) {
      let u0 = f32(i) / 24.0 * tau;
      for (var j = -1; j <= 1; j = j + 1) {
        let v0 = f32(j);
        let half_twist = u0 * twists * 0.5;
        let r = major_r + v0 * ribbon_w * cos(half_twist);
        let pt = vec3<f32>(r * cos(u0), v0 * ribbon_w * sin(half_twist), r * sin(u0));
        let box = w4_isect_box(ro - pt, rd, vec3<f32>(ribbon_w * 0.55));
        if (box.w > 0.0 && box.w < best_t) {
          best_t = box.w;
          best_uv = vec2<f32>(u0 / tau, v0 * 0.5 + 0.5);
        }
      }
    }
    if (best_t > 1e8) {
      return vec4<f32>(line_color * 0.05, (1.0 - horizon_fade) * src.a);
    }
    let tex = sample_rgb(best_uv);
    let lin_u = 1.0 - smoothstep(line_width, line_width * 1.8, abs(fract(best_uv.x * line_density) - 0.5));
    let lin_v = 1.0 - smoothstep(line_width, line_width * 1.8, abs(fract(best_uv.y * line_density * 0.3) - 0.5));
    let lat = max(lin_u, lin_v);
    let col = tex * amount + line_color * lat;
    let fade = 1.0 - clamp((best_t - 2.0) / 2.5, 0.0, 1.0);
    let alpha = mix(1.0, fade, horizon_fade);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 154u) {
    // crystal-shard-field: floating refractive shards
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let shard_count = clamp(round(u.params0.x), 4.0, 32.0);
    let shard_size = u.params0.y;
    let spread = u.params0.z;
    let chroma_edge = u.params0.w;
    let refraction = u.params1.x;
    let spin = u.params1.y;
    let tint = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let horizon_fade = u.params2.y;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin * 0.2);
    var ro = rot * vec3<f32>(0.0, 0.0, 3.0);
    var rd = rot * normalize(vec3<f32>(p, -1.5));
    let n = i32(shard_count);
    var best_t = 1e9;
    var best_n = vec3<f32>(0.0);
    for (var i = 0; i < 32; i = i + 1) {
      if (i >= n) { break; }
      let fi = f32(i);
      var center = vec3<f32>(
        (w4_hash13(vec3<f32>(fi, 0.0, 0.0)) - 0.5) * 2.0 * spread,
        (w4_hash13(vec3<f32>(fi, 1.0, 0.0)) - 0.5) * 2.0 * spread,
        (w4_hash13(vec3<f32>(fi, 2.0, 0.0)) - 0.5) * 2.0 * spread
      );
      center.y = center.y + sin(time * 0.3 + fi * 2.7) * 0.1;
      center.x = center.x + cos(time * 0.4 + fi * 1.7) * 0.1;
      let s_rot = w4_rot_y(fi * 1.7 + time * 0.1) * w4_rot_x(fi * 0.7);
      let lro = s_rot * (ro - center);
      let lrd = s_rot * rd;
      let bs = shard_size * (0.6 + w4_hash13(vec3<f32>(fi, 5.0, 0.0)));
      let box = w4_isect_box(lro, lrd, vec3<f32>(bs, bs * 0.4, bs));
      if (box.w > 0.0 && box.w < best_t) {
        best_t = box.w;
        best_n = transpose(s_rot) * box.xyz;
      }
    }
    if (best_t > 1e8) {
      return vec4<f32>(tint * 0.04, (1.0 - horizon_fade) * src.a);
    }
    let best_pos = ro + rd * best_t;
    let s_uv = best_pos.xy * 0.3 + vec2<f32>(0.5);
    let refract_dir = best_n.xy * refraction * 0.06;
    var col = vec3<f32>(0.0);
    if (chroma_edge > 0.001) {
      col.r = sample_rgb(s_uv + refract_dir + best_n.xy * chroma_edge * 0.02).r;
      col.g = sample_rgb(s_uv + refract_dir).g;
      col.b = sample_rgb(s_uv + refract_dir - best_n.xy * chroma_edge * 0.02).b;
    } else {
      col = sample_rgb(clamp(s_uv + refract_dir, vec2<f32>(0.0), vec2<f32>(1.0)));
    }
    col = col * tint;
    let light_dir = normalize(vec3<f32>(0.5, 0.7, 0.5));
    let spec = pow(max(dot(reflect(-light_dir, best_n), -rd), 0.0), 16.0);
    col = (col + vec3<f32>(spec) * 0.6) * amount;
    let fade = 1.0 - clamp((best_t - 2.0) / 3.0, 0.0, 1.0);
    let alpha = mix(1.0, fade, horizon_fade);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 155u) {
    // tube-lattice: ring of vertical tubes wrapped with source
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let tube_count = clamp(round(u.params0.x), 1.0, 12.0);
    let tube_radius = u.params0.y;
    let spread = u.params0.z;
    let spin = u.params0.w;
    let tilt = u.params1.x;
    let twist = u.params1.y;
    let rim_color = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let horizon_fade = u.params2.y;
    let tau = 6.28318530718;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin * 0.3) * w4_rot_x(tilt * 3.14159265 * 0.5);
    var ro = rot * vec3<f32>(0.0, 0.0, 3.0);
    var rd = rot * normalize(vec3<f32>(p, -1.5));
    let n = i32(tube_count);
    var best_t = 1e9;
    var best_n = vec3<f32>(0.0);
    var best_hit = vec3<f32>(0.0);
    for (var i = 0; i < 12; i = i + 1) {
      if (i >= n) { break; }
      let fi = f32(i);
      let ang = fi / tube_count * tau;
      var offset = vec3<f32>(cos(ang), 0.0, sin(ang)) * spread;
      offset = w4_rot_z(twist * sin(time * 0.2 + fi)) * offset;
      let cyl = w4_isect_cyl_y(ro - offset, rd, tube_radius);
      if (cyl.w > 0.0 && cyl.w < best_t) {
        let hit = ro + rd * cyl.w;
        if (abs(hit.y - offset.y) > 1.5) { continue; }
        best_t = cyl.w;
        best_n = cyl.xyz;
        best_hit = hit;
      }
    }
    if (best_t > 1e8) {
      return vec4<f32>(rim_color * 0.04, (1.0 - horizon_fade) * src.a);
    }
    let ang2 = atan2(best_n.z, best_n.x) / tau + 0.5;
    let y_u = best_hit.y * 0.5 + 0.5;
    let tex = sample_rgb(vec2<f32>(ang2, y_u));
    let rim = w4_fresnel(best_n, rd, 1.6);
    let col = tex * amount + rim_color * rim * 0.7;
    let fade = 1.0 - clamp((best_t - 2.0) / 3.0, 0.0, 1.0);
    let alpha = mix(1.0, fade, horizon_fade);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 156u) {
    // disco-mirror-ball: faceted mirror sphere with chase lights
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let radius = u.params0.x;
    let facet_count = max(2.0, u.params0.y);
    let spin = u.params0.z;
    let tilt = u.params0.w;
    let chase_speed = u.params1.x;
    let chase_hue_width = u.params1.y;
    let sparkle = u.params1.z;
    let highlight = vec3<f32>(u.params1.w, u.params2.x, u.params2.y);
    let horizon_fade = u.params2.z;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let ro = vec3<f32>(0.0, 0.0, 2.8);
    let rd = normalize(vec3<f32>(p, -1.7));
    let t = w4_isect_sphere(ro, rd, radius);
    if (t < 0.0) {
      return vec4<f32>(highlight * 0.04, (1.0 - horizon_fade) * src.a);
    }
    let pos = ro + rd * t;
    var n = normalize(pos);
    n = w4_rot_y(time * spin * 0.3) * w4_rot_x(tilt * 3.14159265 * 0.5) * n;
    let suv = w4_sphere_uv(n);
    let facet_size = vec2<f32>(1.0 / facet_count, 1.0 / (facet_count * 0.5));
    let facet_idx = floor(suv / facet_size);
    let facet_center = (facet_idx + vec2<f32>(0.5)) * facet_size;
    let tex = sample_rgb(facet_center);
    let in_facet = fract(suv / facet_size);
    var edge = smoothstep(0.92, 1.0, max(in_facet.x, in_facet.y)) + smoothstep(0.92, 1.0, max(1.0 - in_facet.x, 1.0 - in_facet.y));
    edge = clamp(edge, 0.0, 1.0);
    let chase = sin(time * chase_speed + facet_idx.x * 1.7 + facet_idx.y * 2.3) * 0.5 + 0.5;
    let chase_tint = w4_hsv2rgb(vec3<f32>(fract(time * 0.05 + chase * chase_hue_width), 0.8, 1.0));
    var col = mix(tex, tex * chase_tint, chase * 0.5);
    let spark = step(1.0 - sparkle * 0.3, w4_hash13(vec3<f32>(facet_idx, floor(time * 4.0))));
    col = col + highlight * spark * 1.5 + highlight * edge * 0.5;
    col = col * amount;
    let rim = w4_fresnel(n, rd, 2.5);
    col = col + highlight * rim * 0.4;
    let alpha = clamp(1.0 - rim * horizon_fade * 0.5, 0.0, 1.0);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 157u) {
    // lissajous-knot: tube along a 3D lissajous curve
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let ratio = vec3<f32>(u.params0.x, u.params0.y, u.params0.z);
    let phase_x = u.params0.w;
    let phase_y = u.params1.x;
    let tube_radius = u.params1.y;
    let k_scale = u.params1.z;
    let spin = u.params1.w;
    let tilt = u.params2.x;
    let tube_color = vec3<f32>(u.params2.y, u.params2.z, u.params2.w);
    let horizon_fade = clamp(p_or(u.params3.x, 0.6), 0.0, 1.0);
    let tau = 6.28318530718;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin * 0.3) * w4_rot_x(tilt * 3.14159265 * 0.5);
    var ro = rot * vec3<f32>(0.0, 0.0, 3.0);
    var rd = rot * normalize(vec3<f32>(p, -1.5));
    var best_t = 1e9;
    var best_pt = vec3<f32>(0.0);
    var best_u = 0.0;
    for (var i = 0; i < 64; i = i + 1) {
      let ti = f32(i) / 63.0 * tau;
      let pt = vec3<f32>(
        sin(ratio.x * ti + phase_x * tau),
        sin(ratio.y * ti + phase_y * tau),
        sin(ratio.z * ti)
      ) * k_scale;
      let t = w4_isect_sphere(ro - pt, rd, tube_radius);
      if (t > 0.0 && t < best_t) {
        best_t = t;
        best_pt = pt;
        best_u = ti / tau;
      }
    }
    if (best_t > 1e8) {
      return vec4<f32>(tube_color * 0.05, (1.0 - horizon_fade) * src.a);
    }
    let hit = ro + rd * best_t;
    let n = normalize(hit - best_pt);
    let ang = atan2(n.z, n.x) / tau + 0.5;
    let tex = sample_rgb(vec2<f32>(best_u, ang));
    let light_dir = normalize(vec3<f32>(0.5, 0.7, 0.5));
    let diff = max(dot(n, light_dir), 0.0);
    let col = (tex * amount + tube_color * 0.3) * (0.4 + diff * 0.7);
    let fade = 1.0 - clamp((best_t - 2.0) / 2.5, 0.0, 1.0);
    let alpha = mix(1.0, fade, horizon_fade);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 158u) {
    // helix-particle-stream: rising helix particle tubes
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let helices = clamp(round(u.params0.x), 1.0, 6.0);
    let helix_radius = u.params0.y;
    let turns = u.params0.z;
    let height = u.params0.w;
    let tube_radius = u.params1.x;
    let rise_speed = u.params1.y;
    let spin = u.params1.z;
    let tilt = u.params1.w;
    let tint = vec3<f32>(u.params2.x, u.params2.y, u.params2.z);
    let horizon_fade = u.params2.w;
    let tau = 6.28318530718;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin * 0.3) * w4_rot_x(tilt * 3.14159265 * 0.5);
    var ro = rot * vec3<f32>(0.0, 0.0, 3.0);
    var rd = rot * normalize(vec3<f32>(p, -1.5));
    let n_helix = i32(helices);
    var best_t = 1e9;
    var best_u = 0.0;
    var best_pt = vec3<f32>(0.0);
    var best_h = 0.0;
    for (var h = 0; h < 6; h = h + 1) {
      if (h >= n_helix) { break; }
      for (var i = 0; i < 40; i = i + 1) {
        var ti = f32(i) / 39.0;
        ti = fract(ti + time * rise_speed * 0.05);
        let ang = ti * turns * tau + f32(h) * (tau / helices);
        let pt = vec3<f32>(cos(ang) * helix_radius, (ti - 0.5) * height, sin(ang) * helix_radius);
        let t = w4_isect_sphere(ro - pt, rd, tube_radius);
        if (t > 0.0 && t < best_t) {
          best_t = t;
          best_u = ti;
          best_pt = pt;
          best_h = f32(h);
        }
      }
    }
    if (best_t > 1e8) {
      return vec4<f32>(tint * 0.04, (1.0 - horizon_fade) * src.a);
    }
    let hit = ro + rd * best_t;
    let n = normalize(hit - best_pt);
    let tex = sample_rgb(vec2<f32>(best_u, best_h / helices));
    let light_dir = normalize(vec3<f32>(0.5, 0.7, 0.5));
    let diff = max(dot(n, light_dir), 0.0);
    let col = tex * amount * (0.5 + diff * 0.7);
    let fade = 1.0 - clamp((best_t - 2.0) / 2.5, 0.0, 1.0);
    let alpha = mix(1.0, fade, horizon_fade);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 159u) {
    // donut-constellation: textured torus with orbiting stars
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let major_r = u.params0.x;
    let minor_r = u.params0.y;
    let star_count = clamp(round(u.params0.z), 4.0, 32.0);
    let star_size = u.params0.w;
    let spin = u.params1.x;
    let tilt = u.params1.y;
    let torus_color = vec3<f32>(u.params1.z, u.params1.w, u.params2.x);
    let star_color = vec3<f32>(u.params2.y, u.params2.z, u.params2.w);
    let horizon_fade = clamp(p_or(u.params3.x, 0.6), 0.0, 1.0);
    let tau = 6.28318530718;
    var p = (uv * 2.0 - vec2<f32>(1.0));
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let rot = w4_rot_y(time * spin * 0.3) * w4_rot_x(tilt * 3.14159265 * 0.6);
    var ro = rot * vec3<f32>(0.0, 0.0, 3.0);
    var rd = rot * normalize(vec3<f32>(p, -1.5));
    var t = 0.0;
    var hit = false;
    var hp = ro;
    for (var i = 0; i < 72; i = i + 1) {
      hp = ro + rd * t;
      let d = w4_sd_torus(hp, major_r, minor_r);
      if (d < 0.002) { hit = true; break; }
      t = t + max(d * 0.8, 0.005);
      if (t > 8.0) { break; }
    }
    if (!hit) {
      return vec4<f32>(torus_color * 0.04, (1.0 - horizon_fade) * src.a);
    }
    let ring = normalize(vec3<f32>(hp.x, 0.0, hp.z)) * major_r;
    let n = normalize(hp - ring);
    let u_c = atan2(hp.z, hp.x) / tau + 0.5;
    let v_c = atan2(hp.y, length(hp.xz) - major_r) / tau + 0.5;
    let tex = sample_rgb(vec2<f32>(u_c, v_c));
    let rim = w4_fresnel(n, rd, 2.5);
    var col = tex * amount + torus_color * rim * 0.5;
    let stars = i32(star_count);
    for (var i = 0; i < 32; i = i + 1) {
      if (i >= stars) { break; }
      let fi = f32(i);
      let star_ang = fi / star_count * tau + time * 0.05;
      let star_pos = vec3<f32>(cos(star_ang) * major_r, 0.0, sin(star_ang) * major_r);
      let d_star = distance(hp, star_pos);
      col = col + star_color * smoothstep(star_size, 0.0, d_star) * 1.5;
    }
    let fade = 1.0 - clamp((t - 2.0) / 3.0, 0.0, 1.0);
    let alpha = mix(1.0, fade, horizon_fade);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), alpha * src.a);
  }
  if (code == 160u) {
    // sphere-project: image projected on a lit sphere
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let roughness = u.params0.x;
    let spin_spd = u.params0.y * 2.0;
    let rim_glow = u.params0.z;
    let tint = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let tau = 6.28318530718;
    var centered = (uv - vec2<f32>(0.5)) * vec2<f32>(res.x / max(1.0, res.y), 1.0);
    centered.y = -centered.y;
    let r = length(centered);
    let sphere_r = 0.45;
    if (r < sphere_r) {
      let z = sqrt(sphere_r * sphere_r - r * r);
      let normal = normalize(vec3<f32>(centered, z));
      let angle = time * spin_spd;
      let ca = cos(angle); let sa = sin(angle);
      let rot_n = vec3<f32>(normal.x * ca - normal.z * sa, normal.y, normal.x * sa + normal.z * ca);
      let suv = vec2<f32>(atan2(rot_n.z, rot_n.x) / tau + 0.5, asin(clamp(rot_n.y, -1.0, 1.0)) / 3.14159265 + 0.5);
      let tex_color = sample_rgb(suv);
      let light_dir = normalize(vec3<f32>(0.5, 0.7, 1.0));
      let diff = max(dot(normal, light_dir), 0.0);
      let spec = pow(max(dot(reflect(-light_dir, normal), vec3<f32>(0.0, 0.0, 1.0)), 0.0), mix(4.0, 64.0, roughness));
      let fres = pow(1.0 - abs(normal.z), 3.0) * rim_glow;
      let lit = tex_color * (diff * 0.7 + 0.3) * tint + vec3<f32>(spec * 0.3) + vec3<f32>(fres) * tint;
      return vec4<f32>(clamp(mix(src.rgb, lit, amount), vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
    }
    let edge_fade = smoothstep(sphere_r + 0.02, sphere_r, r);
    return vec4<f32>(mix(src.rgb, src.rgb * 0.3, edge_fade * amount * 0.5), src.a);
  }
  if (code == 161u) {
    // cube-project: image on the faces of a spinning cube
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let cube_size = 0.3 + u.params0.x * 0.5;
    let edge_glow = u.params0.x;
    let spin_spd = u.params0.y * 1.5;
    let manual_rot = u.params0.z;
    let tint = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    var centered = (uv - vec2<f32>(0.5)) * vec2<f32>(res.x / max(1.0, res.y), 1.0);
    centered.y = -centered.y;
    var ro = vec3<f32>(0.0, 0.0, -2.5);
    var rd = normalize(vec3<f32>(centered, 1.0));
    let angle = time * spin_spd + manual_rot;
    let tilt = 0.4;
    let ca = cos(angle); let sa = sin(angle);
    rd = vec3<f32>(ca * rd.x - sa * rd.z, rd.y, sa * rd.x + ca * rd.z);
    ro = vec3<f32>(ca * ro.x - sa * ro.z, ro.y, sa * ro.x + ca * ro.z);
    let ct = cos(tilt); let st = sin(tilt);
    rd = vec3<f32>(rd.x, ct * rd.y - st * rd.z, st * rd.y + ct * rd.z);
    ro = vec3<f32>(ro.x, ct * ro.y - st * ro.z, st * ro.y + ct * ro.z);
    let inv_rd = 1.0 / rd;
    let t1 = (vec3<f32>(-cube_size) - ro) * inv_rd;
    let t2 = (vec3<f32>(cube_size) - ro) * inv_rd;
    let t_min = min(t1, t2);
    let t_max = max(t1, t2);
    let t_near = max(max(t_min.x, t_min.y), t_min.z);
    let t_far = min(min(t_max.x, t_max.y), t_max.z);
    if (t_near < t_far && t_far > 0.0) {
      let t = select(t_far, t_near, t_near > 0.0);
      let hit_pos = ro + rd * t;
      let abs_hit = abs(hit_pos);
      var face_uv = hit_pos.xy / cube_size * 0.5 + vec2<f32>(0.5);
      var normal = vec3<f32>(0.0, 0.0, sign(hit_pos.z));
      if (abs_hit.x > abs_hit.y - 0.001 && abs_hit.x > abs_hit.z - 0.001) {
        face_uv = hit_pos.yz / cube_size * 0.5 + vec2<f32>(0.5);
        normal = vec3<f32>(sign(hit_pos.x), 0.0, 0.0);
      } else if (abs_hit.y > abs_hit.z - 0.001) {
        face_uv = hit_pos.xz / cube_size * 0.5 + vec2<f32>(0.5);
        normal = vec3<f32>(0.0, sign(hit_pos.y), 0.0);
      }
      let tex_color = sample_rgb(clamp(face_uv, vec2<f32>(0.0), vec2<f32>(1.0)));
      let light_dir = normalize(vec3<f32>(0.5, 0.7, 1.0));
      let diff = max(dot(normal, light_dir), 0.0) * 0.7 + 0.3;
      var lit = tex_color * diff * tint;
      let edge_dist = vec2<f32>(1.0) - abs(face_uv * 2.0 - vec2<f32>(1.0));
      let edge = smoothstep(0.02, 0.08, min(edge_dist.x, edge_dist.y));
      lit = lit + vec3<f32>(1.0 - edge) * edge_glow * tint;
      return vec4<f32>(clamp(lit, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
    }
    return vec4<f32>(src.rgb * 0.15, src.a);
  }
  if (code == 162u) {
    // cylinder-wrap: image wrapped on a spinning cylinder
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let radius = 0.2 + u.params0.x * 0.8;
    let spin_speed = u.params0.y * 2.0;
    let perspective = 0.5 + u.params0.z * 2.0;
    let tau = 6.28318530718;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let angle = time * spin_speed;
    let ro = vec3<f32>(0.0, 0.0, -2.0 - perspective);
    let rd = normalize(vec3<f32>(p, 2.0));
    let a = rd.x * rd.x + rd.z * rd.z;
    let b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
    let c = ro.x * ro.x + ro.z * ro.z - radius * radius;
    let disc = b * b - 4.0 * a * c;
    var col = src.rgb * 0.1;
    if (disc > 0.0) {
      let t = (-b - sqrt(disc)) / (2.0 * a);
      if (t > 0.0) {
        let hit = ro + t * rd;
        if (abs(hit.y) < 1.0) {
          let theta = atan2(hit.x, hit.z) + angle;
          let tex_u = fract(theta / tau);
          let tex_v = hit.y * 0.5 + 0.5;
          let tex_col = sample_rgb(vec2<f32>(tex_u, tex_v));
          let normal = normalize(vec3<f32>(hit.x, 0.0, hit.z));
          let light_dir = normalize(vec3<f32>(0.5, 0.7, -1.0));
          let diff = max(dot(normal, light_dir), 0.0) * 0.6 + 0.4;
          let view_dir = normalize(-rd);
          let half_dir = normalize(light_dir + view_dir);
          let spec = pow(max(dot(normal, half_dir), 0.0), 32.0) * 0.5;
          col = tex_col * diff + vec3<f32>(spec);
        }
      }
    }
    return vec4<f32>(clamp(mix(src.rgb, col, amount), vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 163u) {
    // torus-tunnel: fly through the inside of a torus
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let tube_radius = 0.3 + u.params0.x * 0.7;
    let fly_speed = u.params0.y * 1.5;
    let twist = u.params0.z * 4.0;
    let tau = 6.28318530718;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let major_r = 1.5;
    let t = time * fly_speed;
    let cam_angle = t;
    var cam_pos = vec3<f32>(cos(cam_angle) * major_r, 0.0, sin(cam_angle) * major_r);
    let cam_fwd = normalize(vec3<f32>(-sin(cam_angle), 0.0, cos(cam_angle)));
    var cam_up = vec3<f32>(0.0, 1.0, 0.0);
    let cam_right = normalize(cross(cam_fwd, cam_up));
    cam_up = cross(cam_right, cam_fwd);
    let tw = t * twist;
    let t_right = cam_right * cos(tw) + cam_up * sin(tw);
    let t_up = -cam_right * sin(tw) + cam_up * cos(tw);
    let rd = normalize(cam_fwd + p.x * t_right * 0.8 + p.y * t_up * 0.8);
    cam_pos = cam_pos + cam_fwd * 0.01;
    var col = vec3<f32>(0.0);
    var total_dist = 0.0;
    var hit = false;
    for (var i = 0; i < 60; i = i + 1) {
      let pos = cam_pos + rd * total_dist;
      let d = -w4_sd_torus(pos, major_r, tube_radius);
      if (d < 0.002) { hit = true; break; }
      if (total_dist > 10.0) { break; }
      total_dist = total_dist + max(d, 0.005);
    }
    if (hit) {
      let hit_pos = cam_pos + rd * total_dist;
      let ring_angle = atan2(hit_pos.z, hit_pos.x);
      let local_p = vec2<f32>(length(hit_pos.xz) - major_r, hit_pos.y);
      let tube_angle = atan2(local_p.y, local_p.x);
      let tex_uv = vec2<f32>(fract(ring_angle / tau + 0.5), fract(tube_angle / tau + 0.5));
      let tex_col = sample_rgb(tex_uv);
      let fog = exp(-total_dist * 0.3);
      col = tex_col * fog + vec3<f32>(0.02, 0.01, 0.03);
    }
    return vec4<f32>(clamp(mix(src.rgb, col, amount), vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 164u) {
    // diamond-gem: faceted gem with refraction + rainbow caustics
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let facets = 4.0 + u.params0.x * 16.0;
    let rot_speed = u.params0.y * 2.0;
    let sparkle = u.params0.z;
    let tau = 6.28318530718;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let t = time * rot_speed;
    let ca = cos(t); let sa = sin(t);
    let rp = vec2<f32>(p.x * ca - p.y * sa * 0.3, p.x * sa * 0.3 + p.y * ca);
    let ax = abs(rp.x);
    let top_width = 0.6;
    let equator_y = -0.15;
    let crown_y = -0.55;
    let point_y = 0.75;
    let t_crown = clamp((rp.y - equator_y) / (crown_y - equator_y), 0.0, 1.0);
    let crown_width = mix(top_width, top_width * 0.7, t_crown);
    let t_pav = clamp((rp.y - equator_y) / (point_y - equator_y), 0.0, 1.0);
    let pav_width = mix(top_width, 0.0, t_pav);
    let half_width = mix(pav_width, crown_width, step(rp.y, equator_y));
    let in_diamond = step(ax, half_width) * step(crown_y, rp.y) * step(rp.y, point_y);
    let angle = atan2(rp.y - equator_y, rp.x);
    let q_angle = floor(angle * facets / tau + 0.5) * tau / facets;
    let facet_n2 = vec2<f32>(cos(q_angle), sin(q_angle));
    let facet_normal = normalize(vec3<f32>(facet_n2.x, facet_n2.y, 0.6));
    let ref_xy = facet_n2 * 0.4;
    let tex_col = sample_rgb(clamp(uv + ref_xy * 0.15, vec2<f32>(0.0), vec2<f32>(1.0)));
    let tex_r = sample_rgb(clamp(uv + ref_xy * 0.20, vec2<f32>(0.0), vec2<f32>(1.0)));
    let tex_b = sample_rgb(clamp(uv + ref_xy * 0.10, vec2<f32>(0.0), vec2<f32>(1.0)));
    let dispersed = vec3<f32>(tex_r.r, tex_col.g, tex_b.b);
    let light_dir = normalize(vec3<f32>(0.5, -0.8, 1.0));
    let diff = max(dot(facet_normal, light_dir), 0.0);
    let view_dir = vec3<f32>(0.0, 0.0, 1.0);
    let half_v = normalize(light_dir + view_dir);
    let spec = pow(max(dot(facet_normal, half_v), 0.0), 80.0);
    let fres = pow(1.0 - max(dot(view_dir, facet_normal), 0.0), 3.0);
    let caustic_angle = angle + t * 0.5;
    let rainbow = vec3<f32>(0.5) + 0.5 * cos(tau * (vec3<f32>(caustic_angle / tau) + vec3<f32>(0.0, 0.33, 0.67)));
    var gem_col = dispersed * (diff * 0.6 + 0.4);
    gem_col = gem_col + rainbow * fres * 0.4 + vec3<f32>(spec) * sparkle * 3.0 + rainbow * spec * sparkle * 0.5;
    let edge_dist = abs(ax - half_width * 0.97);
    let edge = smoothstep(0.02, 0.0, edge_dist) * in_diamond;
    gem_col = gem_col + vec3<f32>(0.8, 0.85, 1.0) * edge * 0.5;
    var col = mix(src.rgb * 0.15, gem_col, in_diamond);
    col = mix(src.rgb, col, amount);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 165u) {
    // shatter-3d: voronoi shards exploding with gravity + rotation
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let force = amount * 2.0;
    let shard_size = mix(4.0, 20.0, u.params0.x);
    let speed = 0.5 + u.params0.y * 2.0;
    let gravity = u.params0.z * 0.5;
    let tau = 6.28318530718;
    let phase = sin(time * speed) * 0.5 + 0.5;
    let explode = phase * force;
    let cell_size = vec2<f32>(shard_size) / res;
    let cell_id = floor(uv / cell_size);
    var min_dist = 10.0;
    var closest_id = cell_id;
    var closest_center = vec2<f32>(0.5);
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighbor = cell_id + vec2<f32>(f32(x), f32(y));
        let point = vec2<f32>(hash21(neighbor), hash21(neighbor + vec2<f32>(57.0)));
        let diff2 = neighbor + point - uv / cell_size;
        let d = dot(diff2, diff2);
        if (d < min_dist) {
          min_dist = d;
          closest_id = neighbor;
          closest_center = neighbor + point;
        }
      }
    }
    let shard_angle = hash21(closest_id) * tau;
    let shard_delay = hash21(closest_id + vec2<f32>(57.0)) * 0.5;
    let local_explode = max(explode - shard_delay, 0.0);
    let dir = normalize(closest_center * cell_size - vec2<f32>(0.5) + vec2<f32>(1e-6));
    var offset = dir * local_explode * 0.3;
    offset.y = offset.y - gravity * local_explode * local_explode;
    let rot = local_explode * shard_angle * 2.0;
    let center = closest_center * cell_size;
    var rot_uv = uv - center;
    let cs = cos(rot); let sn = sin(rot);
    rot_uv = vec2<f32>(rot_uv.x * cs - rot_uv.y * sn, rot_uv.x * sn + rot_uv.y * cs) + center;
    let sample_uv = rot_uv - offset;
    let edge = smoothstep(0.01, 0.03, sqrt(min_dist));
    let depth = 1.0 - local_explode * 0.3;
    var col = sample_rgb(clamp(sample_uv, vec2<f32>(0.0), vec2<f32>(1.0))) * depth * edge;
    let edge_highlight = 1.0 - smoothstep(0.02, 0.06, sqrt(min_dist));
    col = col + edge_highlight * vec3<f32>(0.3) * local_explode;
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 166u) {
    // mobius-strip: image wrapped along a rotating mobius band
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let strip_w = 0.1 + u.params0.x * 0.5;
    let rot_speed = u.params0.y * 1.5;
    let twist_amt = 1.0 + u.params0.z * 4.0;
    let tau = 6.28318530718;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let t = time * rot_speed;
    let ro = vec3<f32>(0.0, 1.2, -3.0);
    let fwd = normalize(-ro);
    let right = normalize(cross(fwd, vec3<f32>(0.0, 1.0, 0.0)));
    let up = cross(right, fwd);
    let rd = normalize(fwd + p.x * right + p.y * up);
    var min_dist = 100.0;
    var best_u = 0.0;
    var best_v = 0.0;
    for (var i = 0; i < 48; i = i + 1) {
      let u0 = f32(i) / 48.0 * tau;
      for (var j = 0; j < 6; j = j + 1) {
        let v0 = f32(j) / 5.0 * 2.0 - 1.0;
        let half_twist = u0 * twist_amt * 0.5;
        let big_r = 1.2;
        let mp = vec3<f32>(
          (big_r + v0 * strip_w * cos(half_twist)) * cos(u0 + t),
          v0 * strip_w * sin(half_twist),
          (big_r + v0 * strip_w * cos(half_twist)) * sin(u0 + t)
        );
        let diff3 = mp - ro;
        let along = dot(diff3, rd);
        if (along > 0.0) {
          let closest = ro + rd * along;
          let d = length(mp - closest);
          if (d < min_dist) {
            min_dist = d;
            best_u = u0;
            best_v = v0;
          }
        }
      }
    }
    var col = src.rgb * 0.08;
    if (min_dist < 0.08) {
      var tex_col = sample_rgb(vec2<f32>(fract(best_u / tau), best_v * 0.5 + 0.5));
      let shade = smoothstep(0.08, 0.01, min_dist);
      let light = 0.5 + 0.5 * sin(best_u * 2.0 + t);
      tex_col = tex_col * (0.6 + 0.4 * light);
      col = tex_col * shade;
    }
    return vec4<f32>(clamp(mix(src.rgb, col, amount), vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 167u) {
    // voxel-displace: isometric voxel height blocks from luma
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let depth_scale = 0.3 + amount * 1.5;
    let grid_res = floor(mix(6.0, 32.0, u.params0.x));
    let rot_angle = time * u.params0.y * 0.8;
    let gap = u.params0.z * 0.3;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let ca = cos(rot_angle); let sa = sin(rot_angle);
    let rp = vec2<f32>(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
    let iso_p = vec2<f32>(rp.x, rp.y / 0.65);
    let grid_uv = iso_p * 0.5 + vec2<f32>(0.5);
    let voxel_id = floor(grid_uv * grid_res);
    let cell_uv = fract(grid_uv * grid_res);
    let tex_coord = (voxel_id + vec2<f32>(0.5)) / grid_res;
    let tex_col = sample_rgb(clamp(tex_coord, vec2<f32>(0.0), vec2<f32>(1.0)));
    let height = dot(tex_col, vec3<f32>(0.2126, 0.7152, 0.0722)) * depth_scale;
    let in_grid = step(0.0, grid_uv.x) * step(grid_uv.x, 1.0) * step(0.0, grid_uv.y) * step(grid_uv.y, 1.0);
    let half_gap = gap * 0.5;
    let in_cell = step(half_gap, cell_uv.x) * step(cell_uv.x, 1.0 - half_gap) * step(half_gap, cell_uv.y) * step(cell_uv.y, 1.0 - half_gap);
    let left_tex = sample_rgb(clamp((voxel_id + vec2<f32>(-0.5, 0.5)) / grid_res, vec2<f32>(0.0), vec2<f32>(1.0)));
    let front_tex = sample_rgb(clamp((voxel_id + vec2<f32>(0.5, 1.5)) / grid_res, vec2<f32>(0.0), vec2<f32>(1.0)));
    let left_h = dot(left_tex, vec3<f32>(0.2126, 0.7152, 0.0722)) * depth_scale;
    let front_h = dot(front_tex, vec3<f32>(0.2126, 0.7152, 0.0722)) * depth_scale;
    let side_exposure_x = max(height - left_h, 0.0);
    let side_exposure_y = max(height - front_h, 0.0);
    let top_face = in_cell;
    let right_side = step(0.0, side_exposure_x) * step(cell_uv.x, half_gap * 3.0) * (1.0 - step(half_gap, cell_uv.x));
    let front_side = step(0.0, side_exposure_y) * step(1.0 - half_gap * 3.0, cell_uv.y) * step(cell_uv.y, 1.0);
    let voxel_col = tex_col * 1.1 * top_face + tex_col * 0.6 * right_side + tex_col * 0.4 * front_side;
    let show_voxel = in_grid * max(top_face, max(right_side, front_side));
    var col = mix(vec3<f32>(0.02), voxel_col, show_voxel);
    let ao = smoothstep(0.0, half_gap * 2.0, min(cell_uv.x, min(cell_uv.y, min(1.0 - cell_uv.x, 1.0 - cell_uv.y))));
    col = col * mix(0.7, 1.0, ao);
    col = col * (0.6 + height * 0.6);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 168u) {
    // wave-surface: refracting water plane
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let amp = 0.05 + amount * 0.3;
    let freq = 2.0 + u.params0.x * 10.0;
    let speed = 0.5 + u.params0.y * 3.0;
    let specular = u.params0.z;
    let t = time * speed;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let ro = vec3<f32>(0.0, 2.0, -1.5);
    let rd = normalize(vec3<f32>(p.x, -1.2, p.y + 0.5));
    let t_plane = -ro.y / rd.y;
    var col = vec3<f32>(0.01, 0.02, 0.05);
    if (t_plane > 0.0) {
      let hit_pos = ro + rd * t_plane;
      let sp = hit_pos.xz;
      let eps = 0.01;
      var h = 0.0; var h_l = 0.0; var h_r = 0.0; var h_d = 0.0; var h_u = 0.0;
      var f_muls = array<f32, 5>(1.0, 0.7, 0.5, 0.8, 2.0);
      var t_muls = array<f32, 5>(1.3, 0.9, 1.7, 2.1, 2.5);
      var a_muls = array<f32, 5>(0.5, 0.3, 0.2, 0.15, 0.1);
      var dirs_a = array<vec2<f32>, 5>(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(2.0, 1.5));
      for (var w = 0; w < 5; w = w + 1) {
        let f_mul = f_muls[w];
        let t_mul = t_muls[w];
        let a_mul = a_muls[w];
        let dir_a = dirs_a[w];
        let norm_d = max(1.0, length(dir_a));
        h = h + sin(dot(sp, dir_a) * freq * f_mul / norm_d + t * t_mul) * a_mul;
        h_l = h_l + sin(dot(sp - vec2<f32>(eps, 0.0), dir_a) * freq * f_mul / norm_d + t * t_mul) * a_mul;
        h_r = h_r + sin(dot(sp + vec2<f32>(eps, 0.0), dir_a) * freq * f_mul / norm_d + t * t_mul) * a_mul;
        h_d = h_d + sin(dot(sp - vec2<f32>(0.0, eps), dir_a) * freq * f_mul / norm_d + t * t_mul) * a_mul;
        h_u = h_u + sin(dot(sp + vec2<f32>(0.0, eps), dir_a) * freq * f_mul / norm_d + t * t_mul) * a_mul;
      }
      let normal = normalize(vec3<f32>((h_l - h_r) * amp, 2.0 * eps, (h_d - h_u) * amp));
      let refr = refract(rd, normal, 0.75);
      let tex_uv = fract(sp * 0.3 + vec2<f32>(0.5) + refr.xz * 0.1);
      let tex_col = sample_rgb(tex_uv);
      let light_dir = normalize(vec3<f32>(0.3, 1.0, -0.5));
      let diff = max(dot(normal, light_dir), 0.0) * 0.6 + 0.4;
      let view_dir = normalize(-rd);
      let refl_dir = reflect(-light_dir, normal);
      let spec = pow(max(dot(view_dir, refl_dir), 0.0), 32.0) * specular;
      let fres = pow(1.0 - max(dot(view_dir, normal), 0.0), 4.0) * 0.3;
      col = tex_col * diff + vec3<f32>(0.4, 0.6, 0.9) * fres + vec3<f32>(spec);
      col = col * exp(-t_plane * 0.15);
    }
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 169u) {
    // prism-split: triangular prism with chromatic dispersion
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let separation = amount * 0.15;
    let prism_angle = u.params0.x * 3.14159265;
    let rotation = u.params0.y * 6.28318530718;
    let tint_intensity = u.params0.z;
    let tint = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let tau = 6.28318530718;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let ra = rotation + time * 0.3;
    let cra = cos(ra); let sra = sin(ra);
    p = vec2<f32>(cra * p.x - sra * p.y, sra * p.x + cra * p.y);
    let prism_size = 0.4 + prism_angle * 0.3;
    // sdTriangle
    let k = sqrt(3.0);
    var tp = p;
    tp.x = abs(tp.x) - prism_size;
    tp.y = tp.y + prism_size / k;
    if (tp.x + k * tp.y > 0.0) { tp = vec2<f32>(tp.x - k * tp.y, -k * tp.x - tp.y) / 2.0; }
    tp.x = tp.x - clamp(tp.x, -2.0 * prism_size, 0.0);
    let dist = -length(tp) * sign(tp.y);
    let in_prism = smoothstep(0.02, -0.02, dist);
    let base_angle = atan2(p.y, p.x);
    let base_dist = length(p);
    var red_offset = vec2<f32>(cos(base_angle - separation), sin(base_angle - separation)) * separation * base_dist;
    var blue_offset = vec2<f32>(cos(base_angle + separation), sin(base_angle + separation)) * separation * base_dist;
    red_offset = red_offset * (1.0 + in_prism * 4.0);
    blue_offset = blue_offset * (1.0 + in_prism * 4.0);
    var col = vec3<f32>(
      sample_rgb(uv + red_offset).r,
      src.g,
      sample_rgb(uv + blue_offset).b
    );
    col = col * mix(vec3<f32>(1.0), tint, tint_intensity * in_prism);
    let edge_glow = smoothstep(0.05, 0.0, abs(dist)) * 0.6;
    let rainbow = vec3<f32>(0.5) + 0.5 * cos(tau * (vec3<f32>(base_angle / tau) + vec3<f32>(0.0, 0.33, 0.67)));
    col = col + rainbow * edge_glow * separation * 5.0;
    let highlight = pow(max(1.0 - abs(dist) * 5.0, 0.0), 8.0) * 0.2;
    col = col + vec3<f32>(highlight);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 170u) {
    // origami-fold: animated paper folds with creases
    let time = u.resolution_time.z;
    let fold_depth = 0.1 + amount * 0.9;
    let fold_count = 2.0 + floor(u.params0.x * 10.0);
    let speed = 0.5 + u.params0.y * 2.0;
    let crease_sharpen = 2.0 + u.params0.z * 20.0;
    let t = time * speed;
    let fold_anim = (sin(t) * 0.5 + 0.5) * fold_depth;
    let h_fold = uv.y * fold_count;
    let h_fold_id = floor(h_fold);
    let h_fold_frac = fract(h_fold);
    let v_fold = uv.x * fold_count;
    let v_fold_id = floor(v_fold);
    let v_fold_frac = fract(v_fold);
    let h_dir = (h_fold_id - floor(h_fold_id * 0.5) * 2.0) * 2.0 - 1.0;
    let v_dir = (v_fold_id - floor(v_fold_id * 0.5) * 2.0) * 2.0 - 1.0;
    let h_angle = (h_fold_frac - 0.5) * 2.0 * h_dir;
    let v_angle = (v_fold_frac - 0.5) * 2.0 * v_dir;
    let fold_normal_z = cos(h_angle * fold_anim * 3.14159265 * 0.5) * cos(v_angle * fold_anim * 3.14159265 * 0.5);
    let fold_normal_x = sin(v_angle * fold_anim * 3.14159265 * 0.5) * 0.5;
    let fold_normal_y = sin(h_angle * fold_anim * 3.14159265 * 0.5) * 0.5;
    let normal = normalize(vec3<f32>(fold_normal_x, fold_normal_y, fold_normal_z));
    let light_dir = normalize(vec3<f32>(0.5, 0.7, 1.0));
    let diff = max(dot(normal, light_dir), 0.0) * 0.6 + 0.4;
    let half_dir = normalize(light_dir + vec3<f32>(0.0, 0.0, 1.0));
    let spec = pow(max(dot(normal, half_dir), 0.0), 16.0) * 0.3;
    let disp_uv = clamp(uv + vec2<f32>(fold_normal_x, fold_normal_y) * fold_anim * 0.02, vec2<f32>(0.0), vec2<f32>(1.0));
    let tex_col = sample_rgb(disp_uv);
    let h_crease = pow(abs(h_fold_frac - 0.5) * 2.0, crease_sharpen);
    let v_crease = pow(abs(v_fold_frac - 0.5) * 2.0, crease_sharpen);
    let crease_dark = mix(0.6, 1.0, min(h_crease, v_crease));
    let shadow = mix(1.0, fold_normal_z, fold_anim);
    var col = tex_col * diff * crease_dark * shadow + vec3<f32>(spec) * fold_anim;
    let edge_dist = min(abs(h_fold_frac - 0.5), abs(v_fold_frac - 0.5));
    col = col + vec3<f32>(smoothstep(0.02, 0.0, edge_dist) * fold_anim * 0.4);
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 171u) {
    // mirror-room: bouncing reflections inside a textured box
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let room_size = 0.5 + u.params0.x * 2.0;
    let cam_speed = u.params0.y * 0.5;
    let refl_fade = 0.3 + u.params0.z * 0.65;
    var p = (uv - vec2<f32>(0.5)) * 2.0;
    p.x = p.x * (res.x / max(1.0, res.y));
    p.y = -p.y;
    let t = time;
    let ro = vec3<f32>(
      sin(t * cam_speed * 0.7) * room_size * 0.3,
      sin(t * cam_speed * 0.5) * room_size * 0.2,
      cos(t * cam_speed * 0.6) * room_size * 0.3
    );
    let look_angle = t * cam_speed * 0.4;
    let fwd = normalize(vec3<f32>(cos(look_angle), sin(t * cam_speed * 0.2) * 0.3, sin(look_angle)));
    let right = normalize(cross(fwd, vec3<f32>(0.0, 1.0, 0.0)));
    let up = cross(right, fwd);
    var ray_pos = ro;
    var ray_dir = normalize(fwd + p.x * right * 0.8 + p.y * up * 0.8);
    var col = vec3<f32>(0.0);
    var energy = 1.0;
    for (var bounce = 0; bounce < 6; bounce = bounce + 1) {
      let t_min = (vec3<f32>(-room_size) - ray_pos) / ray_dir;
      let t_max = (vec3<f32>(room_size) - ray_pos) / ray_dir;
      let t2 = max(t_min, t_max);
      var hit_t = min(min(t2.x, t2.y), t2.z);
      if (hit_t < 0.001) { hit_t = 0.001; }
      let hit_pos = ray_pos + ray_dir * hit_t;
      let abs_hit = abs(hit_pos);
      var normal = vec3<f32>(0.0, 0.0, -sign(ray_dir.z));
      var face_uv = hit_pos.xy / room_size * 0.5 + vec2<f32>(0.5);
      if (abs_hit.x >= abs_hit.y - 0.001 && abs_hit.x >= abs_hit.z - 0.001) {
        normal = vec3<f32>(-sign(ray_dir.x), 0.0, 0.0);
        face_uv = hit_pos.yz / room_size * 0.5 + vec2<f32>(0.5);
      } else if (abs_hit.y >= abs_hit.z - 0.001) {
        normal = vec3<f32>(0.0, -sign(ray_dir.y), 0.0);
        face_uv = hit_pos.xz / room_size * 0.5 + vec2<f32>(0.5);
      }
      let tex_col = sample_rgb(clamp(face_uv, vec2<f32>(0.0), vec2<f32>(1.0)));
      col = col + tex_col * energy * 0.35;
      energy = energy * refl_fade;
      if (energy < 0.01) { break; }
      ray_pos = hit_pos + normal * 0.01;
      ray_dir = reflect(ray_dir, normal);
    }
    return vec4<f32>(clamp(mix(src.rgb, col, amount), vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 172u) {
    // geometric-tile-pro: 3D flip-board tiles
    let time = u.resolution_time.z;
    let tile_count = 3.0 + amount * 15.0;
    let flip_range = u.params0.x * 3.14159265;
    let speed = u.params0.y * 2.0;
    let gap_size = u.params0.z * 0.1;
    let tau = 6.28318530718;
    let tile_id = floor(uv * tile_count);
    let tile_uv = fract(uv * tile_count);
    let border = step(vec2<f32>(gap_size), tile_uv) * step(vec2<f32>(gap_size), vec2<f32>(1.0) - tile_uv);
    let in_tile = border.x * border.y;
    if (in_tile > 0.5) {
      let rnd = hash21(tile_id);
      let flip_angle = sin(time * speed + rnd * tau) * flip_range;
      let centered = tile_uv - vec2<f32>(0.5);
      let cos_a = cos(flip_angle);
      let persp_x = centered.x * cos_a;
      let persp_scale = 1.0 / (1.0 + abs(centered.x * sin(flip_angle)) * 0.5);
      let rotated_uv = vec2<f32>(persp_x, centered.y) * persp_scale + vec2<f32>(0.5);
      let src_uv = (tile_id + clamp(rotated_uv, vec2<f32>(0.01), vec2<f32>(0.99))) / tile_count;
      let tile_color = sample_rgb(src_uv);
      let lighting = 0.6 + 0.4 * cos_a;
      return vec4<f32>(clamp(tile_color * lighting, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
    }
    return vec4<f32>(vec3<f32>(0.02), src.a);
  }
  if (code == 173u) {
    // shingle-stack: overlapping animated shingles with parallax
    let time = u.resolution_time.z;
    let tile_count = floor(mix(3.0, 14.0, u.params0.x));
    let slide_speed = u.params0.y * 2.0;
    let overlap = 0.2 + u.params0.z * 0.4;
    let tau = 6.28318530718;
    var scaled = uv * tile_count;
    let row = floor(scaled.y);
    let row_offset = (row - floor(row * 0.5) * 2.0) * 0.5;
    scaled.x = scaled.x + row_offset;
    let tile_id = floor(scaled);
    let tile_frac = fract(scaled);
    let rnd = hash21(tile_id);
    let rnd2 = hash21(tile_id + vec2<f32>(100.0));
    let lift = sin(rnd * tau + time * slide_speed) * 0.5 + 0.5;
    let parallax_amount = lift * overlap * 0.3;
    let parallax_offset = vec2<f32>((rnd2 - 0.5) * parallax_amount, -parallax_amount * 0.5);
    let tile_uv = (tile_id - vec2<f32>(row_offset, 0.0) + tile_frac) / tile_count;
    let tex_col = sample_rgb(clamp(tile_uv + parallax_offset, vec2<f32>(0.0), vec2<f32>(1.0)));
    let shadow_above = smoothstep(overlap, 0.0, tile_frac.y) * 0.4;
    let shadow_side = smoothstep(overlap * 0.5, 0.0, tile_frac.x) * 0.2;
    let lighting = 0.5 + lift * 0.5;
    let edge_x = min(tile_frac.x, 1.0 - tile_frac.x);
    let edge_y = min(tile_frac.y, 1.0 - tile_frac.y);
    let bevel = smoothstep(0.0, 0.08, min(edge_x, edge_y));
    var col = tex_col * lighting;
    col = col * (1.0 - shadow_above - shadow_side);
    col = col + vec3<f32>((1.0 - bevel) * lift * 0.3);
    col = col * (bevel * 0.3 + 0.7);
    return vec4<f32>(clamp(mix(src.rgb, col, amount), vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 174u) {
    // time-smear: temporal smear approximated with decaying directional/zoom taps
    let time = u.resolution_time.z;
    let blend2 = u.params0.x;
    let decay = clamp(u.params0.y, 0.0, 0.98);
    let s_mode = u32(round(u.params0.z));
    let speed = u.params0.w;
    let t = time * speed;
    let dir = vec2<f32>(cos(t * 0.7), sin(t * 0.7));
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    var w = 1.0;
    for (var i = 0u; i < 16u; i = i + 1u) {
      let fi = f32(i);
      var s_uv = uv - dir * amount * 0.02 * fi * blend2;
      if (s_mode >= 1u) {
        s_uv = vec2<f32>(0.5) + (s_uv - vec2<f32>(0.5)) * (1.0 + fi * amount * 0.015);
      }
      acc = acc + sample_rgb(clamp(s_uv, vec2<f32>(0.0), vec2<f32>(1.0))) * w;
      wsum = wsum + w;
      w = w * (0.55 + decay * 0.45);
      if (w < 0.01) { break; }
    }
    return vec4<f32>(acc / max(wsum, 0.001), src.a);
  }
  if (code == 175u) {
    // chronophoto: strip-sequenced time-phase offsets
    let time = u.resolution_time.z;
    let strip_factor = u.params0.x;
    let phase_amt = u.params0.y;
    let c_mode = u32(round(u.params0.z));
    let speed = u.params0.w;
    let strips = 4.0 + strip_factor * 28.0;
    var coord = uv.x;
    if (c_mode >= 1u) { coord = uv.y; }
    let strip_id = floor(coord * strips);
    let golden = 2.39996;
    let phase = sin(time * speed + strip_id * golden * phase_amt) * amount * 0.08;
    var s_uv = uv + vec2<f32>(phase, 0.0);
    if (c_mode >= 1u) { s_uv = uv + vec2<f32>(0.0, phase); }
    var col = sample_rgb(clamp(s_uv, vec2<f32>(0.0), vec2<f32>(1.0)));
    // older strips desaturate + darken slightly (sequence-photography feel)
    let age = fract(strip_id / strips + time * speed * 0.05);
    let l = luma(col);
    col = mix(col, vec3<f32>(l), age * amount * 0.6);
    col = col * (1.0 - age * amount * 0.25);
    // strip seams
    let seam = smoothstep(0.02, 0.0, abs(fract(coord * strips) - 0.5) - 0.47);
    col = col * (1.0 - seam * amount * 0.5);
    return vec4<f32>(col, src.a);
  }
  if (code == 176u) {
    // optical-flow-datamosh: block-quantized gradient-flow displacement
    let res = u.resolution_time.xy;
    let time = u.resolution_time.z;
    let motion_scale = u.params0.x;
    let persistence = u.params0.y;
    let chroma_split = u.params0.z;
    let block_size = max(2.0, u.params0.w);
    let freeze = u.params1.x;
    let texel = 1.0 / max(res, vec2<f32>(2.0));
    let block_id = floor(uv * res / block_size);
    let block_center = (block_id + vec2<f32>(0.5)) * block_size / res;
    let g_step = texel * block_size * 0.5;
    let l_l = luma(sample_rgb(block_center - vec2<f32>(g_step.x, 0.0)));
    let l_r = luma(sample_rgb(block_center + vec2<f32>(g_step.x, 0.0)));
    let l_d = luma(sample_rgb(block_center - vec2<f32>(0.0, g_step.y)));
    let l_u = luma(sample_rgb(block_center + vec2<f32>(0.0, g_step.y)));
    var flow = vec2<f32>(l_r - l_l, l_u - l_d) * motion_scale;
    // temporal jitter per block, like drifting mosh vectors
    let jit = vec2<f32>(
      hash21(block_id + vec2<f32>(floor(time * 3.0))) - 0.5,
      hash21(block_id + vec2<f32>(floor(time * 3.0) + 13.7)) - 0.5
    ) * 0.35 * (1.0 - freeze);
    flow = (flow + jit * length(flow + vec2<f32>(0.05))) * amount * persistence;
    var col = vec3<f32>(0.0);
    if (chroma_split > 0.001) {
      col.r = sample_rgb(clamp(uv - flow * (1.0 + chroma_split * 0.5), vec2<f32>(0.0), vec2<f32>(1.0))).r;
      col.g = sample_rgb(clamp(uv - flow, vec2<f32>(0.0), vec2<f32>(1.0))).g;
      col.b = sample_rgb(clamp(uv - flow * (1.0 - chroma_split * 0.5), vec2<f32>(0.0), vec2<f32>(1.0))).b;
    } else {
      col = sample_rgb(clamp(uv - flow, vec2<f32>(0.0), vec2<f32>(1.0)));
    }
    // smear along flow within the block for mosh streaks
    var acc = col;
    var wsum = 1.0;
    for (var i = 1; i <= 5; i = i + 1) {
      let fi = f32(i) / 5.0;
      let s = sample_rgb(clamp(uv - flow * (1.0 + fi * 2.0), vec2<f32>(0.0), vec2<f32>(1.0)));
      let w = (1.0 - fi) * persistence;
      acc = acc + s * w;
      wsum = wsum + w;
    }
    return vec4<f32>(acc / wsum, src.a);
  }
  if (code == 177u) {
    // flow-field-trails: curl-noise advected luminance trails
    let time = u.resolution_time.z;
    let flow_scale = max(0.5, u.params0.x);
    let samples = clamp(round(u.params0.y), 4.0, 32.0);
    let speed = u.params0.z;
    let chroma_split = u.params0.w;
    let contrast = max(0.1, u.params1.x);
    let color_cycle = u.params1.z;
    var p = uv;
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    let steps = i32(samples);
    for (var i = 0; i < 32; i = i + 1) {
      if (i >= steps) { break; }
      let fi = f32(i);
      var s = sample_rgb(clamp(p, vec2<f32>(0.0), vec2<f32>(1.0)));
      if (color_cycle > 0.001) {
        s = hue_rotate(s, fi * color_cycle * 0.03);
      }
      let l = pow(luma(s), contrast);
      let w = (1.0 - fi / samples) * l;
      acc = acc + s * w;
      wsum = wsum + w;
      let noise_pos = p * flow_scale + vec2<f32>(time * speed * 0.3);
      let n0 = fbm2d(noise_pos);
      let nx = fbm2d(noise_pos + vec2<f32>(0.01, 0.0));
      let ny = fbm2d(noise_pos + vec2<f32>(0.0, 0.01));
      let flow = vec2<f32>(-(ny - n0), nx - n0) / 0.01;
      p = p + normalize(flow + vec2<f32>(0.001)) * 0.01 * amount * 2.5;
    }
    var trails = vec3<f32>(0.0);
    if (wsum > 0.01) { trails = acc / wsum; }
    if (chroma_split > 0.001) {
      let cd = vec2<f32>(chroma_split * 0.004, 0.0);
      trails.r = mix(trails.r, sample_rgb(clamp(p + cd, vec2<f32>(0.0), vec2<f32>(1.0))).r, 0.3);
      trails.b = mix(trails.b, sample_rgb(clamp(p - cd, vec2<f32>(0.0), vec2<f32>(1.0))).b, 0.3);
    }
    let result = max(src.rgb * 0.35, trails);
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 178u) {
    // reaction-diffusion: stateless Turing-pattern overlay masked by luma
    let time = u.resolution_time.z;
    let pattern_scale = max(0.1, u.params0.x);
    let luma_mask = u.params0.y;
    let rd_color = vec3<f32>(u.params0.w, u.params1.x, u.params1.y);
    let feed = u.params1.z;
    let kill = u.params1.w;
    let diff_a = clamp(p_or(u.params2.x, 1.0), 0.5, 1.5);
    let diff_b = clamp(p_or(u.params2.y, 0.5), 0.2, 1.0);
    let reseed = clamp(u.params2.z, 0.0, 1.0);
    let scale = pattern_scale * 9.0;
    let a = fbm2d(uv * scale / diff_a + vec2<f32>(time * 0.03));
    let b = cellular2d(uv * scale * 0.8 / max(0.2, diff_b) + vec2<f32>(7.3, 2.1));
    let field = a - b * 0.9;
    // feed/kill shift the pattern threshold + width (coral vs spots vs stripes)
    let center = (kill - feed) * 8.0;
    let width = 0.06 + feed * 1.5;
    var spots = smoothstep(center - width, center, field) * smoothstep(center + width, center, field);
    let stripes = smoothstep(0.0, 0.08, abs(fract(field * 6.0 + time * 0.05) - 0.5) - 0.2);
    spots = max(spots, (1.0 - stripes) * 0.6);
    let l = luma(src.rgb);
    if (reseed > 0.001) {
      // bright content re-seeds the pattern
      spots = max(spots, smoothstep(1.0 - reseed * 0.55, 1.02, l));
    }
    let mask = mix(1.0, smoothstep(luma_mask - 0.25, luma_mask + 0.25, l), 0.85);
    let pattern = spots * mask;
    let result = mix(src.rgb, mix(src.rgb * 0.35, rd_color, pattern), amount * clamp(pattern + 0.25, 0.0, 1.0));
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 179u) {
    // feedback-zoom: unrolled recursive zoom feedback with hue cycling.
    // amount = feedback mix, params0 = (zoom/frame, rot/frame, decay, centerX),
    // params1 = (centerY, hue shift, center mask)
    let fb_zoom = clamp(p_or(u.params0.x, 1.02), 0.85, 1.15);
    let rot_per_iter = clamp(u.params0.y, -0.2, 0.2);
    let decay = clamp(u.params0.z, 0.0, 1.0);
    let center = vec2<f32>(u.params0.w, u.params1.x);
    let hue_cycle = u.params1.y * 0.15;
    let center_mask = clamp(u.params1.z, 0.0, 1.0);
    let fb_mix = clamp(amount, 0.0, 1.0);
    let persist = clamp((1.0 - decay) * 0.98, 0.02, 0.98);
    let inv_zoom = 1.0 / fb_zoom;
    var p = uv;
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    let cr = cos(rot_per_iter); let sr = sin(rot_per_iter);
    for (var i = 0u; i < 16u; i = i + 1u) {
      let fi = f32(i);
      var w = pow(persist, fi) * fb_mix;
      if (i == 0u) { w = 1.0; }
      if (center_mask > 0.001 && i > 0u) {
        w = w * mix(1.0, smoothstep(0.0, 0.35, length(p - center)), center_mask);
      }
      if (w < 0.01 && i > 0u) { break; }
      var s = sample_rgb(clamp(p, vec2<f32>(0.0), vec2<f32>(1.0)));
      if (hue_cycle > 0.0001) {
        s = hue_rotate(s, fi * hue_cycle);
      }
      acc = acc + s * w;
      wsum = wsum + w;
      p = (p - center) * inv_zoom + center;
      let d = p - center;
      p = center + vec2<f32>(d.x * cr - d.y * sr, d.x * sr + d.y * cr);
    }
    return vec4<f32>(acc / max(wsum, 0.001), src.a);
  }
  if (code == 180u) {
    // motion-trails: directional luma-gated trail accumulation
    let angle_deg = u.params0.x;
    let samples = clamp(round(u.params0.y), 4.0, 32.0);
    let falloff = u.params0.z;
    let chroma_split = u.params0.w;
    let ang = angle_deg * 0.017453292;
    let trail_dir = vec2<f32>(cos(ang), sin(ang));
    let step_size = amount * 0.02;
    var acc = src.rgb;
    var total_weight = 1.0;
    let steps = i32(samples);
    for (var i = 1; i <= 32; i = i + 1) {
      if (i > steps) { break; }
      let fi = f32(i);
      let sample_uv = uv - trail_dir * fi * step_size;
      if (sample_uv.x < 0.0 || sample_uv.x > 1.0 || sample_uv.y < 0.0 || sample_uv.y > 1.0) { break; }
      var s = sample_rgb(sample_uv);
      if (chroma_split > 0.001) {
        let cd = trail_dir * chroma_split * 0.004 * fi;
        s.r = sample_rgb(clamp(sample_uv + cd, vec2<f32>(0.0), vec2<f32>(1.0))).r;
        s.b = sample_rgb(clamp(sample_uv - cd, vec2<f32>(0.0), vec2<f32>(1.0))).b;
      }
      let l = luma(s);
      if (l > 0.25) {
        let weight = mix(1.0 - fi / samples, pow(0.85, fi), falloff);
        acc = acc + s * weight;
        total_weight = total_weight + weight;
      }
    }
    return vec4<f32>(acc / total_weight, src.a);
  }
  if (code == 181u) {
    // echo-repeat: offset/scaled echo copies with hue drift
    let count = clamp(round(u.params0.x), 2.0, 12.0);
    let offset_xy = vec2<f32>(u.params0.y, u.params0.z);
    let hue_shift = u.params0.w;
    let fade_rate = clamp(amount, 0.05, 0.95);
    var acc = src.rgb;
    var total_weight = 1.0;
    let n = i32(count);
    for (var i = 1; i <= 12; i = i + 1) {
      if (i >= n) { break; }
      let fi = f32(i);
      let fade = pow(fade_rate, fi);
      let scl = pow(0.92, fi);
      let echo_uv = (uv - vec2<f32>(0.5) - offset_xy * fi) / scl + vec2<f32>(0.5);
      if (echo_uv.x >= 0.0 && echo_uv.x <= 1.0 && echo_uv.y >= 0.0 && echo_uv.y <= 1.0) {
        var s = sample_rgb(echo_uv);
        if (hue_shift > 0.0001) {
          s = hue_rotate(s, fi * hue_shift);
        }
        acc = acc + s * fade;
        total_weight = total_weight + fade;
      }
    }
    return vec4<f32>(acc / total_weight, src.a);
  }
  if (code == 182u) {
    // light-paint: flow-advected glowing trails from bright pixels
    let time = u.resolution_time.z;
    let threshold = u.params0.x;
    let trail_length = u.params0.y;
    let flow_angle = u.params0.z * 0.017453292;
    let flow_scale = max(0.5, u.params0.w);
    let chroma_shift = u.params1.x;
    let tint = vec3<f32>(u.params1.y, u.params1.z, u.params1.w);
    var p = uv;
    var acc = vec3<f32>(0.0);
    var total_weight = 0.0;
    let steps = 4 + i32(trail_length * 12.0);
    let bias = vec2<f32>(cos(flow_angle), sin(flow_angle)) * 0.3;
    for (var i = 0; i < 16; i = i + 1) {
      if (i >= steps) { break; }
      let fi = f32(i);
      var s = sample_rgb(clamp(p, vec2<f32>(0.0), vec2<f32>(1.0)));
      if (chroma_shift > 0.001) {
        s = hue_rotate(s, fi * chroma_shift * 0.02);
      }
      let l = luma(s);
      if (l > threshold) {
        let weight = 1.0 - fi / f32(steps);
        acc = acc + s * tint * weight;
        total_weight = total_weight + weight;
      }
      let noise_pos = p * flow_scale + vec2<f32>(time * 0.6);
      let n0 = fbm2d(noise_pos);
      let nx = fbm2d(noise_pos + vec2<f32>(0.01, 0.0));
      let ny = fbm2d(noise_pos + vec2<f32>(0.0, 0.01));
      let flow = vec2<f32>(-(ny - n0), nx - n0) / 0.01 + bias;
      p = p + normalize(flow + vec2<f32>(0.001)) * 0.01;
    }
    var result = src.rgb;
    if (total_weight > 0.01) {
      result = max(src.rgb, (acc / total_weight) * 0.8 * amount * 1.4);
    }
    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), src.a);
  }
  if (code == 183u) {
    // recursive-echo: zoom+rotate+translate echo stack
    let depth = clamp(round(u.params0.x), 2.0, 16.0);
    let zoom = clamp(u.params0.y, 0.7, 1.1);
    let rotation_deg = u.params0.z;
    let hue_shift = u.params0.w;
    let offset_xy = vec2<f32>(u.params1.x, u.params1.y);
    let echo_mode = u32(round(u.params1.z));
    let fade_rate = clamp(amount, 0.05, 0.95);
    let rot = rotation_deg * 0.017453292;
    let cr = cos(rot); let sr = sin(rot);
    var p = uv;
    var acc = vec3<f32>(0.0);
    var total_weight = 0.0;
    let n = i32(depth);
    for (var i = 0; i < 16; i = i + 1) {
      if (i >= n) { break; }
      let fi = f32(i);
      let fade = pow(fade_rate, fi);
      var s = sample_rgb(clamp(p, vec2<f32>(0.0), vec2<f32>(1.0)));
      if (hue_shift > 0.0001) {
        s = hue_rotate(s, fi * hue_shift);
      }
      acc = acc + s * fade;
      total_weight = total_weight + fade;
      var d = (p - vec2<f32>(0.5)) * zoom;
      if (echo_mode == 1u && (i % 2) == 0) {
        // mirror echo: alternate iterations reflect through center
        d = -d;
      }
      var rot_i_c = cr;
      var rot_i_s = sr;
      if (echo_mode == 2u) {
        // spiral: rotation accumulates with depth
        let rot_i = rot * (1.0 + fi * 0.35);
        rot_i_c = cos(rot_i);
        rot_i_s = sin(rot_i);
      }
      d = vec2<f32>(d.x * rot_i_c - d.y * rot_i_s, d.x * rot_i_s + d.y * rot_i_c);
      p = vec2<f32>(0.5) + d + offset_xy;
    }
    return vec4<f32>(acc / max(total_weight, 0.001), src.a);
  }
  return src;
}

@vertex
fn vs_full(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let pos = positions[vertex_index];
  var out: VsOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = vec2<f32>(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  return out;
}

@fragment
fn fs_effect(in: VsOut) -> @location(0) vec4<f32> {
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let src = textureSampleLevel(source_tex, source_sampler, uv, 0.0);
  let effected = apply_effect(src, uv);
  let mixed = mix(src, effected, clamp(u.effect.z, 0.0, 1.0));
  return vec4<f32>(saturate3(mixed.rgb), clamp(mixed.a, 0.0, 1.0));
}
`;

export function getNativeEffectPassShaderSource() {
  return {
    shaderId: NATIVE_EFFECT_PASS_SHADER_ID,
    stage: 'render',
    entry: 'fs_effect',
    source: NATIVE_EFFECT_PASS_WGSL,
  };
}

export function buildNativeEffectPassPrecompileCommands(): NativeEffectPassPrecompileCommand[] {
  const source = getNativeEffectPassShaderSource();
  return [{
    type: 'precompile_shader',
    shader_id: source.shaderId,
    stage: source.stage,
    entry: source.entry,
    source: source.source,
  }];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeGraphId(value: string): string {
  return String(value || 'effect').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 180);
}

function blobFlagBits(params: NativeEffectPassOptions['params'], defaults: {
  showCoords: number;
  showBBox: number;
  showCenter: number;
}): number {
  if (!params) return defaults.showCoords + defaults.showBBox * 2 + defaults.showCenter * 4;
  const explicit = Number(params.blobFlags);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(7, Math.round(explicit)));
  const showCoords = clampNumber(params.blobShowCoords, 0, 1, defaults.showCoords) >= 0.5 ? 1 : 0;
  const showBBox = clampNumber(params.blobShowBBox, 0, 1, defaults.showBBox) >= 0.5 ? 1 : 0;
  const showCenter = clampNumber(params.blobShowCenter, 0, 1, defaults.showCenter) >= 0.5 ? 1 : 0;
  return showCoords + showBBox * 2 + showCenter * 4;
}

export function nativeEffectPassManifestEntry(effect: NativeEffectPassId): NativeEffectPassManifestEntry {
  const entry = NATIVE_EFFECT_PASS_BY_ID.get(effect);
  if (!entry) throw new Error(`Unsupported native effect pass: ${effect}`);
  return entry;
}

export function packNativeEffectPassUniforms(options: NativeEffectPassOptions): number[] {
  const manifest = nativeEffectPassManifestEntry(options.effect);
  const width = Math.max(1, Math.round(options.width ?? 1920));
  const height = Math.max(1, Math.round(options.height ?? 1080));
  const time = Number.isFinite(options.time) ? Number(options.time) : 0;
  const frameDelta = Number.isFinite(options.frameDelta) ? Number(options.frameDelta) : 1 / 60;
  let amount = clampNumber(
    options.amount ?? manifest.defaultAmount,
    manifest.amountMin,
    manifest.amountMax,
    manifest.defaultAmount,
  );
  let mix = clampNumber(options.mix ?? 1, 0, 1, 1);
  const frameIndex = Math.max(0, Math.round(options.frameIndex ?? 0));
  const params = options.params ?? {};
  let param0 = clampNumber(params.scale ?? params.param0 ?? params.mode ?? 0.42, 0, 64, 0.42);
  let param1 = clampNumber(params.seed ?? params.param1 ?? params.gridLines ?? 0, -100000, 100000, 0);
  let param2 = clampNumber(params.param2 ?? params.animSpeed ?? 0, -100000, 100000, 0);
  let param3 = clampNumber(params.param3 ?? params.animAmount ?? 0, -100000, 100000, 0);
  let param4 = clampNumber(params.param4 ?? params.centerX ?? 0, -100000, 100000, 0);
  let param5 = clampNumber(params.param5 ?? params.centerY ?? 0, -100000, 100000, 0);
  let param6 = clampNumber(params.param6 ?? params.tintAmount ?? 0, -100000, 100000, 0);
  let param7 = clampNumber(params.param7 ?? params.breathing ?? 0, -100000, 100000, 0);
  let param8 = clampNumber(params.param8 ?? 0, -100000, 100000, 0);
  let param9 = clampNumber(params.param9 ?? 0, -100000, 100000, 0);
  let param10 = clampNumber(params.param10 ?? 0, -100000, 100000, 0);
  let param11 = clampNumber(params.param11 ?? 0, -100000, 100000, 0);
  let param12 = clampNumber(params.param12 ?? 0, -100000, 100000, 0);
  let param13 = clampNumber(params.param13 ?? 0, -100000, 100000, 0);
  let param14 = clampNumber(params.param14 ?? 0, -100000, 100000, 0);
  let param15 = clampNumber(params.param15 ?? 0, -100000, 100000, 0);

  if (options.effect === 'crosshatch') {
    // effectUX vocabulary (hatch*). Params previously died in the generic
    // slot guesses below while the shader ignored slots entirely.
    param0 = clampNumber(params.hatchDensity ?? params.param0, 0.1, 2, 1);
    param1 = clampNumber(params.hatchAngle ?? params.param1, 0, 180, 30);
    param2 = clampNumber(params.hatchLineWidth ?? params.param2, 0.5, 4, 1);
    param3 = clampNumber(params.hatchContrast ?? params.param3, 0, 2, 1);
    param4 = clampNumber(params.hatchPaperR ?? params.param4, 0, 1, 0.95);
    param5 = clampNumber(params.hatchPaperG ?? params.param5, 0, 1, 0.93);
    param6 = clampNumber(params.hatchPaperB ?? params.param6, 0, 1, 0.88);
    param7 = clampNumber(params.hatchInkR ?? params.param7, 0, 1, 0.1);
    param8 = clampNumber(params.hatchInkG ?? params.param8, 0, 1, 0.1);
    param9 = clampNumber(params.hatchInkB ?? params.param9, 0, 1, 0.1);
  } else if (
    options.effect === 'linocut' ||
    options.effect === 'topo-map' ||
    options.effect === 'led-wall' ||
    options.effect === 'hex-grid' ||
    options.effect === 'number-grid' ||
    options.effect === 'spiral-tile' ||
    options.effect === 'voronoi-shatter' ||
    options.effect === 'stained-glass'
  ) {
    // Generic-family stylize effects share one UI vocabulary
    // (amount2/amount3/threshold/angle/center/color — same slots the WebGL
    // uniforms used). One mapping here means each shader upgrade
    // immediately sees its params. The family's main `amount` slider rides
    // the passthru params rather than the descriptor amount, so fold it
    // into the amount slot here.
    amount = clampNumber(
      params.amount ?? amount,
      manifest.amountMin,
      manifest.amountMax,
      manifest.defaultAmount,
    );
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.threshold ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.angle ?? params.param3, -360, 360, 0);
    param4 = clampNumber(params.centerX ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.centerY ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.red ?? params.param6, 0, 1, 0.5);
    param7 = clampNumber(params.green ?? params.param7, 0, 1, 0.5);
    param8 = clampNumber(params.blue ?? params.param8, 0, 1, 0.5);
  } else if (options.effect === 'ascii') {
    // The native pass was written amount-only: cell size came from `amount`
    // and the glyph ramp, tint and contrast were hardcoded, so none of the
    // eight exposed controls did anything. Map them onto the param slots the
    // shader now reads. Ranges mirror effectUX so the UI sliders line up.
    param0 = clampNumber(params.asciiCellSize ?? params.cellSize ?? params.param0, 4, 32, 12);
    param1 = clampNumber(params.asciiContrast ?? params.contrast ?? params.param1, 0, 2, 1.2);
    param2 = clampNumber(params.asciiColorMix ?? params.colorMix ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.asciiInvert ?? params.invert ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.asciiMode ?? params.mode ?? params.param4, 0, 3, 0);
    param5 = clampNumber(params.asciiTintR ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.asciiTintG ?? params.param6, 0, 1, 1);
    param7 = clampNumber(params.asciiTintB ?? params.param7, 0, 1, 0.4);
  } else if (options.effect === 'vignette') {
    param0 = clampNumber(params.softness ?? params.param0, 0, 2, 0.4);
    param1 = clampNumber(params.roundness ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.shape ?? params.param2, 0, 3, 0);
    param3 = clampNumber(params.aspect ?? params.param3, 0.1, 4, 1);
    param4 = clampNumber(params.centerX ?? params.param4, -2, 3, 0.5);
    param5 = clampNumber(params.centerY ?? params.param5, -2, 3, 0.5);
    param6 = clampNumber(params.tintAmount ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.breathing ?? params.param7, 0, 1, 0);
    param8 = clampNumber(params.vignetteColorR ?? params.param8, 0, 1, 0);
    param9 = clampNumber(params.vignetteColorG ?? params.param9, 0, 1, 0);
    param10 = clampNumber(params.vignetteColorB ?? params.param10, 0, 1, 0);
    param11 = clampNumber(params.vignetteBreathSpeed ?? params.param11, 0, 2, 0.5);
  } else if (options.effect === 'rgb-shift') {
    param0 = clampNumber(params.angle ?? params.param0, 0, 360, 0);
    param1 = clampNumber(params.mode ?? params.param1, 0, 4, 0);
    param2 = clampNumber(params.centerX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.centerY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.prismSpread ?? params.param4, 0, 3, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'scanlines') {
    param0 = clampNumber(params.count ?? params.param0, 1, 1200, 200);
    param1 = clampNumber(params.speed ?? params.param1, -4, 4, 0);
    param2 = clampNumber(params.phosphor ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.rollingBar ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.curvature ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.interlace ?? params.param5, 0, 1, 0);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'fm-scanlines') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 2, 0);
    param1 = clampNumber(params.count ?? params.param1, 4, 800, 140);
    param2 = clampNumber(params.width ?? params.param2, 0, 1, 0.32);
    param3 = clampNumber(params.freq ?? params.frequency ?? params.param3, 0, 1, 0.25);
    param4 = clampNumber(params.fmDepth ?? params.param4, 0, 1, 0.55);
    param5 = clampNumber(params.amp ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.speed ?? params.param6, 0, 2, 0.6);
    param7 = clampNumber(params.colorMix ?? params.param7, 0, 1, 0);
    param8 = clampNumber(params.invert ?? params.param8, 0, 1, 0);
  } else if (options.effect === 'vhs') {
    param0 = clampNumber(params.tracking ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.noise ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.distortion ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.colorBleed ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.scanlines ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.headSwitch ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.tapeWobble ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.dropout ?? params.param7, 0, 1, 0);
    param8 = clampNumber(params.chromaDelay ?? params.param8, 0, 1, 0);
    param9 = clampNumber(params.trackingJump ?? params.param9, 0, 1, 0);
    param10 = clampNumber(params.saturation ?? params.param10, 0, 1.5, 1);
    param11 = 0;
  } else if (options.effect === 'plasma') {
    amount = clampNumber(options.amount ?? params.plasmaMix ?? params.outputMix ?? params.amount, 0, 1, 0.85);
    param0 = clampNumber(params.plasmaScale ?? params.scale ?? params.param0, 0.1, 24, 5.5);
    param1 = clampNumber(params.plasmaSpeed ?? params.speed ?? params.param1, 0, 3, 0.7);
    param2 = clampNumber(params.plasmaPalette ?? params.palette ?? params.param2, 0, 11, 0);
    param3 = clampNumber(params.plasmaSourceMix ?? params.sourceMix ?? params.param3, 0, 1, 0.35);
    param4 = clampNumber(params.plasmaComplexity ?? params.param4, 1, 5, 3);
    param5 = clampNumber(params.plasmaMode ?? params.param5, 0, 2, 0);
    param6 = clampNumber(params.plasmaBlendMode ?? params.param6, 0, 4, 0);
    param7 = clampNumber(params.plasmaWarpAmount ?? params.param7, 0, 1, 0.4);
    // Live audio (params.audioLevel is injected by the per-frame rebuild).
    param8 = clampNumber(params.plasmaAudioReact ?? params.param8, 0, 1, 0) *
      clampNumber(params.audioLevel, 0, 1.5, 0);
  } else if (options.effect === 'halftone') {
    amount = clampNumber(options.amount ?? params.halftoneMix ?? params.outputMix ?? params.amount, 0, 1, 0.9);
    param0 = clampNumber(params.halftoneDotSize ?? params.halftoneScale ?? params.scale ?? params.cellSize ?? params.param0, 2, 96, 6);
    param1 = clampNumber(params.halftoneAngle ?? params.angle ?? params.param1, 0, 360, 45);
    param2 = clampNumber(params.halftoneDotGain ?? params.dotGain ?? params.param2, 0.25, 2, 1);
    param3 = clampNumber(params.halftoneColorMode ?? params.colorMode ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.halftoneMode ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.halftoneDotShape ?? params.param5, 0, 3, 0);
    param6 = clampNumber(params.halftoneAngleC ?? params.param6, 0, 180, 15);
    param7 = clampNumber(params.halftoneAngleM ?? params.param7, 0, 180, 75);
    param8 = clampNumber(params.halftoneAngleY ?? params.param8, 0, 180, 0);
    param9 = clampNumber(params.halftoneAngleK ?? params.param9, 0, 180, 45);
    param10 = clampNumber(params.halftoneDrift ?? params.param10, 0, 2, 0);
  } else if (options.effect === 'toon') {
    amount = clampNumber(options.amount ?? params.toonMix ?? params.outputMix ?? params.amount, 0, 1, 0.85);
    param0 = clampNumber(params.toonSteps ?? params.toonLevels ?? params.levels ?? params.param0, 2, 12, 4);
    param1 = clampNumber(params.toonOutline ?? params.toonEdgeStrength ?? params.edgeStrength ?? params.param1, 0, 2, 0.8);
    param2 = clampNumber(params.toonColorPop ?? params.toonSaturation ?? params.saturation ?? params.param2, 0, 2, 1.15);
    param3 = clampNumber(params.toonEdgeThreshold ?? params.threshold ?? params.param3, 0, 1, 0.05);
    param4 = clampNumber(params.toonRampSoftness ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.toonShadowBand ?? params.param5, 0, 1, 0);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'kuwahara') {
    amount = clampNumber(options.amount ?? params.kuwaharaMix ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.kuwaharaRadius ?? params.radius ?? params.param0, 1, 8, 3);
    param1 = clampNumber(params.kuwaharaEdgeSharpness ?? params.edgeStrength ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.kuwaharaColorPunch ?? params.colorMix ?? params.param2, 0, 1, 0.2);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'defocus-bokeh') {
    amount = clampNumber(options.amount ?? params.bokehRadius ?? params.radius ?? params.param0, 0, 30, 12);
    param0 = clampNumber(params.bokehSamples ?? params.samples ?? params.param1, 8, 48, 24);
    param1 = clampNumber(params.bokehBrightWeight ?? params.brightWeight ?? params.param2, 0, 2, 0.8);
    param2 = clampNumber(params.bokehThreshold ?? params.threshold ?? params.param3, 0, 1, 0.7);
    param3 = clampNumber(params.bokehChromaFringe ?? params.chromaFringe ?? params.param4, 0, 1, 0);
    param4 = clampNumber(params.bokehShape ?? params.shape ?? params.param5, 0, 2, 0);
    param5 = clampNumber(params.bokehRotation ?? params.rotation ?? params.param6, 0, 360, 0);
    param6 = clampNumber(params.bokehMix ?? params.outputMix ?? params.mix ?? params.param7, 0, 1, 1);
    param7 = 0;
  } else if (options.effect === 'god-rays') {
    amount = clampNumber(options.amount ?? params.godRaysIntensity ?? params.amount, 0, 2, 0.7);
    param0 = clampNumber(params.godRaysDecay ?? params.param0, 0.85, 1, 0.95);
    param1 = clampNumber(params.godRaysExposure ?? params.param1, 0.1, 1, 0.4);
    param2 = clampNumber(params.godRaysDensity ?? params.param2, 0, 1, 0.95);
    param3 = clampNumber(params.godRaysThreshold ?? params.threshold ?? params.param3, 0, 1, 0.7);
    param4 = clampNumber(params.godRaysCenterX ?? params.centerX ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.godRaysCenterY ?? params.centerY ?? params.param5, 0, 1, 0.2);
    param6 = clampNumber(params.godRaysSamples ?? params.samples ?? params.param6, 8, 128, 64);
    param7 = clampNumber(params.godRaysTintR ?? params.tintR ?? params.param7, 0, 1.5, 1);
    param8 = clampNumber(params.godRaysTintG ?? params.tintG ?? params.param8, 0, 1.5, 0.95);
    param9 = clampNumber(params.godRaysTintB ?? params.tintB ?? params.param9, 0, 1.5, 0.85);
    param10 = clampNumber(params.godRaysMix ?? params.outputMix ?? params.mix ?? params.param10, 0, 1, 1);
    param11 = 0;
  } else if (options.effect === 'displacement') {
    amount = clampNumber(options.amount ?? params.dispAmount ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.dispScale ?? params.scale ?? params.param0, 1, 32, 6);
    param1 = clampNumber(params.dispSpeed ?? params.speed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.dispMode ?? params.mode ?? params.param2, 0, 3, 0);
    param3 = clampNumber(params.dispTurbulence ?? params.turbulence ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.dispChromatic ?? params.chromatic ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'polar-transform') {
    amount = clampNumber(options.amount ?? params.polarMix ?? params.outputMix ?? params.mix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.polarMode ?? params.mode ?? params.param0, 0, 2, 0);
    param1 = clampNumber(params.polarRotation ?? params.rotation ?? params.param1, 0, 360, 0);
    param2 = clampNumber(params.polarZoom ?? params.zoom ?? params.param2, 0.25, 4, 1);
    param3 = clampNumber(params.polarCenterX ?? params.centerX ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.polarCenterY ?? params.centerY ?? params.param4, 0, 1, 0.5);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'blur') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 1);
    param1 = clampNumber(params.angle ?? params.param1, 0, 360, 0);
    param2 = clampNumber(params.param2, 0, 2, 1);
    param3 = clampNumber(params.edgeProtect ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.outputMix ?? params.param4, 0, 1, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'chromatic-aberration') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 1);
    param1 = clampNumber(params.angle ?? params.param1, 0, 360, 0);
    param2 = clampNumber(params.centerX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.centerY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.edgeFalloff ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'glitch') {
    param0 = clampNumber(params.speed ?? params.param0, 0, 4, 1);
    param1 = clampNumber(params.blockSize ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.rgbSplit ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.jitter ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.verticalSlice ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.blockHold ?? params.param5, 0, 1, 0.3);
    param6 = clampNumber(params.tearChance ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.triggerMode ?? params.param7, 0, 3, 0);
    param8 = clampNumber(params.freezeBurst ?? params.glitchFreezeBurst ?? params.param8, 0, 1, 0);
  } else if (options.effect === 'exposure') {
    param0 = clampNumber(params.rollOff ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.highlightProtect ?? params.param1, 0, 1, 0);
    param2 = 0;
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'vibrance') {
    param0 = clampNumber(params.skinProtect ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.highlightProtect ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.ceiling ?? params.param2, 0.1, 2, 1);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'temperature-tint') {
    param0 = clampNumber(params.tint ?? params.param0, -1, 1, 0);
    param1 = clampNumber(params.shadowTemp ?? params.param1, -1, 1, 0);
    param2 = clampNumber(params.highlightTemp ?? params.param2, -1, 1, 0);
    param3 = clampNumber(params.splitTone ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.autoCycle ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'sharpen') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.radius ?? params.param1, 1, 8, 2);
    param2 = clampNumber(params.edgeProtect ?? params.param2, 0, 1, 0.2);
    param3 = clampNumber(params.param3 ?? params.intensity ?? 0, 0, 1, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'directional-blur') {
    param0 = clampNumber(params.angle ?? params.param0, 0, 360, 0);
    param1 = clampNumber(params.samples ?? params.count ?? params.param1, 4, 32, 16);
    param2 = clampNumber(params.falloff ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.centerBias ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.outputMix ?? params.param4, 0, 1, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'zoom-blur') {
    param0 = clampNumber(params.centerX ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.centerY ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.samples ?? params.count ?? params.param2, 4, 32, 16);
    param3 = clampNumber(params.falloff ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.chromatic ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'radial-blur') {
    param0 = clampNumber(params.centerX ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.centerY ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.samples ?? params.count ?? params.param2, 4, 32, 16);
    param3 = clampNumber(params.falloff ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.radiusInner ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.radiusOuter ?? params.param5, 0, 1.5, 0.7);
    param6 = clampNumber(params.outputMix ?? params.param6, 0, 1, 1);
    param7 = 0;
  } else if (options.effect === 'kaleidoscope') {
    param0 = clampNumber(params.segments ?? params.count ?? params.param0, 2, 32, 6);
    param1 = clampNumber(params.angle ?? params.param1, 0, 360, 0);
    param2 = clampNumber(params.centerX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.centerY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.zoom ?? params.param4, 0.25, 4, 1);
    param5 = clampNumber(params.mode ?? params.param5, 0, 2, 0);
    param6 = clampNumber(params.spiral ?? params.param6, 0, 2, 0);
    param7 = clampNumber(params.animSpeed ?? params.speed ?? params.param7, 0, 2, 0);
  } else if (options.effect === 'mirror') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.position ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.offset ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.flipSide ?? params.param3, 0, 1, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'chroma-key') {
    param0 = clampNumber(params.keyR ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.keyG ?? params.param1, 0, 1, 1);
    param2 = clampNumber(params.keyB ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.softness ?? params.param3, 0, 1, 0.15);
    param4 = clampNumber(params.spill ?? params.param4, 0, 1, 0.6);
    param5 = clampNumber(params.matte ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.mode ?? params.param6, 0, 2, 1);
    param7 = 0;
  } else if (options.effect === 'luma-key') {
    param0 = clampNumber(params.highCut ?? params.param0, 0, 1, 0.6);
    param1 = clampNumber(params.invert ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.param2 ?? params.gamma ?? 1, 0.2, 3, 1);
    param3 = clampNumber(params.matte ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.premultiply ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'difference-key') {
    param0 = clampNumber(params.refR ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.refG ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.refB ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.softness ?? params.param3, 0, 1, 0.15);
    param4 = clampNumber(params.invert ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.matte ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.mode ?? params.param6, 0, 2, 0);
    param7 = 0;
  } else if (options.effect === 'erode' || options.effect === 'dilate') {
    param0 = clampNumber(params.shape ?? params.param0, 0, 2, 1);
    param1 = clampNumber(params.channel ?? params.param1, 0, 4, 0);
    param2 = clampNumber(params.outputMix ?? params.param2, 0, 1, 1);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'wave') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.waveform ?? params.param1, 0, 3, 0);
    param2 = clampNumber(params.frequency ?? params.param2, 0.5, 30, 5);
    param3 = clampNumber(params.speed ?? params.param3, 0, 3, 1);
    param4 = clampNumber(params.phase ?? params.param4, 0, 360, 0);
    param5 = clampNumber(params.secondary ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.chromaSplit ?? params.param6, 0, 1, 0);
    param7 = 0;
  } else if (options.effect === 'fisheye') {
    param0 = clampNumber(params.radius ?? params.param0, 0.1, 1, 1);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.zoom ?? params.param3, 0.5, 2, 1);
    param4 = clampNumber(params.mode ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.edgeFalloff ?? params.chromatic ?? params.chromaSplit ?? params.param5, 0, 1, 0);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'lens-distortion') {
    param0 = clampNumber(params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.cubic ?? params.param3, -0.5, 0.5, 0);
    param4 = clampNumber(params.anamorphicX ?? params.param4, 0.5, 2, 1.3);
    param5 = clampNumber(params.edgeFade ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.chromatic ?? params.chromaSplit ?? params.param6, 0, 1, 0);
    param7 = 0;
  } else if (options.effect === 'twirl') {
    param0 = clampNumber(params.radius ?? params.param0, 0.05, 1, 0.5);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.falloff ?? params.param3, 0.5, 4, 1.5);
    param4 = clampNumber(params.animSpeed ?? params.speed ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'pinch-bulge') {
    param0 = clampNumber(params.radius ?? params.param0, 0.1, 1, 0.5);
    param1 = clampNumber(params.centerX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.centerY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.falloff ?? params.param3, 0.5, 4, 1.5);
    param4 = clampNumber(params.chromatic ?? params.chromaSplit ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.outputMix ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'edge-detect') {
    const invert = clampNumber(params.invert ?? params.param2, 0, 1, 0) >= 0.5 ? 1 : 0;
    const edgeOnly = clampNumber(params.edgeOnlyAlpha ?? params.param7, 0, 1, 0) >= 0.5 ? 2 : 0;
    param0 = clampNumber(params.thickness ?? params.param0, 0.25, 12, 1);
    param1 = clampNumber(params.mode ?? params.param1, 0, 3, 0);
    param2 = invert + edgeOnly;
    param3 = clampNumber(params.edgeTintR ?? params.param3, 0, 1.5, 1);
    param4 = clampNumber(params.edgeTintG ?? params.param4, 0, 1.5, 1);
    param5 = clampNumber(params.edgeTintB ?? params.param5, 0, 1.5, 1);
    param6 = clampNumber(params.tintEdges ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.edgeGlow ?? params.param7, 0, 2, 0);
  } else if (options.effect === 'film-grain') {
    param0 = clampNumber(params.grainSize ?? params.param0, 0.25, 8, 1);
    param1 = clampNumber(params.grainShadow ?? params.param1, 0, 2, 0.7);
    param2 = clampNumber(params.grainMid ?? params.param2, 0, 2, 1);
    param3 = clampNumber(params.grainHigh ?? params.param3, 0, 2, 0.5);
    param4 = clampNumber(params.grainMono ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.grainStock ?? params.param5, 0, 3, 1);
    param6 = clampNumber(params.grainColorJitter ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.grainAnimSpeed ?? params.param7, 0, 4, 1);
  } else if (options.effect === 'filmic-tonemap') {
    amount = clampNumber(options.amount ?? params.tonemapMix ?? params.outputMix ?? params.param3, 0, 1, 1);
    param0 = clampNumber(params.tonemapCurve ?? params.param0, 0, 5, 0);
    param1 = clampNumber(params.tonemapExposure ?? params.exposure ?? params.param1, 0.25, 4, 1);
    param2 = clampNumber(params.tonemapContrast ?? params.contrast ?? params.param2, 0, 1, 0);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'bloom') {
    amount = clampNumber(options.amount ?? params.amount ?? params.outputMix ?? params.param7, 0, 1, 0.6);
    param0 = clampNumber(params.bloomIntensity ?? params.intensity ?? params.param0, 0, 2, 1);
    param1 = clampNumber(params.threshold ?? params.param1, 0, 1, 0.6);
    param2 = clampNumber(params.bloomKnee ?? params.softness ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.bloomRadius ?? params.radius ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.bloomAnamorphic ?? params.anamorphicX ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.red ?? params.param5, 0, 1.5, 1);
    param6 = clampNumber(params.green ?? params.param6, 0, 1.5, 1);
    param7 = clampNumber(params.blue ?? params.param7, 0, 1.5, 1);
  } else if (options.effect === 'colorama') {
    amount = clampNumber(options.amount ?? params.coloramaMix ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.coloramaPalette ?? params.param0, 0, 11, 0);
    param1 = clampNumber(params.coloramaOffset ?? params.offset ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.coloramaSpeed ?? params.speed ?? params.param2, 0, 2, 0.2);
    param3 = clampNumber(params.coloramaContrast ?? params.contrast ?? params.param3, 0.5, 2, 1);
    param4 = clampNumber(params.coloramaBands ?? params.param4, 0, 32, 0);
    param5 = clampNumber(params.coloramaAudioReact ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.coloramaHueShift ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.audio ?? params.param7, 0, 1.5, 0);
  } else if (options.effect === 'edge-feather') {
    amount = clampNumber(options.amount ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.featherTop ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.featherBottom ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.featherLeft ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.featherRight ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.featherSoftness ?? params.softness ?? params.param4, 0, 2, 0.5);
    param5 = clampNumber(params.featherGamma ?? params.gamma ?? params.param5, 0.1, 4, 1);
    param6 = clampNumber(params.featherMattePreview ?? params.matte ?? params.param6, 0, 1, 0);
    param7 = 0;
  } else if (options.effect === 'dither') {
    amount = clampNumber(options.amount ?? params.ditherIntensity ?? params.intensity ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.ditherType ?? params.mode ?? params.param0, 0, 4, 0);
    param1 = clampNumber(params.ditherScale ?? params.scale ?? params.param1, 0.5, 64, 1);
    param2 = clampNumber(params.ditherColorDepth ?? params.param2, 1, 8, 2);
    param3 = clampNumber(params.ditherPalette ?? params.palette ?? params.param3, 0, 5, 0);
    param4 = clampNumber(params.ditherPixelLock ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'outline') {
    amount = clampNumber(options.amount ?? params.outlineThickness ?? params.thickness ?? params.amount, 0, 12, 2);
    param0 = clampNumber(params.outlineR ?? params.red ?? params.param0, 0, 1.5, 1);
    param1 = clampNumber(params.outlineG ?? params.green ?? params.param1, 0, 1.5, 1);
    param2 = clampNumber(params.outlineB ?? params.blue ?? params.param2, 0, 1.5, 1);
    param3 = clampNumber(params.outlineOnly ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.outlineGlow ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.outlinePosition ?? params.position ?? params.param5, 0, 2, 1);
    param6 = clampNumber(params.outlineCrawl ?? params.speed ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.outlineAlphaAware ?? params.param7, 0, 1, 0);
    param8 = clampNumber(params.outlineGlowFalloff ?? params.param8, 0.1, 4, 1);
  } else if (options.effect === 'emboss') {
    amount = clampNumber(options.amount ?? params.embossStrength ?? params.strength ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.embossAngle ?? params.angle ?? params.param0, 0, 360, 135);
    param1 = clampNumber(params.embossHeight ?? params.height ?? params.param1, 0, 4, 1);
    param2 = clampNumber(params.embossHighlightR ?? params.red ?? params.param2, 0, 1.5, 1);
    param3 = clampNumber(params.embossHighlightG ?? params.green ?? params.param3, 0, 1.5, 1);
    param4 = clampNumber(params.embossHighlightB ?? params.blue ?? params.param4, 0, 1.5, 1);
    param5 = clampNumber(params.embossShadowR ?? params.param5, 0, 1.5, 0);
    param6 = clampNumber(params.embossShadowG ?? params.param6, 0, 1.5, 0);
    param7 = clampNumber(params.embossShadowB ?? params.param7, 0, 1.5, 0);
    param8 = clampNumber(params.embossNormalMode ?? params.param8, 0, 1, 0);
    param9 = clampNumber(params.embossMetallicness ?? params.param9, 0, 1, 0);
  } else if (options.effect === 'crt') {
    amount = clampNumber(options.amount ?? params.crtScanlines ?? params.intensity ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.crtScanCount ?? params.count ?? params.param0, 32, 1200, 480);
    param1 = clampNumber(params.crtMask ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.crtMaskType ?? params.mode ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.crtCurvature ?? params.curvature ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.crtVignette ?? params.param4, 0, 1, 0.4);
    param5 = clampNumber(params.crtGlow ?? params.glow ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.crtRollingBar ?? params.rollingBar ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.crtChromatic ?? params.chromatic ?? params.param7, 0, 1, 0.3);
  } else if (options.effect === 'thermal') {
    amount = clampNumber(options.amount ?? params.thermalIntensity ?? params.intensity ?? params.amount, 0.05, 2, 1);
    param0 = clampNumber(params.thermalPalette ?? params.palette ?? params.param0, 0, 4, 0);
    param1 = clampNumber(params.thermalShimmer ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.thermalSensorNoise ?? params.noise ?? params.param2, 0, 1, 0);
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'night-vision') {
    amount = clampNumber(options.amount ?? params.nightVisionIntensity ?? params.intensity ?? params.amount, 0, 2, 1.5);
    param0 = clampNumber(params.nightVisionNoise ?? params.noise ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.nightVisionVignette ?? params.vignette ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.nightVisionPhosphor ?? params.phosphor ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.nightVisionBloom ?? params.bloom ?? params.param3, 0, 2, 0.6);
    param4 = clampNumber(params.nightVisionScopeMask ?? params.scopeMask ?? params.param4, 0, 2, 1);
    param5 = clampNumber(params.nightVisionRollingNoise ?? params.rollingBar ?? params.param5, 0, 1, 0);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'blob-track') {
    amount = clampNumber(options.amount ?? params.blobMix ?? params.outputMix ?? params.amount, 0, 1, 0.8);
    param0 = clampNumber(params.blobThreshold ?? params.threshold ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.blobShape ?? params.shape ?? params.param1, 0, 4, 0);
    param2 = clampNumber(params.blobColor ?? params.palette ?? params.param2, 0, 7, 0);
    param3 = clampNumber(params.blobThickness ?? params.thickness ?? params.param3, 0.25, 8, 2);
    param4 = clampNumber(params.blobGridSize ?? params.gridLines ?? params.param4, 4, 128, 16);
    param5 = blobFlagBits(params, { showCoords: 1, showBBox: 1, showCenter: 1 });
    param6 = clampNumber(params.blobTrailLength ?? params.trailLength ?? params.param6, 0, 1, 0.3);
    param7 = clampNumber(params.blobMinSize ?? params.param7, 0, 1, 0.02);
    param8 = clampNumber(params.blobColorMode ?? params.param8, 0, 2, 0);
    param9 = clampNumber(params.blobFixedColorR ?? params.param9, 0, 1, 0);
    param10 = clampNumber(params.blobFixedColorG ?? params.param10, 0, 1, 1);
    param11 = clampNumber(params.blobFixedColorB ?? params.param11, 0, 1, 0.5);
    param12 = clampNumber(params.blobMarkerSize ?? params.param12, 0.2, 3, 1);
    param13 = clampNumber(params.blobBlendMode ?? params.param13, 0, 4, 0);
  } else if (options.effect === 'blob-contour') {
    amount = clampNumber(options.amount ?? params.blobMix ?? params.outputMix ?? params.amount, 0, 1, 0.7);
    param0 = clampNumber(params.blobThreshold ?? params.threshold ?? params.param0, 0, 1, 0.4);
    param1 = clampNumber(params.blobShape ?? params.shape ?? params.param1, 0, 2, 0);
    param2 = clampNumber(params.blobColor ?? params.palette ?? params.param2, 0, 7, 1);
    param3 = clampNumber(params.blobThickness ?? params.thickness ?? params.param3, 0.25, 8, 1.5);
    param4 = clampNumber(params.blobGridSize ?? params.gridLines ?? params.param4, 4, 128, 16);
    param5 = blobFlagBits(params, { showCoords: 0, showBBox: 0, showCenter: 0 });
    param6 = clampNumber(params.blobTrailLength ?? params.trailLength ?? params.param6, 0, 1, 0.4);
    param7 = clampNumber(params.blobMinSize ?? params.param7, 0, 1, 0.5);
  } else if (options.effect === 'blob-heatmap') {
    amount = clampNumber(options.amount ?? params.blobMix ?? params.outputMix ?? params.amount, 0, 1, 0.85);
    param0 = clampNumber(params.blobThreshold ?? params.threshold ?? params.param0, 0, 1, 0.2);
    param1 = clampNumber(params.blobShape ?? params.shape ?? params.param1, 0, 2, 0);
    param2 = clampNumber(params.blobColor ?? params.palette ?? params.param2, 0, 3, 0);
    param3 = clampNumber(params.blobThickness ?? params.thickness ?? params.param3, 0.25, 8, 1);
    param4 = clampNumber(params.blobGridSize ?? params.gridLines ?? params.param4, 4, 128, 16);
    param5 = blobFlagBits(params, { showCoords: 1, showBBox: 1, showCenter: 1 });
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'tilt-shift') {
    amount = clampNumber(options.amount ?? params.outputMix ?? params.mix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.tiltShiftMode ?? params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.tiltShiftFocusY ?? params.focusY ?? params.centerY ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.tiltShiftFocusX ?? params.focusX ?? params.centerX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.tiltShiftFocusBand ?? params.focusBand ?? params.param3, 0.001, 1, 0.2);
    param4 = clampNumber(params.tiltShiftFalloff ?? params.falloff ?? params.param4, 0.001, 1, 0.3);
    param5 = clampNumber(params.tiltShiftMaxBlur ?? params.maxBlur ?? params.amount2 ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.tiltShiftAngle ?? params.angle ?? params.param6, 0, 360, 0);
    param7 = clampNumber(params.tiltShiftSaturation ?? params.saturation ?? params.param7, 0, 2, 1.2);
  } else if (options.effect === 'halation') {
    amount = clampNumber(options.amount ?? params.halationAmount ?? params.amount, 0, 2, 0.6);
    param0 = clampNumber(params.halationRadius ?? params.radius ?? params.amount2 ?? params.param0, 0, 48, 12);
    param1 = clampNumber(params.halationThreshold ?? params.threshold ?? params.param1, 0, 1, 0.65);
    param2 = clampNumber(params.halationTintR ?? params.red ?? params.param2, 0, 1.5, 0.9);
    param3 = clampNumber(params.halationTintG ?? params.green ?? params.param3, 0, 1.5, 0.45);
    param4 = clampNumber(params.halationTintB ?? params.blue ?? params.param4, 0, 1.5, 0.2);
    param5 = clampNumber(params.halationMode ?? params.mode ?? params.param5, 0, 2, 0);
    param6 = clampNumber(params.halationMix ?? params.outputMix ?? params.mix ?? params.param6, 0, 1, 1);
    param7 = 0;
  } else if (options.effect === 'anamorphic-streak') {
    amount = clampNumber(options.amount ?? params.anaIntensity ?? params.intensity ?? params.amount, 0, 2, 0.6);
    param0 = clampNumber(params.anaLength ?? params.length ?? params.amount2 ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.anaThreshold ?? params.threshold ?? params.param1, 0, 1, 0.7);
    param2 = clampNumber(params.anaTintR ?? params.red ?? params.param2, 0, 1.5, 0.6);
    param3 = clampNumber(params.anaTintG ?? params.green ?? params.param3, 0, 1.5, 0.75);
    param4 = clampNumber(params.anaTintB ?? params.blue ?? params.param4, 0, 1.5, 1);
    param5 = clampNumber(params.anaAngle ?? params.angle ?? params.param5, 0, 180, 0);
    param6 = clampNumber(params.anaSamples ?? params.samples ?? params.param6, 8, 64, 32);
    param7 = clampNumber(params.anaMix ?? params.outputMix ?? params.mix ?? params.param7, 0, 1, 1);
  } else if (options.effect === 'heat-haze') {
    amount = clampNumber(options.amount ?? params.hazeAmount ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.hazeScale ?? params.scale ?? params.amount2 ?? params.param0, 1, 32, 8);
    param1 = clampNumber(params.hazeSpeed ?? params.speed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.hazeDirectionY ?? params.directionY ?? params.param2, -1, 1, 0.5);
    param3 = clampNumber(params.hazeTurbulence ?? params.turbulence ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.hazeMode ?? params.mode ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.hazeFocusY ?? params.focusY ?? params.centerY ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.hazeFocusBand ?? params.focusBand ?? params.param6, 0.05, 1, 0.4);
    param7 = 0;
  } else if (options.effect === 'curves') {
    amount = clampNumber(options.amount ?? params.curvesMix ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.curvesContrast ?? params.contrast ?? params.param0, 0, 1, 0.4);
    param1 = clampNumber(params.curvesToe ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.curvesShoulder ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.curvesBlackCrush ?? params.param3, 0, 1, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'selective-color') {
    amount = clampNumber(options.amount ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.selColorTargetHue ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.selColorRange ?? params.param1, 0, 1, 0.12);
    param2 = clampNumber(params.selColorFeather ?? params.param2, 0, 1, 0.08);
    param3 = clampNumber(params.selColorMode ?? params.mode ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.selColorReplaceHue ?? params.param4, 0, 1, 0.55);
    param5 = clampNumber(params.selColorSatBoost ?? params.saturation ?? params.param5, 0, 1, 0.35);
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'false-color') {
    amount = clampNumber(options.amount ?? params.falseColorMix ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.falseColorMode ?? params.mode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.falseColorShowOriginal ?? params.param1, 0, 1, 1);
    param2 = clampNumber(params.falseColorMidpoint ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.falseColorRange ?? params.param3, 0, 0.5, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'shadow-recovery') {
    amount = clampNumber(options.amount ?? params.shadowAmount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.shadowThreshold ?? params.threshold ?? params.param0, 0, 1, 0.4);
    param1 = clampNumber(params.shadowSoftness ?? params.softness ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.shadowColorRecovery ?? params.param2, 0, 1, 0.2);
    param3 = clampNumber(params.shadowHighlightProtect ?? params.highlightProtect ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.shadowMix ?? params.outputMix ?? params.mix ?? params.param4, 0, 1, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'highlight-rolloff') {
    amount = clampNumber(options.amount ?? params.highRolloffAmount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.highRolloffThreshold ?? params.threshold ?? params.param0, 0, 1, 0.7);
    param1 = clampNumber(params.highRolloffSoftness ?? params.softness ?? params.param1, 0, 1, 0.2);
    param2 = clampNumber(params.highRolloffPreserveHue ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.highRolloffMaxValue ?? params.param3, 0.7, 1.5, 1);
    param4 = clampNumber(params.highRolloffMix ?? params.outputMix ?? params.mix ?? params.param4, 0, 1, 1);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'color-balance') {
    amount = clampNumber(options.amount ?? params.cbMix ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.cbShadowR ?? params.param0, -1, 1, 0);
    param1 = clampNumber(params.cbShadowG ?? params.param1, -1, 1, 0);
    param2 = clampNumber(params.cbShadowB ?? params.param2, -1, 1, 0);
    param3 = clampNumber(params.cbPreserveLuma ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.cbMidR ?? params.param4, -1, 1, 0);
    param5 = clampNumber(params.cbMidG ?? params.param5, -1, 1, 0);
    param6 = clampNumber(params.cbMidB ?? params.param6, -1, 1, 0);
    param7 = 0;
    param8 = clampNumber(params.cbHighR ?? params.param8, -1, 1, 0);
    param9 = clampNumber(params.cbHighG ?? params.param9, -1, 1, 0);
    param10 = clampNumber(params.cbHighB ?? params.param10, -1, 1, 0);
    param11 = 0;
  } else if (options.effect === 'lift-gamma-gain') {
    amount = clampNumber(options.amount ?? params.lggMix ?? params.outputMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.lggLiftR ?? params.param0, -0.5, 0.5, 0);
    param1 = clampNumber(params.lggLiftG ?? params.param1, -0.5, 0.5, 0);
    param2 = clampNumber(params.lggLiftB ?? params.param2, -0.5, 0.5, 0);
    param3 = clampNumber(params.lggLumaOnly ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.lggGammaR ?? params.param4, 0.05, 4, 1);
    param5 = clampNumber(params.lggGammaG ?? params.param5, 0.05, 4, 1);
    param6 = clampNumber(params.lggGammaB ?? params.param6, 0.05, 4, 1);
    param7 = 0;
    param8 = clampNumber(params.lggGainR ?? params.param8, 0.05, 4, 1);
    param9 = clampNumber(params.lggGainG ?? params.param9, 0.05, 4, 1);
    param10 = clampNumber(params.lggGainB ?? params.param10, 0.05, 4, 1);
    param11 = 0;
  } else if (options.effect === 'strobe-flash') {
    amount = clampNumber(options.amount ?? params.strobeIntensity ?? params.intensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.strobeRate ?? params.speed ?? params.param0, 0.5, 30, 4);
    param1 = clampNumber(params.strobeDuty ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.strobeMode ?? params.mode ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.strobeTintR ?? params.red ?? params.param3, 0, 1, 1);
    param4 = clampNumber(params.strobeTintG ?? params.green ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.strobeTintB ?? params.blue ?? params.param5, 0, 1, 1);
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'phase-lab') {
    amount = clampNumber(options.amount ?? params.phaseLabIntensity ?? params.amount, 0, 4, 1.35);
    mix = clampNumber(params.phaseLabMix ?? options.mix, 0, 1, 0.92);
    param0 = clampNumber(params.phaseLabMode ?? params.mode ?? params.param0, 0, 7, 0);
    param1 = clampNumber(params.phaseLabScale ?? params.scale ?? params.param1, 0.1, 32, 6);
    param2 = clampNumber(params.phaseLabSpeed ?? params.speed ?? params.param2, 0, 4, 0.35);
    param3 = clampNumber(params.phaseLabPhase ?? params.param3, -100, 100, 0);
    param4 = clampNumber(params.phaseLabColorGain ?? params.param4, 0, 4, 1.25);
    param5 = clampNumber(params.phaseLabSourceBleed ?? params.param5, 0, 1, 0.22);
    param6 = clampNumber(params.phaseLabEdgeBoost ?? params.param6, 0, 8, 2.4);
    param7 = clampNumber(params.phaseLabDistortion ?? params.param7, 0, 1, 0.04);
    param8 = clampNumber(params.phaseLabLineDensity ?? params.param8, 0.1, 64, 18);
    param9 = clampNumber(params.phaseLabPolarizerAngle ?? params.param9, -360, 360, 35);
    param10 = clampNumber(params.phaseLabSpectralShift ?? params.param10, -4, 4, 0.35);
    param11 = clampNumber(params.phaseLabFocus ?? params.param11, 0.08, 4, 1.45);
    param12 = clampNumber(params.phaseLabMirrorRadius ?? params.param12, 0.03, 0.45, 0.16);
    param13 = clampNumber(params.phaseLabConeLift ?? params.param13, 0.2, 3, 1.2);
    // Audio fold: the per-frame graph rebuild injects the live audio level as
    // params.audioLevel; reactive off (or silence) packs 0.
    param14 = clampNumber(params.phaseLabAudioReactive ?? 1, 0, 1, 1) >= 0.5
      ? clampNumber(params.phaseLabAudioDrive ?? params.param14, 0, 3, 0.65) *
        clampNumber(params.audioLevel, 0, 1.5, 0)
      : 0;
  } else if (options.effect === 'lens-dirt') {
    amount = clampNumber(options.amount ?? params.dirtAmount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.dirtScale ?? params.scale ?? params.param0, 0.5, 32, 8);
    param1 = clampNumber(params.dirtThreshold ?? params.param1, 0, 1, 0.6);
    param2 = clampNumber(params.dirtTintWarmth ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.dirtScratches ?? params.param3, 0, 1, 0.2);
    param4 = clampNumber(params.dirtSpots ?? params.param4, 0, 1, 0.6);
    param5 = clampNumber(params.dirtMode ?? params.param5, 0, 2, 0);
    param6 = clampNumber(params.dirtAnimSpeed ?? params.param6, 0, 1, 0);
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'diffusion-promist') {
    amount = clampNumber(options.amount ?? params.diffAmount ?? params.amount, 0, 1, 0.5);
    mix = clampNumber(params.diffMix ?? options.mix, 0, 1, 1);
    param0 = clampNumber(params.diffRadius ?? params.param0, 1, 30, 12);
    param1 = clampNumber(params.diffThreshold ?? params.param1, 0, 1, 0.6);
    param2 = clampNumber(params.diffShadowLift ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.diffHighlightBloom ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.diffHaze ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.diffHazeWarmth ?? params.param5, 0, 1, 0.5);
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'compression-artifacts') {
    amount = clampNumber(options.amount ?? params.compArtMix ?? params.amount, 0, 1, 1);
    param0 = clampNumber(params.compArtBlockSize ?? params.param0, 2, 64, 8);
    param1 = clampNumber(params.compArtQuality ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.compArtChromaSubsample ?? params.param2, 0, 1, 0.6);
    param3 = clampNumber(params.compArtBlockNoise ?? params.param3, 0, 1, 0.2);
    param4 = clampNumber(params.compArtMode ?? params.param4, 0, 2, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'datamosh-lite') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.4);
    param2 = 0;
    param3 = 0;
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'scanline-drift') {
    amount = clampNumber(options.amount ?? params.scanDriftIntensity ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.scanDriftFrequency ?? params.param0, 1, 200, 80);
    param1 = clampNumber(params.scanDriftSpeed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.scanDriftWaveform ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.scanDriftChromaSplit ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.scanDriftChunkiness ?? params.param4, 0, 1, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'tape-dropout') {
    amount = clampNumber(options.amount ?? params.tapeDropoutDensity ?? params.amount, 0, 1, 0.4);
    mix = clampNumber(params.tapeDropoutMix ?? options.mix, 0, 1, 1);
    param0 = clampNumber(params.tapeDropoutLength ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.tapeDropoutColor ?? params.param1, 0, 2, 0);
    param2 = clampNumber(params.tapeDropoutSpeed ?? params.param2, 0, 3, 1);
    param3 = clampNumber(params.tapeDropoutNoise ?? params.param3, 0, 1, 0.7);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'ripple-caustics') {
    amount = clampNumber(options.amount ?? params.causticsIntensity ?? params.amount, 0, 2, 0.6);
    param0 = clampNumber(params.causticsScale ?? params.param0, 0.5, 32, 8);
    param1 = clampNumber(params.causticsSpeed ?? params.param1, 0, 3, 0.6);
    param2 = clampNumber(params.causticsRefraction ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.causticsTintR ?? params.param3, 0, 1, 0.6);
    param4 = clampNumber(params.causticsTintG ?? params.param4, 0, 1, 0.85);
    param5 = clampNumber(params.causticsTintB ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.causticsMode ?? params.param6, 0, 2, 0);
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'shockwave') {
    amount = clampNumber(options.amount ?? params.shockAmplitude ?? params.amount, 0, 0.2, 0.06);
    param0 = clampNumber(params.shockTriggerTime ?? params.param0, 0, 1e9, 0);
    param1 = clampNumber(params.shockSpeed ?? params.param1, 0.1, 3, 0.6);
    param2 = clampNumber(params.shockRingWidth ?? params.param2, 0.01, 0.5, 0.15);
    param3 = clampNumber(params.shockCenterX ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.shockCenterY ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.shockChromatic ?? params.param5, 0, 1, 0.3);
    param6 = clampNumber(params.shockMode ?? params.param6, 0, 1, 0);
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'droste-recursive') {
    amount = clampNumber(options.amount ?? params.drosteZoom ?? params.amount, 1.05, 3, 1.5);
    mix = clampNumber(params.drosteMix ?? options.mix, 0, 1, 1);
    param0 = clampNumber(params.drosteRotation ?? params.param0, -360, 360, 5);
    param1 = clampNumber(params.drosteIterations ?? params.param1, 1, 12, 6);
    param2 = clampNumber(params.drosteOffsetX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.drosteOffsetY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.drosteFrameSize ?? params.param4, 0, 0.5, 0.4);
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'slit-scan') {
    amount = clampNumber(options.amount ?? params.slitScanIntensity ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.slitScanMode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.slitScanPattern ?? params.param1, 0, 2, 0);
    param2 = clampNumber(params.slitScanSpeed ?? params.param2, 0, 3, 1);
    param3 = clampNumber(params.slitScanChromaSplit ?? params.param3, 0, 1, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'fractal-warp') {
    amount = clampNumber(options.amount ?? params.fractalWarpAmount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.fractalWarpScale ?? params.param0, 0.5, 16, 4);
    param1 = clampNumber(params.fractalWarpOctaves ?? params.param1, 1, 6, 4);
    param2 = clampNumber(params.fractalWarpSpeed ?? params.param2, 0, 3, 0.7);
    param3 = clampNumber(params.fractalWarpChromatic ?? params.param3, 0, 1, 0.2);
    param4 = clampNumber(params.fractalWarpMode ?? params.param4, 0, 2, 0);
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'fluid-distort') {
    amount = clampNumber(options.amount ?? params.fluidDistAmount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.fluidDistScale ?? params.param0, 0.5, 16, 4);
    param1 = clampNumber(params.fluidDistSpeed ?? params.param1, 0, 3, 0.8);
    param2 = clampNumber(params.fluidDistTurbulence ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.fluidDistMode ?? params.param3, 0, 2, 0);
    param4 = 0;
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'wormhole') {
    amount = clampNumber(options.amount ?? params.wormholePullStrength ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.wormholeRotation ?? params.param0, 0, 3, 1);
    param1 = clampNumber(params.wormholeCenterX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.wormholeCenterY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.wormholeTwist ?? params.param3, 0, 3, 0.5);
    param4 = clampNumber(params.wormholeChromatic ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.wormholeAnimSpeed ?? params.param5, 0, 2, 0.5);
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'vhs-full-deck') {
    amount = clampNumber(options.amount ?? params.vhsFdTracking ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.vhsFdHeadSwitch ?? params.param0, 0, 1, 0.4);
    param1 = clampNumber(params.vhsFdChromaBleed ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.vhsFdDropouts ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.vhsFdTapeNoise ?? params.param3, 0, 1, 0.4);
    param4 = clampNumber(params.vhsFdScanlines ?? params.param4, 0, 1, 0.4);
    param5 = clampNumber(params.vhsFdColorBleed ?? params.param5, 0, 1, 0.3);
    param6 = clampNumber(params.vhsFdSaturation ?? params.param6, 0, 1.5, 0.85);
    param7 = clampNumber(params.vhsFdTrackingJump ?? params.param7, 0, 1, 0.1);
    param8 = clampNumber(params.vhsFdMode ?? params.param8, 0, 2, 1);
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'topo-warp') {
    amount = clampNumber(options.amount ?? params.twDisplacement ?? params.amount, 0, 1, 0.5);
    mix = clampNumber(params.twMix ?? options.mix, 0, 1, 0.85);
    param0 = clampNumber(params.twContourCount ?? params.param0, 1, 32, 12);
    param1 = clampNumber(params.twContourWidth ?? params.param1, 0.001, 0.05, 0.008);
    param2 = clampNumber(params.twChromaticEdge ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.twColorR ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.twColorG ?? params.param4, 0, 1, 0.85);
    param5 = clampNumber(params.twColorB ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.twShadowRidges ?? params.param6, 0, 1, 0.5);
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'strobe-sequencer') {
    amount = clampNumber(options.amount ?? params.ssIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.ssBPM ?? params.param0, 30, 240, 120);
    param1 = clampNumber(params.ssSteps ?? params.param1, 1, 16, 16);
    param2 = clampNumber(params.ssPattern ?? params.param2, 0, 65535, 21845);
    param3 = clampNumber(params.ssMode ?? params.param3, 0, 3, 0);
    param4 = clampNumber(params.ssTintR ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.ssTintG ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.ssTintB ?? params.param6, 0, 1, 1);
    param7 = clampNumber(params.ssSwing ?? params.param7, 0, 0.5, 0);
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'mirror-shards') {
    amount = clampNumber(options.amount ?? params.msShardSize ?? params.amount, 0.05, 0.5, 0.2);
    param0 = clampNumber(params.msShards ?? params.param0, 2, 32, 8);
    param1 = clampNumber(params.msRotation ?? params.param1, 0, 360, 60);
    param2 = clampNumber(params.msChromatic ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.msMode ?? params.param3, 0, 2, 0);
    param4 = clampNumber(params.msDelayAmount ?? params.param4, 0, 1, 0.3);
    param5 = 0;
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'rorschach-mirror') {
    amount = clampNumber(options.amount ?? params.rmInkAmount ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.rmMode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.rmFluidEdges ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.rmTintR ?? params.param2, 0, 1, 0.05);
    param3 = clampNumber(params.rmTintG ?? params.param3, 0, 1, 0.05);
    param4 = clampNumber(params.rmTintB ?? params.param4, 0, 1, 0.05);
    param5 = clampNumber(params.rmBgR ?? params.param5, 0, 1, 0.95);
    param6 = clampNumber(params.rmBgG ?? params.param6, 0, 1, 0.95);
    param7 = clampNumber(params.rmBgB ?? params.param7, 0, 1, 0.92);
    param8 = clampNumber(params.rmMixOriginal ?? params.param8, 0, 1, 0);
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'glitch-quilt') {
    amount = clampNumber(options.amount ?? params.gqShuffleAmount ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.gqTileSize ?? params.param0, 4, 128, 32);
    param1 = clampNumber(params.gqRotateAmount ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.gqChromaSplit ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.gqTriggerRate ?? params.param3, 0, 3, 1);
    param4 = clampNumber(params.gqMode ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.gqDelayAmount ?? params.param5, 0, 1, 0.3);
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'poster-tear') {
    amount = clampNumber(options.amount ?? params.ptTearAmount ?? params.amount, 0, 1, 0.3);
    param0 = clampNumber(params.ptTearAngle ?? params.param0, 0, 360, 35);
    param1 = clampNumber(params.ptTearJitter ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.ptShiftBelow ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.ptOffsetX ?? params.param3, -0.3, 0.3, 0.05);
    param4 = clampNumber(params.ptOffsetY ?? params.param4, -0.3, 0.3, 0.02);
    param5 = clampNumber(params.ptTearGlow ?? params.param5, 0, 1, 0.3);
    param6 = clampNumber(params.ptMode ?? params.param6, 0, 2, 0);
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'paint-peel') {
    amount = clampNumber(options.amount ?? params.ppAmount ?? params.amount, 0, 1, 0.3);
    param0 = clampNumber(params.ppScale ?? params.param0, 0.5, 16, 4);
    param1 = clampNumber(params.ppLumaBias ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.ppCurl ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.ppShadow ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.ppBgR ?? params.param4, 0, 1, 0.15);
    param5 = clampNumber(params.ppBgG ?? params.param5, 0, 1, 0.13);
    param6 = clampNumber(params.ppBgB ?? params.param6, 0, 1, 0.1);
    param7 = clampNumber(params.ppMode ?? params.param7, 0, 2, 0);
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'liquid-glass') {
    amount = clampNumber(options.amount ?? params.lgRefraction ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.lgBlobs ?? params.param0, 1, 8, 3);
    param1 = clampNumber(params.lgBlobSize ?? params.param1, 0.02, 0.4, 0.18);
    param2 = clampNumber(params.lgChromatic ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.lgSpecular ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.lgCausticAmount ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.lgSpeed ?? params.param5, 0, 3, 0.5);
    param6 = clampNumber(params.lgTintR ?? params.param6, 0, 1, 0.85);
    param7 = clampNumber(params.lgTintG ?? params.param7, 0, 1, 0.95);
    param8 = clampNumber(params.lgTintB ?? params.param8, 0, 1, 1);
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'crystal-refract') {
    amount = clampNumber(options.amount ?? params.crystalRefraction ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.crystalScale ?? params.param0, 0.5, 16, 6);
    param1 = clampNumber(params.crystalSparkle ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.crystalEdgeGlow ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.crystalTintR ?? params.param3, 0, 1, 0.85);
    param4 = clampNumber(params.crystalTintG ?? params.param4, 0, 1, 0.95);
    param5 = clampNumber(params.crystalTintB ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.crystalMode ?? params.param6, 0, 1, 0);
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'infinite-mirror') {
    amount = clampNumber(options.amount ?? params.infMirrorShrink ?? params.amount, 0.5, 0.95, 0.8);
    param0 = clampNumber(params.infMirrorIterations ?? params.param0, 1, 12, 5);
    param1 = clampNumber(params.infMirrorRotation ?? params.param1, -360, 360, 5);
    param2 = clampNumber(params.infMirrorTintFade ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.infMirrorHueShift ?? params.param3, 0, 1, 0.05);
    param4 = clampNumber(params.infMirrorMode ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.infMirrorOffsetX ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.infMirrorOffsetY ?? params.param6, 0, 1, 0.5);
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'tunnel-flight') {
    amount = clampNumber(options.amount ?? params.tunnelSpeed ?? params.amount, 0, 3, 1);
    param0 = clampNumber(params.tunnelTwist ?? params.param0, 0, 3, 0.5);
    param1 = clampNumber(params.tunnelDepth ?? params.param1, 0.5, 3, 1.5);
    param2 = clampNumber(params.tunnelCenterX ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.tunnelCenterY ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.tunnelMode ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.tunnelChromatic ?? params.param5, 0, 1, 0.2);
    param6 = 0;
    param7 = 0;
    param8 = 0;
    param9 = 0;
    param10 = 0;
    param11 = 0;
  } else if (options.effect === 'volumetric-fog-overlay') {
    amount = clampNumber(options.amount ?? params.fogDensity ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.fogScale ?? params.param0, 0.5, 32, 6);
    param1 = clampNumber(params.fogSpeed ?? params.param1, 0, 2, 0.5);
    param2 = clampNumber(params.fogHeightFalloff ?? params.param2, -1, 1, -0.3);
    param3 = clampNumber(params.fogDepthSim ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.fogColorR ?? params.param4, 0, 1, 0.85);
    param5 = clampNumber(params.fogColorG ?? params.param5, 0, 1, 0.9);
    param6 = clampNumber(params.fogColorB ?? params.param6, 0, 1, 0.95);
    param7 = clampNumber(params.fogTurbulence ?? params.param7, 0, 1, 1);
    param8 = clampNumber(params.fogMode ?? params.param8, 0, 2, 1);
    param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'rain-fog-snow-overlay') {
    amount = clampNumber(options.amount ?? params.weatherDensity ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.weatherType ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.weatherSpeed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.weatherAngle ?? params.param2, -45, 45, 10);
    param3 = clampNumber(params.weatherSize ?? params.param3, 0.5, 3, 1);
    param4 = clampNumber(params.weatherFog ?? params.param4, 0, 1, 0.2);
    param5 = clampNumber(params.weatherColorR ?? params.param5, 0, 1, 0.85);
    param6 = clampNumber(params.weatherColorG ?? params.param6, 0, 1, 0.9);
    param7 = clampNumber(params.weatherColorB ?? params.param7, 0, 1, 1);
    param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'particle-overlay-fx') {
    amount = clampNumber(options.amount ?? params.partDensity ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.partMode ?? params.param0, 0, 4, 0);
    param1 = clampNumber(params.partSize ?? params.param1, 0.5, 4, 1);
    param2 = clampNumber(params.partSpeed ?? params.param2, 0, 3, 1);
    param3 = clampNumber(params.partTwinkle ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.partColorR ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.partColorG ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.partColorB ?? params.param6, 0, 1, 0.9);
    param7 = clampNumber(params.partBlend ?? params.param7, 0, 1, 0);
    param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'glint-starburst') {
    amount = clampNumber(options.amount ?? params.glintIntensity ?? params.amount, 0, 2, 0.7);
    param0 = clampNumber(params.glintThreshold ?? params.param0, 0, 1, 0.75);
    param1 = clampNumber(params.glintLength ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.glintPoints ?? params.param2, 2, 12, 4);
    param3 = clampNumber(params.glintRotation ?? params.param3, 0, 360, 0);
    param4 = clampNumber(params.glintColorR ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.glintColorG ?? params.param5, 0, 1, 0.95);
    param6 = clampNumber(params.glintColorB ?? params.param6, 0, 1, 0.85);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'emboss-relight') {
    amount = clampNumber(options.amount ?? params.embRelStrength ?? params.amount, 0, 3, 1);
    param0 = clampNumber(params.embRelAngle ?? params.param0, 0, 360, 135);
    param1 = clampNumber(params.embRelHeight ?? params.param1, 0, 4, 1);
    param2 = clampNumber(params.embRelDetail ?? params.param2, 1, 4, 1);
    param3 = clampNumber(params.embRelSpecular ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.embRelColorPreserve ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.embRelAmbient ?? params.param5, 0, 1, 0.3);
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'pixel-sort') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.4);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.3);
    param2 = 0; param3 = 0; param4 = 0; param5 = 0;
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'neon-tube-trace') {
    amount = clampNumber(options.amount ?? params.ntGlow ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.ntEdgeThreshold ?? params.param0, 0, 1, 0.15);
    param1 = clampNumber(params.ntTubeWidth ?? params.param1, 0.5, 4, 1.5);
    param2 = clampNumber(params.ntGlowRadius ?? params.param2, 1, 12, 6);
    param3 = clampNumber(params.ntTintR ?? params.param3, 0, 1, 1);
    param4 = clampNumber(params.ntTintG ?? params.param4, 0, 1, 0.2);
    param5 = clampNumber(params.ntTintB ?? params.param5, 0, 1, 0.7);
    param6 = clampNumber(params.ntChase ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.ntChaseSpeed ?? params.param7, 0, 3, 1);
    param8 = clampNumber(params.ntFlicker ?? params.param8, 0, 1, 0);
    param9 = clampNumber(params.ntBg ?? params.param9, 0, 2, 2);
    param10 = 0; param11 = 0;
  } else if (options.effect === 'hologram-scan') {
    amount = clampNumber(options.amount ?? params.hsIntensity ?? params.amount, 0, 1, 0.7);
    param0 = clampNumber(params.hsScanFreq ?? params.param0, 50, 500, 200);
    param1 = clampNumber(params.hsScanSpeed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.hsGridSpacing ?? params.param2, 0, 32, 12);
    param3 = clampNumber(params.hsRGBFlicker ?? params.param3, 0, 1, 0.4);
    param4 = clampNumber(params.hsBrokenBands ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.hsTintR ?? params.param5, 0, 1, 0.4);
    param6 = clampNumber(params.hsTintG ?? params.param6, 0, 1, 0.95);
    param7 = clampNumber(params.hsTintB ?? params.param7, 0, 1, 1);
    param8 = clampNumber(params.hsOpacityFlicker ?? params.param8, 0, 1, 0.3);
    param9 = clampNumber(params.hsEdgeGlow ?? params.param9, 0, 1, 0.6);
    param10 = 0; param11 = 0;
  } else if (options.effect === 'laser-slice') {
    amount = clampNumber(options.amount ?? params.lsGlow ?? params.amount, 0, 2, 1.2);
    param0 = clampNumber(params.lsMode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.lsSpeed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.lsBeamWidth ?? params.param2, 0.005, 0.1, 0.02);
    param3 = clampNumber(params.lsSparks ?? params.param3, 0, 1, 0.4);
    param4 = clampNumber(params.lsEraseAmount ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.lsTintR ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.lsTintG ?? params.param6, 0, 1, 0.1);
    param7 = clampNumber(params.lsTintB ?? params.param7, 0, 1, 0.1);
    param8 = clampNumber(params.lsReveal ?? params.param8, 0, 1, 1);
    param9 = clampNumber(params.lsPersistence ?? params.param9, 0, 1, 0.92);
    param10 = 0; param11 = 0;
  } else if (options.effect === 'aura-field') {
    amount = clampNumber(options.amount ?? params.afIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.afRadius ?? params.param0, 4, 32, 12);
    param1 = clampNumber(params.afEdgeAmount ?? params.param1, 0, 1, 0.6);
    param2 = clampNumber(params.afLumaAmount ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.afAudioReact ?? params.param3, 0, 2, 0.5);
    param4 = clampNumber(params.afHueShift ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.afTintR ?? params.param5, 0, 1, 0.6);
    param6 = clampNumber(params.afTintG ?? params.param6, 0, 1, 0.85);
    param7 = clampNumber(params.afTintB ?? params.param7, 0, 1, 1);
    param8 = clampNumber(params.afMode ?? params.param8, 0, 2, 1);
    param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'smoke-disintegrate') {
    amount = clampNumber(options.amount ?? params.smokeAmount ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.smokeScale ?? params.param0, 0.5, 16, 4);
    param1 = clampNumber(params.smokeSpeed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.smokeDirection ?? params.param2, 0, 360, 90);
    param3 = clampNumber(params.smokeEdgeFade ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.smokeColorR ?? params.param4, 0, 1, 0.85);
    param5 = clampNumber(params.smokeColorG ?? params.param5, 0, 1, 0.85);
    param6 = clampNumber(params.smokeColorB ?? params.param6, 0, 1, 0.9);
    param7 = clampNumber(params.smokeMode ?? params.param7, 0, 2, 0);
    param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'shimmer-cloth') {
    amount = clampNumber(options.amount ?? params.clothAmplitude ?? params.amount, 0, 1, 0.3);
    param0 = clampNumber(params.clothFrequency ?? params.param0, 1, 30, 8);
    param1 = clampNumber(params.clothSpeed ?? params.param1, 0, 3, 0.7);
    param2 = clampNumber(params.clothThreadDensity ?? params.param2, 1, 200, 60);
    param3 = clampNumber(params.clothThreadDepth ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.clothShimmer ?? params.param4, 0, 2, 0.5);
    param5 = clampNumber(params.clothMode ?? params.param5, 0, 2, 0);
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'cellular-automata-burn') {
    amount = clampNumber(options.amount ?? params.caMix ?? params.amount, 0, 1, 0.7);
    param0 = clampNumber(params.caCellSize ?? params.param0, 1, 8, 2);
    param1 = clampNumber(params.caBirthThreshold ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.caColorR ?? params.param2, 0, 1, 1);
    param3 = clampNumber(params.caColorG ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.caColorB ?? params.param4, 0, 1, 0.1);
    param5 = clampNumber(params.caMode ?? params.param5, 0, 2, 0);
    param6 = clampNumber(params.caSurvivalLow ?? params.param6, 0, 8, 1.5);
    param7 = clampNumber(params.caSurvivalHigh ?? params.param7, 0, 8, 3.5);
    param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'spectral-prism-tunnel') {
    amount = clampNumber(options.amount ?? params.sptPrismSpread ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.sptTunnelDepth ?? params.param0, 0.5, 3, 1.5);
    param1 = clampNumber(params.sptRotation ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.sptSpeed ?? params.param2, 0, 3, 1);
    param3 = clampNumber(params.sptSlices ?? params.param3, 4, 32, 12);
    param4 = clampNumber(params.sptFade ?? params.param4, 0, 1, 0.5);
    param5 = 0; param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'led-volume') {
    amount = clampNumber(options.amount ?? params.ledGlow ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.ledVoxelSize ?? params.param0, 8, 32, 16);
    param1 = clampNumber(params.ledDepthPulse ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.ledDepthSpeed ?? params.param2, 0, 3, 1);
    param3 = clampNumber(params.ledPosterize ?? params.param3, 1, 8, 4);
    param4 = clampNumber(params.ledPerspective ?? params.param4, 0, 1, 0.4);
    param5 = clampNumber(params.ledMode ?? params.param5, 0, 2, 1);
    param6 = clampNumber(params.ledBgR ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.ledBgG ?? params.param7, 0, 1, 0);
    param8 = clampNumber(params.ledBgB ?? params.param8, 0, 1, 0);
    param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'audio-shock-bloom') {
    amount = clampNumber(options.amount ?? params.asbIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.asbBloomThreshold ?? params.param0, 0, 1, 0.6);
    param1 = clampNumber(params.asbBloomRadius ?? params.param1, 1, 30, 12);
    param2 = clampNumber(params.asbShockSpeed ?? params.param2, 0.1, 3, 0.8);
    param3 = clampNumber(params.asbShockAmplitude ?? params.param3, 0, 0.2, 0.05);
    param4 = clampNumber(params.asbChromaSplit ?? params.param4, 0, 1, 0.4);
    param5 = clampNumber(params.asbStrobeAmount ?? params.param5, 0, 1, 0.4);
    param6 = clampNumber(params.asbTintR ?? params.param6, 0, 1, 1);
    param7 = clampNumber(params.asbTintG ?? params.param7, 0, 1, 0.95);
    param8 = clampNumber(params.asbTintB ?? params.param8, 0, 1, 0.85);
    param9 = clampNumber(params.asbAudioGate ?? params.param9, 0, 1, 0.3);
    param10 = 0; param11 = 0;
  } else if (options.effect === 'analog-feedback-rack') {
    amount = clampNumber(options.amount ?? params.afrMix ?? params.amount, 0, 1, 0.7);
    param0 = clampNumber(params.afrZoom ?? params.param0, 0.85, 1.15, 1.02);
    param1 = clampNumber(params.afrRotation ?? params.param1, -0.2, 0.2, 0.005);
    param2 = clampNumber(params.afrDecay ?? params.param2, 0, 1, 0.04);
    param3 = clampNumber(params.afrHueShift ?? params.param3, 0, 1, 0.01);
    param4 = clampNumber(params.afrMaskCenter ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.afrChromaSplit ?? params.param5, 0, 1, 0.2);
    param6 = clampNumber(params.afrOffsetX ?? params.param6, -0.1, 0.1, 0);
    param7 = clampNumber(params.afrOffsetY ?? params.param7, -0.1, 0.1, 0);
    param8 = clampNumber(params.afrMode ?? params.param8, 0, 2, 0);
    param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'club-laser-grid') {
    amount = clampNumber(options.amount ?? params.clgIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.clgGridDensity ?? params.param0, 4, 32, 12);
    param1 = clampNumber(params.clgPerspective ?? params.param1, 0, 1, 0.7);
    param2 = clampNumber(params.clgSpeed ?? params.param2, 0, 3, 1);
    param3 = clampNumber(params.clgIntersectionGlow ?? params.param3, 0, 1, 0.7);
    param4 = clampNumber(params.clgLineWidth ?? params.param4, 0.5, 4, 1.5);
    param5 = clampNumber(params.clgTintR ?? params.param5, 0, 1, 0.2);
    param6 = clampNumber(params.clgTintG ?? params.param6, 0, 1, 1);
    param7 = clampNumber(params.clgTintB ?? params.param7, 0, 1, 0.5);
    param8 = clampNumber(params.clgAudioReact ?? params.param8, 0, 2, 0.7);
    param9 = clampNumber(params.clgMode ?? params.param9, 0, 2, 0);
    param10 = 0; param11 = 0;
  } else if (options.effect === 'ghost-exposure') {
    amount = clampNumber(options.amount ?? params.geExposure ?? params.amount, 0, 1, 0.3);
    param0 = clampNumber(params.geDecay ?? params.param0, 0, 1, 0.04);
    param1 = clampNumber(params.geHueShiftPerFrame ?? params.param1, 0, 0.05, 0.005);
    param2 = clampNumber(params.geIntensity ?? params.param2, 0, 2, 1);
    param3 = clampNumber(params.geMode ?? params.param3, 0, 2, 0);
    param4 = clampNumber(params.geClamp ?? params.param4, 0, 1, 0.85);
    param5 = 0; param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'dream-diffusion') {
    amount = clampNumber(options.amount ?? params.ddBloomAmount ?? params.amount, 0, 2, 1.2);
    param0 = clampNumber(params.ddBloomRadius ?? params.param0, 1, 30, 14);
    param1 = clampNumber(params.ddHalation ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.ddChromaticBlur ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.ddPastelRolloff ?? params.param3, 0, 1, 0.6);
    param4 = clampNumber(params.ddShadowLift ?? params.param4, 0, 0.5, 0.15);
    param5 = clampNumber(params.ddSoftness ?? params.param5, 0, 1, 0.4);
    param6 = clampNumber(params.ddTintR ?? params.param6, 0, 2, 1.05);
    param7 = clampNumber(params.ddTintG ?? params.param7, 0, 2, 1);
    param8 = clampNumber(params.ddTintB ?? params.param8, 0, 2, 0.95);
    param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'ghost-double') {
    amount = clampNumber(options.amount ?? params.ghostOpacity ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.ghostOffsetX ?? params.param0, -0.3, 0.3, 0.05);
    param1 = clampNumber(params.ghostOffsetY ?? params.param1, -0.3, 0.3, 0);
    param2 = clampNumber(params.ghostMirror ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.ghostTintR ?? params.param3, 0, 1, 1);
    param4 = clampNumber(params.ghostTintG ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.ghostTintB ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.ghostBlend ?? params.param6, 0, 2, 0);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'depth-parallax') {
    amount = clampNumber(options.amount ?? params.dpDepthStrength ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.dpPushIn ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.dpLayers ?? params.param1, 1, 8, 4);
    param2 = clampNumber(params.dpChromatic ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.dpDepthBoost ?? params.param3, 0.1, 2, 1);
    param4 = clampNumber(params.dpMode ?? params.param4, 0, 2, 0);
    param5 = clampNumber(params.dpPanX ?? params.param5, -1, 1, 0);
    param6 = clampNumber(params.dpPanY ?? params.param6, -1, 1, 0);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'pixel-sand') {
    amount = clampNumber(options.amount ?? params.psGravity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.psTurbulence ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.psThreshold ?? params.param1, 0, 1, 0.6);
    param2 = clampNumber(params.psMode ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.psReplenish ?? params.param3, 0, 1, 0.6);
    param4 = clampNumber(params.psChromaSplit ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.psGrainSize ?? params.param5, 1, 6, 3);
    param6 = clampNumber(params.psPersistence ?? params.param6, 0, 1, 0.92);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'point-cloud-dissolve') {
    amount = clampNumber(options.amount ?? params.pcdDissolve ?? params.amount, 0, 1, 0);
    param0 = clampNumber(params.pcdDotSize ?? params.param0, 1, 12, 4);
    param1 = clampNumber(params.pcdScatterRadius ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.pcdAttract ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.pcdTurbulence ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.pcdMode ?? params.param4, 0, 2, 1);
    param5 = clampNumber(params.pcdBgR ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.pcdBgG ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.pcdBgB ?? params.param7, 0, 1, 0);
    param8 = clampNumber(params.pcdHueShift ?? params.param8, 0, 1, 0);
    param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'explode3-d') {
    amount = clampNumber(options.amount ?? params.amount, 0, 2, 0.3);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.threshold ?? params.param2, 0, 1, 0.7);
    param3 = clampNumber(params.angle ?? params.param3, -100, 100, 0);
    param4 = clampNumber(params.red ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.green ?? params.param5, 0, 1, 0.95);
    param6 = clampNumber(params.blue ?? params.param6, 0, 1, 0.9);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'terrain3-d') {
    amount = clampNumber(options.amount ?? params.terrainHeight ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.terrainMode ?? params.param0, 0, 2, 1);
    param1 = clampNumber(params.terrainCamHeight ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.terrainSpeed ?? params.param2, 0, 3, 0.3);
    param3 = clampNumber(params.terrainFog ?? params.param3, 0, 1, 0.4);
    param4 = clampNumber(params.terrainYaw ?? params.param4, -10, 10, 0);
    param5 = clampNumber(params.terrainPitch ?? params.param5, 0, 1, 0.5);
    param6 = clampNumber(params.terrainRoll ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.terrainFogR ?? params.param7, 0, 1, 0.05);
    param8 = clampNumber(params.terrainFogG ?? params.param8, 0, 1, 0.07);
    param9 = clampNumber(params.terrainFogB ?? params.param9, 0, 1, 0.12);
    param10 = clampNumber(params.terrainHorizonFade ?? params.param10, 0, 1, 0.7);
    param11 = clampNumber(params.terrainSourceMix ?? params.param11, 0, 1, 0);
  } else if (options.effect === 'wrapped-terrain') {
    amount = clampNumber(options.amount ?? params.wtHeight ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.wtShape ?? params.param0, 0, 2, 0);
    param1 = clampNumber(params.wtRotateX ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.wtRotateY ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.wtAutoRotate ?? params.param3, 0, 3, 0.4);
    param4 = clampNumber(params.wtCamDistance ?? params.param4, 1.5, 6, 2.5);
    param5 = clampNumber(params.wtSpecular ?? params.param5, 0, 1, 0.4);
    param6 = clampNumber(params.wtAmbient ?? params.param6, 0, 1, 0.3);
    param7 = clampNumber(params.wtFogDistance ?? params.param7, 0, 2, 0.2);
    param8 = clampNumber(params.wtFogR ?? params.param8, 0, 1, 0.05);
    param9 = clampNumber(params.wtFogG ?? params.param9, 0, 1, 0.07);
    param10 = clampNumber(params.wtFogB ?? params.param10, 0, 1, 0.12);
    param11 = clampNumber(params.wtHorizonFade ?? params.param11, 0, 1, 0.6);
    param12 = clampNumber(params.wtTileScale ?? params.param12, 0.5, 4, 1);
    param13 = clampNumber(params.wtSourceMix ?? params.param13, 0, 1, 0);
  } else if (options.effect === 'string-orb') {
    amount = clampNumber(options.amount ?? params.soIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.soRadius ?? params.param0, 0.6, 1.4, 0.85);
    param1 = clampNumber(params.soHeight ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.soLatCount ?? params.param2, 4, 64, 16);
    param3 = clampNumber(params.soLonCount ?? params.param3, 4, 64, 24);
    param4 = clampNumber(params.soDiagCount ?? params.param4, 0, 32, 8);
    param5 = clampNumber(params.soSlope ?? params.param5, -2, 2, 1.5);
    param6 = clampNumber(params.soWidth ?? params.param6, 0.005, 0.05, 0.012);
    param7 = clampNumber(params.soSpin ?? params.param7, -3, 3, 0.4);
    param8 = clampNumber(params.soTilt ?? params.param8, 0, 1, 0.15);
    param9 = clampNumber(params.soFlow ?? params.param9, 0, 3, 0.5);
    param10 = clampNumber(params.soGlow ?? params.param10, 0, 2, 0.7);
    param11 = clampNumber(params.soTileScale ?? params.param11, 0.5, 4, 1);
    param12 = clampNumber(params.soHorizonFade ?? params.param12, 0, 1, 0.7);
    param13 = clampNumber(params.soGlowR ?? params.param13, 0, 1, 0.4);
    param14 = clampNumber(params.soGlowG ?? params.param14, 0, 1, 0.85);
    param15 = clampNumber(params.soGlowB ?? params.param15, 0, 1, 1);
  } else if (options.effect === 'sphere-wireframe') {
    amount = clampNumber(options.amount ?? params.swIntensity ?? params.amount, 0, 2, 1.2);
    param0 = clampNumber(params.swRadius ?? params.param0, 0.6, 1.4, 0.85);
    param1 = clampNumber(params.swHeight ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.swMeridians ?? params.param2, 4, 32, 16);
    param3 = clampNumber(params.swParallels ?? params.param3, 4, 32, 12);
    param4 = clampNumber(params.swWidth ?? params.param4, 0.005, 0.04, 0.012);
    param5 = clampNumber(params.swSpin ?? params.param5, -3, 3, 0.4);
    param6 = clampNumber(params.swTilt ?? params.param6, 0, 1, 0.2);
    param7 = clampNumber(params.swHaloGlow ?? params.param7, 0, 2, 0.7);
    param8 = clampNumber(params.swColorR ?? params.param8, 0, 1, 0.5);
    param9 = clampNumber(params.swColorG ?? params.param9, 0, 1, 0.9);
    param10 = clampNumber(params.swColorB ?? params.param10, 0, 1, 1);
    param11 = clampNumber(params.swFillSource ?? params.param11, 0, 1, 0.4);
    param12 = clampNumber(params.swHorizonFade ?? params.param12, 0, 1, 0.7);
    param13 = clampNumber(params.swTileScale ?? params.param13, 0.5, 4, 1);
  } else if (options.effect === 'voxel-cube-cluster') {
    amount = clampNumber(options.amount ?? params.vccHeight ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.vccGridSize ?? params.param0, 2, 6, 4);
    param1 = clampNumber(params.vccCubeSize ?? params.param1, 0.1, 0.45, 0.22);
    param2 = clampNumber(params.vccSpacing ?? params.param2, 0.4, 1.2, 0.7);
    param3 = clampNumber(params.vccSpin ?? params.param3, 0, 3, 0.5);
    param4 = clampNumber(params.vccTilt ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.vccCamDistance ?? params.param5, 2, 6, 4);
    param6 = clampNumber(params.vccSpecular ?? params.param6, 0, 1, 0.4);
    param7 = clampNumber(params.vccAmbient ?? params.param7, 0, 1, 0.3);
    param8 = clampNumber(params.vccBgR ?? params.param8, 0, 1, 0.04);
    param9 = clampNumber(params.vccBgG ?? params.param9, 0, 1, 0.05);
    param10 = clampNumber(params.vccBgB ?? params.param10, 0, 1, 0.08);
    param11 = clampNumber(params.vccHorizonFade ?? params.param11, 0, 1, 0.6);
  } else if (options.effect === 'mobius-lattice') {
    amount = clampNumber(options.amount ?? params.mlIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.mlMajorR ?? params.param0, 0.5, 1.2, 0.85);
    param1 = clampNumber(params.mlRibbonW ?? params.param1, 0.1, 0.5, 0.3);
    param2 = clampNumber(params.mlTwists ?? params.param2, 0.5, 4, 1);
    param3 = clampNumber(params.mlSpin ?? params.param3, -3, 3, 0.5);
    param4 = clampNumber(params.mlTilt ?? params.param4, 0, 1, 0.25);
    param5 = clampNumber(params.mlLineDensity ?? params.param5, 4, 32, 16);
    param6 = clampNumber(params.mlLineWidth ?? params.param6, 0.005, 0.04, 0.015);
    param7 = clampNumber(params.mlLineR ?? params.param7, 0, 1, 1);
    param8 = clampNumber(params.mlLineG ?? params.param8, 0, 1, 0.85);
    param9 = clampNumber(params.mlLineB ?? params.param9, 0, 1, 0.4);
    param10 = clampNumber(params.mlHorizonFade ?? params.param10, 0, 1, 0.6);
    param11 = 0;
  } else if (options.effect === 'crystal-shard-field') {
    amount = clampNumber(options.amount ?? params.csfIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.csfShardCount ?? params.param0, 6, 32, 16);
    param1 = clampNumber(params.csfShardSize ?? params.param1, 0.1, 0.6, 0.28);
    param2 = clampNumber(params.csfSpread ?? params.param2, 0.5, 2, 1.2);
    param3 = clampNumber(params.csfChromaEdge ?? params.param3, 0, 1, 0.4);
    param4 = clampNumber(params.csfRefraction ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.csfSpin ?? params.param5, -3, 3, 0.4);
    param6 = clampNumber(params.csfTintR ?? params.param6, 0, 1, 0.85);
    param7 = clampNumber(params.csfTintG ?? params.param7, 0, 1, 0.95);
    param8 = clampNumber(params.csfTintB ?? params.param8, 0, 1, 1);
    param9 = clampNumber(params.csfHorizonFade ?? params.param9, 0, 1, 0.6);
    param10 = 0; param11 = 0;
  } else if (options.effect === 'tube-lattice') {
    amount = clampNumber(options.amount ?? params.tlIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.tlTubeCount ?? params.param0, 3, 12, 6);
    param1 = clampNumber(params.tlTubeRadius ?? params.param1, 0.05, 0.3, 0.15);
    param2 = clampNumber(params.tlSpread ?? params.param2, 0.4, 2, 0.9);
    param3 = clampNumber(params.tlSpin ?? params.param3, -3, 3, 0.4);
    param4 = clampNumber(params.tlTilt ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.tlTwist ?? params.param5, 0, 3, 0.5);
    param6 = clampNumber(params.tlRimR ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.tlRimG ?? params.param7, 0, 1, 0.95);
    param8 = clampNumber(params.tlRimB ?? params.param8, 0, 1, 1);
    param9 = clampNumber(params.tlHorizonFade ?? params.param9, 0, 1, 0.6);
    param10 = 0; param11 = 0;
  } else if (options.effect === 'disco-mirror-ball') {
    amount = clampNumber(options.amount ?? params.dmbIntensity ?? params.amount, 0, 2, 1.2);
    param0 = clampNumber(params.dmbRadius ?? params.param0, 0.6, 1.4, 1);
    param1 = clampNumber(params.dmbFacetCount ?? params.param1, 6, 32, 16);
    param2 = clampNumber(params.dmbSpin ?? params.param2, -3, 3, 0.6);
    param3 = clampNumber(params.dmbTilt ?? params.param3, 0, 1, 0.2);
    param4 = clampNumber(params.dmbChaseSpeed ?? params.param4, 0, 3, 1.2);
    param5 = clampNumber(params.dmbChaseHueWidth ?? params.param5, 0, 1, 0.3);
    param6 = clampNumber(params.dmbSparkle ?? params.param6, 0, 1, 0.5);
    param7 = clampNumber(params.dmbHighlightR ?? params.param7, 0, 1, 1);
    param8 = clampNumber(params.dmbHighlightG ?? params.param8, 0, 1, 1);
    param9 = clampNumber(params.dmbHighlightB ?? params.param9, 0, 1, 0.85);
    param10 = clampNumber(params.dmbHorizonFade ?? params.param10, 0, 1, 0.5);
    param11 = 0;
  } else if (options.effect === 'lissajous-knot') {
    amount = clampNumber(options.amount ?? params.lkIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.lkRatioX ?? params.param0, 1, 7, 3);
    param1 = clampNumber(params.lkRatioY ?? params.param1, 1, 7, 4);
    param2 = clampNumber(params.lkRatioZ ?? params.param2, 1, 7, 5);
    param3 = clampNumber(params.lkPhaseX ?? params.param3, 0, 1, 0.25);
    param4 = clampNumber(params.lkPhaseY ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.lkTubeRadius ?? params.param5, 0.04, 0.2, 0.08);
    param6 = clampNumber(params.lkScale ?? params.param6, 0.5, 1.5, 1);
    param7 = clampNumber(params.lkSpin ?? params.param7, -3, 3, 0.4);
    param8 = clampNumber(params.lkTilt ?? params.param8, 0, 1, 0.25);
    param9 = clampNumber(params.lkTubeR ?? params.param9, 0, 1, 1);
    param10 = clampNumber(params.lkTubeG ?? params.param10, 0, 1, 0.5);
    param11 = clampNumber(params.lkTubeB ?? params.param11, 0, 1, 0.85);
    param12 = clampNumber(params.lkHorizonFade ?? params.param12, 0, 1, 0.6);
  } else if (options.effect === 'helix-particle-stream') {
    amount = clampNumber(options.amount ?? params.hpsIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.hpsHelices ?? params.param0, 1, 6, 2);
    param1 = clampNumber(params.hpsHelixRadius ?? params.param1, 0.2, 1, 0.5);
    param2 = clampNumber(params.hpsTurns ?? params.param2, 1, 6, 3);
    param3 = clampNumber(params.hpsHeight ?? params.param3, 1, 3, 2);
    param4 = clampNumber(params.hpsTubeRadius ?? params.param4, 0.02, 0.15, 0.06);
    param5 = clampNumber(params.hpsRiseSpeed ?? params.param5, 0, 3, 1);
    param6 = clampNumber(params.hpsSpin ?? params.param6, -3, 3, 0.3);
    param7 = clampNumber(params.hpsTilt ?? params.param7, 0, 1, 0.2);
    param8 = clampNumber(params.hpsTintR ?? params.param8, 0, 1, 0.4);
    param9 = clampNumber(params.hpsTintG ?? params.param9, 0, 1, 1);
    param10 = clampNumber(params.hpsTintB ?? params.param10, 0, 1, 0.7);
    param11 = clampNumber(params.hpsHorizonFade ?? params.param11, 0, 1, 0.6);
  } else if (options.effect === 'donut-constellation') {
    amount = clampNumber(options.amount ?? params.dcTintIntensity ?? params.amount, 0, 2, 1);
    param0 = clampNumber(params.dcMajorR ?? params.param0, 0.5, 1.4, 1);
    param1 = clampNumber(params.dcMinorR ?? params.param1, 0.05, 0.4, 0.18);
    param2 = clampNumber(params.dcStarCount ?? params.param2, 4, 32, 12);
    param3 = clampNumber(params.dcStarSize ?? params.param3, 0.005, 0.04, 0.025);
    param4 = clampNumber(params.dcSpin ?? params.param4, -3, 3, 0.4);
    param5 = clampNumber(params.dcTilt ?? params.param5, 0, 1, 0.4);
    param6 = clampNumber(params.dcTorusR ?? params.param6, 0, 1, 0.8);
    param7 = clampNumber(params.dcTorusG ?? params.param7, 0, 1, 0.4);
    param8 = clampNumber(params.dcTorusB ?? params.param8, 0, 1, 1);
    param9 = clampNumber(params.dcStarR ?? params.param9, 0, 1, 1);
    param10 = clampNumber(params.dcStarG ?? params.param10, 0, 1, 1);
    param11 = clampNumber(params.dcStarB ?? params.param11, 0, 1, 0.85);
    param12 = clampNumber(params.dcHorizonFade ?? params.param12, 0, 1, 0.6);
  } else if (options.effect === 'sphere-project') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.8);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.4);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.2);
    param2 = clampNumber(params.threshold ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.red ?? params.param3, 0, 1, 1);
    param4 = clampNumber(params.green ?? params.param4, 0, 1, 0.95);
    param5 = clampNumber(params.blue ?? params.param5, 0, 1, 0.9);
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'cube-project') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.6);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.2);
    param2 = clampNumber(params.angle ?? params.param2, -10, 10, 0.5);
    param3 = clampNumber(params.red ?? params.param3, 0, 1, 1);
    param4 = clampNumber(params.green ?? params.param4, 0, 1, 0.95);
    param5 = clampNumber(params.blue ?? params.param5, 0, 1, 0.9);
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'cylinder-wrap' || options.effect === 'torus-tunnel' || options.effect === 'shatter3-d'
    || options.effect === 'mobius-strip' || options.effect === 'voxel-displace' || options.effect === 'wave-surface'
    || options.effect === 'origami-fold' || options.effect === 'mirror-room' || options.effect === 'diamond-gem'
    || options.effect === 'shingle-stack') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, manifest.defaultAmount);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.4);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.2);
    param2 = clampNumber(params.threshold ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.red ?? params.param3, 0, 1, 1);
    param4 = clampNumber(params.green ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.blue ?? params.param5, 0, 1, 1);
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'prism-split') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0);
    param2 = clampNumber(params.threshold ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.red ?? params.param3, 0, 1, 1);
    param4 = clampNumber(params.green ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.blue ?? params.param5, 0, 1, 1);
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'geometric-tile-pro') {
    amount = clampNumber(options.amount ?? params.geomProTileCount ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.geomProFlipRange ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.geomProSpeed ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.geomProGap ?? params.param2, 0, 1, 0.1);
    param3 = 0; param4 = 0; param5 = 0;
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'time-smear') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.7);
    param2 = clampNumber(params.mode ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.speed ?? params.param3, 0, 3, 1);
    param4 = 0; param5 = 0;
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'chronophoto') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.5);
    param0 = clampNumber(params.amount2 ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.amount3 ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.mode ?? params.param2, 0, 1, 0);
    param3 = clampNumber(params.speed ?? params.param3, 0, 3, 1);
    param4 = 0; param5 = 0;
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'optical-flow-datamosh') {
    amount = clampNumber(options.amount ?? params.ofdmIntensity ?? params.amount, 0, 1, 0.7);
    param0 = clampNumber(params.ofdmMotionScale ?? params.param0, 0, 3, 1);
    param1 = clampNumber(params.ofdmPersistence ?? params.param1, 0, 1, 0.7);
    param2 = clampNumber(params.ofdmChromaSplit ?? params.param2, 0, 1, 0.3);
    param3 = clampNumber(params.ofdmBlockSize ?? params.param3, 2, 48, 12);
    param4 = clampNumber(params.ofdmFreeze ?? params.param4, 0, 1, 0);
    param5 = clampNumber(params.ofdmMode ?? params.param5, 0, 2, 0);
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'flow-field-trails') {
    amount = clampNumber(options.amount ?? params.fftTrailLength ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.fftFlowScale ?? params.param0, 0.5, 16, 4);
    param1 = clampNumber(params.fftSamples ?? params.param1, 4, 32, 24);
    param2 = clampNumber(params.fftSpeed ?? params.param2, 0, 3, 0.8);
    param3 = clampNumber(params.fftChromaSplit ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.fftContrast ?? params.param4, 0.1, 4, 1);
    param5 = clampNumber(params.fftMode ?? params.param5, 0, 2, 0);
    param6 = clampNumber(params.fftColorCycle ?? params.param6, 0, 1, 0);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'reaction-diffusion') {
    amount = clampNumber(options.amount ?? params.rdMix ?? params.amount, 0, 1, 0.6);
    param0 = clampNumber(params.rdPatternScale ?? params.param0, 0.1, 4, 1);
    param1 = clampNumber(params.rdLumaMask ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.rdMode ?? params.param2, 0, 2, 0);
    param3 = clampNumber(params.rdColorR ?? params.param3, 0, 1, 0.4);
    param4 = clampNumber(params.rdColorG ?? params.param4, 0, 1, 0.85);
    param5 = clampNumber(params.rdColorB ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.rdFeedRate ?? params.param6, 0, 0.2, 0.055);
    param7 = clampNumber(params.rdKillRate ?? params.param7, 0, 0.2, 0.062);
    param8 = clampNumber(params.rdDiffusionA ?? params.param8, 0.5, 1.5, 1);
    param9 = clampNumber(params.rdDiffusionB ?? params.param9, 0.2, 1, 0.5);
    param10 = clampNumber(params.rdReseed ?? params.param10, 0, 1, 0.3);
    param11 = 0;
  } else if (options.effect === 'feedback-zoom') {
    amount = clampNumber(options.amount ?? params.amount, 0, 1, 0.7);
    param0 = clampNumber(params.feedbackZoom ?? params.param0, 0.85, 1.15, 1.02);
    param1 = clampNumber(params.feedbackRotation ?? params.param1, -0.2, 0.2, 0.005);
    param2 = clampNumber(params.feedbackDecay ?? params.param2, 0, 1, 0.05);
    param3 = clampNumber(params.centerX ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.centerY ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.feedbackHueShift ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.feedbackMaskCenter ?? params.param6, 0, 1, 0);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'motion-trails') {
    amount = clampNumber(options.amount ?? params.motionTrailsLength ?? params.amount, 0, 1, 0.4);
    param0 = clampNumber(params.motionTrailsAngle ?? params.param0, 0, 360, 0);
    param1 = clampNumber(params.motionTrailsSamples ?? params.param1, 4, 32, 16);
    param2 = clampNumber(params.motionTrailsFalloff ?? params.param2, 0, 1, 0.5);
    param3 = clampNumber(params.motionTrailsChromaSplit ?? params.param3, 0, 1, 0.2);
    param4 = clampNumber(params.motionTrailsMode ?? params.param4, 0, 2, 0);
    param5 = 0;
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'echo-repeat') {
    amount = clampNumber(options.amount ?? params.echoDecay ?? params.amount, 0.05, 0.95, 0.7);
    param0 = clampNumber(params.echoCount ?? params.param0, 2, 12, 5);
    param1 = clampNumber(params.echoOffsetX ?? params.param1, -0.3, 0.3, 0.05);
    param2 = clampNumber(params.echoOffsetY ?? params.param2, -0.3, 0.3, 0.05);
    param3 = clampNumber(params.echoHueShift ?? params.param3, 0, 1, 0.02);
    param4 = clampNumber(params.echoMode ?? params.param4, 0, 2, 0);
    param5 = 0;
    param6 = 0; param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'light-paint') {
    amount = clampNumber(options.amount ?? params.lightPaintIntensity ?? params.amount, 0, 2, 0.7);
    param0 = clampNumber(params.lightPaintThreshold ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.lightPaintTrailLength ?? params.param1, 0, 1, 0.4);
    param2 = clampNumber(params.lightPaintFlowAngle ?? params.param2, 0, 360, 0);
    param3 = clampNumber(params.lightPaintFlowScale ?? params.param3, 0.5, 16, 6);
    param4 = clampNumber(params.lightPaintChromaShift ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.lightPaintTintR ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.lightPaintTintG ?? params.param6, 0, 1, 0.8);
    param7 = clampNumber(params.lightPaintTintB ?? params.param7, 0, 1, 0.3);
    param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  } else if (options.effect === 'binary-code') {
    // effectUX vocabulary (bin*): density/speed/cell/contrast/bgMix/colorRGB.
    param0 = clampNumber(params.binDensity ?? params.param0, 0, 1, 0.7);
    param1 = clampNumber(params.binSpeed ?? params.param1, 0, 3, 0.5);
    param2 = clampNumber(params.binCellSize ?? params.param2, 6, 32, 12);
    param3 = clampNumber(params.binContrast ?? params.param3, 0, 2, 1);
    param4 = clampNumber(params.binBgMix ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.binColorR ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.binColorG ?? params.param6, 0, 1, 1);
    param7 = clampNumber(params.binColorB ?? params.param7, 0, 1, 0.3);
  } else if (options.effect === 'matrix-rain') {
    // effectUX vocabulary (matrix*).
    param0 = clampNumber(params.matrixDensity ?? params.param0, 0, 1, 0.6);
    param1 = clampNumber(params.matrixSpeed ?? params.param1, 0, 3, 1);
    param2 = clampNumber(params.matrixCellSize ?? params.param2, 6, 32, 14);
    param3 = clampNumber(params.matrixTrailLength ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.matrixBgMix ?? params.param4, 0, 1, 0.5);
    param5 = clampNumber(params.matrixColorR ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.matrixColorG ?? params.param6, 0, 1, 1);
    param7 = clampNumber(params.matrixColorB ?? params.param7, 0, 1, 0.4);
  } else if (options.effect === 'dot-matrix') {
    // effectUX vocabulary (dm*).
    param0 = clampNumber(params.dmDotShape ?? params.param0, 0, 2, 0);
    param1 = clampNumber(params.dmDotSize ?? params.param1, 4, 32, 12);
    param2 = clampNumber(params.dmGap ?? params.param2, 0, 1, 0.2);
    param3 = clampNumber(params.dmPosterize ?? params.param3, 1, 8, 4);
    param4 = clampNumber(params.dmGlow ?? params.param4, 0, 1, 0.4);
    param5 = clampNumber(params.dmBgR ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.dmBgG ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.dmBgB ?? params.param7, 0, 1, 0);
  } else if (options.effect === 'block-mosaic') {
    // effectUX vocabulary (mosaic*).
    param0 = clampNumber(params.mosaicMode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.mosaicTileSize ?? params.param1, 8, 64, 24);
    param2 = clampNumber(params.mosaicGrout ?? params.param2, 0, 1, 0.15);
    param3 = clampNumber(params.mosaicColorJitter ?? params.param3, 0, 1, 0.1);
    param4 = clampNumber(params.mosaicGroutR ?? params.param4, 0, 1, 0.1);
    param5 = clampNumber(params.mosaicGroutG ?? params.param5, 0, 1, 0.1);
    param6 = clampNumber(params.mosaicGroutB ?? params.param6, 0, 1, 0.1);
  } else if (options.effect === 'geometric-tile') {
    // effectUX vocabulary (geom*).
    param0 = clampNumber(params.geomMode ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.geomTiles ?? params.param1, 1, 16, 4);
    param2 = clampNumber(params.geomRotation ?? params.param2, 0, 360, 90);
    param3 = clampNumber(params.geomOffsetX ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.geomMix ?? params.param4, 0, 1, 1);
  } else if (options.effect === 'comic-ink') {
    // effectUX vocabulary (comicInk*); ink strength folds into amount.
    amount = clampNumber(options.amount ?? params.comicInkStrength ?? params.amount, 0, 3, 1.2);
    param0 = clampNumber(params.comicInkThreshold ?? params.threshold ?? params.param0, 0, 1, 0.3);
    param1 = clampNumber(params.comicInkPosterize ?? params.param1, 2, 12, 5);
    param2 = clampNumber(params.comicInkHalftone ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.comicInkHalftoneSize ?? params.param3, 2, 16, 6);
    param4 = clampNumber(params.comicInkColorMix ?? params.colorMix ?? params.param4, 0, 1, 0.3);
    param5 = clampNumber(params.comicInkR ?? params.param5, 0, 1, 0);
    param6 = clampNumber(params.comicInkG ?? params.param6, 0, 1, 0);
    param7 = clampNumber(params.comicInkB ?? params.param7, 0, 1, 0);
  } else if (options.effect === 'watercolor') {
    // effectUX vocabulary (watercolor*); pigment bleed folds into amount.
    amount = clampNumber(options.amount ?? params.watercolorBleed ?? params.amount, 0, 1.5, 0.5);
    param0 = clampNumber(params.watercolorEdgeDarken ?? params.param0, 0, 1, 0.5);
    param1 = clampNumber(params.watercolorWetness ?? params.param1, 0, 1, 0.3);
    param2 = clampNumber(params.watercolorGranulation ?? params.param2, 0, 1, 0.2);
    param3 = clampNumber(params.watercolorPaperTexture ?? params.param3, 0, 1, 0.4);
    param4 = clampNumber(params.watercolorPaperScale ?? params.param4, 1, 32, 8);
    param5 = clampNumber(params.watercolorPaperHue ?? params.param5, 0, 2, 0);
  } else if (options.effect === 'oil-paint') {
    // effectUX vocabulary (oilPaint*); brush radius folds into amount.
    amount = clampNumber(options.amount ?? params.oilPaintRadius ?? params.radius ?? params.amount, 1, 8, 4);
    param0 = clampNumber(params.oilPaintIntensity ?? params.param0, 4, 24, 12);
    param1 = clampNumber(params.oilPaintBrushLength ?? params.param1, 0, 2, 0.6);
    param2 = clampNumber(params.oilPaintBristle ?? params.param2, 0, 1, 0.4);
    param3 = clampNumber(params.oilPaintColorPunch ?? params.param3, 0, 1, 0.3);
    param4 = clampNumber(params.oilPaintHighlight ?? params.param4, 0, 1, 0.2);
    param5 = clampNumber(params.oilPaintMode ?? params.mode ?? params.param5, 0, 1, 0);
  } else if (options.effect === 'noise') {
    // effectUX vocabulary (noise*).
    amount = clampNumber(options.amount ?? params.noiseAmount ?? params.amount, 0, 1, 0.2);
    param0 = clampNumber(params.noiseType ?? params.param0, 0, 4, 0);
    param1 = clampNumber(params.noiseMode ?? params.param1, 0, 4, 0);
    param2 = clampNumber(params.noiseScale ?? params.scale ?? params.param2, 0.5, 32, 1);
    param3 = clampNumber(params.noiseMono ?? params.param3, 0, 1, 0);
    param4 = clampNumber(params.noiseShadow ?? params.param4, 0, 1, 1);
    param5 = clampNumber(params.noiseMid ?? params.param5, 0, 1, 1);
    param6 = clampNumber(params.noiseHigh ?? params.param6, 0, 1, 1);
    param7 = clampNumber(params.noiseAnimSpeed ?? params.param7, 0, 2, 1);
    param8 = clampNumber(params.seed ?? params.param8, -100000, 100000, 0);
  } else if (options.effect === 'thermal-contour') {
    // effectUX vocabulary (tc*); tcIntensity folds into amount, tcMix into mix.
    amount = clampNumber(options.amount ?? params.tcIntensity ?? params.amount, 0, 2, 1);
    mix = clampNumber(params.tcMix ?? options.mix, 0, 1, 0.85);
    param0 = clampNumber(params.tcPalette ?? params.param0, 0, 3, 0);
    param1 = clampNumber(params.tcContourCount ?? params.param1, 1, 12, 8);
    param2 = clampNumber(params.tcContourWidth ?? params.param2, 0.001, 0.02, 0.005);
    param3 = clampNumber(params.tcContourGlow ?? params.param3, 0, 1, 0.5);
    param4 = clampNumber(params.tcTrackBlobs ?? params.param4, 0, 1, 0.4);
    param5 = 0;
    param6 = 0;
    param7 = 0;
  } else if (options.effect === 'gamma') {
    param0 = clampNumber(params.gammaShadows ?? params.param0, 0.2, 3, 1);
    param1 = clampNumber(params.gammaMids ?? params.param1, 0.2, 3, 1);
    param2 = clampNumber(params.gammaHighlights ?? params.param2, 0.2, 3, 1);
    param3 = clampNumber(params.gammaMix ?? params.param3, 0, 1, 1);
    param4 = 0; param5 = 0; param6 = 0; param7 = 0;
  } else if (options.effect === 'invert') {
    param0 = clampNumber(params.invertMode ?? params.param0, 0, 4, 0);
    param1 = clampNumber(params.invertThreshold ?? params.param1, 0, 1, 0.5);
    param2 = clampNumber(params.invertStrobeRate ?? params.param2, 0, 10, 4);
    param3 = 0; param4 = 0; param5 = 0; param6 = 0; param7 = 0;
  } else if (options.effect === 'posterize') {
    param0 = clampNumber(params.posterizeDither ?? params.param0, 0, 1, 0);
    param1 = clampNumber(params.posterizeAnimSpeed ?? params.param1, 0, 2, 0);
    param2 = clampNumber(params.posterizePalette ?? params.param2, 0, 3, 0);
    param3 = 0; param4 = 0; param5 = 0; param6 = 0; param7 = 0;
  } else if (options.effect === 'recursive-echo') {
    amount = clampNumber(options.amount ?? params.recEchoOpacity ?? params.amount, 0.05, 0.95, 0.6);
    param0 = clampNumber(params.recEchoDepth ?? params.param0, 2, 16, 5);
    param1 = clampNumber(params.recEchoZoom ?? params.param1, 0.7, 1.1, 0.95);
    param2 = clampNumber(params.recEchoRotation ?? params.param2, -180, 180, 5);
    param3 = clampNumber(params.recEchoHueShift ?? params.param3, 0, 1, 0.05);
    param4 = clampNumber(params.recEchoOffsetX ?? params.param4, -0.3, 0.3, 0.02);
    param5 = clampNumber(params.recEchoOffsetY ?? params.param5, -0.3, 0.3, 0.02);
    param6 = clampNumber(params.recEchoMode ?? params.param6, 0, 2, 0);
    param7 = 0; param8 = 0; param9 = 0; param10 = 0; param11 = 0;
  }
  return [
    width,
    height,
    time,
    frameDelta,
    manifest.code,
    amount,
    mix,
    frameIndex,
    param0,
    param1,
    param2,
    param3,
    param4,
    param5,
    param6,
    param7,
    param8,
    param9,
    param10,
    param11,
    param12,
    param13,
    param14,
    param15,
  ];
}

function buildNativeEffectPassRenderPass(
  options: NativeEffectPassOptions,
  manifest: NativeEffectPassManifestEntry,
  uniformId: string,
  nameSuffix = '',
): Record<string, unknown> {
  return {
    name: `effect-pass-${manifest.id}${nameSuffix}`,
    shader_id: NATIVE_EFFECT_PASS_SHADER_ID,
    target: 'source_frame',
    source_id: options.targetSourceId,
    seq: Math.max(0, Math.round(options.seq ?? options.frameIndex ?? 0)),
    vertex_entry: 'vs_full',
    fragment_entry: 'fs_effect',
    vertex_count: 3,
    instance_count: 1,
    clear: options.clear ?? true,
    clear_color: [0, 0, 0, 0],
    blend: 'replace',
    bindings: [
      { binding: 0, kind: 'source-frame-texture', source_id: options.sourceId },
      { binding: 1, kind: 'source-frame-sampler' },
      { binding: 2, resource: uniformId, kind: 'uniform' },
    ],
  };
}

export function buildNativeEffectPassGraph(options: NativeEffectPassOptions): NativeEffectPassGraph {
  const manifest = nativeEffectPassManifestEntry(options.effect);
  const targetSourceId = options.targetSourceId || `${options.sourceId}:effect:${options.effect}`;
  const safeTarget = safeGraphId(targetSourceId);
  const uniformId = `effect-pass:${safeTarget}:uniform`;
  const renderOptions = { ...options, targetSourceId };
  return {
    effect: manifest.id,
    config: {
      buffers: [{
        id: uniformId,
        kind: 'uniform',
        byte_length: 96,
        initial_f32: packNativeEffectPassUniforms(options),
      }],
      passes: [],
      readbacks: [],
      render_passes: [buildNativeEffectPassRenderPass(renderOptions, manifest, uniformId)],
    },
  };
}

export function buildNativeEffectPassChainGraph(options: NativeEffectPassChainOptions): NativeEffectPassGraph {
  const effects = options.effects.filter((effect) => effect && NATIVE_EFFECT_PASS_BY_ID.has(effect.effect));
  if (!effects.length) {
    throw new Error('Native effect-pass chain requires at least one supported effect');
  }
  if (effects.length === 1) {
    return buildNativeEffectPassGraph({
      ...options,
      effect: effects[0].effect,
      amount: effects[0].amount,
      mix: effects[0].mix,
      params: effects[0].params,
    });
  }

  const buffers: Array<Record<string, unknown>> = [];
  const renderPasses: Array<Record<string, unknown>> = [];
  const finalTargetSourceId = options.targetSourceId || `${options.sourceId}:effect:${effects[effects.length - 1].effect}`;
  const safeFinalTarget = safeGraphId(finalTargetSourceId);
  const intermediatePrefix = safeGraphId(options.intermediatePrefix || `${finalTargetSourceId}:chain`);
  let currentSourceId = options.sourceId;

  effects.forEach((effect, index) => {
    const manifest = nativeEffectPassManifestEntry(effect.effect);
    const targetSourceId = index === effects.length - 1
      ? finalTargetSourceId
      : `${intermediatePrefix}:step:${index % 2}`;
    const uniformId = `effect-pass:${safeFinalTarget}:pass:${index}:uniform`;
    const passOptions: NativeEffectPassOptions = {
      ...options,
      sourceId: currentSourceId,
      targetSourceId,
      effect: effect.effect,
      amount: effect.amount,
      mix: effect.mix,
      params: effect.params,
      seq: Math.max(0, Math.round(options.seq ?? options.frameIndex ?? 0)) + index,
    };
    buffers.push({
      id: uniformId,
      kind: 'uniform',
      byte_length: 96,
      initial_f32: packNativeEffectPassUniforms(passOptions),
    });
    renderPasses.push(buildNativeEffectPassRenderPass(passOptions, manifest, uniformId, `-${index + 1}`));
    currentSourceId = targetSourceId;
  });

  return {
    effect: effects[0].effect,
    effects: effects.map((effect) => effect.effect),
    config: {
      buffers,
      passes: [],
      readbacks: [],
      render_passes: renderPasses,
    },
  };
}
