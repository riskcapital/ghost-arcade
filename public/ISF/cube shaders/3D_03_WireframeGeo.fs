/*{
    "DESCRIPTION": "Wireframe geodesic spheres and solid spheres with colorful palette, ray-marched SDF",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 12.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "wireThickness", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.005, "MAX": 0.08},
        {"NAME": "meshDensity", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 12.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Hash ---
float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
}

float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

// --- Rotation around Y ---
vec3 rotY(vec3 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// --- Rotation around X ---
vec3 rotX(vec3 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

// --- SDF: Solid sphere ---
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

// --- Wireframe sphere: sphere shell carved by great circle lines ---
float sdWireframeSphere(vec3 p, float r, float thick, float dens) {
    float sphereDist = abs(length(p) - r) - thick;

    // Great circles: distance to planes through origin
    // Use multiple orientations for geodesic look
    vec3 n = normalize(p);

    // Latitude lines
    float latLines = abs(fract(n.y * dens * 0.5 + 0.5) - 0.5) * 2.0;
    float lat = latLines * r / dens;

    // Longitude lines
    float lon = abs(fract(atan(n.z, n.x) * dens / 6.283 + 0.5) - 0.5) * 2.0;
    lon *= r / dens;

    // Diagonal great circles (geodesic feel)
    float diag1 = abs(fract((n.x + n.y) * dens * 0.35 + 0.5) - 0.5) * 2.0;
    diag1 *= r / dens;
    float diag2 = abs(fract((n.z + n.y) * dens * 0.35 + 0.5) - 0.5) * 2.0;
    diag2 *= r / dens;

    // Combine: distance to nearest wire
    float wireDist = min(min(lat, lon), min(diag1, diag2));

    // Intersection: on sphere AND near a wire
    return max(sphereDist, wireDist - thick);
}

// --- Scene layout: 5 spheres ---
// idx 0: large center wireframe
// idx 1: medium wireframe upper-right
// idx 2: small solid pink
// idx 3: medium wireframe lower-left
// idx 4: small solid teal

int gHitId;

vec3 objPos(int idx, float t) {
    if (idx == 0) return vec3(0.0, 0.0, 0.0);
    if (idx == 1) return vec3(2.2, 1.0, -0.5) + vec3(sin(t * 0.4) * 0.3, cos(t * 0.3) * 0.2, 0.0);
    if (idx == 2) return vec3(-1.8, -0.5, 1.0) + vec3(0.0, sin(t * 0.5) * 0.3, cos(t * 0.35) * 0.2);
    if (idx == 3) return vec3(-1.5, 1.5, -1.5) + vec3(cos(t * 0.3) * 0.2, 0.0, sin(t * 0.45) * 0.3);
    return vec3(1.5, -1.2, 1.5) + vec3(sin(t * 0.35) * 0.2, cos(t * 0.4) * 0.3, 0.0);
}

float objRadius(int idx) {
    if (idx == 0) return 1.3;
    if (idx == 1) return 0.8;
    if (idx == 2) return 0.45;
    if (idx == 3) return 0.7;
    return 0.4;
}

// 0 = wireframe, 1 = solid
float objType(int idx) {
    if (idx == 0) return 0.0;
    if (idx == 1) return 0.0;
    if (idx == 2) return 1.0;
    if (idx == 3) return 0.0;
    return 1.0;
}

// palette: pink, purple, teal, yellow
vec3 objColor(int idx, float shift) {
    vec3 c;
    if (idx == 0) c = vec3(0.7, 0.3, 0.85);      // purple
    else if (idx == 1) c = vec3(0.2, 0.85, 0.75);  // teal
    else if (idx == 2) c = vec3(0.95, 0.4, 0.55);  // pink
    else if (idx == 3) c = vec3(0.9, 0.85, 0.25);  // yellow
    else c = vec3(0.3, 0.8, 0.9);                   // cyan

    // Apply color shift
    float cs = cos(shift);
    float ss = sin(shift);
    float r = c.r * cs - c.g * ss;
    float g = c.r * ss + c.g * cs;
    c.r = clamp(r, 0.0, 1.0);
    c.g = clamp(g, 0.0, 1.0);
    return c;
}

float map(vec3 p, float t) {
    float d = 1e10;
    gHitId = 0;

    float beatPulse = 1.0 + audioBeat * 0.15;

    for (int i = 0; i < 5; i++) {
        vec3 sp = objPos(i, t);
        float r = objRadius(i) * beatPulse;
        vec3 lp = p - sp;

        // Each object rotates
        float fi = float(i);
        lp = rotY(lp, t * (0.2 + fi * 0.1));
        lp = rotX(lp, t * (0.15 + fi * 0.08));

        float sd;
        if (objType(i) < 0.5) {
            // Wireframe sphere
            sd = sdWireframeSphere(lp, r, wireThickness, meshDensity);
        } else {
            // Solid sphere
            sd = sdSphere(lp, r * 0.9);
        }

        if (sd < d) {
            d = sd;
            gHitId = i;
        }
    }
    return d;
}

vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy, t) - map(p - e.xyy, t),
        map(p + e.yxy, t) - map(p - e.yxy, t),
        map(p + e.yyx, t) - map(p - e.yyx, t)
    ));
}

float calcAO(vec3 p, vec3 n, float t) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float h = 0.02 + 0.1 * fi;
        float d = map(p + n * h, t);
        ao += (h - d) * scale;
        scale *= 0.6;
    }
    return clamp(1.0 - 2.5 * ao, 0.0, 1.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera
    float camAngle = t * 0.25;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        1.0 + sin(t * 0.2) * 0.8,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.2, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Dark background with subtle gradient
    vec3 bg = mix(vec3(0.06, 0.04, 0.1), vec3(0.12, 0.08, 0.18), smoothstep(-0.3, 0.8, rd.y));
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
        if (dist > 30.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        map(p, t);
        int hitId = gHitId;

        vec3 n = calcNormal(p, t);
        float ao = calcAO(p, n, t);

        vec3 objCol = objColor(hitId, colorShift);

        // Two-point lighting
        vec3 l1 = normalize(vec3(3.0, 5.0, 2.0));
        vec3 l2 = normalize(vec3(-2.0, 2.0, -3.0));

        float diff1 = max(dot(n, l1), 0.0);
        float diff2 = max(dot(n, l2), 0.0) * 0.35;
        float amb = 0.15;

        // Specular
        vec3 h1 = normalize(l1 - rd);
        float spec = pow(max(dot(n, h1), 0.0), 32.0) * 0.5;

        float lighting = amb + (diff1 + diff2) * ao;

        if (objType(hitId) < 0.5) {
            // Wireframe: emissive colored
            col = objCol * (0.5 + lighting * 0.8) * intensity;
            col += objCol * 0.3; // self-illumination
            col += vec3(spec) * 0.3;
            // Audio glow on wireframe
            col += objCol * audioHigh * 0.2;
        } else {
            // Solid: matte
            col = objCol * lighting * intensity;
            col += vec3(spec) * 0.2;
        }

        // Rim light
        float rim = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
        col += objCol * rim * 0.25;

        // Fog
        float fog = 1.0 - exp(-0.01 * dist * dist);
        col = mix(col, bg, fog);
    }

    // Vignette
    float vig = 1.0 - 0.4 * length(uv);
    col *= vig;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
