/*{
    "DESCRIPTION": "Crystallon — a raymarched geometric KIFS (kaleidoscopic iterated function system). Space is folded by reflections, rotations and scaling, then a box/octahedron primitive is evaluated, building recursive crystalline polytopes — Sierpinski/Menger-like temples of hard geometry. Same glossy iridescent chrome material as Tendril (thin-film + specular + fresnel), bounded in a sphere so it floats in black, slowly rotating fold = endlessly morphing structure. Heavy (raymarched): made for a GPU.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Geometric"],
    "INPUTS": [
        { "NAME": "iterations",  "TYPE": "float", "DEFAULT": 4.0,  "MIN": 1.0,   "MAX": 10.0, "LABEL": "Fold Iterations" },
        { "NAME": "foldScale",   "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.20,  "MAX": 3.0,  "LABEL": "Fold Scale" },
        { "NAME": "offsetX",     "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Offset X" },
        { "NAME": "offsetY",     "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Offset Y" },
        { "NAME": "offsetZ",     "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Offset Z" },
        { "NAME": "rotA",        "TYPE": "float", "DEFAULT": 0.40, "MIN": -1.50, "MAX": 1.50, "LABEL": "Fold Rotate A" },
        { "NAME": "rotB",        "TYPE": "float", "DEFAULT": 0.60, "MIN": -1.50, "MAX": 1.50, "LABEL": "Fold Rotate B" },
        { "NAME": "spin",        "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Fold Morph" },
        { "NAME": "boxSize",     "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.10,  "MAX": 1.5,  "LABEL": "Cell Size" },
        { "NAME": "shapeMix",    "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Box / Octahedron" },
        { "NAME": "boundRadius", "TYPE": "float", "DEFAULT": 4.0,  "MIN": 1.0,   "MAX": 6.0,  "LABEL": "Bound Radius" },
        { "NAME": "camDist",     "TYPE": "float", "DEFAULT": 5.0,  "MIN": 2.0,   "MAX": 10.0, "LABEL": "Camera Distance" },
        { "NAME": "fov",         "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Field of View" },
        { "NAME": "orbitSpeed",  "TYPE": "float", "DEFAULT": 0.12, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Orbit Speed" },
        { "NAME": "camTilt",     "TYPE": "float", "DEFAULT": 0.30, "MIN": -1.5,  "MAX": 1.5,  "LABEL": "Camera Tilt" },
        { "NAME": "iridescence", "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Iridescence" },
        { "NAME": "hueByDepth",  "TYPE": "float", "DEFAULT": 0.30, "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Hue by Depth" },
        { "NAME": "hueByHeight", "TYPE": "float", "DEFAULT": 0.30, "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Hue by Height" },
        { "NAME": "hueSpread",   "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.30,  "MAX": 3.0,  "LABEL": "Hue Spread" },
        { "NAME": "hueShift",    "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Hue Shift" },
        { "NAME": "hueDrift",    "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.0,   "MAX": 0.50, "LABEL": "Hue Drift" },
        { "NAME": "specular",    "TYPE": "float", "DEFAULT": 1.30, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Specular" },
        { "NAME": "specPower",   "TYPE": "float", "DEFAULT": 40.0, "MIN": 2.0,   "MAX": 96.0, "LABEL": "Gloss Sharpness" },
        { "NAME": "fresnelStr",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Fresnel Rim" },
        { "NAME": "ao",          "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Crevice Shadow" },
        { "NAME": "fog",         "TYPE": "float", "DEFAULT": 0.10, "MIN": 0.0,   "MAX": 0.60, "LABEL": "Depth Fade" },
        { "NAME": "saturation",  "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",    "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",       "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "grain",       "TYPE": "float", "DEFAULT": 0.025,"MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define MARCH 100
#define FAR 16.0

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 pal(float t) {
    vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(hueSpread);
    vec3 d = vec3(0.0, 0.33, 0.67) + hueShift;
    return a + b * cos(TAU * (c * t + d));
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// Kaleidoscopic IFS: reflect, sort, rotate, scale+translate -> recursive
// geometric polytopes. Distance to a box/octahedron primitive at the end.
float map(vec3 P) {
    vec3 p = P;
    float scale = 1.0;
    vec3 off = vec3(offsetX, offsetY, offsetZ);
    // Bounded oscillation (NOT accumulation) so the fold rotation morphs
    // the crystal without ever drifting into the regime that collapses
    // the IFS to an empty point.
    float ra = rotA + spin * 0.4 * sin(TIME * 0.30);
    float rb = rotB + spin * 0.4 * cos(TIME * 0.27);

    for (int i = 0; i < 10; i++) {
        if (float(i) >= iterations) break;

        // Mirror folds.
        p = abs(p);
        // Octahedral sort folds (Sierpinski-style).
        if (p.x < p.y) p.xy = p.yx;
        if (p.x < p.z) p.xz = p.zx;
        if (p.y < p.z) p.yz = p.zy;

        // Rotate the cell.
        p.xy *= rot(ra);
        p.yz *= rot(rb);

        // Scale toward the offset corner (the IFS contraction).
        p = p * foldScale - off * (foldScale - 1.0);
        scale *= foldScale;
    }

    // Primitive: blend box <-> octahedron.
    float dBox = length(max(abs(p) - vec3(boxSize), 0.0))
               + min(max(abs(p).x - boxSize, max(abs(p).y - boxSize, abs(p).z - boxSize)), 0.0);
    float dOct = (abs(p.x) + abs(p.y) + abs(p.z) - boxSize * 1.5) * 0.57735;
    float d = mix(dBox, dOct, shapeMix) / scale;

    // Bound to a sphere (world space) so the form floats in black.
    d = max(d, length(P) - boundRadius);
    return d;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

void main() {
    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    // Orbiting camera.
    vec3 ro = vec3(0.0, 0.0, -camDist);
    vec3 rd = normalize(vec3(uv, fov));
    float yaw = TIME * orbitSpeed;
    ro.xz *= rot(yaw); rd.xz *= rot(yaw);
    ro.yz *= rot(camTilt); rd.yz *= rot(camTilt);

    // March.
    float t = 0.0, d = 0.0;
    bool hit = false;
    vec3 pos = ro;
    float steps = 0.0;
    for (int i = 0; i < MARCH; i++) {
        pos = ro + rd * t;
        d = map(pos);
        steps += 1.0;
        if (d < 0.0009 * (1.0 + t * 0.4)) { hit = true; break; }
        if (t > FAR) break;
        t += d * 0.9;
    }

    vec3 col = vec3(0.0);

    if (hit) {
        vec3 n = calcNormal(pos);
        vec3 v = -rd;
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);

        vec3 l1 = normalize(vec3(0.7, 0.85, -0.55));
        vec3 l2 = normalize(vec3(-0.5, 0.3, -0.8));
        float diff = max(dot(n, l1), 0.0) + 0.4 * max(dot(n, l2), 0.0);
        float spec = pow(max(dot(reflect(-l1, n), v), 0.0), specPower) * specular;

        // Cheap crevice shadow from march-step count (denser geometry = darker).
        float occ = 1.0 - ao * clamp(steps / float(MARCH), 0.0, 1.0);

        float irPhase = fres * iridescence * 3.0
                      + dot(n, v) * iridescence
                      + pos.y * hueByHeight
                      + length(pos) * hueByDepth
                      + TIME * hueDrift;
        vec3 base = pal(irPhase);

        col = base * (0.12 + 0.9 * diff) * occ;
        col += spec * mix(vec3(1.0), pal(irPhase + 0.25), 0.6);
        col += fres * fresnelStr * pal(irPhase + 0.4);
        col *= exp(-t * fog);
    } else {
        float halo = exp(-length(uv) * 2.2) * 0.05;
        col += halo * pal(TIME * hueDrift + 0.5);
    }

    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);

    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.6);
    col = pow(col, vec3(gamma));

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
