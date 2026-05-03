/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Digital glitch blocks effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Glitch"],
    "INPUTS": [
        {"NAME": "blockSize", "TYPE": "float", "MIN": 4.0, "MAX": 32.0, "DEFAULT": 12.0, "LABEL": "Block Size"},
        {"NAME": "glitchRate", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 8.0, "LABEL": "Glitch Rate"},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Intensity"},
        {"NAME": "colorShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Color Shift"},
        {"NAME": "scanlines", "TYPE": "bool", "DEFAULT": true, "LABEL": "Scanlines"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 1.0, 1.0, 1.0], "LABEL": "Color 1"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [1.0, 0.0, 1.0, 1.0], "LABEL": "Color 2"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.1, 1.0], "LABEL": "Background"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    float t = floor(TIME * glitchRate);

    // Block grid
    vec2 blockUV = floor(uv * blockSize) / blockSize;
    vec2 blockId = floor(uv * blockSize);

    // Random values per block per time
    float rnd = hash2(blockId + t);
    float rnd2 = hash2(blockId * 1.3 + t + 100.0);

    vec3 col = bgColor.rgb;

    // Glitch block visibility
    if (rnd < intensity) {
        // Block color
        if (rnd2 < 0.5) {
            col = color1.rgb;
        } else {
            col = color2.rgb;
        }

        // Color channel shift
        if (colorShift > 0.0) {
            float shift = (hash(t + blockId.y) - 0.5) * colorShift * 0.1;
            vec2 shiftUV = uv + vec2(shift, 0.0);
            vec2 shiftBlockId = floor(shiftUV * blockSize);
            float shiftRnd = hash2(shiftBlockId + t);

            if (shiftRnd < intensity) {
                col.r = color2.r;
            }
        }

        // Block brightness variation
        col *= 0.5 + rnd2 * 0.5;
    }

    // Scanlines
    if (scanlines) {
        float scanline = sin(uv.y * RENDERSIZE.y * 2.0) * 0.5 + 0.5;
        col *= 0.9 + scanline * 0.1;

        // Horizontal noise lines
        if (hash(floor(uv.y * 100.0) + t) > 0.98) {
            col += vec3(0.2);
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
