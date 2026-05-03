/*{
    "DESCRIPTION": "Quantum Chamber - Raymarched 3D particle-in-a-box. Superposed eigenstates ψ_{mnp} = sin(mπx)sin(nπy)sin(pπz) live inside an invisible 3D chamber whose walls are mathematical zero boundaries. Probability density |ψ|² oscillates in 3D. Ray-integrated cube wireframe makes all 12 edges glow. Optional wall reflectivity mirrors the chamber onto its far wall.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",           "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "modeCount",       "TYPE": "float", "DEFAULT": 4.0,  "MIN": 1.0,   "MAX": 6.0},
        {"NAME": "modeRange",       "TYPE": "float", "DEFAULT": 6.0,  "MIN": 2.0,   "MAX": 12.0},
        {"NAME": "stepCount",       "TYPE": "float", "DEFAULT": 48.0, "MIN": 16.0,  "MAX": 96.0},
        {"NAME": "focalLength",     "TYPE": "float", "DEFAULT": 2.2,  "MIN": 1.2,   "MAX": 6.0},
        {"NAME": "vanishPointX",    "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "vanishPointY",    "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "density",         "TYPE": "float", "DEFAULT": 1.2,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "brightness",      "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "wireThickness",   "TYPE": "float", "DEFAULT": 0.018,"MIN": 0.002, "MAX": 0.08},
        {"NAME": "wireBrightness",  "TYPE": "float", "DEFAULT": 2.0,  "MIN": 0.0,   "MAX": 6.0},
        {"NAME": "hairline",        "TYPE": "float", "DEFAULT": 1.2,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "wallReflection",  "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "reshuffleRate",   "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0,   "MAX": 0.5},
        {"NAME": "bgColor",         "TYPE": "color", "DEFAULT": [0.005, 0.008, 0.015, 1.0]},
        {"NAME": "posColor",        "TYPE": "color", "DEFAULT": [0.15, 0.6, 1.0, 1.0]},
        {"NAME": "negColor",        "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.7, 1.0]},
        {"NAME": "wireColor",       "TYPE": "color", "DEFAULT": [1.0, 0.97, 0.82, 1.0]}
    ]
}*/

#define PI 3.14159265359
#define KMAX 6
#define SMAX 96

float hash1(float n) { return fract(sin(n * 43.1 + 17.3) * 43758.5453); }

vec2 boxIntersect(vec3 ro, vec3 rd) {
    vec3 inv = 1.0 / rd;
    vec3 t1 = -ro * inv;
    vec3 t2 = (1.0 - ro) * inv;
    vec3 tN = min(t1, t2);
    vec3 tF = max(t1, t2);
    return vec2(max(max(tN.x, tN.y), tN.z), min(min(tF.x, tF.y), tF.z));
}

vec3 exitNormal(vec3 ro, vec3 rd) {
    vec3 inv = 1.0 / rd;
    vec3 t1 = -ro * inv;
    vec3 t2 = (1.0 - ro) * inv;
    vec3 tFv = max(t1, t2);
    if (tFv.x <= tFv.y && tFv.x <= tFv.z) return vec3(-sign(rd.x), 0.0, 0.0);
    if (tFv.y <= tFv.z)                    return vec3(0.0, -sign(rd.y), 0.0);
    return vec3(0.0, 0.0, -sign(rd.z));
}

vec3 traceVolume(vec3 ro, vec3 rd, float t, int K, int STEPS, float era, float eraBlend) {
    vec3 accum = vec3(0.0);
    vec2 tHit = boxIntersect(ro, rd);
    if (tHit.y <= max(tHit.x, 0.0)) return accum;

    float tNear = max(tHit.x, 0.0);
    float tFar  = tHit.y;
    float stepSize = (tFar - tNear) / float(STEPS);

    for (int i = 0; i < SMAX; i++) {
        if (i >= STEPS) break;
        float tStep = tNear + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * tStep;

        float psiR = 0.0, psiI = 0.0;

        for (int k = 0; k < KMAX; k++) {
            if (k >= K) break;
            float fk = float(k);
            float amp = 1.0 / (1.0 + fk * 0.3);

            for (int eIdx = 0; eIdx < 2; eIdx++) {
                float eOff = (eIdx == 0) ? era : era + 1.0;
                float w = (eIdx == 0) ? (1.0 - eraBlend) : eraBlend;
                if (w < 0.001) continue;

                float m = floor(2.0 + hash1(fk * 1.31 + eOff * 7.0)  * (modeRange - 2.0));
                float n = floor(2.0 + hash1(fk * 2.73 + eOff * 11.0) * (modeRange - 2.0));
                float p = floor(2.0 + hash1(fk * 4.11 + eOff * 29.0) * (modeRange - 2.0));

                float phi = sin(m * PI * pos.x) * sin(n * PI * pos.y) * sin(p * PI * pos.z);
                float E = m*m + n*n + p*p;
                float omega = E * t * 0.04 + fk * 1.5 + float(eIdx) * 0.7;

                float wa = amp * w;
                psiR += wa * phi * cos(omega);
                psiI += wa * phi * sin(omega);
            }
        }

        float rho = (psiR * psiR + psiI * psiI);
        float phase = atan(psiI, psiR);
        vec3 emission = mix(posColor.rgb, negColor.rgb, 0.5 + 0.5 * sin(phase));
        accum += emission * rho * density * stepSize;

        vec3 dFace = min(pos, 1.0 - pos);
        float dMin = min(min(dFace.x, dFace.y), dFace.z);
        float dMax = max(max(dFace.x, dFace.y), dFace.z);
        float dMid = dFace.x + dFace.y + dFace.z - dMin - dMax;
        float wire = smoothstep(wireThickness, 0.0, dMid);
        accum += wireColor.rgb * wire * wireBrightness * stepSize;
    }

    return accum;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    int K = int(modeCount);
    int STEPS = int(stepCount);

    float f = focalLength;
    vec3 ro = vec3(vanishPointX, vanishPointY, -f);
    vec3 rd = normalize(vec3(uv - vec2(vanishPointX, vanishPointY), f));

    float era      = floor(t * reshuffleRate);
    float eraBlend = smoothstep(0.0, 1.0, fract(t * reshuffleRate));

    vec3 col = bgColor.rgb;

    vec2 tHit = boxIntersect(ro, rd);
    if (tHit.y > max(tHit.x, 0.0)) {
        vec3 accum = traceVolume(ro, rd, t, K, STEPS, era, eraBlend) * brightness;

        if (wallReflection > 0.0) {
            vec3 wallPos = ro + rd * tHit.y;
            vec3 wallN = exitNormal(ro, rd);
            vec3 reflDir = reflect(rd, wallN);
            vec3 reflOrigin = wallPos + wallN * 0.001;
            vec3 reflAccum = traceVolume(reflOrigin, reflDir, t, K, STEPS, era, eraBlend) * brightness;
            accum += reflAccum * wallReflection;
        }

        col += accum;
    }

    float ex = min(uv.x, 1.0 - uv.x);
    float ey = min(uv.y, 1.0 - uv.y);
    float edgeDist = min(ex, ey);
    float hair = smoothstep(0.005, 0.0, edgeDist);
    col += wireColor.rgb * hair * hairline;

    gl_FragColor = vec4(col, 1.0);
}
