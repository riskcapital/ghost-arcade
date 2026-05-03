/*{
    "DESCRIPTION": "Dense cluster of colorful matte spheres like a pile of gumballs, ray-marched with spatial repetition",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.2, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 12.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "sphereSize", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.05, "MAX": 0.6},
        {"NAME": "density", "TYPE": "float", "DEFAULT": 1.3, "MIN": 0.5, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Hashing ---
float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
    float a = hash31(p);
    float b = hash31(p + 71.7);
    float c = hash31(p + 143.3);
    return vec3(a, b, c);
}

// --- 4-color palette: pink, green, purple, white ---
vec3 palette(float id, float shift) {
    float idx = mod(floor(id * 4.0), 4.0);
    vec3 col;
    if (idx < 1.0) {
        col = vec3(0.95, 0.4, 0.6);   // pink
    } else if (idx < 2.0) {
        col = vec3(0.3, 0.85, 0.5);   // green
    } else if (idx < 3.0) {
        col = vec3(0.6, 0.3, 0.9);    // purple
    } else {
        col = vec3(0.95, 0.95, 0.97); // white
    }
    // Rotate hue slightly with colorShift
    float cs = cos(shift);
    float ss = sin(shift);
    float r = col.r * cs - col.g * ss;
    float g = col.r * ss + col.g * cs;
    col.r = clamp(r, 0.0, 1.0);
    col.g = clamp(g, 0.0, 1.0);
    return col;
}

// --- SDF: Sphere ---
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

// --- Bounding sphere for the cluster ---
float sdBoundingSphere(vec3 p) {
    return length(p) - 3.5;
}

// --- Scene SDF ---
float cellSize;
vec3 gCellId;  // current cell id for coloring

float map(vec3 p) {
    // Bounding sphere to limit the cluster
    float bound = sdBoundingSphere(p);
    if (bound > 1.0) return bound;

    cellSize = density;
    vec3 q = p / cellSize;
    vec3 cellId = floor(q + 0.5);
    vec3 cellPos = fract(q + 0.5) - 0.5;

    // Jitter sphere position within cell
    vec3 jitter = hash33(cellId) * 0.4 - 0.2;

    // Audio-reactive sphere size
    float beatPulse = 1.0 + audioBeat * 0.3 * intensity;
    float baseR = sphereSize * beatPulse;

    // Per-cell size variation
    float sizeVar = 0.7 + 0.6 * hash31(cellId + 7.7);
    float r = baseR * sizeVar / cellSize;

    float d = sdSphere(cellPos - jitter, r) * cellSize;

    // Clip to bounding sphere
    d = max(d, bound);

    gCellId = cellId;
    return d;
}

// --- Normal via gradient ---
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// --- Soft ambient occlusion ---
float calcAO(vec3 p, vec3 n) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float h = 0.01 + 0.12 * fi;
        float d = map(p + n * h);
        ao += (h - d) * scale;
        scale *= 0.65;
    }
    return clamp(1.0 - 2.0 * ao, 0.0, 1.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbits
    float camAngle = t * 0.4;
    float camH = sin(t * 0.2) * 1.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH + 1.0,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    // Camera matrix
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Light grey background
    vec3 bgColor = vec3(0.85, 0.86, 0.88);
    vec3 col = bgColor;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 64; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 30.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;

        // Re-evaluate to get the cell ID at hit point
        map(p);
        vec3 cellId = gCellId;

        vec3 n = calcNormal(p);
        float ao = calcAO(p, n);

        // Sphere color from palette
        float hv = hash31(cellId);
        vec3 sphereCol = palette(hv, colorShift);
        sphereCol *= intensity * 0.8;

        // Lighting: two-point + ambient
        vec3 lightDir1 = normalize(vec3(2.0, 4.0, 3.0));
        vec3 lightDir2 = normalize(vec3(-3.0, 1.0, -2.0));

        float diff1 = max(dot(n, lightDir1), 0.0);
        float diff2 = max(dot(n, lightDir2), 0.0) * 0.4;
        float ambient = 0.25;

        // Soft shadow approximation via AO
        float lighting = ambient + (diff1 + diff2) * ao;

        // Matte Phong: mild specular
        vec3 halfDir = normalize(lightDir1 - rd);
        float spec = pow(max(dot(n, halfDir), 0.0), 16.0) * 0.15;

        col = sphereCol * lighting + vec3(spec);

        // Fog toward background color
        float fog = 1.0 - exp(-0.015 * dist * dist);
        col = mix(col, bgColor, fog);
    }

    // Audio-reactive subtle vignette
    float vignette = 1.0 - 0.3 * length(uv) * (1.0 + audioBass * 0.5);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
