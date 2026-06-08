/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Sol LeWitt inspired modular grid with systematic variations",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15},
        {"NAME": "gridSize", "TYPE": "float", "MIN": 2.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "variation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "strokeWeight", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "colorful", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0},
        {"NAME": "depth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Draw different patterns per cell
float cellPattern(vec2 uv, float patternType, float lineW) {
    float d = 1e10;

    if (patternType < 0.25) {
        // Diagonal NE
        d = abs(uv.x - uv.y);
    } else if (patternType < 0.5) {
        // Diagonal NW
        d = abs(uv.x + uv.y - 1.0);
    } else if (patternType < 0.75) {
        // Horizontal
        d = abs(uv.y - 0.5);
    } else {
        // Vertical
        d = abs(uv.x - 0.5);
    }

    return smoothstep(lineW, lineW * 0.3, d);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;

    // Aspect ratio correction
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 gridUV = uv * vec2(aspect * gridSize, gridSize);

    // Cell coordinates
    vec2 cellID = floor(gridUV);
    vec2 cellUV = fract(gridUV);

    // Hash for this cell
    float cellHash = hash(cellID);

    // Animate pattern selection
    float animOffset = sin(t * PI + cellHash * 10.0) * variation * 0.5;
    float patternType = fract(cellHash + animOffset);

    float lineW = strokeWeight * 0.05;

    // Multiple lines per cell
    float pattern = 0.0;
    for (float i = 0.0; i < 5.0; i++) {
        vec2 offsetUV = cellUV;
        offsetUV += (i - 2.0) * 0.15;
        pattern = max(pattern, cellPattern(offsetUV, patternType, lineW));
    }

    // Color
    vec3 col = vec3(0.95); // Paper white

    if (colorful > 0.5) {
        // Colored version
        vec3 cellColor = hsv2rgb(vec3(cellHash, 0.7, 0.3 + depth * 0.4));
        col = mix(col, cellColor, pattern);
    } else {
        // Black and white
        col = mix(col, vec3(0.05 + depth * cellHash * 0.2), pattern);
    }

    // Grid lines (cell borders)
    vec2 gridLine = smoothstep(vec2(0.02), vec2(0.0), cellUV) +
                    smoothstep(vec2(0.98), vec2(1.0), cellUV);
    col = mix(col, vec3(0.7), max(gridLine.x, gridLine.y) * 0.3);

    // Subtle depth shadow
    float shadow = cellHash * depth * 0.1;
    col -= shadow * pattern;

    gl_FragColor = vec4(col, 1.0);
}
