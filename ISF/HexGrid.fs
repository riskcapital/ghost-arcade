/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated hexagonal grid with glow effects",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "glow", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "colorShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.05}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define SQRT3 1.7320508

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 hexCenter(vec2 p) {
    vec2 q = vec2(p.x * 2.0 / 3.0, (-p.x / 3.0 + SQRT3 / 3.0 * p.y));
    vec2 qi = floor(q + 0.5);
    return vec2(qi.x * 1.5, qi.x * SQRT3 * 0.5 + qi.y * SQRT3);
}

float hexDist(vec2 p) {
    p = abs(p);
    return max(p.x * 0.5 + p.y * SQRT3 * 0.5, p.x);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    uv *= scale;

    float t = iTime * speed;
    vec2 hc = hexCenter(uv);
    vec2 hp = uv - hc;
    float hd = hexDist(hp);

    float edge = 1.0 - smoothstep(0.5 - lineWidth, 0.5, hd);
    float pulse = sin(length(hc) * 0.5 - t * 2.0) * 0.5 + 0.5;

    float hue = fract(length(hc) * 0.1 + t * 0.1 + colorShift);
    vec3 col = hsv2rgb(vec3(hue, 0.8, 1.0));

    col *= edge * glow;
    col += hsv2rgb(vec3(hue + 0.5, 0.6, pulse * 0.3)) * (1.0 - edge);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
