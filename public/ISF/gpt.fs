/*{
    "CREDIT": "ChatGPT",
    "DESCRIPTION": "MechDMT — geometric fractal kaleidoscope simulating the mind of a robot on DMT",
    "CATEGORIES": [ "generator" ],
    "INPUTS": [
        { "NAME": "speed",      "TYPE": "float", "MIN": 0.0, "MAX": 3.0,  "DEFAULT": 1.0 },
        { "NAME": "folds",      "TYPE": "float", "MIN": 2.0, "MAX": 12.0, "DEFAULT": 6.0 },
        { "NAME": "gridScale",  "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 10.0 },
        { "NAME": "noiseScale", "TYPE": "float", "MIN": 0.1, "MAX": 10.0, "DEFAULT": 3.0 }
    ]
}*/

#define PI       3.141592653589793
#define TWO_PI  (2.0 * PI)
const int OCTAVES = 5;

// IQ-style 2D random
vec2 rand2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

// Smooth 2D noise
float noise2d(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f*f*(3.0 - 2.0*f);
    float a = dot(rand2(i + vec2(0.0,0.0)), f - vec2(0.0,0.0));
    float b = dot(rand2(i + vec2(1.0,0.0)), f - vec2(1.0,0.0));
    float c = dot(rand2(i + vec2(0.0,1.0)), f - vec2(0.0,1.0));
    float d = dot(rand2(i + vec2(1.0,1.0)), f - vec2(1.0,1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion
float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < OCTAVES; i++) {
        v += amp * noise2d(p);
        p *= 2.0;
        amp *= 0.5;
    }
    return v;
}

// Kaleidoscope symmetry
vec2 kaleido(vec2 uv, float slices) {
    float angle = TWO_PI / slices;
    float a = atan(uv.y, uv.x);
    float r = length(uv);
    a = mod(a, angle);
    a = abs(a - angle*0.5);
    return vec2(cos(a), sin(a)) * r;
}

// Convert HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    // normalized, centered coords
    vec2 uv = (gl_FragCoord.xy / RENDERSIZE.xy) * 2.0 - 1.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    // apply a gentle swirl warp
    float t = TIME * speed;
    vec2 swirl = vec2(
        uv.x * cos(t) - uv.y * sin(t),
        uv.x * sin(t) + uv.y * cos(t)
    );

    // integerize the fold count
    int iF = int(floor(folds + 0.5));
    float slices = float(iF);

    // kaleidoscope symmetry
    vec2 ks = kaleido(swirl, slices);

    // grid pattern mask
    vec2 gv = fract(ks * gridScale) - 0.5;
    float gridLine = smoothstep(0.48, 0.5, length(gv));

    // fractal noise
    float n = fbm(ks * noiseScale + t * 0.1);

    // mix grid and noise for complex mask
    float mask = mix(gridLine, n, 0.5);

    // dynamic, shifting color via HSV
    vec3 col = hsv2rgb(vec3(n * 2.0 + t * 0.05, 1.0, mask));

    // subtle vignette
    float d = length((gl_FragCoord.xy / RENDERSIZE.xy) - 0.5);
    float vig = smoothstep(0.6, 1.0, d);

    gl_FragColor = vec4(col * (1.0 - vig), 1.0);
}
