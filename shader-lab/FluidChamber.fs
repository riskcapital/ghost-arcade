/*{
    "DESCRIPTION": "Fluid Chamber - Dense 3D particle flow inside a lit chamber. N particles ride a selectable 3D flow field (traveling waves, curl noise, vortex, or radial breathing). Soft Gaussian emission accumulates into smooth fluid-like volumes, with cast shadows projected onto the chamber walls. Optional wall reflectivity mirrors the scene.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",              "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "particleCount",      "TYPE": "float", "DEFAULT": 64.0, "MIN": 8.0,   "MAX": 1280.0},
        {"NAME": "particleSize",       "TYPE": "float", "DEFAULT": 0.028,"MIN": 0.005, "MAX": 0.1},
        {"NAME": "particleBrightness", "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "particleFalloff",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.15,  "MAX": 2.0},
        {"NAME": "flowMode",           "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "flowAmplitude",      "TYPE": "float", "DEFAULT": 0.22, "MIN": 0.0,   "MAX": 0.5},
        {"NAME": "flowSpeed",          "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "flowScale",          "TYPE": "float", "DEFAULT": 3.5,  "MIN": 0.5,   "MAX": 10.0},
        {"NAME": "turbulence",         "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "turbulenceScale",    "TYPE": "float", "DEFAULT": 3.0,  "MIN": 0.5,   "MAX": 10.0},
        {"NAME": "focalLength",        "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "vanishPointX",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lightAzimuth",       "TYPE": "float", "DEFAULT": -0.3, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "lightElevation",     "TYPE": "float", "DEFAULT": 0.55, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "wallAmbient",        "TYPE": "float", "DEFAULT": 0.38, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "wallBright",         "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "wallReflection",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "cornerAO",           "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowStrength",     "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "shadowSoftness",     "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 2.5},
        {"NAME": "shadowRadius",       "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.3,   "MAX": 3.0},
        {"NAME": "hairlineWidth",      "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.15},
        {"NAME": "hairlineBrightness", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wallColor",          "TYPE": "color", "DEFAULT": [0.80, 0.81, 0.84, 1.0]},
        {"NAME": "wallShadowColor",    "TYPE": "color", "DEFAULT": [0.10, 0.10, 0.12, 1.0]},
        {"NAME": "particleColor",      "TYPE": "color", "DEFAULT": [0.85, 0.93, 1.0, 1.0]},
        {"NAME": "particleColorB",     "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.55, 1.0]},
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

vec3 flowDisplacement(vec3 home, float t, int mode, float amp, float scl, float fs) {
    if (mode == 0) {
        return amp * vec3(
            sin(home.y * scl + t * fs)       * cos(home.z * scl + t * fs * 0.7),
            sin(home.z * scl + t * fs * 1.1) * cos(home.x * scl + t * fs * 0.9),
            sin(home.x * scl + t * fs * 0.8) * cos(home.y * scl + t * fs * 1.2)
        );
    }
    if (mode == 1) {
        return amp * curl3(home * scl + vec3(t * fs * 0.25, t * fs * 0.18, t * fs * 0.31));
    }
    if (mode == 2) {
        vec3 r = home - vec3(0.5);
        float angle = t * fs + length(r.xz) * scl * 0.3;
        float ca = cos(angle), sa = sin(angle);
        vec3 rotated = vec3(r.x * ca - r.z * sa, r.y, r.x * sa + r.z * ca);
        return (rotated - r) * amp * 2.0
             + vec3(0.0, sin(t * fs + home.x * scl) * amp * 0.25, 0.0);
    }
    vec3 r = home - vec3(0.5);
    float d = length(r) + 0.001;
    float pulse = sin(t * fs + d * scl);
    return (r / d) * pulse * amp;
}

vec3 particlePos(float id, float t, int mode) {
    vec3 home = vec3(hash1(id * 1.17),
                     hash1(id * 2.31 + 9.1),
                     hash1(id * 3.71 + 17.3));
    home = 0.12 + home * 0.76;

    vec3 disp = flowDisplacement(home, t, mode, flowAmplitude, flowScale, flowSpeed);
    if (turbulence > 0.0) {
        disp += curl3(home * turbulenceScale + vec3(id * 5.17, 0.0, t * 0.5))
                * turbulence * 0.12;
    }
    return clamp(home + disp, vec3(0.015), vec3(0.985));
}

float particleEmission(vec3 ro, vec3 rd, vec3 c, float r, float falloff, float tMax) {
    vec3 oc = c - ro;
    float tc = dot(oc, rd);
    if (tc < 0.0 || tc > tMax) return 0.0;
    vec3 nearest = ro + rd * tc;
    float d = length(nearest - c);
    float sigma = r * falloff;
    return exp(-(d * d) / (2.0 * sigma * sigma));
}

float particleShadow(vec3 p, vec3 L, vec3 c, float r, float strength, float soft) {
    vec3 oc = p - c;
    float b = dot(oc, L);
    if (b > 0.0) return 1.0;
    float d = sqrt(max(0.0, dot(oc, oc) - b * b));
    float outer = r * (1.0 + 1.2 * soft);
    float inner = r * 0.25;
    float sh = smoothstep(inner, outer, d);
    return mix(1.0 - strength, 1.0, sh);
}

void intersectAndShade(vec3 ro, vec3 rd, vec3 L, float t, int N, int mode,
                        out vec3 colOut, out vec3 wallPosOut, out vec3 wallNOut) {
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
    float diff = max(dot(wallN, L), 0.0);
    vec3 lit = wallColor.rgb * (wallAmbient + diff * wallBright);

    vec3 absN = abs(wallN);
    vec3 along = 1.0 - absN;
    vec3 dFaces = min(wallPos, 1.0 - wallPos) * along + absN;
    float dEdge = min(min(dFaces.x, dFaces.y), dFaces.z);
    float ao = mix(1.0, smoothstep(0.0, 0.15, dEdge), cornerAO);

    vec3 glowAccum = vec3(0.0);
    float shadow = 1.0;
    float shR = particleSize * shadowRadius;

    for (int i = 0; i < 1280; i++) {
        if (i >= N) break;
        float fi = float(i);
        vec3 c = particlePos(fi, t, mode);

        float e = particleEmission(ro, rd, c, particleSize, particleFalloff, tFar);
        if (e > 0.001) {
            vec3 pcol = mix(particleColor.rgb, particleColorB.rgb, hash1(fi * 7.13));
            glowAccum += pcol * e;
        }

        shadow *= particleShadow(wallPos, L, c, shR, shadowStrength, shadowSoftness);
    }

    colOut = mix(wallShadowColor.rgb, lit, shadow) * ao;
    colOut += glowAccum * particleBrightness;
    wallPosOut = wallPos;
    wallNOut = wallN;
}

vec3 shadeOnce(vec3 ro, vec3 rd, vec3 L, float t, int N, int mode) {
    vec3 col; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, mode, col, wp, wn);
    return col;
}

vec3 shadeOuter(vec3 ro, vec3 rd, vec3 L, float t, int N, int mode) {
    vec3 col; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, mode, col, wp, wn);
    if (wallReflection > 0.0) {
        vec3 reflDir = reflect(rd, wn);
        vec3 reflOrigin = wp + wn * 0.001;
        vec3 reflCol = shadeOnce(reflOrigin, reflDir, L, t, N, mode);
        col = mix(col, reflCol, wallReflection);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    int N = int(particleCount);
    int mode = int(flowMode + 0.5);

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float lzMag = sqrt(max(0.1,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, -lzMag));

    vec3 col = shadeOuter(ro, rd, L, t, N, mode);

    float ex = min(uv.x, 1.0 - uv.x);
    float ey = min(uv.y, 1.0 - uv.y);
    float edgeDist = min(ex, ey);
    if (hairlineWidth > 0.0) {
        float hair = 1.0 - smoothstep(hairlineWidth * 0.6, hairlineWidth, edgeDist);
        col = mix(col, hairlineColor.rgb * hairlineBrightness, hair);
    }

    col = col / (1.0 + col * 0.15);
    gl_FragColor = vec4(col, 1.0);
}
