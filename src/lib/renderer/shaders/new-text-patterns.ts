// ============================================================================
// NEW TEXT PATTERN SHADERS
// 10 standalone GLSL fragment shaders for stylistic image rendering
// ============================================================================

// ============================================================================
// 1. BRAILLE PATTERN SHADER - Renders image as braille-like dot patterns
// ============================================================================
export const braillePatternShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Cell size in pixels: range from 4 to 32 pixels
    float cellPixels = mix(4.0, 32.0, uAmount);
    // Dot radius ratio within subcell: 0.1 to 0.45
    float dotRadius = mix(0.1, 0.45, uAmount2);
    // Color mix: 0 = monochrome, 1 = full source color
    float colorMix = uAmount3;

    vec2 fragCoord = vUv * uResolution;

    // Braille cell is 2 columns x 4 rows of dots
    float cellW = cellPixels;
    float cellH = cellPixels * 2.0; // 4 rows vs 2 cols -> taller cell

    // Which cell are we in
    vec2 cellIndex = floor(fragCoord / vec2(cellW, cellH));
    // Position within cell, normalized 0..1
    vec2 cellPos = fract(fragCoord / vec2(cellW, cellH));

    // Subcell: 2 cols, 4 rows
    vec2 subIndex = floor(cellPos * vec2(2.0, 4.0));
    vec2 subPos = fract(cellPos * vec2(2.0, 4.0));

    // Sample source at center of each subcell
    vec2 subCenterUV = (cellIndex * vec2(cellW, cellH) + (subIndex + 0.5) * vec2(cellW / 2.0, cellH / 4.0)) / uResolution;
    subCenterUV = clamp(subCenterUV, 0.0, 1.0);
    vec4 subSample = texture2D(uTexture, subCenterUV);
    float subLuma = luma(subSample.rgb);

    // Sample source at cell center for overall color
    vec2 cellCenterUV = (cellIndex + 0.5) * vec2(cellW, cellH) / uResolution;
    cellCenterUV = clamp(cellCenterUV, 0.0, 1.0);
    vec4 cellSample = texture2D(uTexture, cellCenterUV);

    // Dot active if luminance exceeds threshold
    float active = step(uThreshold, subLuma);

    // Distance from subcell center
    vec2 d = subPos - 0.5;
    float dist = length(d);

    // Anti-aliased dot
    float pixelSize = 1.0 / (cellW * 0.5); // approximate pixel size in subcell space
    float dot = 1.0 - smoothstep(dotRadius - pixelSize, dotRadius + pixelSize, dist);
    dot *= active;

    // Background color (dark)
    vec3 bgColor = vec3(0.02);
    // Dot color: blend between white and source color
    vec3 dotColor = mix(vec3(1.0), cellSample.rgb, colorMix);
    // Modulate dot brightness by luminance
    dotColor *= mix(0.5, 1.0, subLuma);

    vec3 finalColor = mix(bgColor, dotColor, dot);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 2. CIRCUIT BOARD SHADER - Renders as PCB-style traces
// ============================================================================
export const circuitBoardShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Grid density: 6 to 60 cells across
    float gridCount = mix(6.0, 60.0, uAmount);
    // Trace thickness in cell-space: 0.02 to 0.2
    float traceThick = mix(0.02, 0.2, uAmount2);
    // Glow intensity
    float glowInt = mix(0.0, 2.0, uAmount3);

    vec2 uv = vUv;
    vec4 src = texture2D(uTexture, uv);
    float srcLuma = luma(src.rgb);

    vec2 cellSize = vec2(1.0) / gridCount;
    vec2 cellIndex = floor(uv / cellSize);
    vec2 cellPos = fract(uv / cellSize);

    // Hash for this cell determines trace directions
    float h = hash(cellIndex);
    float h2 = hash(cellIndex + 73.0);
    float h3 = hash(cellIndex + 137.0);

    // Sample source at cell center
    vec2 cellCenterUV = (cellIndex + 0.5) * cellSize;
    vec4 cellSrc = texture2D(uTexture, cellCenterUV);
    float cellLuma = luma(cellSrc.rgb);

    // Trace presence based on luminance
    float tracePresence = smoothstep(uThreshold - 0.1, uThreshold + 0.1, cellLuma);

    // Draw traces: horizontal and vertical lines through cell
    float traceMask = 0.0;

    // Horizontal trace
    if (h > 0.3) {
        float dy = abs(cellPos.y - 0.5);
        traceMask = max(traceMask, 1.0 - smoothstep(traceThick * 0.5 - 0.005, traceThick * 0.5 + 0.005, dy));
    }
    // Vertical trace
    if (h2 > 0.3) {
        float dx = abs(cellPos.x - 0.5);
        traceMask = max(traceMask, 1.0 - smoothstep(traceThick * 0.5 - 0.005, traceThick * 0.5 + 0.005, dx));
    }

    // Node/pad at center
    float centerDist = length(cellPos - 0.5);
    float padRadius = traceThick * 1.2;
    float pad = 1.0 - smoothstep(padRadius - 0.01, padRadius + 0.01, centerDist);
    traceMask = max(traceMask, pad);

    // Corner connections: L-shaped turns
    if (h3 > 0.5) {
        float corner1 = abs(cellPos.x - 0.5) + abs(cellPos.y - 0.5);
        // Not a true L-bend, but suggests connectivity with a diagonal reject
    }

    traceMask *= tracePresence;

    // Glow effect: soft distance from traces
    float glowDist = 0.0;
    if (h > 0.3) {
        float dy = abs(cellPos.y - 0.5);
        glowDist = max(glowDist, exp(-dy * 8.0));
    }
    if (h2 > 0.3) {
        float dx = abs(cellPos.x - 0.5);
        glowDist = max(glowDist, exp(-dx * 8.0));
    }
    glowDist *= tracePresence;

    // PCB background color (dark green)
    vec3 pcbBg = vec3(0.0, 0.05, 0.02);
    // Trace color from source
    vec3 traceColor = mix(vec3(0.7, 0.85, 0.3), cellSrc.rgb, 0.5);
    // Glow color
    vec3 glowColor = traceColor * glowInt * 0.3;

    vec3 finalColor = pcbBg;
    finalColor += glowColor * glowDist;
    finalColor = mix(finalColor, traceColor, traceMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 3. STAINED GLASS SHADER - Voronoi cells with dark "lead" borders
// ============================================================================
export const stainedGlassShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 hashVec2(vec2 p) {
    return vec2(hash(p), hash(p + vec2(37.0, 91.0)));
}

void main() {
    // Cell count: 5 to 50 across
    float cellCount = mix(5.0, 50.0, uAmount);
    // Lead thickness: 0.01 to 0.15 in cell-space
    float leadThick = mix(0.01, 0.15, uAmount2);
    // Saturation boost: 0 to 1.5
    float satBoost = mix(0.0, 1.5, uAmount3);

    vec2 uv = vUv;
    vec2 scaledUV = uv * cellCount;
    vec2 cellBase = floor(scaledUV);

    float minDist = 10.0;
    float secondDist = 10.0;
    vec2 closestCell = vec2(0.0);

    // Search 3x3 neighborhood
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = cellBase + vec2(float(x), float(y));
            vec2 point = neighbor + hashVec2(neighbor);
            float d = length(scaledUV - point);
            if (d < minDist) {
                secondDist = minDist;
                minDist = d;
                closestCell = neighbor;
            } else if (d < secondDist) {
                secondDist = d;
            }
        }
    }

    // Edge distance (difference between closest and second closest)
    float edge = secondDist - minDist;

    // Sample source at closest cell center
    vec2 cellCenter = (closestCell + hashVec2(closestCell)) / cellCount;
    cellCenter = clamp(cellCenter, 0.0, 1.0);
    vec4 src = texture2D(uTexture, cellCenter);

    // Boost saturation
    float l = luma(src.rgb);
    vec3 saturated = mix(vec3(l), src.rgb, 1.0 + satBoost);
    saturated = max(saturated, 0.0);

    // Slight brightness boost for stained glass glow
    saturated *= 1.1;

    // Lead border
    float leadMask = 1.0 - smoothstep(leadThick - 0.02, leadThick + 0.02, edge);
    vec3 leadColor = vec3(0.02);

    vec3 finalColor = mix(saturated, leadColor, leadMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 4. WOVEN FABRIC SHADER - Interlocking horizontal/vertical threads
// ============================================================================
export const wovenFabricShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Thread density: 10 to 80 threads across
    float threadCount = mix(10.0, 80.0, uAmount);
    // Thread width ratio within cell: 0.3 to 0.95
    float threadWidth = mix(0.3, 0.95, uAmount2);
    // Shadow depth: 0 to 0.6
    float shadowDepth = mix(0.0, 0.6, uAmount3);

    vec2 uv = vUv;
    vec2 scaled = uv * threadCount;
    vec2 cellIndex = floor(scaled);
    vec2 cellPos = fract(scaled);

    // Determine weave pattern: checkerboard for over/under
    float checker = mod(cellIndex.x + cellIndex.y, 2.0);

    // Thread masks
    float halfWidth = threadWidth * 0.5;

    // Warp thread (vertical): centered horizontally in cell
    float warpDist = abs(cellPos.x - 0.5);
    float warpMask = 1.0 - smoothstep(halfWidth - 0.02, halfWidth + 0.02, warpDist);

    // Weft thread (horizontal): centered vertically in cell
    float weftDist = abs(cellPos.y - 0.5);
    float weftMask = 1.0 - smoothstep(halfWidth - 0.02, halfWidth + 0.02, weftDist);

    // Sample source colors for each thread direction
    vec2 warpUV = vec2((cellIndex.x + 0.5) / threadCount, uv.y);
    vec2 weftUV = vec2(uv.x, (cellIndex.y + 0.5) / threadCount);
    warpUV = clamp(warpUV, 0.0, 1.0);
    weftUV = clamp(weftUV, 0.0, 1.0);

    vec3 warpColor = texture2D(uTexture, warpUV).rgb;
    vec3 weftColor = texture2D(uTexture, weftUV).rgb;

    // Thread shading: rounded cross-section
    float warpShade = 1.0 - warpDist * warpDist * 4.0;
    float weftShade = 1.0 - weftDist * weftDist * 4.0;
    warpShade = clamp(warpShade, 0.3, 1.0);
    weftShade = clamp(weftShade, 0.3, 1.0);

    warpColor *= warpShade;
    weftColor *= weftShade;

    // Over/under logic
    // checker == 0: warp is on top; checker == 1: weft is on top
    vec3 bgColor = vec3(0.03); // dark gap between threads
    vec3 result = bgColor;

    // Shadow on the thread that goes under
    float shadow = 1.0 - shadowDepth;

    if (checker < 0.5) {
        // Warp on top: draw weft first (underneath), then warp
        if (weftMask > 0.0) {
            result = mix(result, weftColor * shadow, weftMask);
        }
        if (warpMask > 0.0) {
            result = mix(result, warpColor, warpMask);
        }
    } else {
        // Weft on top: draw warp first (underneath), then weft
        if (warpMask > 0.0) {
            result = mix(result, warpColor * shadow, warpMask);
        }
        if (weftMask > 0.0) {
            result = mix(result, weftColor, weftMask);
        }
    }

    gl_FragColor = vec4(result, 1.0);
}
`;

// ============================================================================
// 5. MOSAIC TILE SHADER - Irregular shaped tiles with grout lines
// ============================================================================
export const mosaicTileShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Tile size: 5 to 60 tiles across
    float tileCount = mix(5.0, 60.0, uAmount);
    // Grout width: 0.01 to 0.15 in tile-space
    float groutWidth = mix(0.01, 0.15, uAmount2);
    // Rotation randomness: 0 to 0.5 radians
    float rotRand = mix(0.0, 0.5, uAmount3);

    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    vec2 scaled = uv * vec2(tileCount * aspect, tileCount);

    // Offset every other row for brick-like pattern
    vec2 cellIndex = floor(scaled);
    float rowOffset = mod(cellIndex.y, 2.0) * 0.5;
    scaled.x += rowOffset;
    cellIndex = floor(scaled);
    vec2 cellPos = fract(scaled);

    // Random rotation per tile
    float angle = (hash(cellIndex) - 0.5) * 2.0 * rotRand;
    float ca = cos(angle);
    float sa = sin(angle);
    vec2 rotatedPos = vec2(
        ca * (cellPos.x - 0.5) - sa * (cellPos.y - 0.5) + 0.5,
        sa * (cellPos.x - 0.5) + ca * (cellPos.y - 0.5) + 0.5
    );

    // Random size variation per tile
    float sizeVar = 0.85 + 0.15 * hash(cellIndex + 41.0);

    // Tile shape: rounded rectangle with slight variation
    vec2 tileDist = abs(rotatedPos - 0.5) / (0.5 * sizeVar);
    // Superellipse-ish distance for more interesting tile shape
    float roundness = 0.08;
    float tileEdge = max(tileDist.x, tileDist.y);
    // Smooth rounded corners
    float cornerDist = length(max(tileDist - vec2(1.0 - roundness), 0.0));
    float tileMask = tileEdge + cornerDist * 0.5;

    // Grout: border region
    float groutHalf = groutWidth * 0.5;
    float groutMask = smoothstep(1.0 - groutHalf - 0.02, 1.0 - groutHalf, tileMask);

    // Sample source at tile center
    vec2 tileCenterScaled = cellIndex + 0.5;
    tileCenterScaled.x -= rowOffset;
    vec2 tileCenterUV = tileCenterScaled / vec2(tileCount * aspect, tileCount);
    tileCenterUV = clamp(tileCenterUV, 0.0, 1.0);
    vec4 src = texture2D(uTexture, tileCenterUV);

    // Slight color variation per tile
    float colorVar = 0.9 + 0.1 * hash(cellIndex + 200.0);
    vec3 tileColor = src.rgb * colorVar;

    // Subtle shading: darken edges of tile
    float edgeShade = 1.0 - tileMask * 0.15;
    tileColor *= edgeShade;

    // Grout color
    vec3 groutColor = vec3(0.12, 0.11, 0.10);

    vec3 finalColor = mix(tileColor, groutColor, groutMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 6. NEON OUTLINE SHADER - Glowing neon edge detection
// ============================================================================
export const neonOutlineShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float sampleLuma(vec2 uv) {
    return luma(texture2D(uTexture, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
    // Edge sensitivity: 0.5 to 5.0
    float sensitivity = mix(0.5, 5.0, uAmount);
    // Glow spread: 1 to 8 pixels
    float glowSpread = mix(1.0, 8.0, uAmount2);
    // Glow intensity: 0.5 to 3.0
    float glowIntensity = mix(0.5, 3.0, uAmount3);

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;

    // Sobel edge detection
    float tl = sampleLuma(uv + vec2(-texel.x, -texel.y));
    float tc = sampleLuma(uv + vec2(0.0,     -texel.y));
    float tr = sampleLuma(uv + vec2( texel.x, -texel.y));
    float ml = sampleLuma(uv + vec2(-texel.x,  0.0));
    float mr = sampleLuma(uv + vec2( texel.x,  0.0));
    float bl = sampleLuma(uv + vec2(-texel.x,  texel.y));
    float bc = sampleLuma(uv + vec2(0.0,      texel.y));
    float br = sampleLuma(uv + vec2( texel.x,  texel.y));

    float sobelX = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
    float sobelY = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
    float edge = length(vec2(sobelX, sobelY)) * sensitivity;
    edge = clamp(edge, 0.0, 1.0);

    // Multi-sample glow: blur the edge for bloom effect
    float glow = 0.0;
    float totalWeight = 0.0;
    for (int i = -4; i <= 4; i++) {
        for (int j = -4; j <= 4; j++) {
            vec2 offset = vec2(float(i), float(j)) * texel * glowSpread;
            vec2 sampleUV = uv + offset;

            // Compute edge at this offset
            float stl = sampleLuma(sampleUV + vec2(-texel.x, -texel.y));
            float stc = sampleLuma(sampleUV + vec2(0.0,     -texel.y));
            float str2 = sampleLuma(sampleUV + vec2( texel.x, -texel.y));
            float sml = sampleLuma(sampleUV + vec2(-texel.x,  0.0));
            float smr = sampleLuma(sampleUV + vec2( texel.x,  0.0));
            float sbl = sampleLuma(sampleUV + vec2(-texel.x,  texel.y));
            float sbc = sampleLuma(sampleUV + vec2(0.0,      texel.y));
            float sbr = sampleLuma(sampleUV + vec2( texel.x,  texel.y));

            float sx = -stl - 2.0*sml - sbl + str2 + 2.0*smr + sbr;
            float sy = -stl - 2.0*stc - str2 + sbl + 2.0*sbc + sbr;
            float se = length(vec2(sx, sy)) * sensitivity;
            se = clamp(se, 0.0, 1.0);

            float w = exp(-float(i*i + j*j) / (glowSpread * glowSpread * 0.5));
            glow += se * w;
            totalWeight += w;
        }
    }
    glow /= totalWeight;

    // Neon color: use uColor as base tint
    vec3 neonBase = length(uColor) > 0.01 ? uColor : vec3(0.2, 0.6, 1.0);
    // Slight hue shift for outer glow
    vec3 neonOuter = neonBase * vec3(1.2, 0.8, 1.0);

    // Dark background
    vec3 bgColor = vec3(0.01);

    // Compose: sharp edge + soft glow
    vec3 finalColor = bgColor;
    finalColor += neonOuter * glow * glowIntensity * 0.5;
    finalColor += neonBase * edge * glowIntensity;

    // White core on strong edges
    float core = smoothstep(0.6, 0.9, edge);
    finalColor += vec3(1.0) * core * 0.5;

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 7. PIXEL SORT SHADER - Simulates pixel sorting effect
// ============================================================================
export const pixelSortShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Sort distance: 0 to 60 pixels
    float sortDist = mix(0.0, 60.0, uAmount);
    // Luminance threshold for which pixels get sorted
    float sortThresh = mix(0.0, 1.0, uAmount2);
    // Chromatic separation: 0 to 5 pixels
    float chromSep = mix(0.0, 5.0, uAmount3);

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;

    // Sample current pixel
    vec4 src = texture2D(uTexture, uv);
    float srcLuma = luma(src.rgb);

    // Determine if this pixel should participate in sorting
    float sortActive = step(sortThresh, srcLuma);

    // Vertical pixel sorting simulation:
    // Look upward for brighter pixels that would "sort" down to this position
    vec3 sortedR = src.rgb;
    vec3 sortedG = src.rgb;
    vec3 sortedB = src.rgb;

    float maxSteps = min(sortDist, 60.0);
    int steps = int(maxSteps);

    // Find the brightest pixel above that exceeds threshold
    float bestLuma = srcLuma;
    vec3 bestColor = src.rgb;

    for (int i = 1; i <= 60; i++) {
        if (float(i) > maxSteps) break;

        float fi = float(i);
        vec2 upUV = uv - vec2(0.0, fi * texel.y);
        if (upUV.y < 0.0) break;

        vec4 upSample = texture2D(uTexture, upUV);
        float upLuma = luma(upSample.rgb);

        // Only sort bright pixels
        if (upLuma > sortThresh && upLuma > bestLuma) {
            bestLuma = upLuma;
            bestColor = upSample.rgb;
        }
    }

    // Blend sorted result based on activity
    float sortStrength = sortActive * smoothstep(sortThresh, sortThresh + 0.1, srcLuma);
    vec3 sorted = mix(src.rgb, bestColor, sortStrength * 0.6);

    // Chromatic separation on sorted pixels
    float chromOffset = chromSep * texel.y * sortStrength;
    float rChannel = texture2D(uTexture, uv - vec2(0.0, chromOffset)).r;
    float gChannel = sorted.g;
    float bChannel = texture2D(uTexture, uv + vec2(0.0, chromOffset)).b;

    // Vertical streak effect: elongate bright areas
    float streak = 0.0;
    for (int i = 1; i <= 60; i++) {
        if (float(i) > maxSteps * 0.5) break;
        vec2 aboveUV = uv - vec2(0.0, float(i) * texel.y);
        if (aboveUV.y < 0.0) break;
        float aboveLuma = luma(texture2D(uTexture, aboveUV).rgb);
        if (aboveLuma > sortThresh) {
            float falloff = 1.0 - float(i) / (maxSteps * 0.5);
            streak = max(streak, aboveLuma * falloff * 0.3);
        }
    }

    vec3 finalColor = vec3(rChannel, gChannel, bChannel);
    finalColor += vec3(streak) * sortStrength;

    // Mix with original based on how much sorting is active
    finalColor = mix(src.rgb, finalColor, sortActive * 0.8 + 0.2);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 8. LINOCUT SHADER - Woodcut/linocut print aesthetic
// ============================================================================
export const linocutShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float sampleLuma(vec2 uv) {
    return luma(texture2D(uTexture, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
    // Detail level: blur radius 0 to 4 pixels
    float detail = mix(0.0, 4.0, 1.0 - uAmount);
    // Groove spacing: 2 to 12 pixels
    float grooveSpacing = mix(2.0, 12.0, uAmount2);
    // Ink intensity: 0.3 to 1.0
    float inkIntensity = mix(0.3, 1.0, uAmount3);

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;
    vec2 fragCoord = uv * uResolution;

    // Pre-blur for detail control
    vec3 blurred = vec3(0.0);
    float blurTotal = 0.0;
    int blurRadius = int(detail);
    for (int i = -4; i <= 4; i++) {
        for (int j = -4; j <= 4; j++) {
            if (abs(i) > blurRadius || abs(j) > blurRadius) continue;
            float w = exp(-float(i*i + j*j) / max(detail * detail * 0.5, 0.1));
            blurred += texture2D(uTexture, uv + vec2(float(i), float(j)) * texel).rgb * w;
            blurTotal += w;
        }
    }
    blurred /= blurTotal;
    float l = luma(blurred);

    // Edge detection for groove direction
    float gx = sampleLuma(uv + vec2(texel.x, 0.0)) - sampleLuma(uv - vec2(texel.x, 0.0));
    float gy = sampleLuma(uv + vec2(0.0, texel.y)) - sampleLuma(uv - vec2(0.0, texel.y));
    float edgeMag = length(vec2(gx, gy));
    float edgeAngle = atan(gy, gx);

    // Groove pattern: lines that follow contour direction
    // Perpendicular to gradient = along the contour
    float contourAngle = edgeAngle + 1.5708; // + PI/2
    vec2 contourDir = vec2(cos(contourAngle), sin(contourAngle));

    // Project fragment position onto contour perpendicular direction
    vec2 grooveDir = vec2(cos(edgeAngle), sin(edgeAngle));
    float groovePhase = dot(fragCoord, grooveDir) / grooveSpacing;
    float grooveLine = abs(fract(groovePhase) - 0.5) * 2.0;

    // In dark areas, more grooves (more ink carved away reveals paper)
    // Actually in linocut: dark = ink, light = carved away (paper)
    // Grooves create texture in mid-tones
    float grooveMask = smoothstep(0.3, 0.5, grooveLine);

    // High contrast conversion
    float paperThresh = uThreshold;
    float inkMask = smoothstep(paperThresh + 0.1, paperThresh - 0.1, l);

    // In mid-tone areas, use groove pattern
    float midMask = 1.0 - abs(l - 0.5) * 2.0;
    midMask = clamp(midMask, 0.0, 1.0);

    // Combine: dark areas solid ink, mid areas grooved, light areas paper
    float finalInk = inkMask;
    // Add groove texture in mid-tones
    finalInk = mix(finalInk, finalInk * grooveMask, midMask * 0.5);

    // Edge enhancement
    float edgeBoost = smoothstep(0.02, 0.15, edgeMag);
    finalInk = max(finalInk, edgeBoost * 0.7);

    // Paper color (warm off-white)
    vec3 paperColor = vec3(0.92, 0.89, 0.82);
    // Ink color (near black)
    vec3 inkColor = vec3(0.05, 0.04, 0.06) * inkIntensity;

    // Add subtle paper texture
    float paperNoise = hash(fragCoord * 0.5) * 0.04;
    paperColor += paperNoise;

    vec3 finalColor = mix(paperColor, inkColor, finalInk);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 9. TOPO MAP SHADER - Topographic contour map lines
// ============================================================================
export const topoMapShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    // Contour density: 4 to 40 contour levels
    float contourLevels = mix(4.0, 40.0, uAmount);
    // Line thickness: 0.5 to 3.0 pixels
    float lineThick = mix(0.5, 3.0, uAmount2);
    // Color fill amount: 0 = monochrome, 1 = full source color
    float colorFill = uAmount3;

    vec2 uv = vUv;
    vec2 texel = 1.0 / uResolution;

    // Sample and slightly blur for smoother contours
    vec3 blurred = vec3(0.0);
    float total = 0.0;
    for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
            float w = exp(-float(i*i + j*j) * 0.5);
            blurred += texture2D(uTexture, uv + vec2(float(i), float(j)) * texel).rgb * w;
            total += w;
        }
    }
    blurred /= total;

    float elevation = luma(blurred);
    vec4 src = texture2D(uTexture, uv);

    // Quantize elevation to contour levels
    float quantized = floor(elevation * contourLevels) / contourLevels;
    float nextLevel = (floor(elevation * contourLevels) + 1.0) / contourLevels;

    // Gradient magnitude (slope) for adaptive line thickness
    float ex = luma(texture2D(uTexture, uv + vec2(texel.x, 0.0)).rgb);
    float wx = luma(texture2D(uTexture, uv - vec2(texel.x, 0.0)).rgb);
    float ey = luma(texture2D(uTexture, uv + vec2(0.0, texel.y)).rgb);
    float wy = luma(texture2D(uTexture, uv - vec2(0.0, texel.y)).rgb);
    float slope = length(vec2(ex - wx, ey - wy)) * 0.5 / texel.x;

    // Contour line: where elevation crosses a contour level
    float levelFract = fract(elevation * contourLevels);
    // Distance to nearest contour boundary (0 or 1 in fract space)
    float distToContour = min(levelFract, 1.0 - levelFract);

    // Convert to pixel-space distance (approximate)
    float slopePixels = max(slope, 0.001); // avoid division by zero
    float pixelDist = distToContour / (slopePixels * texel.x) * (1.0 / contourLevels);

    // Line mask with anti-aliasing; thinner on steep slopes
    float adaptiveThick = lineThick / max(slopePixels * 0.01, 0.5);
    adaptiveThick = clamp(adaptiveThick, 0.5, lineThick * 2.0);
    float lineMask = 1.0 - smoothstep(adaptiveThick * 0.5 - 0.5, adaptiveThick * 0.5 + 0.5, pixelDist);

    // Major contour lines (every 5th level) are thicker
    float majorLevel = floor(elevation * contourLevels / 5.0) * 5.0 / contourLevels;
    float majorFract = fract(elevation * contourLevels / 5.0);
    float majorDist = min(majorFract, 1.0 - majorFract);
    float majorPixelDist = majorDist / (slopePixels * texel.x) * (5.0 / contourLevels);
    float majorMask = 1.0 - smoothstep(adaptiveThick - 0.5, adaptiveThick + 0.5, majorPixelDist);
    lineMask = max(lineMask, majorMask);

    // Background: subtle elevation coloring
    // Topo map style: greens at low, yellows mid, browns high
    vec3 topoLow = vec3(0.75, 0.88, 0.70);  // green
    vec3 topoMid = vec3(0.92, 0.88, 0.65);  // yellow
    vec3 topoHigh = vec3(0.78, 0.65, 0.50); // brown

    vec3 topoColor;
    if (elevation < 0.5) {
        topoColor = mix(topoLow, topoMid, elevation * 2.0);
    } else {
        topoColor = mix(topoMid, topoHigh, (elevation - 0.5) * 2.0);
    }

    // Mix topo coloring with source color based on colorFill
    vec3 fillColor = mix(topoColor, src.rgb * 0.8 + topoColor * 0.2, colorFill);

    // Line color: use uColor if provided, else dark brown
    vec3 lineColor = length(uColor) > 0.01 ? uColor : vec3(0.25, 0.18, 0.12);

    vec3 finalColor = mix(fillColor, lineColor, lineMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// 10. LED WALL SHADER - LED display wall with RGB sub-elements
// ============================================================================
export const ledWallShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMode;
uniform float uAmount;
uniform float uAmount2;
uniform float uAmount3;
uniform float uThreshold;
uniform float uAngle;
uniform vec2 uCenter;
uniform vec3 uColor;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Rounded rectangle SDF
float roundedRect(vec2 p, vec2 halfSize, float radius) {
    vec2 d = abs(p) - halfSize + radius;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
    // LED size: 4 to 40 pixels per LED
    float ledPixels = mix(4.0, 40.0, uAmount);
    // Roundness: 0.0 (square) to 0.45 (very round)
    float roundness = mix(0.0, 0.45, uAmount2);
    // Bloom amount: 0 to 1
    float bloomAmt = uAmount3;

    vec2 fragCoord = vUv * uResolution;

    // LED grid
    vec2 ledIndex = floor(fragCoord / ledPixels);
    vec2 ledPos = fract(fragCoord / ledPixels); // 0..1 within LED cell

    // Sample source at LED center
    vec2 ledCenterUV = (ledIndex + 0.5) * ledPixels / uResolution;
    ledCenterUV = clamp(ledCenterUV, 0.0, 1.0);
    vec4 src = texture2D(uTexture, ledCenterUV);

    // LED outer shape (with gap)
    float gap = 0.08; // gap between LEDs
    vec2 ledHalfSize = vec2(0.5 - gap);
    float ledDist = roundedRect(ledPos - 0.5, ledHalfSize, roundness);
    float ledMask = 1.0 - smoothstep(-0.01, 0.01, ledDist);

    // RGB sub-pixel layout (3 vertical stripes within the LED)
    float subPixelWidth = (1.0 - gap * 2.0) / 3.0;
    float subGap = 0.01;

    // Position within the LED active area
    float localX = ledPos.x - gap;
    float ledWidth = 1.0 - gap * 2.0;

    float rStripe = 0.0;
    float gStripe = 0.0;
    float bStripe = 0.0;

    if (localX > 0.0 && localX < ledWidth) {
        float normalized = localX / ledWidth;
        // R sub-pixel: 0 to 0.333
        rStripe = smoothstep(0.0, subGap, normalized) * (1.0 - smoothstep(0.333 - subGap, 0.333, normalized));
        // G sub-pixel: 0.333 to 0.666
        gStripe = smoothstep(0.333, 0.333 + subGap, normalized) * (1.0 - smoothstep(0.666 - subGap, 0.666, normalized));
        // B sub-pixel: 0.666 to 1.0
        bStripe = smoothstep(0.666, 0.666 + subGap, normalized) * (1.0 - smoothstep(1.0 - subGap, 1.0, normalized));
    }

    // Each sub-pixel shows its respective channel boosted
    vec3 subPixelColor;
    subPixelColor.r = src.r * rStripe * 1.3;
    subPixelColor.g = src.g * gStripe * 1.3;
    subPixelColor.b = src.b * bStripe * 1.3;

    // Also add some base mixed color to avoid pure black between sub-pixels
    vec3 baseLedColor = src.rgb * 0.3;

    vec3 ledColor = (subPixelColor + baseLedColor) * ledMask;

    // Bloom/glow: soft glow around bright LEDs
    float brightness = luma(src.rgb);
    float glowDist = length(ledPos - 0.5);
    float glow = exp(-glowDist * glowDist * 8.0) * brightness * bloomAmt * 0.5;
    vec3 glowColor = src.rgb * glow;

    // Background (very dark, between LEDs)
    vec3 bgColor = vec3(0.01);

    vec3 finalColor = bgColor + ledColor + glowColor;

    // Clamp to prevent overblown highlights
    finalColor = min(finalColor, vec3(1.2));

    gl_FragColor = vec4(finalColor, 1.0);
}
`;
