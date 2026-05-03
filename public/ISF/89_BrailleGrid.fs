/*{
    "DESCRIPTION": "Animated braille-like dot grid pattern with audio-reactive brightness and shifting patterns",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "gridSize", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 30.0},
        {"NAME": "dotSize", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.05, "MAX": 0.6},
        {"NAME": "brightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;

    // Audio reactivity
    float bassGlow = 1.0 + audioBass * 1.5;
    float midPulse = 1.0 + audioMid * 0.8;
    float beatFlash = 1.0 + audioBeat * 2.0;

    // Grid coordinates
    vec2 gridUV = uv * gridSize;
    vec2 cellID = floor(gridUV);
    vec2 cellUV = fract(gridUV) - 0.5;

    // Braille cell: 2 columns x 3 rows of dots within each cell
    vec2 brailleGrid = cellUV * vec2(2.0, 3.0);
    vec2 brailleCell = floor(brailleGrid + vec2(1.0, 1.5));
    vec2 brailleUV = fract(brailleGrid + vec2(1.0, 1.5)) - 0.5;

    // Determine which dots are "on" using hash and time
    float pattern = hash(cellID + brailleCell * 7.0 + floor(t * 0.5));
    float threshold = 0.3 + audioLevel * 0.3;
    float dotOn = step(threshold, pattern);

    // Animated wave across grid
    float wave = sin(cellID.x * 0.5 + cellID.y * 0.3 + t * 2.0) * 0.5 + 0.5;
    dotOn *= step(0.3, wave + audioMid * 0.5);

    // Dot shape - circular
    float dist = length(brailleUV);
    float dotRadius = dotSize * midPulse;
    float dot = smoothstep(dotRadius, dotRadius - 0.1, dist);

    // Color based on position and time
    float hue = cellID.x * 0.05 + cellID.y * 0.03 + t * 0.1 * colorShift;
    vec3 col = vec3(
        0.5 + 0.5 * cos(hue * 6.28),
        0.5 + 0.5 * cos(hue * 6.28 + 2.09),
        0.5 + 0.5 * cos(hue * 6.28 + 4.18)
    );

    // Final compositing
    vec3 finalCol = col * dot * dotOn * brightness * bassGlow;

    // Beat flash highlight
    finalCol += vec3(0.1) * dot * dotOn * audioBeat;

    gl_FragColor = vec4(finalCol, 1.0);
}
