/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Aged copper surface with oxidized patina effects",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.25},
        {"NAME": "patinaAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "detail", "TYPE": "float", "MIN": 1.0, "MAX": 5.0, "DEFAULT": 3.0},
        {"NAME": "copperTone", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "shimmer", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float fbm(vec2 p, float t) {
    float f = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        f += a * snoise(p + t * 0.1);
        p *= 2.0;
        a *= 0.5;
    }
    return f;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Multi-layered noise for patina distribution
    float patina1 = fbm(uv * detail, t);
    float patina2 = fbm(uv * detail * 2.0 + 5.0, t * 0.7);
    float patinaMask = smoothstep(0.0, 0.5, patina1 * 0.5 + 0.5) * patinaAmount;
    patinaMask *= smoothstep(-0.2, 0.3, patina2);

    // Copper colors
    vec3 polishedCopper = mix(
        vec3(0.95, 0.64, 0.54),  // Rose gold
        vec3(0.85, 0.55, 0.40),  // Deep copper
        copperTone
    );

    // Patina colors (verdigris)
    vec3 patina = mix(
        vec3(0.35, 0.65, 0.55),  // Blue-green
        vec3(0.25, 0.55, 0.45),  // Darker patina
        patina2 * 0.5 + 0.5
    );

    // Mix copper and patina
    vec3 baseColor = mix(polishedCopper, patina, patinaMask);

    // Calculate surface normal from noise
    float eps = 0.01;
    float h = fbm(uv * detail, t);
    float hx = fbm(uv * detail + vec2(eps, 0.0), t);
    float hy = fbm(uv * detail + vec2(0.0, eps), t);
    vec3 normal = normalize(vec3((h - hx) * 3.0, (h - hy) * 3.0, 0.3));

    // Lighting
    vec3 light = normalize(vec3(0.4, 0.5, 1.0));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    float diff = max(dot(normal, light), 0.0);
    float spec = pow(max(dot(reflect(-light, normal), viewDir), 0.0), 32.0);

    // Copper has stronger specular on polished areas
    spec *= (1.0 - patinaMask * 0.8);

    // Fresnel
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);

    // Shimmer effect on copper
    float shim = snoise(uv * 30.0 + t) * shimmer * (1.0 - patinaMask);

    // Combine
    vec3 col = baseColor * (0.3 + diff * 0.5);
    col += vec3(1.0, 0.9, 0.85) * spec * 0.8;
    col += polishedCopper * fresnel * 0.3 * (1.0 - patinaMask);
    col += vec3(0.1, 0.15, 0.12) * fresnel * patinaMask;
    col += vec3(0.05) * shim;

    gl_FragColor = vec4(col, 1.0);
}
