/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Melting organic blobs with simplex noise - great for video mapping",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.4},
        {"NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 3.0},
        {"NAME": "meltiness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "colorShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0},
        {"NAME": "metallic", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// Simplex noise functions
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p) {
    float f = 0.0;
    f += 0.5000 * snoise(p); p *= 2.01;
    f += 0.2500 * snoise(p); p *= 2.02;
    f += 0.1250 * snoise(p); p *= 2.03;
    f += 0.0625 * snoise(p);
    return f;
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Create flowing, melting noise field
    vec3 p = vec3(uv * scale, t * 0.3);

    // Multiple layers of flowing noise
    float n1 = fbm(p);
    float n2 = fbm(p + vec3(5.2, 1.3, t * 0.2));
    float n3 = fbm(p * 0.5 + vec3(n1, n2, t * 0.1) * meltiness);

    // Combine for organic blob shapes
    float blob = n1 + n2 * 0.5 + n3 * 0.25;
    blob = blob * 0.5 + 0.5;

    // Create surface with threshold
    float surface = smoothstep(0.3, 0.7, blob);

    // Metallic lighting
    float highlight = pow(blob, 3.0) * metallic;
    float shadow = pow(1.0 - blob, 2.0) * 0.5;

    // Color based on blob value
    float hue = fract(blob * 0.3 + colorShift + t * 0.05);
    vec3 baseColor = hsv2rgb(vec3(hue, 0.3 * (1.0 - metallic), 0.8));

    // Silver/chrome when metallic
    vec3 metalColor = vec3(0.9, 0.9, 0.95);
    vec3 col = mix(baseColor, metalColor, metallic * 0.7);

    // Apply lighting
    col = col * (0.5 + surface * 0.5);
    col += vec3(1.0) * highlight;
    col *= 1.0 - shadow * 0.3;

    // Edge glow
    float edge = abs(blob - 0.5) < 0.1 ? 1.0 - abs(blob - 0.5) * 10.0 : 0.0;
    col += hsv2rgb(vec3(hue + 0.1, 0.8, 1.0)) * edge * 0.3;

    gl_FragColor = vec4(col, 1.0);
}
