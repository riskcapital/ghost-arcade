/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Sol LeWitt style wall drawing with geometric patterns",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "pattern", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 0.0},
        {"NAME": "density", "TYPE": "float", "MIN": 5.0, "MAX": 40.0, "DEFAULT": 20.0},
        {"NAME": "strokeWeight", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "colorCount", "TYPE": "float", "MIN": 1.0, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "hueOffset", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
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

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Diagonal lines pattern
float diagonalLines(vec2 uv, float angle, float freq, float width) {
    float c = cos(angle);
    float s = sin(angle);
    float rotX = uv.x * c - uv.y * s;
    float pattern = abs(fract(rotX * freq) - 0.5);
    return smoothstep(width, width * 0.3, pattern);
}

// Concentric arcs pattern
float arcPattern(vec2 uv, vec2 center, float freq, float width) {
    float d = length(uv - center);
    float pattern = abs(fract(d * freq) - 0.5);
    return smoothstep(width, width * 0.3, pattern);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec2 centered = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;

    float lineW = strokeWeight * 0.02;
    vec3 col = vec3(0.95); // Paper white background

    int pat = int(floor(pattern));
    int colors = int(floor(colorCount));

    // Pattern selection
    float line1 = 0.0;
    float line2 = 0.0;
    float line3 = 0.0;
    float line4 = 0.0;

    if (pat == 0) {
        // Horizontal and vertical hatching
        line1 = diagonalLines(centered, 0.0, density, lineW);
        line2 = diagonalLines(centered, PI * 0.5, density * 0.8, lineW);
    } else if (pat == 1) {
        // Diagonal cross-hatching
        line1 = diagonalLines(centered, PI * 0.25, density, lineW);
        line2 = diagonalLines(centered, -PI * 0.25, density, lineW);
    } else if (pat == 2) {
        // Concentric from corners
        line1 = arcPattern(centered, vec2(-0.8, -0.5), density * 0.5, lineW);
        line2 = arcPattern(centered, vec2(0.8, 0.5), density * 0.5, lineW);
    } else if (pat == 3) {
        // All directions
        line1 = diagonalLines(centered, 0.0, density, lineW);
        line2 = diagonalLines(centered, PI * 0.25, density, lineW);
        line3 = diagonalLines(centered, PI * 0.5, density, lineW);
        line4 = diagonalLines(centered, PI * 0.75, density, lineW);
    } else {
        // Radial from center
        float angle = atan(centered.y, centered.x);
        float radialPattern = abs(fract(angle * density / PI) - 0.5);
        line1 = smoothstep(lineW, lineW * 0.3, radialPattern);
        line2 = arcPattern(centered, vec2(0.0), density * 0.3, lineW);
    }

    // Apply colors
    if (colors >= 1) {
        col = col - vec3(line1 * 0.85);
    }
    if (colors >= 2) {
        vec3 color2 = hsv2rgb(vec3(hueOffset, 0.7, 0.5));
        col = mix(col, color2, line2 * 0.9);
    }
    if (colors >= 3) {
        vec3 color3 = hsv2rgb(vec3(hueOffset + 0.33, 0.7, 0.5));
        col = mix(col, color3, line3 * 0.9);
    }
    if (colors >= 4) {
        vec3 color4 = hsv2rgb(vec3(hueOffset + 0.66, 0.7, 0.5));
        col = mix(col, color4, line4 * 0.9);
    }

    // Subtle animation - breathing
    float breath = sin(t * PI) * 0.02;
    col = col + vec3(breath);

    // Paper texture
    float noise = hash(gl_FragCoord.xy * 0.5) * 0.03;
    col = col + vec3(noise);

    gl_FragColor = vec4(col, 1.0);
}
