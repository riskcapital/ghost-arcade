/*{
    "DESCRIPTION": "Voxel City - Minecraft-style voxel cityscape that grows from all six walls. Columns extrude inward from floor, ceiling, and all four sides in shifting patterns, each driven by per-wall sine waves and per-column hash heights. Raycast via DDA, with shadow-DDA for true voxel cast shadows on all chamber walls.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",              "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "gridSize",           "TYPE": "float", "DEFAULT": 12.0, "MIN": 6.0,   "MAX": 20.0},
        {"NAME": "waveSpeed",          "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "cellGaps",           "TYPE": "float", "DEFAULT": 0.28, "MIN": 0.0,   "MAX": 0.85},
        {"NAME": "heightContrast",     "TYPE": "float", "DEFAULT": 1.6,  "MIN": 0.5,   "MAX": 4.0},
        {"NAME": "maxExtrusion",       "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.1,   "MAX": 1.0},
        {"NAME": "floorStrength",      "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "ceilStrength",       "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "leftStrength",       "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "rightStrength",      "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "frontStrength",      "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "backStrength",       "TYPE": "float", "DEFAULT": 0.9,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "focalLength",        "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "vanishPointX",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",       "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lightAzimuth",       "TYPE": "float", "DEFAULT": -0.3, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "lightElevation",     "TYPE": "float", "DEFAULT": 0.55, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "wallAmbient",        "TYPE": "float", "DEFAULT": 0.32, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "wallBright",         "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "cornerAO",           "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "voxelAmbient",       "TYPE": "float", "DEFAULT": 0.3,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "voxelBright",        "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "wallReflection",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "faceShade",          "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0,   "MAX": 0.5},
        {"NAME": "shadowStrength",     "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "hairlineWidth",      "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.15},
        {"NAME": "hairlineBrightness", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wallColor",          "TYPE": "color", "DEFAULT": [0.78, 0.79, 0.82, 1.0]},
        {"NAME": "wallShadowColor",    "TYPE": "color", "DEFAULT": [0.08, 0.08, 0.10, 1.0]},
        {"NAME": "voxelColorA",        "TYPE": "color", "DEFAULT": [0.95, 0.9, 0.82, 1.0]},
        {"NAME": "voxelColorB",        "TYPE": "color", "DEFAULT": [0.5, 0.55, 0.7, 1.0]},
        {"NAME": "hairlineColor",      "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "bgColor",            "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

#define MAX_DDA 72
#define MAX_SHADOW 48

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

// w1 = (wFloor, wCeil, wLeft), w2 = (wRight, wFront, wBack)
bool cellActive(vec3 cf, float fN, vec3 w1, vec3 w2) {
    if (cf.x < 0.0 || cf.x >= fN || cf.y < 0.0 || cf.y >= fN || cf.z < 0.0 || cf.z >= fN) return false;

    vec2 c_xz = vec2(cf.x, cf.z);
    vec2 c_yz = vec2(cf.y, cf.z);
    vec2 c_xy = vec2(cf.x, cf.y);

    float hFloor = hash2(c_xz * 0.37 + 100.0);
    float hCeil  = hash2(c_xz * 0.37 + 200.0);
    float hLeft  = hash2(c_yz * 0.37 + 300.0);
    float hRight = hash2(c_yz * 0.37 + 400.0);
    float hFront = hash2(c_xy * 0.37 + 500.0);
    float hBack  = hash2(c_xy * 0.37 + 600.0);

    float fx = (cf.x + 0.5) / fN;
    float fy = (cf.y + 0.5) / fN;
    float fz = (cf.z + 0.5) / fN;
    float ext = maxExtrusion;
    float gap = cellGaps;
    float hc = heightContrast;

    if (floorStrength > 0.0 && hFloor > gap
        && fy < pow(hFloor, hc) * w1.x * ext * floorStrength) return true;
    if (ceilStrength > 0.0 && hCeil > gap
        && fy > 1.0 - pow(hCeil, hc) * w1.y * ext * ceilStrength) return true;
    if (leftStrength > 0.0 && hLeft > gap
        && fx < pow(hLeft, hc) * w1.z * ext * leftStrength) return true;
    if (rightStrength > 0.0 && hRight > gap
        && fx > 1.0 - pow(hRight, hc) * w2.x * ext * rightStrength) return true;
    if (frontStrength > 0.0 && hFront > gap
        && fz < pow(hFront, hc) * w2.y * ext * frontStrength) return true;
    if (backStrength > 0.0 && hBack > gap
        && fz > 1.0 - pow(hBack, hc) * w2.z * ext * backStrength) return true;
    return false;
}

vec3 voxelColor(vec3 cf) {
    float h = hash3(cf * 0.37);
    return mix(voxelColorA.rgb, voxelColorB.rgb, h);
}

// Returns t (distance from pEntry) to hit, or -1. Output normal and cell (as vec3).
float ddaVoxel(vec3 pEntry, vec3 rd, vec3 entryN, float fN, vec3 w1, vec3 w2,
               out vec3 normalOut, out vec3 hitCell) {
    vec3 cf = floor(pEntry * fN);
    cf = clamp(cf, vec3(0.0), vec3(fN - 1.0));
    vec3 rayStep = sign(rd);
    vec3 deltaDist = abs(1.0 / rd) / fN;
    vec3 nextEdge = (cf + max(rayStep, vec3(0.0))) / fN;
    vec3 sideDist = (nextEdge - pEntry) / rd;

    normalOut = entryN;
    hitCell = vec3(-1.0);
    float tHit = 0.0;

    for (int i = 0; i < MAX_DDA; i++) {
        if (cellActive(cf, fN, w1, w2)) {
            hitCell = cf;
            return tHit;
        }
        if (sideDist.x < sideDist.y && sideDist.x < sideDist.z) {
            tHit = sideDist.x;
            sideDist.x += deltaDist.x;
            cf.x += rayStep.x;
            normalOut = vec3(-rayStep.x, 0.0, 0.0);
        } else if (sideDist.y < sideDist.z) {
            tHit = sideDist.y;
            sideDist.y += deltaDist.y;
            cf.y += rayStep.y;
            normalOut = vec3(0.0, -rayStep.y, 0.0);
        } else {
            tHit = sideDist.z;
            sideDist.z += deltaDist.z;
            cf.z += rayStep.z;
            normalOut = vec3(0.0, 0.0, -rayStep.z);
        }
        if (cf.x < 0.0 || cf.x >= fN || cf.y < 0.0 || cf.y >= fN || cf.z < 0.0 || cf.z >= fN) {
            break;
        }
    }
    return -1.0;
}

bool ddaShadow(vec3 p, vec3 L, float fN, vec3 w1, vec3 w2) {
    p += L * 0.002;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) return false;

    vec3 cf = floor(p * fN);
    cf = clamp(cf, vec3(0.0), vec3(fN - 1.0));
    vec3 rayStep = sign(L);
    vec3 deltaDist = abs(1.0 / L) / fN;
    vec3 nextEdge = (cf + max(rayStep, vec3(0.0))) / fN;
    vec3 sideDist = (nextEdge - p) / L;

    for (int i = 0; i < MAX_SHADOW; i++) {
        if (cellActive(cf, fN, w1, w2)) return true;
        if (sideDist.x < sideDist.y && sideDist.x < sideDist.z) {
            sideDist.x += deltaDist.x;
            cf.x += rayStep.x;
        } else if (sideDist.y < sideDist.z) {
            sideDist.y += deltaDist.y;
            cf.y += rayStep.y;
        } else {
            sideDist.z += deltaDist.z;
            cf.z += rayStep.z;
        }
        if (cf.x < 0.0 || cf.x >= fN || cf.y < 0.0 || cf.y >= fN || cf.z < 0.0 || cf.z >= fN) break;
    }
    return false;
}

void shadeRay(vec3 ro, vec3 rd, vec3 L, float fN, vec3 w1, vec3 w2,
              out vec3 colOut, out float hitWallFlag,
              out vec3 wallPosOut, out vec3 wallNOut) {
    vec3 inv = 1.0 / rd;
    vec3 tA = -ro * inv;
    vec3 tB = (1.0 - ro) * inv;
    vec3 tNv = min(tA, tB);
    vec3 tFv = max(tA, tB);
    float tNear = max(0.0, max(max(tNv.x, tNv.y), tNv.z));
    float tFar  = min(min(tFv.x, tFv.y), tFv.z);

    vec3 entryN;
    if (tNv.x >= tNv.y && tNv.x >= tNv.z)  entryN = vec3(-sign(rd.x), 0.0, 0.0);
    else if (tNv.y >= tNv.z)                entryN = vec3(0.0, -sign(rd.y), 0.0);
    else                                    entryN = vec3(0.0, 0.0, -sign(rd.z));

    vec3 wallN;
    if (tFv.x <= tFv.y && tFv.x <= tFv.z)   wallN = vec3(-sign(rd.x), 0.0, 0.0);
    else if (tFv.y <= tFv.z)                 wallN = vec3(0.0, -sign(rd.y), 0.0);
    else                                     wallN = vec3(0.0, 0.0, -sign(rd.z));
    vec3 wallPos = ro + rd * tFar;

    hitWallFlag = 0.0;
    wallPosOut = vec3(0.0);
    wallNOut = vec3(0.0);

    if (tFar > tNear) {
        vec3 pEntry = ro + rd * (tNear + 1e-4);
        pEntry = clamp(pEntry, vec3(0.0), vec3(0.9999));

        vec3 voxN;
        vec3 hitCell;
        float tDDA = ddaVoxel(pEntry, rd, entryN, fN, w1, w2, voxN, hitCell);

        if (tDDA >= 0.0) {
            vec3 p = pEntry + rd * tDDA;
            float diff = max(dot(voxN, L), 0.0);

            vec3 neighbor = p + voxN * (0.5 / fN);
            vec3 nCf = floor(neighbor * fN);
            bool nOcc = cellActive(nCf, fN, w1, w2);
            float localAO = nOcc ? 0.6 : 1.0;

            bool inShadow = ddaShadow(p, L, fN, w1, w2);
            float shadowMul = inShadow ? (1.0 - shadowStrength) : 1.0;

            float faceBoost = 1.0 + faceShade * (voxN.y - abs(voxN.x) * 0.5);

            vec3 vcol = voxelColor(hitCell);
            colOut = vcol * (voxelAmbient * localAO + diff * voxelBright * shadowMul) * faceBoost;
        } else {
            float diff = max(dot(wallN, L), 0.0);
            vec3 lit = wallColor.rgb * (wallAmbient + diff * wallBright);

            vec3 absN = abs(wallN);
            vec3 along = 1.0 - absN;
            vec3 dFaces = min(wallPos, 1.0 - wallPos) * along + absN;
            float dEdge = min(min(dFaces.x, dFaces.y), dFaces.z);
            float ao = mix(1.0, smoothstep(0.0, 0.15, dEdge), cornerAO);

            bool wallShadowed = ddaShadow(wallPos, L, fN, w1, w2);
            float shadowMul = wallShadowed ? (1.0 - shadowStrength) : 1.0;
            colOut = mix(wallShadowColor.rgb, lit, shadowMul) * ao;
            hitWallFlag = 1.0;
            wallPosOut = wallPos;
            wallNOut = wallN;
        }
    } else {
        colOut = bgColor.rgb;
    }
}

vec3 shadeOnce(vec3 ro, vec3 rd, vec3 L, float fN, vec3 w1, vec3 w2) {
    vec3 col; float hw; vec3 wp, wn;
    shadeRay(ro, rd, L, fN, w1, w2, col, hw, wp, wn);
    return col;
}

vec3 shadeOuter(vec3 ro, vec3 rd, vec3 L, float fN, vec3 w1, vec3 w2) {
    vec3 col; float hw; vec3 wp, wn;
    shadeRay(ro, rd, L, fN, w1, w2, col, hw, wp, wn);
    if (hw > 0.5 && wallReflection > 0.0) {
        vec3 reflDir = reflect(rd, wn);
        vec3 reflOrigin = wp + wn * 0.001;
        vec3 reflCol = shadeOnce(reflOrigin, reflDir, L, fN, w1, w2);
        col = mix(col, reflCol, wallReflection);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    float fN = floor(gridSize + 0.5);

    float ws = waveSpeed;
    vec3 w1 = vec3(
        0.5 + 0.5 * sin(t * ws * 1.00 + 0.0),
        0.5 + 0.5 * sin(t * ws * 1.31 + 1.7),
        0.5 + 0.5 * sin(t * ws * 0.88 + 3.2)
    );
    vec3 w2 = vec3(
        0.5 + 0.5 * sin(t * ws * 1.17 + 4.7),
        0.5 + 0.5 * sin(t * ws * 0.95 + 5.8),
        0.5 + 0.5 * sin(t * ws * 1.24 + 2.3)
    );

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float lzMag = sqrt(max(0.1,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, -lzMag));

    vec3 col = shadeOuter(ro, rd, L, fN, w1, w2);

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
