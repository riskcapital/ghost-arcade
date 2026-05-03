/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "3D wave matrix with intersecting data patterns",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 1.5, "DEFAULT": 0.5},
        {"NAME": "waveFrequency", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0},
        {"NAME": "gridSize", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0},
        {"NAME": "perspective", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55},
        {"NAME": "waveHeight", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
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

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Apply perspective transformation
    float persp = 1.0 / (1.0 + uv.y * perspective * 0.5);
    vec2 gridUV = uv * persp * gridSize;
    gridUV.y += t * 2.0;

    // Calculate wave height at this grid position
    float wave1 = sin(gridUV.x * waveFrequency + t * 3.0);
    float wave2 = sin(gridUV.y * waveFrequency * 0.7 - t * 2.0);
    float wave3 = sin((gridUV.x + gridUV.y) * waveFrequency * 0.5 + t);
    float waveHeight_local = (wave1 + wave2 + wave3) / 3.0 * waveHeight;

    // Grid lines
    vec2 gridFract = fract(gridUV);
    float lineX = smoothstep(0.02, 0.0, abs(gridFract.x - 0.5) - 0.48);
    float lineY = smoothstep(0.02, 0.0, abs(gridFract.y - 0.5) - 0.48);

    // Wave affects line brightness
    float lineBrightness = (lineX + lineY) * (0.5 + waveHeight_local * 0.5 + 0.5);

    // Color based on wave height
    float colorShift = waveHeight_local * 0.5 + 0.5;
    vec3 lineColor = hsv2rgb(vec3(hue + colorShift * 0.2, 0.7, lineBrightness));

    // Data points at intersections
    float intersect = lineX * lineY;
    float dataPoint = step(0.5, intersect);

    // Pulse effect
    float pulse = sin(gridUV.x + gridUV.y + t * 5.0) * 0.5 + 0.5;
    dataPoint *= pulse;

    vec3 col = lineColor;
    col += hsv2rgb(vec3(hue + 0.3, 0.9, 1.0)) * dataPoint * 0.5;

    // Fade with perspective
    col *= persp;

    // Add glow at horizon
    float horizon = exp(-pow(uv.y + 0.3, 2.0) * 10.0) * perspective;
    col += hsv2rgb(vec3(hue, 0.5, 0.3)) * horizon;

    // Scanline effect
    float scanline = sin(gl_FragCoord.y * 2.0) * 0.5 + 0.5;
    col *= 0.9 + scanline * 0.1;

    gl_FragColor = vec4(col, 1.0);
}
