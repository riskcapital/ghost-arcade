/*{
    "DESCRIPTION": "Floating field of solid cubes, wireframe cubes, and spheres with purple-pink palette",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 7.0, "MIN": 3.0, "MAX": 15.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "objectSize", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 0.6},
        {"NAME": "spacing", "TYPE": "float", "DEFAULT": 2.0, "MIN": 1.0, "MAX": 4.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Hash functions ---
float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
    return vec3(hash31(p), hash31(p + 71.7), hash31(p + 143.3));
}

// --- Rotation ---
vec3 rotY(vec3 p, float a) {
    float c = cos(a); float s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 rotX(vec3 p, float a) {
    float c = cos(a); float s = sin(a);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

vec3 rotZ(vec3 p, float a) {
    float c = cos(a); float s = sin(a);
    return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// --- SDF: Box ---
float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// --- SDF: Box Frame ---
float sdBoxFrame(vec3 p, vec3 b, float e) {
    p = abs(p) - b;
    vec3 q = abs(p + e) - e;
    return min(min(
        length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}

// --- SDF: Sphere ---
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

// --- Bounding region ---
float sdBound(vec3 p) {
    return length(p) - 8.0;
}

// --- Scene ---
vec3 gCellId;
float gObjType; // 0=solid cube, 1=wireframe cube, 2=sphere

float map(vec3 p, float t) {
    float bound = sdBound(p);
    if (bound > 2.0) return bound;

    // Spatial repetition
    vec3 q = p / spacing;
    vec3 cellId = floor(q + 0.5);
    vec3 cellPos = (fract(q + 0.5) - 0.5) * spacing;

    // Per-cell properties
    float h1 = hash31(cellId);
    float h2 = hash31(cellId + 33.3);
    float h3 = hash31(cellId + 66.6);

    // Skip some cells for variety
    if (h1 < 0.25) {
        gCellId = cellId;
        gObjType = -1.0;
        return bound;
    }

    // Object type: 0-0.4 solid cube, 0.4-0.7 wireframe cube, 0.7-1.0 sphere
    float typeVal = h2;

    // Audio beat shakes positions
    vec3 shake = (hash33(cellId + 99.9) - 0.5) * audioBeat * 0.3;
    vec3 lp = cellPos - shake;

    // Per-cell rotation
    float rotAngle = h3 * 6.28 + t * (0.3 + h1 * 0.4);
    float rotAngle2 = h2 * 3.14 + t * 0.2;
    lp = rotY(lp, rotAngle);
    lp = rotX(lp, rotAngle2);

    // Size variation
    float sizeVar = 0.6 + h3 * 0.8;
    float sz = objectSize * sizeVar;

    // Audio-reactive size
    float beatSz = 1.0 + audioBass * 0.15;
    sz *= beatSz;

    float d;
    float objType;
    if (typeVal < 0.4) {
        // Solid cube
        d = sdBox(lp, vec3(sz));
        objType = 0.0;
    } else if (typeVal < 0.7) {
        // Wireframe cube
        d = sdBoxFrame(lp, vec3(sz), sz * 0.12);
        objType = 1.0;
    } else {
        // Sphere
        d = sdSphere(lp, sz * 0.9);
        objType = 2.0;
    }

    d = max(d, bound);

    gCellId = cellId;
    gObjType = objType;
    return d;
}

// --- Normal ---
vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy, t) - map(p - e.xyy, t),
        map(p + e.yxy, t) - map(p - e.yxy, t),
        map(p + e.yyx, t) - map(p - e.yyx, t)
    ));
}

// --- AO ---
float calcAO(vec3 p, vec3 n, float t) {
    float ao = 0.0;
    float s = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float h = 0.02 + 0.1 * fi;
        float d = map(p + n * h, t);
        ao += (h - d) * s;
        s *= 0.6;
    }
    return clamp(1.0 - 2.5 * ao, 0.0, 1.0);
}

// --- Color palette: purple/pink/dark ---
vec3 objColor(vec3 cellId, float objType, float shift) {
    float h = hash31(cellId + 200.0);
    vec3 col;

    if (objType < 0.5) {
        // Solid cube: purples and dark
        col = mix(vec3(0.35, 0.15, 0.6), vec3(0.15, 0.08, 0.25), h);
    } else if (objType < 1.5) {
        // Wireframe cube: pinks and magentas
        col = mix(vec3(0.9, 0.3, 0.55), vec3(0.7, 0.2, 0.8), h);
    } else {
        // Sphere: lighter pinks and whites
        col = mix(vec3(0.85, 0.5, 0.65), vec3(0.6, 0.4, 0.85), h);
    }

    // Apply color shift
    float cs = cos(shift);
    float ss = sin(shift);
    float r = col.r * cs - col.g * ss;
    float g = col.r * ss + col.g * cs;
    col.r = clamp(r, 0.0, 1.0);
    col.g = clamp(g, 0.0, 1.0);

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbit
    float camAngle = t * 0.2;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        2.0 + sin(t * 0.15) * 1.5,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Dark purple background
    vec3 bg = mix(vec3(0.04, 0.02, 0.08), vec3(0.08, 0.04, 0.15), smoothstep(-0.3, 0.8, rd.y));
    // Subtle stars
    float starHash = hash31(vec3(floor(rd * 200.0)));
    bg += vec3(0.5) * step(0.995, starHash);

    vec3 col = bg;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 64; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p, t);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 35.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        map(p, t);
        vec3 cellId = gCellId;
        float hitType = gObjType;

        if (hitType >= 0.0) {
            vec3 n = calcNormal(p, t);
            float ao = calcAO(p, n, t);

            vec3 oCol = objColor(cellId, hitType, colorShift);

            // Lighting
            vec3 l1 = normalize(vec3(2.0, 5.0, 3.0));
            vec3 l2 = normalize(vec3(-3.0, 1.0, -2.0));

            float diff1 = max(dot(n, l1), 0.0);
            float diff2 = max(dot(n, l2), 0.0) * 0.3;
            float amb = 0.12;

            vec3 h1 = normalize(l1 - rd);
            float spec = pow(max(dot(n, h1), 0.0), 24.0) * 0.4;

            float lighting = amb + (diff1 + diff2) * ao;

            col = oCol * lighting * intensity;
            col += vec3(spec) * 0.3;

            // Wireframes get emissive boost
            if (hitType > 0.5 && hitType < 1.5) {
                col += oCol * 0.2;
                col += oCol * audioMid * 0.15;
            }

            // Rim light
            float rim = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
            col += oCol * rim * 0.15;

            // Fog
            float fog = 1.0 - exp(-0.005 * dist * dist);
            col = mix(col, bg, fog);
        }
    }

    // Audio-reactive subtle pulse on background
    col += bg * audioBeat * 0.15;

    // Vignette
    float vig = 1.0 - 0.35 * length(uv);
    col *= vig;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
