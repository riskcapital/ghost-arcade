/*{
    "DESCRIPTION": "Laser Grid - Glowing laser poles span the chamber, bouncing back and forth through space. Mode selects vertical (floor→ceiling), horizontal (left wall→right wall), or both (crossing 3D grid). Volumetric glow halo around each pole, Lambert-shaded bright core, soft shadows cast on all chamber walls. Optional wall reflectivity mirrors the scene.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",              "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "mode",               "TYPE": "float", "DEFAULT": 2.0,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "poleCount",          "TYPE": "float", "DEFAULT": 8.0,  "MIN": 2.0,   "MAX": 16.0},
        {"NAME": "poleRadius",         "TYPE": "float", "DEFAULT": 0.012,"MIN": 0.003, "MAX": 0.05},
        {"NAME": "glowRadius",         "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.01,  "MAX": 0.2},
        {"NAME": "glowIntensity",      "TYPE": "float", "DEFAULT": 1.4,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "coreBrightness",     "TYPE": "float", "DEFAULT": 1.4,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "moveSpeed",          "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "moveAmplitude",      "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "focalLength",        "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "vanishPointX",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lightAzimuth",       "TYPE": "float", "DEFAULT": -0.3, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "lightElevation",     "TYPE": "float", "DEFAULT": 0.5,  "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "wallAmbient",        "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "wallBright",         "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "wallReflection",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "cornerAO",           "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowStrength",     "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowSoftness",     "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 2.5},
        {"NAME": "shadowRadius",       "TYPE": "float", "DEFAULT": 1.4,  "MIN": 0.3,   "MAX": 4.0},
        {"NAME": "hairlineWidth",      "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.15},
        {"NAME": "hairlineBrightness", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wallColor",          "TYPE": "color", "DEFAULT": [0.78, 0.79, 0.82, 1.0]},
        {"NAME": "wallShadowColor",    "TYPE": "color", "DEFAULT": [0.08, 0.08, 0.10, 1.0]},
        {"NAME": "poleColorA",         "TYPE": "color", "DEFAULT": [0.25, 0.85, 1.0, 1.0]},
        {"NAME": "poleColorB",         "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.85, 1.0]},
        {"NAME": "hairlineColor",      "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "bgColor",            "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

float hash1(float n) { return fract(sin(n * 43.1 + 17.3) * 43758.5453); }
float tri01(float x) { return abs(fract(x * 0.5) * 2.0 - 1.0); }

vec2 polePos2D(float id, float t) {
    float f1 = 0.25 + hash1(id * 1.17) * 0.55;
    float f2 = 0.25 + hash1(id * 2.31 + 9.1) * 0.55;
    float p1 = hash1(id * 3.71) * 7.3;
    float p2 = hash1(id * 4.19 + 13.7) * 7.3;
    float a = tri01(t * moveSpeed * f1 + p1);
    float b = tri01(t * moveSpeed * f2 + p2);
    float margin = 0.04 + poleRadius;
    float extent = (0.5 - margin) * moveAmplitude;
    return vec2(0.5 + (a * 2.0 - 1.0) * extent,
                0.5 + (b * 2.0 - 1.0) * extent);
}

void poleAxis(float id, float t, int axis, out vec3 aP, out vec3 aD) {
    vec2 p = polePos2D(id, t);
    if (axis == 0) { aP = vec3(p.x, 0.0, p.y); aD = vec3(0.0, 1.0, 0.0); }
    else           { aP = vec3(0.0, p.x, p.y); aD = vec3(1.0, 0.0, 0.0); }
}

vec3 poleColor(float id) {
    return mix(poleColorA.rgb, poleColorB.rgb, hash1(id * 7.13));
}

float rayCylinder(vec3 ro, vec3 rd, vec3 aP, vec3 aD, float aStart, float aEnd,
                  float r, out vec3 nOut) {
    vec3 pa = ro - aP;
    float pa_ax = dot(pa, aD);
    float rd_ax = dot(rd, aD);
    vec3 pa_perp = pa - pa_ax * aD;
    vec3 rd_perp = rd - rd_ax * aD;
    float A = dot(rd_perp, rd_perp);
    if (A < 1e-6) { nOut = vec3(0.0); return -1.0; }
    float B = 2.0 * dot(pa_perp, rd_perp);
    float C = dot(pa_perp, pa_perp) - r * r;
    float disc = B * B - 4.0 * A * C;
    if (disc < 0.0) { nOut = vec3(0.0); return -1.0; }
    float sq = sqrt(disc);
    float t = (-B - sq) / (2.0 * A);
    if (t < 0.0) { nOut = vec3(0.0); return -1.0; }
    float axAtHit = pa_ax + rd_ax * t;
    if (axAtHit < aStart || axAtHit > aEnd) { nOut = vec3(0.0); return -1.0; }
    vec3 toP = (ro + rd * t) - aP;
    float pAx = dot(toP, aD);
    nOut = normalize(toP - pAx * aD);
    return t;
}

void rayAxisDist(vec3 ro, vec3 rd, vec3 aP, vec3 aD,
                 out float tC, out float d, out float axAt) {
    vec3 pa = ro - aP;
    float pa_ax = dot(pa, aD);
    float rd_ax = dot(rd, aD);
    vec3 pa_perp = pa - pa_ax * aD;
    vec3 rd_perp = rd - rd_ax * aD;
    float A = dot(rd_perp, rd_perp);
    if (A < 1e-6) {
        tC = 0.0;
        d = length(pa_perp);
        axAt = pa_ax;
        return;
    }
    tC = -dot(pa_perp, rd_perp) / A;
    d = length(pa_perp + rd_perp * tC);
    axAt = pa_ax + rd_ax * tC;
}

float poleShadow(vec3 p, vec3 L, vec3 aP, vec3 aD, float r, float strength, float soft) {
    vec3 w = p - aP;
    float k  = dot(L, aD);
    float d_ = dot(L, w);
    float e_ = dot(aD, w);
    float denom = 1.0 - k * k;

    float u;
    if (denom < 1e-5) u = 0.0;
    else              u = (e_ - k * d_) / denom;
    u = clamp(u, 0.0, 1.0);

    vec3 axPoint = aP + u * aD;
    float s = dot(axPoint - p, L);
    if (s <= 0.0) return 1.0;

    vec3 rayPoint = p + s * L;
    float dist = length(rayPoint - axPoint);

    float outer = r * (1.0 + 1.2 * soft);
    float inner = r * 0.25;
    float sh = smoothstep(inner, outer, dist);
    return mix(1.0 - strength, 1.0, sh);
}

void intersectAndShade(vec3 ro, vec3 rd, vec3 L, float t, int Nv, int Nh,
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
    vec3 wallPos = ro + rd * tFar;

    float tNearest = tFar;
    int   hitId   = -1;
    vec3  hitN    = vec3(0.0);
    vec3  glowAccum = vec3(0.0);
    float shadow  = 1.0;
    float shR     = poleRadius * shadowRadius;

    for (int i = 0; i < 16; i++) {
        if (i >= Nv) break;
        float fi = float(i);
        vec3 aP, aD;
        poleAxis(fi, t, 0, aP, aD);

        vec3 n;
        float tHit = rayCylinder(ro, rd, aP, aD, 0.0, 1.0, poleRadius, n);
        if (tHit > 0.0 && tHit < tNearest) {
            tNearest = tHit;
            hitId = i;
            hitN = n;
        }

        float tC, d, axAt;
        rayAxisDist(ro, rd, aP, aD, tC, d, axAt);
        if (tC > 0.0 && tC < tFar && axAt > 0.0 && axAt < 1.0) {
            float g = exp(-(d * d) / (2.0 * glowRadius * glowRadius));
            glowAccum += poleColor(fi) * g * glowIntensity;
        }

        shadow *= poleShadow(wallPos, L, aP, aD, shR, shadowStrength, shadowSoftness);
    }

    for (int i = 0; i < 16; i++) {
        if (i >= Nh) break;
        float fi = float(i) + 97.0;
        vec3 aP, aD;
        poleAxis(fi, t, 1, aP, aD);

        vec3 n;
        float tHit = rayCylinder(ro, rd, aP, aD, 0.0, 1.0, poleRadius, n);
        if (tHit > 0.0 && tHit < tNearest) {
            tNearest = tHit;
            hitId = 1000 + i;
            hitN = n;
        }

        float tC, d, axAt;
        rayAxisDist(ro, rd, aP, aD, tC, d, axAt);
        if (tC > 0.0 && tC < tFar && axAt > 0.0 && axAt < 1.0) {
            float g = exp(-(d * d) / (2.0 * glowRadius * glowRadius));
            glowAccum += poleColor(fi) * g * glowIntensity;
        }

        shadow *= poleShadow(wallPos, L, aP, aD, shR, shadowStrength, shadowSoftness);
    }

    hitWallFlag = 0.0;
    wallPosOut = vec3(0.0);
    wallNOut = vec3(0.0);

    vec3 col;
    if (hitId >= 0) {
        float diff = max(dot(hitN, L), 0.0);
        vec3 H = normalize(L - rd);
        float spec = pow(max(dot(hitN, H), 0.0), 64.0) * 0.6;
        float fid = (hitId >= 1000) ? float(hitId - 1000 + 97) : float(hitId);
        vec3 pcol = poleColor(fid);
        col = pcol * (coreBrightness + diff * 0.35) + vec3(spec);
    } else {
        float diff = max(dot(wallN, L), 0.0);
        vec3 lit = wallColor.rgb * (wallAmbient + diff * wallBright);

        vec3 absN = abs(wallN);
        vec3 along = 1.0 - absN;
        vec3 dFaces = min(wallPos, 1.0 - wallPos) * along + absN;
        float dEdge = min(min(dFaces.x, dFaces.y), dFaces.z);
        float ao = mix(1.0, smoothstep(0.0, 0.15, dEdge), cornerAO);

        col = mix(wallShadowColor.rgb, lit, shadow) * ao;
        hitWallFlag = 1.0;
        wallPosOut = wallPos;
        wallNOut = wallN;
    }

    col += glowAccum;
    colOut = col;
}

vec3 shadeOnce(vec3 ro, vec3 rd, vec3 L, float t, int Nv, int Nh) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, Nv, Nh, col, hw, wp, wn);
    return col;
}

vec3 shadeOuter(vec3 ro, vec3 rd, vec3 L, float t, int Nv, int Nh) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, Nv, Nh, col, hw, wp, wn);
    if (hw > 0.5 && wallReflection > 0.0) {
        vec3 reflDir = reflect(rd, wn);
        vec3 reflOrigin = wp + wn * 0.001;
        vec3 reflCol = shadeOnce(reflOrigin, reflDir, L, t, Nv, Nh);
        col = mix(col, reflCol, wallReflection);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    int N = int(poleCount);
    int md = int(mode + 0.5);

    int Nv, Nh;
    if (md == 0)      { Nv = N;          Nh = 0; }
    else if (md == 1) { Nv = 0;          Nh = N; }
    else              { Nv = (N + 1) / 2; Nh = N / 2; }

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float lzMag = sqrt(max(0.1,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, -lzMag));

    vec3 col = shadeOuter(ro, rd, L, t, Nv, Nh);

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
