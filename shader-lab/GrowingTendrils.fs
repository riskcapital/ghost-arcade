/*{
    "DESCRIPTION": "Growing Tendrils - Organic tendrils sprout from the floor, wriggling and flowing upward toward the ceiling. Each tendril is a tapered chain of beads that animates with layered sine wobbles and cycles through grow/hold/retract phases. Shadows cast on all chamber walls. Optional wall reflectivity mirrors the scene.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",              "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "tendrilCount",       "TYPE": "float", "DEFAULT": 6.0,  "MIN": 1.0,   "MAX": 16.0},
        {"NAME": "beadBaseRadius",     "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.01,  "MAX": 0.1},
        {"NAME": "beadTipRadius",      "TYPE": "float", "DEFAULT": 0.012,"MIN": 0.003, "MAX": 0.05},
        {"NAME": "flowAmplitude",      "TYPE": "float", "DEFAULT": 0.18, "MIN": 0.0,   "MAX": 0.45},
        {"NAME": "flowFrequency",      "TYPE": "float", "DEFAULT": 3.0,  "MIN": 0.5,   "MAX": 10.0},
        {"NAME": "flowSpeed",          "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "growthSpeed",        "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.01,  "MAX": 0.8},
        {"NAME": "growFraction",       "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.1,   "MAX": 0.7},
        {"NAME": "holdFraction",       "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0,   "MAX": 0.5},
        {"NAME": "retractFraction",    "TYPE": "float", "DEFAULT": 0.3,  "MIN": 0.1,   "MAX": 0.7},
        {"NAME": "focalLength",        "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "vanishPointX",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lightAzimuth",       "TYPE": "float", "DEFAULT": -0.35,"MIN": -1.0,  "MAX": 1.0},
        {"NAME": "lightElevation",     "TYPE": "float", "DEFAULT": 0.55, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "wallAmbient",        "TYPE": "float", "DEFAULT": 0.38, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "wallBright",         "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "wallReflection",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "cornerAO",           "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "tendrilSpecular",    "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 1.5},
        {"NAME": "tendrilGlow",        "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "shadowStrength",     "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowSoftness",     "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 2.5},
        {"NAME": "shadowRadius",       "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.3,   "MAX": 3.0},
        {"NAME": "hairlineWidth",      "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.15},
        {"NAME": "hairlineBrightness", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wallColor",          "TYPE": "color", "DEFAULT": [0.80, 0.81, 0.84, 1.0]},
        {"NAME": "wallShadowColor",    "TYPE": "color", "DEFAULT": [0.10, 0.10, 0.12, 1.0]},
        {"NAME": "tendrilColorA",      "TYPE": "color", "DEFAULT": [0.65, 0.95, 0.75, 1.0]},
        {"NAME": "tendrilColorB",      "TYPE": "color", "DEFAULT": [0.95, 0.55, 0.85, 1.0]},
        {"NAME": "hairlineColor",      "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "bgColor",            "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

#define BEADS 28

float hash1(float n) { return fract(sin(n * 43.1 + 17.3) * 43758.5453); }

float tendrilGrowth(float id, float t) {
    float off = hash1(id * 3.71);
    float phase = fract(t * growthSpeed + off);
    float gEnd = growFraction;
    float hEnd = gEnd + holdFraction;
    float rEnd = hEnd + retractFraction;
    if (phase < gEnd)      return smoothstep(0.0, 1.0, phase / gEnd);
    else if (phase < hEnd) return 1.0;
    else if (phase < rEnd) return 1.0 - smoothstep(0.0, 1.0, (phase - hEnd) / retractFraction);
    else                   return 0.0;
}

vec3 tendrilSeed(float id) {
    float x = 0.15 + hash1(id * 1.17) * 0.7;
    float z = 0.15 + hash1(id * 2.31 + 9.1) * 0.7;
    return vec3(x, 0.02, z);
}

vec3 tendrilPoint(float id, float u, float growth, float t) {
    vec3 seed = tendrilSeed(id);
    float freq  = flowFrequency * (0.6 + hash1(id * 4.19) * 0.8);
    float phase = hash1(id * 5.53) * 6.28318;
    float tSpd  = flowSpeed * (0.7 + hash1(id * 7.11) * 0.6);
    float env = u;

    float arg1 = u * freq + phase + t * tSpd;
    float arg2 = u * freq * 1.2 + phase + t * tSpd * 0.9;
    float arg3 = u * freq * 2.3 + t * tSpd * 1.7 + hash1(id * 8.23) * 6.28;
    float arg4 = u * freq * 1.9 + t * tSpd * 1.3 + hash1(id * 9.17) * 6.28;

    float xOff = flowAmplitude * (sin(arg1) + 0.35 * sin(arg3)) * env;
    float zOff = flowAmplitude * (cos(arg2) + 0.35 * cos(arg4)) * env;

    float y = seed.y + u * growth * (1.0 - seed.y - 0.01);
    return vec3(seed.x + xOff, y, seed.z + zOff);
}

float beadRadius(float u) {
    return mix(beadBaseRadius, beadTipRadius, u);
}

float raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    float det = b * b - dot(oc, oc) + r * r;
    if (det < 0.0) return -1.0;
    float s = sqrt(det);
    float t = -b - s;
    return (t > 0.0) ? t : -1.0;
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

vec3 tendrilColor(float id) {
    return mix(tendrilColorA.rgb, tendrilColorB.rgb, hash1(id * 13.17));
}

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
    vec3 wallPos = ro + rd * tFar;

    float tNearest = tFar;
    int   hitId    = -1;
    float hitU     = 0.0;
    vec3  hitC     = vec3(0.0);
    float shadow   = 1.0;

    for (int i = 0; i < 16; i++) {
        if (i >= N) break;
        float fi = float(i);
        float growth = tendrilGrowth(fi, t);
        if (growth <= 0.002) continue;

        for (int j = 0; j < BEADS; j++) {
            float u = float(j) / float(BEADS - 1);
            if (u > growth) break;

            vec3 c = tendrilPoint(fi, u, growth, t);
            float r = beadRadius(u);

            float ts = raySphere(ro, rd, c, r);
            if (ts > 0.0 && ts < tNearest) {
                tNearest = ts;
                hitId = i;
                hitU = u;
                hitC = c;
            }

            shadow *= softShadow(wallPos, L, c, r * shadowRadius,
                                 shadowStrength, shadowSoftness);
        }
    }

    hitWallFlag = 0.0;
    wallPosOut = vec3(0.0);
    wallNOut = vec3(0.0);

    if (hitId >= 0) {
        vec3 p = ro + rd * tNearest;
        vec3 n = normalize(p - hitC);
        float diff = max(dot(n, L), 0.0);
        vec3 H = normalize(L - rd);
        float spec = pow(max(dot(n, H), 0.0), 48.0) * tendrilSpecular;
        float rim  = pow(1.0 - max(dot(n, -rd), 0.0), 2.5) * tendrilGlow;
        vec3 tcol = tendrilColor(float(hitId));
        tcol *= mix(0.85, 1.1, hitU);
        colOut = tcol * (wallAmbient * 0.8 + diff) + vec3(spec) + tcol * rim;
    } else {
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
    int N = int(tendrilCount);

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float lzMag = sqrt(max(0.1,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, -lzMag));

    vec3 col = shadeOuter(ro, rd, L, t, N);

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
