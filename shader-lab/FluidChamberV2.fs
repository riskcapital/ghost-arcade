/*{
    "DESCRIPTION": "Fluid Chamber v2 - Same flow-field chamber but particles can be rendered as Blobs (Gaussian emission), Spheres (solid Lambert), Voxels (solid AABB), Metaballs (Wyvill emission that merges), Pyramids (solid octahedra), or Multi (random solid mix). Cast shadows on chamber walls. Optional wall reflectivity mirrors the scene.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",              "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "particleCount",      "TYPE": "float", "DEFAULT": 64.0, "MIN": 8.0,   "MAX": 1280.0},
        {"NAME": "particleSize",       "TYPE": "float", "DEFAULT": 0.028,"MIN": 0.005, "MAX": 0.12},
        {"NAME": "particleBrightness", "TYPE": "float", "DEFAULT": 1.1,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "particleFalloff",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.15,  "MAX": 2.0},
        {"NAME": "shapeMode",          "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 5.0},
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
        {"NAME": "particleSpecular",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.5},
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

// shapeMode: 0=Blob 1=Sphere 2=Voxel 3=Pyramid 4=Metaball 5=Multi
// flowMode:  0=Waves 1=Curl 2=Vortex 3=Radial

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

vec3 particleColorAt(float fi) {
    return mix(particleColor.rgb, particleColorB.rgb, hash1(fi * 7.13));
}

float blobEmission(vec3 ro, vec3 rd, vec3 c, float r, float falloff, float tMax) {
    vec3 oc = c - ro;
    float tc = dot(oc, rd);
    if (tc < 0.0 || tc > tMax) return 0.0;
    vec3 nearest = ro + rd * tc;
    float d = length(nearest - c);
    float sigma = r * falloff;
    return exp(-(d * d) / (2.0 * sigma * sigma));
}

float metaballEmission(vec3 ro, vec3 rd, vec3 c, float r, float tMax) {
    vec3 oc = c - ro;
    float tc = dot(oc, rd);
    if (tc < 0.0 || tc > tMax) return 0.0;
    vec3 nearest = ro + rd * tc;
    float d = length(nearest - c);
    float R = r * 1.8;
    if (d >= R) return 0.0;
    float x = 1.0 - (d * d) / (R * R);
    return x * x * x;
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

float rayAABB(vec3 ro, vec3 rd, vec3 c, float r, out vec3 nOut) {
    vec3 invRd = 1.0 / rd;
    vec3 t1 = ((c - r) - ro) * invRd;
    vec3 t2 = ((c + r) - ro) * invRd;
    vec3 tmin = min(t1, t2);
    vec3 tmax = max(t1, t2);
    float tE = max(max(tmin.x, tmin.y), tmin.z);
    float tX = min(min(tmax.x, tmax.y), tmax.z);
    if (tE > tX || tX < 0.0 || tE < 0.0) { nOut = vec3(0.0); return -1.0; }
    if (tmin.x >= tmin.y && tmin.x >= tmin.z)      nOut = vec3(-sign(rd.x), 0.0, 0.0);
    else if (tmin.y >= tmin.z)                      nOut = vec3(0.0, -sign(rd.y), 0.0);
    else                                             nOut = vec3(0.0, 0.0, -sign(rd.z));
    return tE;
}

float rayOctahedron(vec3 ro, vec3 rd, vec3 c, float r, out vec3 nOut) {
    vec3 p = ro - c;
    float tE = -1e9, tX = 1e9;
    vec3 nE = vec3(0.0);

    float dP = p.x + p.y + p.z;
    float dR = rd.x + rd.y + rd.z;
    if (abs(dR) > 1e-6) {
        float ta = (-r - dP) / dR;
        float tb = ( r - dP) / dR;
        if (ta > tb) { float tmp = ta; ta = tb; tb = tmp; }
        if (ta > tE) { tE = ta; nE = vec3(1.0,1.0,1.0) * -sign(dR); }
        tX = min(tX, tb);
    }
    dP = p.x + p.y - p.z;
    dR = rd.x + rd.y - rd.z;
    if (abs(dR) > 1e-6) {
        float ta = (-r - dP) / dR;
        float tb = ( r - dP) / dR;
        if (ta > tb) { float tmp = ta; ta = tb; tb = tmp; }
        if (ta > tE) { tE = ta; nE = vec3(1.0,1.0,-1.0) * -sign(dR); }
        tX = min(tX, tb);
    }
    dP = p.x - p.y + p.z;
    dR = rd.x - rd.y + rd.z;
    if (abs(dR) > 1e-6) {
        float ta = (-r - dP) / dR;
        float tb = ( r - dP) / dR;
        if (ta > tb) { float tmp = ta; ta = tb; tb = tmp; }
        if (ta > tE) { tE = ta; nE = vec3(1.0,-1.0,1.0) * -sign(dR); }
        tX = min(tX, tb);
    }
    dP = -p.x + p.y + p.z;
    dR = -rd.x + rd.y + rd.z;
    if (abs(dR) > 1e-6) {
        float ta = (-r - dP) / dR;
        float tb = ( r - dP) / dR;
        if (ta > tb) { float tmp = ta; ta = tb; tb = tmp; }
        if (ta > tE) { tE = ta; nE = vec3(-1.0,1.0,1.0) * -sign(dR); }
        tX = min(tX, tb);
    }

    if (tE > tX || tX < 0.0 || tE < 0.0) { nOut = vec3(0.0); return -1.0; }
    nOut = normalize(nE);
    return tE;
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

void intersectAndShade(vec3 ro, vec3 rd, vec3 L, float t, int N, int sMode, int fMode,
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
    int   solidHit = -1;
    vec3  solidC   = vec3(0.0);
    vec3  solidN   = vec3(0.0);
    vec3  emissionAccum = vec3(0.0);
    float shadow = 1.0;
    float shR = particleSize * shadowRadius;

    for (int i = 0; i < 1280; i++) {
        if (i >= N) break;
        float fi = float(i);
        vec3 c = particlePos(fi, t, fMode);

        int shape = sMode;
        if (sMode == 5) {
            shape = 1 + int(hash1(fi * 11.9 + 3.17) * 2.999);
        }

        if (shape == 0) {
            float e = blobEmission(ro, rd, c, particleSize, particleFalloff, tFar);
            emissionAccum += particleColorAt(fi) * e;
        } else if (shape == 4) {
            float e = metaballEmission(ro, rd, c, particleSize, tFar);
            emissionAccum += particleColorAt(fi) * e;
        } else {
            float tHit = -1.0;
            vec3 nHit = vec3(0.0);
            if (shape == 1) {
                tHit = raySphere(ro, rd, c, particleSize);
                if (tHit > 0.0) nHit = normalize((ro + rd * tHit) - c);
            } else if (shape == 2) {
                tHit = rayAABB(ro, rd, c, particleSize, nHit);
            } else if (shape == 3) {
                tHit = rayOctahedron(ro, rd, c, particleSize, nHit);
            }
            if (tHit > 0.0 && tHit < tNearest) {
                tNearest = tHit;
                solidHit = i;
                solidC = c;
                solidN = nHit;
            }
        }

        shadow *= particleShadow(wallPos, L, c, shR, shadowStrength, shadowSoftness);
    }

    hitWallFlag = 0.0;
    wallPosOut = vec3(0.0);
    wallNOut = vec3(0.0);

    vec3 col;
    if (solidHit >= 0) {
        float diff = max(dot(solidN, L), 0.0);
        vec3 H = normalize(L - rd);
        float spec = pow(max(dot(solidN, H), 0.0), 48.0) * particleSpecular;
        float rim  = pow(1.0 - max(dot(solidN, -rd), 0.0), 2.5) * 0.2;
        vec3 pcol = particleColorAt(float(solidHit));
        col = pcol * (wallAmbient * 0.8 + diff) + vec3(spec + rim);
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

    col += emissionAccum * particleBrightness;
    colOut = col;
}

vec3 shadeOnce(vec3 ro, vec3 rd, vec3 L, float t, int N, int sMode, int fMode) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, sMode, fMode, col, hw, wp, wn);
    return col;
}

vec3 shadeOuter(vec3 ro, vec3 rd, vec3 L, float t, int N, int sMode, int fMode) {
    vec3 col; float hw; vec3 wp, wn;
    intersectAndShade(ro, rd, L, t, N, sMode, fMode, col, hw, wp, wn);
    if (hw > 0.5 && wallReflection > 0.0) {
        vec3 reflDir = reflect(rd, wn);
        vec3 reflOrigin = wp + wn * 0.001;
        vec3 reflCol = shadeOnce(reflOrigin, reflDir, L, t, N, sMode, fMode);
        col = mix(col, reflCol, wallReflection);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    int N = int(particleCount);
    int sMode = int(shapeMode + 0.5);
    int fMode = int(flowMode + 0.5);

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float lzMag = sqrt(max(0.1,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, -lzMag));

    vec3 col = shadeOuter(ro, rd, L, t, N, sMode, fMode);

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
