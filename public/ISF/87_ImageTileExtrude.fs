/*{
    "DESCRIPTION": "Image Tile Extrude - Breaks image into a grid of tiles, each extruded by luminance depth. Tilt camera to reveal 3D tile columns.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Effect"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "cameraAngleX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -30.0, "MAX": 30.0, "LABEL": "Camera Tilt X"},
        {"NAME": "cameraAngleY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -30.0, "MAX": 30.0, "LABEL": "Camera Tilt Y"},
        {"NAME": "gridSize", "TYPE": "float", "DEFAULT": 20.0, "MIN": 4.0, "MAX": 80.0, "LABEL": "Grid Resolution"},
        {"NAME": "depthScale", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5, "LABEL": "Extrusion Depth"},
        {"NAME": "tileGap", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0, "MAX": 0.2, "LABEL": "Tile Gap"},
        {"NAME": "tileRound", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 0.4, "LABEL": "Tile Rounding"},
        {"NAME": "sideShading", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Side Face Shading"},
        {"NAME": "animateAngle", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "animateSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

// ============================================================================
// Image Tile Extrude - Voxel-style tile column grid
// Each tile's luminance determines its extrusion height.
// Camera tilt creates parallax between tiles at different depths.
// At camera (0,0): tiles sit flat = original image (with optional grid).
// ============================================================================

#define PI 3.14159265359

float getLuminance(vec2 uv) {
    vec4 tex = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999));
    return dot(tex.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Camera angle
    float ax = cameraAngleX;
    float ay = cameraAngleY;
    if (animateAngle > 0.01) {
        ax += sin(TIME * animateSpeed) * 12.0 * animateAngle;
        ay += cos(TIME * animateSpeed * 0.7) * 8.0 * animateAngle;
    }
    ax += audioBass * 4.0;
    ay += audioMid * 2.0;

    vec2 tiltDir = vec2(sin(ax * PI / 180.0), sin(ay * PI / 180.0));

    // Audio-reactive depth
    float depth = depthScale + audioBeat * 0.03;

    vec2 tileSize = vec2(1.0 / gridSize);
    vec3 bestColor = vec3(0.0);
    float bestDepth = -1.0;
    float bestMask = 0.0;

    // Check nearby tiles to find which one covers this pixel after parallax shift
    // Each tile shifts based on its height - we need to check neighbors
    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            // Candidate tile
            vec2 candidateTileID = floor(uv / tileSize) + vec2(float(dx), float(dy));
            vec2 tileCenterUV = (candidateTileID + 0.5) * tileSize;

            // Skip out-of-bounds tiles
            if (tileCenterUV.x < -0.1 || tileCenterUV.x > 1.1) continue;
            if (tileCenterUV.y < -0.1 || tileCenterUV.y > 1.1) continue;

            // Tile height from its center luminance
            float tileH = getLuminance(tileCenterUV);

            // Parallax shift: bright tiles (near) shift less, dark tiles (far) shift more
            vec2 tileOffset = tiltDir * (1.0 - tileH) * depth;

            // Where does this tile appear on screen after parallax?
            vec2 shiftedCenter = tileCenterUV - tileOffset;
            vec2 localUV = (uv - shiftedCenter) / tileSize + 0.5;

            // Check if this pixel is inside the shifted tile
            float halfGap = tileGap * 0.5;

            // Rounded rectangle SDF
            vec2 d = abs(localUV - 0.5) - (0.5 - halfGap - tileRound);
            float sdf = length(max(d, 0.0)) - tileRound;
            float tileMask = 1.0 - smoothstep(-0.01, 0.01, sdf);

            if (tileMask > 0.01 && tileH > bestDepth) {
                vec3 color = IMG_NORM_PIXEL(inputImage, clamp(tileCenterUV, 0.001, 0.999)).rgb;

                // Side face shading: tiles further from camera appear darker
                float shadeFactor = 1.0 - (1.0 - tileH) * sideShading * 0.4;

                // Edge highlight on tile face
                float edgeHighlight = smoothstep(0.35, 0.5, max(abs(localUV.x - 0.5), abs(localUV.y - 0.5)));
                shadeFactor -= edgeHighlight * sideShading * 0.1;

                bestColor = color * shadeFactor;
                bestDepth = tileH;
                bestMask = tileMask;
            }
        }
    }

    vec3 finalColor = bestColor * bestMask;

    // Subtle background for gaps
    if (bestMask < 0.1) {
        finalColor = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999)).rgb * 0.1;
    }

    gl_FragColor = vec4(finalColor, 1.0);
}
