/*{
    "DESCRIPTION": "Constellation map - procedural star chart with connection lines",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "constellationCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "starsPerGroup", "TYPE": "float", "DEFAULT": 6.0, "MIN": 3.0, "MAX": 10.0},
        {"NAME": "connectionOpacity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "bgStarDensity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "starBrightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "gridOverlay", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.5, "LABEL": "Coordinate Grid"},
        {"NAME": "drift", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "colorVariation", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "haloSize", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float line(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

vec2 getStar(float c, float i, vec2 groupCenter, float t, float driftAmt) {
    float a = hash(c * 100.0 + i * 7.7) * PI * 2.0;
    float r = 0.05 + hash(c * 100.0 + i * 3.3 + 50.0) * 0.12;
    vec2 star = groupCenter + r * vec2(cos(a), sin(a));
    star += vec2(sin(t * 0.3 + i + c), cos(t * 0.2 + i * 1.5 + c)) * driftAmt * 0.01;
    return star;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.01, 0.01, 0.03);

    // Coordinate grid
    if (gridOverlay > 0.0) {
        vec2 grid = uv * 8.0;
        float gx = abs(fract(grid.x) - 0.5);
        float gy = abs(fract(grid.y) - 0.5);
        float gridLine = min(gx, gy);
        col += vec3(0.1, 0.12, 0.2) * smoothstep(0.02, 0.0, gridLine) * gridOverlay;
        col += vec3(0.08, 0.1, 0.15) * smoothstep(0.005, 0.0, abs(uv.x)) * gridOverlay;
        col += vec3(0.08, 0.1, 0.15) * smoothstep(0.005, 0.0, abs(uv.y)) * gridOverlay;
    }

    // Background star field
    for (float layer = 0.0; layer < 3.0; layer++) {
        float scale = 30.0 + layer * 20.0;
        vec2 starUV = (uv + t * 0.01 * (layer + 1.0)) * scale;
        vec2 starId = floor(starUV);
        vec2 starFract = fract(starUV) - 0.5;

        float h = hash2(starId + layer * 100.0);
        if (h > 1.0 - bgStarDensity * 0.15) {
            float sd = length(starFract);
            float brightness = (h - (1.0 - bgStarDensity * 0.15)) / (bgStarDensity * 0.15);
            float twinkle = 0.6 + 0.4 * sin(t * 5.0 + h * 100.0);
            col += vec3(0.4, 0.45, 0.6) * 0.003 / (sd + 0.01) * brightness * twinkle * 0.2 / (1.0 + layer);
        }
    }

    // Constellation groups
    for (float c = 0.0; c < 8.0; c++) {
        if (c >= constellationCount) break;

        vec2 groupCenter = vec2(
            (hash(c * 7.3 + 1.0) - 0.5) * 1.2,
            (hash(c * 3.1 + 5.0) - 0.5) * 0.8
        );
        groupCenter += vec2(sin(t * drift + c), cos(t * drift * 0.7 + c * 2.0)) * 0.03;

        // Draw connection lines
        for (float i = 0.0; i < 9.0; i++) {
            if (i >= starsPerGroup - 1.0) break;
            vec2 s0 = getStar(c, i, groupCenter, t, drift);
            vec2 s1 = getStar(c, i + 1.0, groupCenter, t, drift);
            float ld = line(uv, s0, s1);
            col += vec3(0.2, 0.25, 0.5) * 0.0005 / (ld + 0.003) * connectionOpacity;
        }

        // Close the shape
        if (starsPerGroup > 3.0) {
            vec2 s0 = getStar(c, 0.0, groupCenter, t, drift);
            vec2 s1 = getStar(c, starsPerGroup - 1.0, groupCenter, t, drift);
            float ld = line(uv, s0, s1);
            col += vec3(0.15, 0.2, 0.4) * 0.0003 / (ld + 0.003) * connectionOpacity * 0.5;
        }

        // Draw stars
        for (float i = 0.0; i < 10.0; i++) {
            if (i >= starsPerGroup) break;
            vec2 star = getStar(c, i, groupCenter, t, drift);
            float sd = length(uv - star);
            float mag = 0.5 + 0.5 * hash(c * 100.0 + i * 11.1);

            float temp = hash(c * 100.0 + i * 13.3);
            vec3 starCol = mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.8, 0.6), temp * colorVariation);

            col += starCol * starBrightness * mag * 0.003 / (sd * sd + 0.0002);
            col += starCol * 0.3 * haloSize * mag * exp(-sd * sd / (0.001 * haloSize + 0.0001));

            vec2 dp = uv - star;
            float spike = exp(-abs(dp.x) * 200.0) * exp(-abs(dp.y) * 30.0) +
                         exp(-abs(dp.y) * 200.0) * exp(-abs(dp.x) * 30.0);
            col += starCol * spike * mag * starBrightness * 0.1;
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
