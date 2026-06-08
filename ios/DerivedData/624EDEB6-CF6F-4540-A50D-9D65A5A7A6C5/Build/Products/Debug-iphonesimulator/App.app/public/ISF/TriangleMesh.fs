/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated triangle mesh with wave distortion",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "gridSize", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "waveAmp", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.1},
        {"NAME": "waveSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "hueOffset", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float triangleGrid(vec2 p) {
    const float sqrt3 = 1.7320508;
    vec2 q = vec2(p.x + p.y / sqrt3, 2.0 * p.y / sqrt3);
    vec2 pi = floor(q);
    vec2 pf = fract(q);

    float s = mod(pi.x + pi.y, 2.0);
    if (s == 0.0) {
        if (pf.x + pf.y < 1.0) return 0.0;
    } else {
        if (pf.x + pf.y > 1.0) return 1.0;
    }
    return s;
}

float triangleDist(vec2 p) {
    const float sqrt3 = 1.7320508;
    vec2 q = vec2(p.x + p.y / sqrt3, 2.0 * p.y / sqrt3);
    vec2 pf = fract(q);
    float d1 = pf.x;
    float d2 = pf.y;
    float d3 = 1.0 - pf.x - pf.y;
    return min(min(d1, d2), abs(d3));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * waveSpeed;
    vec2 wave = vec2(sin(uv.y * 10.0 + t), cos(uv.x * 10.0 + t)) * waveAmp;
    uv += wave;

    vec2 p = uv * gridSize;
    float tri = triangleGrid(p);
    float edge = triangleDist(p);
    float line = 1.0 - smoothstep(0.0, 0.08, edge);

    float hue = fract(tri * 0.5 + length(uv) * 0.3 + iTime * 0.1 + hueOffset);
    vec3 fillCol = hsv2rgb(vec3(hue, 0.7, 0.4));
    vec3 lineCol = hsv2rgb(vec3(hue + 0.2, 0.9, 1.0));

    vec3 col = mix(fillCol, lineCol, line) * brightness;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
