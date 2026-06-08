/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Synthwave retro sun effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "sunSize", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.3},
        {"NAME": "gridSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "lineCount", "TYPE": "float", "MIN": 3.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "glowAmount", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "chromatic", "TYPE": "float", "MIN": 0.0, "MAX": 0.05, "DEFAULT": 0.01}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    uv.y += 0.1; // Offset sun up a bit

    float t = iTime * gridSpeed;
    vec3 col = vec3(0.0);

    // Sky gradient
    vec3 skyTop = vec3(0.1, 0.0, 0.2);
    vec3 skyBottom = vec3(0.4, 0.1, 0.3);
    vec3 sky = mix(skyBottom, skyTop, uv.y + 0.5);
    col = sky;

    // Sun
    float sunDist = length(uv - vec2(0.0, 0.15));
    float sun = smoothstep(sunSize, sunSize - 0.01, sunDist);

    // Sun gradient
    vec3 sunTop = vec3(1.0, 0.9, 0.3);
    vec3 sunBottom = vec3(1.0, 0.3, 0.4);
    float sunGradient = (uv.y - 0.15 + sunSize) / (sunSize * 2.0);
    vec3 sunColor = mix(sunBottom, sunTop, clamp(sunGradient, 0.0, 1.0));

    // Sun horizontal lines
    int lines = int(lineCount);
    float linePattern = 1.0;
    for (int i = 0; i < 20; i++) {
        if (i >= lines) break;
        float fi = float(i);
        float lineY = 0.15 - sunSize + fi * sunSize * 2.0 / lineCount;
        float lineThick = 0.01 + fi * 0.002;
        float line = smoothstep(lineThick, 0.0, abs(uv.y - lineY));
        linePattern -= line * 0.3 * step(lineY, 0.15);
    }

    col = mix(col, sunColor * linePattern, sun);

    // Sun glow
    float glow = exp(-sunDist * 3.0) * glowAmount;
    col += vec3(1.0, 0.5, 0.3) * glow * 0.3;

    // Grid floor
    if (uv.y < -0.1) {
        float gridY = -0.1 / uv.y;
        float gridX = uv.x * gridY;

        // Perspective grid
        float gridLineX = smoothstep(0.02, 0.0, abs(fract(gridX * 5.0) - 0.5));
        float gridLineY = smoothstep(0.02, 0.0, abs(fract(gridY * 0.5 - t) - 0.5));

        vec3 gridColor = vec3(1.0, 0.2, 0.5);
        float gridIntensity = (gridLineX + gridLineY) * 0.8 / gridY;

        col = mix(col, gridColor, gridIntensity * smoothstep(-0.5, -0.1, uv.y));
    }

    // Chromatic aberration
    if (chromatic > 0.0) {
        float ca = chromatic * (1.0 + sunDist);
        col.r = col.r;
        col.b *= 1.0 + ca;
    }

    // Scanlines
    col *= 0.95 + 0.05 * sin(fragCoord.y * 2.0);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
