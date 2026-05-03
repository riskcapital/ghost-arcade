/*{
    "DESCRIPTION": "Aquarium Fill - 3D chamber fills with volumetric water poured from a top source. Looking through the layer's front face like a glass aquarium. Beer-Lambert underwater absorption, animated caustics on submerged walls, ripples on the surface, fresnel highlights, pour stream + splash. Optional wall reflectivity mirrors the scene on dry walls above the water line.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",                "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "waterLevel",           "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "autoFill",             "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "fillPeriod",           "TYPE": "float", "DEFAULT": 25.0, "MIN": 5.0,   "MAX": 120.0},
        {"NAME": "holdFraction",         "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 0.8},
        {"NAME": "pourWidth",            "TYPE": "float", "DEFAULT": 0.018,"MIN": 0.003, "MAX": 0.06},
        {"NAME": "pourBrightness",       "TYPE": "float", "DEFAULT": 1.8,  "MIN": 0.0,   "MAX": 5.0},
        {"NAME": "pourWobble",           "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "splashBrightness",     "TYPE": "float", "DEFAULT": 1.2,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "rippleFreq",           "TYPE": "float", "DEFAULT": 32.0, "MIN": 1.0,   "MAX": 80.0},
        {"NAME": "rippleSpeed",          "TYPE": "float", "DEFAULT": 6.0,  "MIN": 0.0,   "MAX": 20.0},
        {"NAME": "rippleDecay",          "TYPE": "float", "DEFAULT": 3.5,  "MIN": 0.0,   "MAX": 10.0},
        {"NAME": "surfaceReflect",       "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0,   "MAX": 1.5},
        {"NAME": "absorptionStrength",   "TYPE": "float", "DEFAULT": 1.8,  "MIN": 0.0,   "MAX": 6.0},
        {"NAME": "scatteringStrength",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "causticIntensity",     "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "causticScale",         "TYPE": "float", "DEFAULT": 8.0,  "MIN": 1.0,   "MAX": 24.0},
        {"NAME": "causticSpeed",         "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "focalLength",          "TYPE": "float", "DEFAULT": 2.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "vanishPointX",         "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",         "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lightAzimuth",         "TYPE": "float", "DEFAULT": -0.2, "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "lightElevation",       "TYPE": "float", "DEFAULT": 0.7,  "MIN": -1.0,  "MAX": 1.0},
        {"NAME": "wallAmbient",          "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "wallBright",           "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "wallReflection",       "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "cornerAO",             "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "glassFresnel",         "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "hairlineWidth",        "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.15},
        {"NAME": "hairlineBrightness",   "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wallColor",            "TYPE": "color", "DEFAULT": [0.82, 0.84, 0.88, 1.0]},
        {"NAME": "waterAbsorption",      "TYPE": "color", "DEFAULT": [0.9, 0.35, 0.12, 1.0]},
        {"NAME": "waterTint",            "TYPE": "color", "DEFAULT": [0.2, 0.55, 0.75, 1.0]},
        {"NAME": "surfaceColor",         "TYPE": "color", "DEFAULT": [0.75, 0.9, 1.0, 1.0]},
        {"NAME": "pourColor",            "TYPE": "color", "DEFAULT": [0.85, 0.95, 1.0, 1.0]},
        {"NAME": "hairlineColor",        "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "bgColor",              "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

float hash1(float n) { return fract(sin(n * 43.1 + 17.3) * 43758.5453); }
float hash2(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i),                hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float caustic(vec2 p, float t, float scl, float spd) {
    p *= scl;
    float ts = t * spd;
    float v = 0.0;
    v += sin(p.x + ts)               * sin(p.y + ts * 1.3);
    v += sin(p.x * 1.7 + ts * 0.7)   * sin(p.y * 1.7 + ts * 1.1 + 20.0);
    v += sin(p.x * 2.3 + ts * 1.2)   * sin(p.y * 2.3 + ts * 0.9 + 50.0);
    v = v * 0.3333 + 0.5;
    return pow(clamp(v, 0.0, 1.0), 3.5);
}

float rippleHeight(vec2 xz, float t, vec2 impact, float freq, float spd, float decay) {
    vec2 pd = xz - impact;
    float r = length(pd);
    float h = cos(r * freq - t * spd) * exp(-r * decay);
    h += 0.08 * (noise2(xz * 6.0 + t * 0.4) - 0.5);
    return h;
}

vec3 rippleNormal(vec2 xz, float t, vec2 impact, float freq, float spd, float decay, float amp) {
    float e = 0.004;
    float hc = rippleHeight(xz,                 t, impact, freq, spd, decay);
    float hx = rippleHeight(xz + vec2(e, 0.0),  t, impact, freq, spd, decay);
    float hz = rippleHeight(xz + vec2(0.0, e),  t, impact, freq, spd, decay);
    vec3 n = vec3((hc - hx) * amp / e, 1.0, (hc - hz) * amp / e);
    return normalize(n);
}

// Full scene render at a given ray. Returns color, also reports if hit is on a DRY wall (for reflection).
void renderScene(vec3 ro, vec3 rd, vec3 L, float t, float wl,
                  out vec3 colOut, out float dryWallFlag,
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

    float tWater = -1.0;
    if (abs(rd.y) > 1e-4) {
        tWater = (wl - ro.y) / rd.y;
    }

    float uEnter, uExit;
    if (rd.y > 1e-4) {
        uEnter = tNear;
        uExit  = (tWater > tNear) ? min(tFar, tWater) : tNear;
    } else if (rd.y < -1e-4) {
        uEnter = (tWater < tFar) ? max(tNear, tWater) : tFar;
        uExit  = tFar;
    } else {
        if (ro.y < wl) { uEnter = tNear; uExit = tFar; }
        else           { uEnter = 0.0;   uExit = 0.0; }
    }
    float waterPath = max(0.0, uExit - uEnter);

    bool wallUnderwater = wallPos.y < wl;

    float diff = max(dot(wallN, L), 0.0);
    vec3 lit = wallColor.rgb * (wallAmbient + diff * wallBright);

    vec3 absN = abs(wallN);
    vec3 along = 1.0 - absN;
    vec3 dFaces = min(wallPos, 1.0 - wallPos) * along + absN;
    float dEdge = min(min(dFaces.x, dFaces.y), dFaces.z);
    float ao = mix(1.0, smoothstep(0.0, 0.15, dEdge), cornerAO);
    vec3 col = lit * ao;

    if (wallUnderwater) {
        vec2 wxz;
        if (absN.x > 0.5)      wxz = wallPos.yz;
        else if (absN.z > 0.5) wxz = wallPos.xy;
        else                   wxz = wallPos.xz;
        float c = caustic(wxz, t, causticScale, causticSpeed);
        float depth = wl - wallPos.y;
        float depthFade = exp(-depth * 1.5);
        col += waterTint.rgb * c * causticIntensity * depthFade;
    }

    vec3 absK = waterAbsorption.rgb * absorptionStrength;
    vec3 tint = exp(-absK * waterPath);
    col *= tint;
    vec3 scatter = waterTint.rgb * (1.0 - exp(-waterPath * scatteringStrength * 2.0))
                   * scatteringStrength;
    col += scatter;

    if (tWater > tNear && tWater < tFar) {
        vec3 sp = ro + rd * tWater;
        if (sp.x > 0.0 && sp.x < 1.0 && sp.z > 0.0 && sp.z < 1.0) {
            vec2 impact = vec2(0.5, 0.5);
            vec3 sN = rippleNormal(sp.xz, t, impact, rippleFreq, rippleSpeed, rippleDecay, 0.015);

            float cosI = max(0.0, -dot(rd, sN));
            float fres = pow(1.0 - cosI, 3.0);
            vec3 H = normalize(L - rd);
            float spec = pow(max(dot(sN, H), 0.0), 96.0);

            vec3 surfHL = surfaceColor.rgb * (fres * surfaceReflect + spec * 1.2);
            col += surfHL;
        }
    }

    float viewNdotZ = abs(rd.z);
    float glassF = pow(1.0 - viewNdotZ, 4.0) * glassFresnel;
    col += surfaceColor.rgb * glassF * 0.5;

    vec3 aP = vec3(0.5, 0.0, 0.5);
    vec3 aD = vec3(0.0, 1.0, 0.0);
    vec3 w0 = ro - aP;
    float aDr = dot(rd, aD);
    float denom = 1.0 - aDr * aDr;
    if (denom > 1e-5) {
        float d0 = dot(rd, w0);
        float e0 = dot(aD, w0);
        float sc = (aDr * e0 - d0) / denom;
        float tc = (e0 - aDr * d0) / denom;
        if (sc > tNear && sc < tFar && tc > wl && tc < 1.0) {
            vec3 rayP = ro + sc * rd;
            vec3 linP = vec3(0.5, tc, 0.5);
            float wob = sin(tc * 18.0 - t * 14.0) * pourWidth * 0.3 * pourWobble;
            linP.x += wob;
            linP.z += cos(tc * 16.0 - t * 12.0) * pourWidth * 0.3 * pourWobble;
            float d = length(rayP - linP);
            float streamGlow = exp(-(d * d) / (2.0 * pourWidth * pourWidth));
            col += pourColor.rgb * streamGlow * pourBrightness;
        }
    }

    vec3 impactP = vec3(0.5, wl, 0.5);
    vec3 oc = impactP - ro;
    float tImp = dot(oc, rd);
    if (tImp > tNear && tImp < tFar) {
        vec3 nearImp = ro + rd * tImp;
        float dImp = length(nearImp - impactP);
        float splashR = pourWidth * 2.8;
        float splash = exp(-(dImp * dImp) / (2.0 * splashR * splashR));
        splash *= 0.7 + 0.3 * sin(t * 12.0);
        col += surfaceColor.rgb * splash * splashBrightness;

        if (tWater > tNear && tWater < tFar) {
            vec3 sp2 = ro + rd * tWater;
            if (sp2.x > 0.0 && sp2.x < 1.0 && sp2.z > 0.0 && sp2.z < 1.0) {
                float rr = length(sp2.xz - vec2(0.5, 0.5));
                float ring = sin(rr * 35.0 - t * 10.0) * exp(-rr * 4.0);
                col += surfaceColor.rgb * max(0.0, ring) * 0.3 * splashBrightness;
            }
        }
    }

    colOut = col;
    // Reflection is only meaningful on DRY wall surfaces (above the water line)
    dryWallFlag = (wallUnderwater ? 0.0 : 1.0);
    wallPosOut = wallPos;
    wallNOut = wallN;
}

vec3 shadeOnce(vec3 ro, vec3 rd, vec3 L, float t, float wl) {
    vec3 col; float dw; vec3 wp, wn;
    renderScene(ro, rd, L, t, wl, col, dw, wp, wn);
    return col;
}

vec3 shadeOuter(vec3 ro, vec3 rd, vec3 L, float t, float wl) {
    vec3 col; float dw; vec3 wp, wn;
    renderScene(ro, rd, L, t, wl, col, dw, wp, wn);
    if (dw > 0.5 && wallReflection > 0.0) {
        vec3 reflDir = reflect(rd, wn);
        vec3 reflOrigin = wp + wn * 0.001;
        vec3 reflCol = shadeOnce(reflOrigin, reflDir, L, t, wl);
        col = mix(col, reflCol, wallReflection);
    }
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    float f = focalLength;

    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float wl = waterLevel;
    if (autoFill > 0.5) {
        float phase = mod(TIME, fillPeriod) / fillPeriod;
        float fillEnd = 1.0 - holdFraction;
        if (phase < fillEnd) {
            wl = smoothstep(0.0, 1.0, phase / fillEnd);
        } else {
            wl = 1.0;
        }
    }

    float lzMag = sqrt(max(0.1,
        1.0 - lightAzimuth * lightAzimuth - lightElevation * lightElevation));
    vec3 L = normalize(vec3(lightAzimuth, lightElevation, -lzMag));

    vec3 col = shadeOuter(ro, rd, L, t, wl);

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
