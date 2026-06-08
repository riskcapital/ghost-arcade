/*{
    "DESCRIPTION": "Crystalline voronoi with octahedral folding and prismatic light refraction. Combines orbital symmetry folding from tweetable GLSL with extruded voronoi cells creating an infinite crystal void.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Voronoi"],
    "INPUTS": [
        { "NAME": "foldIterations", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 9.0, "LABEL": "Fold Depth" },
        { "NAME": "prismSpread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Prismatic Spread" },
        { "NAME": "rotSpeed", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rotation Speed" },
        { "NAME": "zoom", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.2, "MAX": 2.0, "LABEL": "Zoom" },
        { "NAME": "voronoiScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0, "LABEL": "Voronoi Scale" },
        { "NAME": "extrudeAmt", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Crystal Extrusion" },
        { "NAME": "brightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0, "LABEL": "Brightness" },
        { "NAME": "colorBase", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0, "LABEL": "Base Color" },
        { "NAME": "reflections", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Reflections" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// Octahedral fold - from crystallographic symmetry
vec3 octFold(vec3 p) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    return p;
}

vec3 voronoi(vec2 uv) {
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);
    float d1 = 8.0, d2 = 8.0;
    float id = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 nb = vec2(float(i), float(j));
            vec2 pt = hash2(ip + nb);
            pt = 0.5 + 0.5 * sin(TIME * rotSpeed * 0.5 + 6.2831 * pt);
            vec2 diff = nb + pt - fp;
            float dist = length(diff);
            if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
            else if (dist < d2) { d2 = dist; }
        }
    }
    return vec3(d1, d2, id);
}

// Folded crystal SDF with voronoi surface detail
float crystalSDF(vec3 p) {
    float t = TIME * rotSpeed;
    float d = 9.0;

    // Iterative octahedral folding with rotation
    int folds = int(foldIterations);
    for (int i = 0; i < 9; i++) {
        if (i >= folds) break;
        float fi = float(i);
        p.xz *= rot2(t * 0.2 + fi * 0.3);
        p.yz *= rot2(t * 0.15 - fi * 0.2);
        p = octFold(p);
        p -= vec3(0.5 + fi * 0.08);
        d = min(d, length(max(abs(p) - 0.2 * (1.0 + fi * 0.1), 0.0)) - 0.02);
    }

    // Voronoi surface displacement on the crystal
    vec2 vuv = p.xz * voronoiScale;
    vec3 vor = voronoi(vuv);
    float cellExtrude = vor.z * extrudeAmt * 0.15;
    float edgeCut = smoothstep(0.0, 0.04, vor.y - vor.x);

    d -= cellExtrude * edgeCut;

    return d;
}

vec3 crystalNormal(vec3 p) {
    vec2 e = vec2(0.003, 0.0);
    return normalize(vec3(
        crystalSDF(p + e.xyy) - crystalSDF(p - e.xyy),
        crystalSDF(p + e.yxy) - crystalSDF(p - e.yxy),
        crystalSDF(p + e.yyx) - crystalSDF(p - e.yyx)
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

    // Primary ray
    for (int i = 0; i < 80; i++) {
        vec3 pos = ro + rd * totalDist;
        float d = crystalSDF(pos);
        if (d < 0.001) { hit = true; break; }
        if (totalDist > 15.0) break;
        totalDist += d;
    }

    if (hit) {
        vec3 pos = ro + rd * totalDist;
        vec3 nor = crystalNormal(pos);

        // Voronoi query at hit point for coloring
        vec3 foldedP = pos;
        int folds = int(foldIterations);
        for (int i = 0; i < 9; i++) {
            if (i >= folds) break;
            float fi = float(i);
            foldedP.xz *= rot2(t * 0.2 + fi * 0.3);
            foldedP.yz *= rot2(t * 0.15 - fi * 0.2);
            foldedP = octFold(foldedP);
            foldedP -= vec3(0.5 + fi * 0.08);
        }
        vec3 vor = voronoi(foldedP.xz * voronoiScale);

        // Prismatic dispersion - offset RGB channels
        float fresnel = pow(1.0 - abs(dot(nor, -rd)), 3.0);
        float hue = fract(vor.z + colorBase + fresnel * prismSpread);

        // Three channel prismatic split
        vec3 prismatic;
        prismatic.r = hsv2rgb(vec3(fract(hue - prismSpread * 0.1), 0.7, 0.9)).r;
        prismatic.g = hsv2rgb(vec3(hue, 0.7, 0.9)).g;
        prismatic.b = hsv2rgb(vec3(fract(hue + prismSpread * 0.1), 0.7, 0.9)).b;

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 0.8, -0.3));
        float diff = max(dot(nor, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 64.0);

        col = prismatic * (0.12 + diff * 0.6);
        col += spec * 0.7 * vec3(1.0);

        // Edge glow from voronoi
        float edge = vor.y - vor.x;
        float edgeGlow = exp(-edge * 25.0) * 0.8;
        col += hsv2rgb(vec3(fract(hue + 0.2), 0.5, 1.0)) * edgeGlow;

        // Fresnel reflection
        col += fresnel * reflections * 0.4 * hsv2rgb(vec3(fract(hue + 0.3), 0.3, 1.0));

        // Volumetric glow accumulation
        float glowAccum = exp(-totalDist * 0.3) * 0.2;
        col += hsv2rgb(vec3(colorBase, 0.4, glowAccum));
    } else {
        // Background void with subtle nebula
        float bgGlow = exp(-length(uv) * 1.5) * 0.1;
        col = hsv2rgb(vec3(colorBase, 0.3, bgGlow));
    }

    col *= brightness;

    // Tone map
    col = col / (1.0 + col);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
