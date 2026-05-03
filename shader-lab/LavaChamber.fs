/*{
    "DESCRIPTION": "Lava Chamber - Metaball liquid flowing through a 3D chamber. N blobs bounce off the walls with slow lava-lamp motion; Wyvill-kernel density field fuses them into a single organic isosurface. Raymarched, Lambert-shaded, with blobs casting shadows on all chamber walls. Optional wall reflectivity mirrors the scene.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",              "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "blobCount",          "TYPE": "float", "DEFAULT": 6.0,  "MIN": 2.0,   "MAX": 12.0},
        {"NAME": "blobSize",           "TYPE": "float", "DEFAULT": 0.24, "MIN": 0.08,  "MAX": 0.5},
        {"NAME": "blobSizeVariance",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 0.8},
        {"NAME": "fuseThreshold",      "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.1,   "MAX": 0.9},
        {"NAME": "moveSpeed",          "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "verticalBias",       "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "turbulence",         "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "raymarchSteps",      "TYPE": "float", "DEFAULT": 42.0, "MIN": 16.0,  "MAX": 80.0},
        {"NAME": "focalLength",        "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "vanishPointX",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lightAzimuth",       "TYPE": "float", "DEFAULT": -0.3, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "lightElevation",     "TYPE": "float", "DEFAULT": 0.55, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "wallAmbient",        "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "wallBright",         "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "wallReflection",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "cornerAO",           "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "blobSpecular",       "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "blobGlow",           "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "blobAmbient",        "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowStrength",     "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowSoftness",     "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.0,   "MAX": 2.5},
        {"NAME": "shadowSize",         "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.1,   "MAX": 1.5},
        {"NAME": "hairlineWidth",      "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.15},
        {"NAME": "hairlineBrightness", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wallColor",          "TYPE": "color", "DEFAULT": [0.80, 0.79, 0.80, 1.0]},
        {"NAME": "wallShadowColor",    "TYPE": "color", "DEFAULT": [0.09, 0.08, 0.10, 1.0]},
        {"NAME": "blobColorA",         "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.1, 1.0]},
        {"NAME": "blobColorB",         "TYPE": "color", "DEFAULT": [1.0, 0.85, 0.3, 1.0]},
        {"NAME": "hairlineColor",      "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "bgColor",            "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

#define MAX_BLOBS 12
#define MAX_STEPS 80

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

float blobRadiusAt(float id) {
    return blobSize * mix(1.0 - blobSizeVariance * 0.5,
                          1.0 + blobSizeVariance * 0.5,
                          hash1(id * 13.47));
}

vec3 blobPos(float id, float t) {
    float R = blobRadiusAt(id) * 0.6;
    float vx = 0.35 + hash1(id * 1.17)        * 0.65;
    float vy = (0.25 + hash1(id * 2.31 + 9.1) * 0.55) * (1.0 - verticalBias * 0.6);
    float vz = 0.35 + hash1(id * 3.71 + 17.3) * 0.65;
    float ox = hash1(id * 5.13 + 23.7) * 10.0;
    float oy = hash1(id * 6.27 + 31.1) * 10.0;
    float oz = hash1(id * 7.91 + 41.3) * 10.0;

    vec3 base = mix(vec3(R), vec3(1.0 - R), vec3(
        tri01(t * moveSpeed * vx + ox),
        tri01(t * moveSpeed * vy + oy),
        tri01(t * moveSpeed * vz + oz)
    ));

    if (turbulence > 0.0) {
        vec3 off = curl3(base * 2.0 + vec3(id * 5.17, 0.0, t * 0.3))
                   * turbulence * 0.12;
        base = clamp(base + off, vec3(R), vec3(1.0 - R));
    }
    return base;
}

vec3 blobColor(float id) {
    return mix(blobColorA.rgb, blobColorB.rgb, hash1(id * 7.13));
}

float kernel(float r2, float R) {
    float R2 = R * R;
    if (r2 >= R2) return 0.0;
    float x = 1.0 - r2 / R2;
    return x * x * x;
}

float densityAt(vec3 p, float t, int N) {
    float D = 0.0;
    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= N) break;
        float fi = float(i);
        float R = blobRadiusAt(fi);
        vec3 c = blobPos(fi, t);
        vec3 d = p - c;
        D += kernel(dot(d, d), R);
    }
    return D;
}

void densityAndGrad(vec3 p, float t, int N, out float D, out vec3 G, out vec3 C) {
    D = 0.0;
    G = vec3(0.0);
    C = vec3(0.0);
    float wSum = 0.0;
    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= N) break;
        float fi = float(i);
        float R = blobRadiusAt(fi);
        vec3 c = blobPos(fi, t);
        vec3 diff = p - c;
        float r2 = dot(diff, diff);
        float R2 = R * R;
        if (r2 < R2) {
            float x = 1.0 - r2 / R2;
            float k = x * x * x;
            float dk = -6.0 / R2 * x * x;
            D += k;
            G += dk * diff;
            C += blobColor(fi) * k;
            wSum += k;
        }
    }
    if (wSum > 1e-4) C /= wSum;
    else             C = blobColorA.rgb;
}

float softShadow(vec3 p, vec3 L, vec3 c, float r, float strength, float soft) {
    vec3 oc = p - c;
    float b = dot(oc, L);
    if (b > 0.0) return 1.0;
    float d = sqrt(max(0.0, dot(oc, oc) - b * b));
    float outer = r * (1.0 + 1.2 * soft);
    float inner = r * 0.25;
    float sh = smoothstep(inner, outer, d);
    return mix(1.0 - strength, 1.0, sh);
}

void intersectAndShade(vec3 ro, vec3 rd, vec3 L, float t, int N, int STEPS,
                        out vec3 colOut, out float hitWallFlag,
                        out vec3 wallPosOut, out vec3 wallNOut) {
    vec3 inv = 1.0 / rd;
    vec3 tA = -ro * inv;
    vec3 tB = (1.0 - ro) * inv;
    vec3 tNv = min(tA, tB);
    vec3 tFv = max(tA, tB);
    float tNear = max(0.0, max(max(tNv.x, tNv.y), tNv.z));
    float tFar  = min(min(tFv.x, tFv.y), tFv.z);
    vec3 wallN;
    if (tFv.x <= tFv.y && tFv.x <= tFv.z)  wallN = vec3(-sign(rd.x), 0.0, 0.0);
    else if (tFv.y <= tFv.z)               wallN = vec3(0.0, -sign(rd.y), 0.0);
    else                                   wallN = vec3(0.0, 0.0, -sign(rd.z));
    vec3 wallPos = ro + rd * tFar;

    float tHit = -1.0;
    float prevD = 0.0;
    float stepSize = (tFar - tNear) / float(STEPS);
    for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= STEPS) break;
        float ti = tNear + (float(i) + 0.5) * stepSize;
        vec3 p = ro + rd * ti;
        float D = densityAt(p, t, N);
        if (D >= fuseThreshold) {
            float frac = (fuseThreshold - prevD) / max(D - prevD, 1e-4);
            tHit = ti - stepSize * (1.0 - frac);
            break;
        }
        prevD = D;
    }

    hitWallFlag = 0.0;
    wallPosOut = vec3(0.0);
    wallNOut = vec3(0.0);

    if (tHit > 0.0) {
        vec3 p = ro + rd * tHit;
        float D; vec3 G; vec3 C;
        densityAndGrad(p, t, N, D, G, C);
        vec3 n = (length(G) > 1e-4) ? -normalize(G) : vec3(0.0, 0.0, -1.0);

        float diff = max(dot(n, L), 0.0);
        vec3 H = normalize(L - rd);
        float spec = pow(max(dot(n, H), 0.0), 32.0) * blobSpecular;
        float rim  = pow(1.0 - max(dot(n, -rd), 0.0), 2.0) * blobGlow;
        colOut = C * (blobAmbient + diff) + vec3(spec) + C * rim;
    } else {
        float shadow = 1.0;
        for (int i = 0; i < MAX_BLOBS; i++) {
            if (i >= N) break;
            float fi = float(i);
            float R = blobRadiusAt(fi);
            vec3 c = blobPos(fi, t);
            shadow *= softShadow(wallPos, L, c, R * shadowSize,
                                 shadowStrength, shadowSoftness);
        }

        float diff = max(dot(wallN, L), 0.0);
        vec3 lit = wallColor.rgb * (wallAmbient + diff * wallBright);
        vec3 absN = abs(wallN);
        vec3 along = 1.0 - absN;
        vec3 dFaces = min(wallPos, 1.0 - wallPos) * along + absN;
        float dEdge = min(min(dFaces.x, dFaces.y), dFaces.z);
        float ao = mix(1.0, smoothstep(0.0, 0.15, dEdge), cornerAO);
        colOut = mix(wallShadowColor.rgb, lit, shadow) * ao;
        hitWallFlag = 1.0;
        wallPosOut = wallPos;
        wallNOut = wallN;
    }
}

vec3 shadeOnce(vec3 ro, vec3 rd, vec3 L, float t, int N, int STEPS) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, STEPS, col, hw, wp, wn);
    return col;
}

vec3 shadeOuter(vec3 ro, vec3 rd, vec3 L, float t, int N, int STEPS) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, STEPS, col, hw, wp, wn);
    if (hw > 0.5 && wallReflection > 0.0) {
        vec3 reflDir = reflect(rd, wn);
        vec3 reflOrigin = wp + wn * 0.001;
        vec3 reflCol = shadeOnce(reflOrigin, reflDir, L, t, N, STEPS);
        col = mix(col, reflCol, wallReflection);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    int N = int(blobCount);
    int STEPS = int(raymarchSteps);

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float lzMag = sqrt(max(0.1,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, -lzMag));

    vec3 col = shadeOuter(ro, rd, L, t, N, STEPS);

    float ex = min(uv.x, 1.0 - uv.x);
    float ey = min(uv.y, 1.0 - uv.y);
    float edgeDist = min(ex, ey);
    if (hairlineWidth > 0.0) {
        float hair = 1.0 - smoothstep(hairlineWidth * 0.6, hairlineWidth, edgeDist);
        col = mix(col, hairlineColor.rgb * hairlineBrightness, hair);
    }

    col = col / (1.0 + col * 0.12);
    gl_FragColor = vec4(col, 1.0);
}
