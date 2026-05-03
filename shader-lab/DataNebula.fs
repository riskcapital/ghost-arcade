/*{
    "DESCRIPTION": "Data Nebula - Iridescent volumetric cloud that compresses against invisible edge walls. Anadol-style data-pigment trapped in the layer frame.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",         "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,  "MAX": 1.5},
        {"NAME": "density",       "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.2,  "MAX": 3.0},
        {"NAME": "iridescence",   "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,  "MAX": 2.0},
        {"NAME": "edgePressure",  "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,  "MAX": 3.0},
        {"NAME": "edgeGlow",      "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,  "MAX": 3.0},
        {"NAME": "hueShift",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,  "MAX": 1.0},
        {"NAME": "hueRange",      "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.05, "MAX": 1.0},
        {"NAME": "depthParallax", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,  "MAX": 2.0},
        {"NAME": "brightness",    "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,  "MAX": 2.0},
        {"NAME": "grainAmount",   "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.0,  "MAX": 0.15},
        {"NAME": "bgTint",        "TYPE": "color", "DEFAULT": [0.01, 0.005, 0.03, 1.0]}
    ]
}*/

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p, float t) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
        v += a * vnoise(p + t * 0.15);
        p = rot * p * 2.02;
        a *= 0.5;
    }
    return v;
}

// 2D curl from a scalar potential — cheap flow field
vec2 curl(vec2 p, float t) {
    float eps = 0.01;
    float n1 = fbm(p + vec2(0.0, eps), t);
    float n2 = fbm(p - vec2(0.0, eps), t);
    float n3 = fbm(p + vec2(eps, 0.0), t);
    float n4 = fbm(p - vec2(eps, 0.0), t);
    return vec2(n1 - n2, -(n3 - n4)) / (2.0 * eps);
}

// IQ cosine palette → thin-film iridescence
vec3 irid(float x) {
    return 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + x));
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float t = TIME * speed;

    // Invisible glass walls
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float wallPressure = smoothstep(0.35, 0.0, edgeDist) * edgePressure;

    // Curl-noise flow; redirect along wall tangent under pressure
    vec2 flow = curl(p * 1.5, t);
    vec2 toCenter = vec2(0.5) - uv;
    vec2 wallTangent = vec2(-toCenter.y, toCenter.x);
    float flowLen = max(length(flow), 1e-4);
    flow = mix(flow, normalize(flow + wallTangent * 0.5) * flowLen, wallPressure * 0.6);

    // Three parallax fbm slices for 3D depth feel
    vec2 warp = flow * 0.15;
    float d1 = fbm((p + warp * 1.0) * 2.0 * density,        t * 1.0);
    float d2 = fbm((p + warp * 1.6) * 3.2 * density + 17.0, t * 0.7);
    float d3 = fbm((p + warp * 2.4) * 5.5 * density + 53.0, t * 0.4);

    // Pigment pressing against glass — compress density near walls
    float compression = 1.0 + wallPressure * 1.2;
    float vol = (d1 * 0.5 + d2 * 0.35 + d3 * 0.25) * compression;
    vol = pow(clamp(vol, 0.0, 1.2), 1.4);

    // Thin-film: hue shifts with flow direction + micro-detail
    float flowDir = atan(flow.y, flow.x) / 6.2831853 + 0.5;
    float iridSample = hueShift + flowDir * hueRange * iridescence + d3 * 0.15 * iridescence;
    vec3 pigment = irid(iridSample);

    // Depth-banded color layering
    vec3 farCol  = irid(hueShift + 0.15 * iridescence) * 0.4;
    vec3 midCol  = pigment * 0.9;
    vec3 nearCol = irid(hueShift + 0.6 * iridescence) * 1.1;
    vec3 vcol = farCol * d1 * 0.5 + midCol * d2 * 0.7 + nearCol * d3 * 1.0;
    vcol *= depthParallax;

    vec3 col = bgTint.rgb + vcol * vol * brightness;

    // Edge bloom where density collides with walls
    float bloom = smoothstep(0.15, 0.0, edgeDist) * vol * edgeGlow;
    col += irid(hueShift + 0.8) * bloom * 0.6;

    // Pigment-on-surface grain
    float grain = (hash21(uv * RENDERSIZE.xy + t) - 0.5) * grainAmount;
    col += grain;

    gl_FragColor = vec4(col, 1.0);
}
