/*{
    "DESCRIPTION": "Wireframe crystalline void using octahedral folding. Same geometry as Prismatic Void but renders only glowing edges against deep black.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Crystal"],
    "INPUTS": [
        { "NAME": "foldIterations", "TYPE": "float", "DEFAULT": 6.0, "MIN": 1.0, "MAX": 9.0, "LABEL": "Fold Depth" },
        { "NAME": "rotSpeed", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rotation Speed" },
        { "NAME": "zoom", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.2, "MAX": 2.0, "LABEL": "Zoom" },
        { "NAME": "edgeWidth", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.01, "MAX": 0.2, "LABEL": "Edge Width" },
        { "NAME": "glowStr", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0, "LABEL": "Glow Strength" },
        { "NAME": "colorBase", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0, "LABEL": "Base Color" },
        { "NAME": "prismSpread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Prismatic Spread" },
        { "NAME": "brightness", "TYPE": "float", "DEFAULT": 1.2, "MIN": 0.3, "MAX": 3.0, "LABEL": "Brightness" },
        { "NAME": "voronoiScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0, "LABEL": "Voronoi Scale" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 rgb = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(rgb - 1.0, 0.0, 1.0), c.y);
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

vec3 octFold(vec3 p) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    return p;
}

vec3 voronoi(vec2 uv, float anim) {
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
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

// Same SDF as PrismaticVoid
float crystalSDF(vec3 p, float t) {
    float d = 9.0;
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
    return d;
}

// Fold position for edge detection (returns final folded p)
vec3 foldPos(vec3 p, float t) {
    int folds = int(foldIterations);
    for (int i = 0; i < 9; i++) {
        if (i >= folds) break;
        float fi = float(i);
        p.xz *= rot2(t * 0.2 + fi * 0.3);
        p.yz *= rot2(t * 0.15 - fi * 0.2);
        p = octFold(p);
        p -= vec3(0.5 + fi * 0.08);
    }
    return p;
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
        vec3 fp = foldPos(pos, t);

        // Normal
        vec2 e = vec2(0.003, 0.0);
        vec3 nor = normalize(vec3(
            crystalSDF(pos + e.xyy, t) - crystalSDF(pos - e.xyy, t),
            crystalSDF(pos + e.yxy, t) - crystalSDF(pos - e.yxy, t),
            crystalSDF(pos + e.yyx, t) - crystalSDF(pos - e.yyx, t)
        ));

        // Edge detection: edges occur where folded coordinates are near
        // box boundaries or fold planes
        vec3 ap = abs(fp);
        float boxSize = 0.2;
        vec3 edgeDist = abs(ap - boxSize);
        float minEdge = min(edgeDist.x, min(edgeDist.y, edgeDist.z));

        // Also detect fold plane edges (near zero in any axis)
        float foldEdge = min(abs(fp.x), min(abs(fp.y), abs(fp.z)));

        // Voronoi edges on the surface
        vec3 vor = voronoi(fp.xz * voronoiScale, t * 0.5);
        float vorEdge = vor.y - vor.x;

        // Combine edge signals
        float wire = smoothstep(edgeWidth, 0.0, minEdge);
        wire = max(wire, smoothstep(edgeWidth * 0.5, 0.0, foldEdge));
        wire = max(wire, smoothstep(edgeWidth * 0.7, 0.0, vorEdge));

        // Edge color with prismatic dispersion
        float fresnel = pow(1.0 - abs(dot(nor, -rd)), 3.0);
        float hue = fract(colorBase + vor.z * 0.3 + fresnel * prismSpread * 0.3);

        vec3 prismatic;
        prismatic.r = hsv2rgb(vec3(fract(hue - prismSpread * 0.1), 0.6, 1.0)).r;
        prismatic.g = hsv2rgb(vec3(hue, 0.6, 1.0)).g;
        prismatic.b = hsv2rgb(vec3(fract(hue + prismSpread * 0.1), 0.6, 1.0)).b;

        // Wire = bright edge, non-wire = nearly invisible
        float baseDim = 0.03;  // Very dim base surface
        col = prismatic * (baseDim + wire * glowStr);

        // Add fresnel glow on edges
        col += fresnel * wire * 0.3 * hsv2rgb(vec3(fract(hue + 0.2), 0.4, 1.0));

        // Specular on edges only
        vec3 lightDir = normalize(vec3(0.5, 0.8, -0.3));
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 32.0);
        col += spec * wire * 0.5;

        // Fog
        float fog = exp(-totalDist * 0.15);
        col = mix(vec3(0.005, 0.002, 0.01), col, fog);
    } else {
        float bgGlow = exp(-length(uv) * 2.0) * 0.04;
        col = hsv2rgb(vec3(colorBase, 0.3, bgGlow));
    }

    col *= brightness;
    col = col / (1.0 + col);
    col = pow(col, vec3(0.85));

    gl_FragColor = vec4(col, 1.0);
}
