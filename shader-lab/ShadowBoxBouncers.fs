/*{
    "DESCRIPTION": "Shadow Box Bouncers - 3D chamber with diffusely lit greyscale walls, N bouncing 3D spheres, soft cast shadows projected onto the walls. Optional wall reflectivity mirrors the scene. The chamber's front face is the layer rectangle.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",              "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "sphereCount",        "TYPE": "float", "DEFAULT": 8.0,  "MIN": 1.0,   "MAX": 16.0},
        {"NAME": "sphereRadius",       "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.01,  "MAX": 0.22},
        {"NAME": "turbulence",         "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "turbulenceScale",    "TYPE": "float", "DEFAULT": 2.5,  "MIN": 0.5,   "MAX": 8.0},
        {"NAME": "focalLength",        "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "vanishPointX",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lightAzimuth",       "TYPE": "float", "DEFAULT": -0.3, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "lightElevation",     "TYPE": "float", "DEFAULT": 0.6,  "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "wallAmbient",        "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "wallBright",         "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "wallReflection",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "sphereBright",       "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "sphereSpecular",     "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 1.5},
        {"NAME": "shadowStrength",     "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowSoftness",     "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "cornerAO",           "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "hairlineWidth",      "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.15},
        {"NAME": "hairlineBrightness", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wallColor",          "TYPE": "color", "DEFAULT": [0.78, 0.79, 0.82, 1.0]},
        {"NAME": "wallShadowColor",    "TYPE": "color", "DEFAULT": [0.12, 0.12, 0.14, 1.0]},
        {"NAME": "sphereColor",        "TYPE": "color", "DEFAULT": [1.0, 0.96, 0.90, 1.0]},
        {"NAME": "hairlineColor",      "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "bgColor",            "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

float hash1(float n) { return fract(sin(n * 43.1 + 17.3) * 43758.5453); }
float hash3(vec3 p)  { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

float noise3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash3(i);
    float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

vec3 curl3(vec3 p) {
    return vec3(noise3(p), noise3(p + 19.3), noise3(p + 43.7)) * 2.0 - 1.0;
}

float tri01(float x) { return abs(fract(x * 0.5) * 2.0 - 1.0); }

vec3 spherePos(float id, float t, float r, float turb, float scale) {
    float vx = 0.45 + 0.85 * hash1(id * 1.17);
    float vy = 0.45 + 0.85 * hash1(id * 2.31 + 9.1);
    float vz = 0.45 + 0.85 * hash1(id * 3.71 + 17.3);
    float ox = hash1(id * 5.13 + 23.7) * 10.0;
    float oy = hash1(id * 6.27 + 31.1) * 10.0;
    float oz = hash1(id * 7.91 + 41.3) * 10.0;
    vec3 base = mix(vec3(r), vec3(1.0 - r),
                    vec3(tri01(t * vx + ox), tri01(t * vy + oy), tri01(t * vz + oz)));
    if (turb > 0.0) {
        vec3 off = curl3(base * scale + vec3(id * 5.17, 0.0, t * 0.5)) * turb * 0.18;
        base = clamp(base + off, vec3(r * 0.6), vec3(1.0 - r * 0.6));
    }
    return base;
}

float raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    float det = b * b - dot(oc, oc) + r * r;
    if (det < 0.0) return -1.0;
    float s = sqrt(det);
    float t = -b - s;
    return (t > 0.0) ? t : (-b + s);
}

float softShadow(vec3 p, vec3 L, vec3 c, float r, float strength, float soft) {
    vec3 oc = p - c;
    float b = dot(oc, L);
    if (b > 0.0) return 1.0;
    float dLine = sqrt(max(0.0, dot(oc, oc) - b * b));
    float outer = r * (1.0 + 0.8 * soft);
    float inner = r * 0.35;
    float sh = smoothstep(inner, outer, dLine);
    return mix(1.0 - strength, 1.0, sh);
}

// Intersect scene and shade. hitWallFlag > 0.5 signals wall hit (reflection candidate).
void intersectAndShade(vec3 ro, vec3 rd, vec3 L, float t, int N,
                        out vec3 colOut, out float hitWallFlag,
                        out vec3 wallPosOut, out vec3 wallNOut) {
    vec3 inv = 1.0 / rd;
    vec3 tA = -ro * inv;
    vec3 tB = (1.0 - ro) * inv;
    vec3 tFv = max(tA, tB);
    float tFar = min(min(tFv.x, tFv.y), tFv.z);
    vec3 wallN;
    if (tFv.x <= tFv.y && tFv.x <= tFv.z)  wallN = vec3(-sign(rd.x), 0.0, 0.0);
    else if (tFv.y <= tFv.z)               wallN = vec3(0.0, -sign(rd.y), 0.0);
    else                                   wallN = vec3(0.0, 0.0, -sign(rd.z));

    float tSph = tFar;
    int hit = -1;
    vec3 hitCenter = vec3(0.0);
    for (int i = 0; i < 16; i++) {
        if (i >= N) break;
        vec3 c = spherePos(float(i), t, sphereRadius, turbulence, turbulenceScale);
        float ts = raySphere(ro, rd, c, sphereRadius);
        if (ts > 0.0 && ts < tSph) {
            tSph = ts;
            hit = i;
            hitCenter = c;
        }
    }

    hitWallFlag = 0.0;
    wallPosOut = vec3(0.0);
    wallNOut = vec3(0.0);

    if (hit >= 0) {
        vec3 p = ro + rd * tSph;
        vec3 n = normalize(p - hitCenter);
        float diff = max(dot(n, L), 0.0);
        vec3 H = normalize(L - rd);
        float spec = pow(max(dot(n, H), 0.0), 48.0) * sphereSpecular;
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.5) * 0.25;
        colOut = sphereColor.rgb * (wallAmbient * 0.8 + diff * sphereBright) + vec3(spec + rim);
    } else if (tFar > 0.0) {
        vec3 p = ro + rd * tFar;
        float diff = max(dot(wallN, L), 0.0);
        vec3 lit = wallColor.rgb * (wallAmbient + diff * wallBright);

        vec3 absN = abs(wallN);
        vec3 along = 1.0 - absN;
        vec3 dFaces = min(p, 1.0 - p) * along + absN;
        float dEdge = min(min(dFaces.x, dFaces.y), dFaces.z);
        float ao = mix(1.0, smoothstep(0.0, 0.15, dEdge), cornerAO);

        float shadow = 1.0;
        for (int i = 0; i < 16; i++) {
            if (i >= N) break;
            vec3 c = spherePos(float(i), t, sphereRadius, turbulence, turbulenceScale);
            shadow *= softShadow(p, L, c, sphereRadius, shadowStrength, shadowSoftness);
        }

        colOut = mix(wallShadowColor.rgb, lit, shadow) * ao;
        hitWallFlag = 1.0;
        wallPosOut = p;
        wallNOut = wallN;
    } else {
        colOut = bgColor.rgb;
    }
}

vec3 shadeOnce(vec3 ro, vec3 rd, vec3 L, float t, int N) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, col, hw, wp, wn);
    return col;
}

vec3 shadeOuter(vec3 ro, vec3 rd, vec3 L, float t, int N) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, col, hw, wp, wn);
    if (hw > 0.5 && wallReflection > 0.0) {
        vec3 reflDir = reflect(rd, wn);
        vec3 reflOrigin = wp + wn * 0.001;
        vec3 reflCol = shadeOnce(reflOrigin, reflDir, L, t, N);
        col = mix(col, reflCol, wallReflection);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    int N = int(sphereCount);

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float lz = -sqrt(max(0.0,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, lz - 0.2));

    vec3 col = shadeOuter(ro, rd, L, t, N);

    float ex = min(uv.x, 1.0 - uv.x);
    float ey = min(uv.y, 1.0 - uv.y);
    float edgeDist = min(ex, ey);
    if (hairlineWidth > 0.0) {
        float hair = 1.0 - smoothstep(hairlineWidth * 0.6, hairlineWidth, edgeDist);
        col = mix(col, hairlineColor.rgb * hairlineBrightness, hair);
    }

    gl_FragColor = vec4(col, 1.0);
}
