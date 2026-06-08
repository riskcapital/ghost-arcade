/*{
    "DESCRIPTION": "Ultimate combination shader: quantum lattice with voronoi-fragmented crystalline structure, particle morphing between states, volumetric raymarching, orbital folding, and chromatic bloom. Merges all tweetable GLSL concepts into a single GPU-optimized spectacle.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Voronoi"],
    "INPUTS": [
        { "NAME": "morphState", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Morph State" },
        { "NAME": "foldCount", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 9.0, "LABEL": "Fold Iterations" },
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0, "MAX": 1.0, "LABEL": "Speed" },
        { "NAME": "voronoiScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0, "LABEL": "Voronoi Scale" },
        { "NAME": "rotateX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14, "MAX": 3.14, "LABEL": "Rotate X" },
        { "NAME": "rotateY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14, "MAX": 3.14, "LABEL": "Rotate Y" },
        { "NAME": "extrude", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Extrusion" },
        { "NAME": "bloomStr", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 2.0, "LABEL": "Bloom" },
        { "NAME": "hueBase", "TYPE": "float", "DEFAULT": 0.58, "MIN": 0.0, "MAX": 1.0, "LABEL": "Base Hue" },
        { "NAME": "volumetric", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Volumetric" },
        { "NAME": "chromaticAberr", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Chromatic Aberration" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 voronoi(vec2 uv, float anim) {
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);
    float d1 = 8.0, d2 = 8.0;
    float id = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 nb = vec2(float(i), float(j));
            vec2 pt = hash2(ip + nb);
            pt = 0.5 + 0.5 * sin(anim + 6.2831 * pt);
            vec2 diff = nb + pt - fp;
            float dist = length(diff);
            if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
            else if (dist < d2) { d2 = dist; }
        }
    }
    return vec3(d1, d2, id);
}

// Three cosmic states for morphing (inspired by particle engine concept)
// State 0: Crystalline lattice
// State 0.5: Organic expansion
// State 1: Collapse/singularity

float latticeState(vec3 p, float t) {
    float d = 9.0;
    int folds = int(foldCount);
    vec3 q = p;
    for (int i = 0; i < 9; i++) {
        if (i >= folds) break;
        float fi = float(i);
        q.xz *= rot2(t * 0.2 + fi * 0.3);
        q.yz *= rot2(t * 0.13 - fi * 0.2);

        // Octahedral fold
        q = abs(q);
        if (q.x < q.y) q.xy = q.yx;
        if (q.x < q.z) q.xz = q.zx;
        if (q.y < q.z) q.yz = q.zy;
        q -= vec3(0.45 + fi * 0.06);

        // Voronoi surface etching
        vec3 vor = voronoi(q.xz * voronoiScale, t * 0.4 + fi);
        float cellExtrude = vor.z * extrude * 0.1;
        float edgeCut = smoothstep(0.0, 0.04, vor.y - vor.x);

        float shape = length(max(abs(q) - 0.18 * (1.0 + fi * 0.08), 0.0)) - 0.015;
        shape -= cellExtrude * edgeCut;
        d = min(d, shape);
    }
    return d;
}

float organicState(vec3 p, float t) {
    float R = length(p);
    // Log-polar inspired by tweetable: log2(length) as depth
    float logR = log2(max(R, 0.001));
    float phi = asin(clamp(-p.z / max(R, 0.001), -1.0, 1.0));
    float theta = atan(p.x, p.y);

    vec3 lp = vec3(logR - t, phi, theta - t * 0.2);

    float d = 0.0;
    float s = 1.0;
    for (float i = 0.0; i < 8.0; i++) {
        d += abs(dot(sin(lp.zxx * s), cos(lp * s))) / s;
        s *= 2.0;
    }
    d = d * 0.15 - 0.3;

    // Voronoi modulation
    vec3 vor = voronoi(vec2(theta, logR) * voronoiScale, t * 0.5);
    d += (vor.y - vor.x) * extrude * 0.2;

    return d;
}

float quantumSDF(vec3 p, float t) {
    // Morph between states
    float m = morphState;

    // Three-way blend: lattice -> organic -> singularity
    float d;
    if (m < 0.5) {
        float blend = m * 2.0;
        float dA = latticeState(p, t);
        float dB = organicState(p, t);
        d = mix(dA, dB, smoothstep(0.0, 1.0, blend));
    } else {
        float blend = (m - 0.5) * 2.0;
        float dB = organicState(p, t);
        // Singularity: collapse to sphere
        float dC = length(p) - 0.5 + sin(t * 2.0) * 0.1;
        vec3 vor = voronoi(p.xz * voronoiScale * 2.0, t);
        dC -= vor.z * extrude * 0.2 * (1.0 - blend);
        d = mix(dB, dC, smoothstep(0.0, 1.0, blend));
    }

    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * speed;

    vec3 ro = vec3(0.0, 0.0, -3.5);
    vec3 rd = normalize(vec3(uv, 0.8));

    // Camera rotation
    float autoRot = t * 0.15;
    ro.xz *= rot2(rotateY + autoRot);
    rd.xz *= rot2(rotateY + autoRot);
    ro.yz *= rot2(rotateX + sin(t * 0.2) * 0.1);
    rd.yz *= rot2(rotateX + sin(t * 0.2) * 0.1);

    vec3 col = vec3(0.0);

    // Chromatic aberration - trace RGB with slight direction offsets
    float caStr = chromaticAberr * 0.008;
    vec3 rdR = normalize(rd + vec3(caStr, 0, 0));
    vec3 rdG = rd;
    vec3 rdB = normalize(rd + vec3(-caStr, 0, 0));

    // Volumetric accumulation
    float volAccum = 0.0;
    vec3 volCol = vec3(0.0);

    // Main trace (green channel, also used for surface shading reference)
    float totalDist = 0.0;
    bool hit = false;
    vec3 hitPos;

    for (int i = 0; i < 80; i++) {
        vec3 pos = ro + rdG * totalDist;
        float d = quantumSDF(pos, t);

        // Volumetric glow
        float glow = exp(-max(d, 0.02) * 4.0) * volumetric * 0.015;
        vec3 vor = voronoi(pos.xz * voronoiScale * 0.5, t * 0.3);
        float hue = fract(hueBase + vor.z * 0.3 + totalDist * 0.03);
        volCol += hsv2rgb(vec3(hue, 0.5, 1.0)) * glow;
        volAccum += glow;

        if (d < 0.002) {
            hit = true;
            hitPos = pos;
            break;
        }
        if (totalDist > 10.0) break;
        totalDist += d;
    }

    if (hit) {
        vec2 e = vec2(0.003, 0.0);
        vec3 nor = normalize(vec3(
            quantumSDF(hitPos + e.xyy, t) - quantumSDF(hitPos - e.xyy, t),
            quantumSDF(hitPos + e.yxy, t) - quantumSDF(hitPos - e.yxy, t),
            quantumSDF(hitPos + e.yyx, t) - quantumSDF(hitPos - e.yyx, t)
        ));

        vec3 vor = voronoi(hitPos.xz * voronoiScale, t * 0.4);
        float edge = vor.y - vor.x;
        float cellId = vor.z;

        // Lighting
        vec3 light = normalize(vec3(0.6, 0.8, -0.3));
        float diff = max(dot(nor, light), 0.0);
        float spec = pow(max(dot(reflect(-light, nor), -rdG), 0.0), 48.0);
        float fres = pow(1.0 - abs(dot(nor, -rdG)), 3.0);

        float hue = fract(hueBase + cellId * 0.4 + fres * 0.2);

        // Chromatic surface color
        col.r = hsv2rgb(vec3(fract(hue - chromaticAberr * 0.05), 0.7, 0.85)).r;
        col.g = hsv2rgb(vec3(hue, 0.7, 0.85)).g;
        col.b = hsv2rgb(vec3(fract(hue + chromaticAberr * 0.05), 0.7, 0.85)).b;

        col *= (0.1 + diff * 0.65);
        col += spec * 0.6;

        // Edge bloom
        float edgeBloom = exp(-edge * 20.0) * bloomStr;
        col += hsv2rgb(vec3(fract(hue + 0.15), 0.4, 1.0)) * edgeBloom;

        // Fresnel
        col += fres * 0.3 * hsv2rgb(vec3(fract(hue + 0.3), 0.3, 1.0));

        // Extrusion shadow
        float extShadow = smoothstep(0.0, 0.08, edge);
        col *= 0.6 + 0.4 * extShadow;

        // Fog
        float fog = exp(-totalDist * 0.15);
        col = mix(vec3(0.01, 0.005, 0.02), col, fog);
    }

    // Add volumetric
    col += volCol;

    // Background
    if (!hit) {
        float bg = exp(-length(uv) * 1.2) * 0.06;
        col += hsv2rgb(vec3(hueBase, 0.3, bg));
    }

    // Bloom post-process approximation
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float bloomMask = smoothstep(0.5, 1.5, lum);
    col += col * bloomMask * bloomStr * 0.3;

    // Tone map
    col = 1.0 - exp(-col * 1.8);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
