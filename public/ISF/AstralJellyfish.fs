/*{
    "DESCRIPTION": "Fractal crystal lattice with octahedral folding and noise-driven displacement. Organic growth patterns emerge from layered noise warping the crystalline structure.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Crystal"],
    "INPUTS": [
        { "NAME": "foldIterations", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 9.0, "LABEL": "Fold Depth" },
        { "NAME": "rotSpeed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rotation Speed" },
        { "NAME": "zoom", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.2, "MAX": 2.0, "LABEL": "Zoom" },
        { "NAME": "noiseAmt", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Noise Amount" },
        { "NAME": "noiseScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0, "LABEL": "Noise Scale" },
        { "NAME": "colorBase", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0, "LABEL": "Base Color" },
        { "NAME": "prismSpread", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Prismatic Spread" },
        { "NAME": "brightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0, "LABEL": "Brightness" },
        { "NAME": "organicPulse", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Organic Pulse" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 rgb = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(rgb - 1.0, 0.0, 1.0), c.y);
}

mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

vec3 octFold(vec3 p) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    return p;
}

// Simple 3D noise from sin hashing
float noise3D(vec3 p) {
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float n = dot(ip, vec3(1.0, 57.0, 113.0));
    float a = fract(sin(n) * 43758.5453);
    float b = fract(sin(n + 1.0) * 43758.5453);
    float c = fract(sin(n + 57.0) * 43758.5453);
    float d = fract(sin(n + 58.0) * 43758.5453);
    float e = fract(sin(n + 113.0) * 43758.5453);
    float f = fract(sin(n + 114.0) * 43758.5453);
    float g = fract(sin(n + 170.0) * 43758.5453);
    float h = fract(sin(n + 171.0) * 43758.5453);
    return mix(
        mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y),
        mix(mix(e, f, fp.x), mix(g, h, fp.x), fp.y),
        fp.z
    );
}

float fbm3(vec3 p) {
    float f = 0.0;
    f += 0.5 * noise3D(p); p *= 2.01;
    f += 0.25 * noise3D(p); p *= 2.02;
    f += 0.125 * noise3D(p);
    return f;
}

float crystalSDF(vec3 p, float t) {
    float d = 9.0;
    int folds = int(foldIterations);

    // Noise-driven displacement before folding
    float n = fbm3(p * noiseScale + t * 0.3);
    float pulse = sin(t * 2.0) * 0.5 + 0.5;
    p += (n - 0.4) * noiseAmt * (0.7 + pulse * organicPulse * 0.6);

    for (int i = 0; i < 9; i++) {
        if (i >= folds) break;
        float fi = float(i);
        p.xz *= rot2(t * 0.2 + fi * 0.3);
        p.yz *= rot2(t * 0.15 - fi * 0.2);
        p = octFold(p);
        p -= vec3(0.5 + fi * 0.08);

        // Noise perturbation at each fold level
        float ln = noise3D(p * noiseScale * 0.5 + fi + t * 0.2) - 0.5;
        p += ln * noiseAmt * 0.15;

        d = min(d, length(max(abs(p) - 0.2 * (1.0 + fi * 0.1), 0.0)) - 0.02);
    }

    return d;
}

vec3 crystalNormal(vec3 p, float t) {
    vec2 e = vec2(0.003, 0.0);
    return normalize(vec3(
        crystalSDF(p + e.xyy, t) - crystalSDF(p - e.xyy, t),
        crystalSDF(p + e.yxy, t) - crystalSDF(p - e.yxy, t),
        crystalSDF(p + e.yyx, t) - crystalSDF(p - e.yyx, t)
    ));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    vec3 ro = vec3(0.0, 0.0, -3.5 / zoom);
    vec3 rd = normalize(vec3(uv, zoom));

    float t = TIME * rotSpeed;
    ro.xz *= rot2(t * 0.2);
    rd.xz *= rot2(t * 0.2);
    ro.yz *= rot2(sin(t * 0.15) * 0.3);
    rd.yz *= rot2(sin(t * 0.15) * 0.3);

    vec3 col = vec3(0.0);
    float totalDist = 0.0;
    bool hit = false;

    for (int i = 0; i < 80; i++) {
        vec3 pos = ro + rd * totalDist;
        float d = crystalSDF(pos, t);
        if (d < 0.001) { hit = true; break; }
        if (totalDist > 15.0) break;
        totalDist += d;
    }

    if (hit) {
        vec3 pos = ro + rd * totalDist;
        vec3 nor = crystalNormal(pos, t);

        // Noise at hit point for organic coloring
        float hitNoise = fbm3(pos * noiseScale * 1.5 + t * 0.5);

        // Prismatic dispersion
        float fresnel = pow(1.0 - abs(dot(nor, -rd)), 3.0);
        float hue = fract(colorBase + hitNoise * 0.5 + fresnel * prismSpread * 0.5);

        vec3 prismatic;
        prismatic.r = hsv2rgb(vec3(fract(hue - prismSpread * 0.12), 0.7, 0.9)).r;
        prismatic.g = hsv2rgb(vec3(hue, 0.7, 0.9)).g;
        prismatic.b = hsv2rgb(vec3(fract(hue + prismSpread * 0.12), 0.7, 0.9)).b;

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 0.8, -0.3));
        float diff = max(dot(nor, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 48.0);

        col = prismatic * (0.12 + diff * 0.6);
        col += spec * 0.6 * vec3(1.0);

        // Fresnel glow with noise color variation
        col += fresnel * 0.4 * hsv2rgb(vec3(fract(hue + 0.3), 0.4, 1.0));

        // Organic pulse glow
        float pulseGlow = sin(hitNoise * 10.0 + t * 3.0) * 0.5 + 0.5;
        col += hsv2rgb(vec3(fract(hue + 0.15), 0.6, pulseGlow * organicPulse * 0.3));

        // Fog
        float fog = exp(-totalDist * 0.15);
        col = mix(vec3(0.01, 0.005, 0.02), col, fog);
    } else {
        float bgGlow = exp(-length(uv) * 1.5) * 0.08;
        col = hsv2rgb(vec3(colorBase, 0.3, bgGlow));
    }

    col *= brightness;
    col = col / (1.0 + col);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
