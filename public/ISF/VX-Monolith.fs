/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A field of tall stone monoliths under two hard lights, matte grey against a black sky. Every hit of the sound it follows pushes a ripple of slab heights out from the middle of the field; a thin edge light marks the slab struck last. The camera moves slowly with the sound and steps to a new station on each bar.",
    "PASSES": [
        {
            "TARGET": "rippleAge",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "rippleAmp",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "lastHit",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "density", "LABEL": "Slab density", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "variance", "LABEL": "Height variance", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "punch", "LABEL": "Punch", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "lightAngle", "LABEL": "Light angle", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "fog", "LABEL": "Fog", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "camSpeed", "LABEL": "Camera speed", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "edgeLight", "LABEL": "Edge light", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Stone", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Edge light", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBar", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The field: a round patch of grid cells, one slab per cell, radius FIELD cells.
const float FIELD = 6.5;
const float HMAX = 9.0;
const float FOCAL = 2.0;
// Ripples: cells per second outward, wavefront width in cells, fall-off per second.
const float RIP_SPEED = 5.5;
const float RIP_WIDTH = 1.5;
const float RIP_DECAY = 0.9;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 q) {
    vec2 i = floor(q);
    vec2 f = fract(q);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Where a hit lands: a cell near the middle, chosen by its count.
vec2 rippleOrigin(float count) {
    float c = mod(count, 64.0);
    return vec2(floor(hash11(c * 3.71 + 1.3) * 3.0) - 1.0, floor(hash11(c * 5.13 + 7.9) * 3.0) - 1.0);
}

float bump1(vec2 c, float stored, float amp, vec2 o) {
    float age = stored - 1.0;
    float x = (length(c - o) - age * RIP_SPEED) / RIP_WIDTH;
    float b = 0.0;
    if (stored > 0.5 && abs(x) < 3.0) b = amp * exp(-x * x - age * RIP_DECAY);
    return b;
}

// Footprint half-size of the slab in a cell.
vec2 slabHalf(vec2 c) {
    // Monolith proportions: broad, thin, tall, all facing the same way.
    return vec2(mix(0.22, 0.44, density), mix(0.06, 0.11, density));
}

float slabHeight(vec2 c, vec4 ages, vec4 amps, vec4 ox, vec4 oz) {
    float r = length(c);
    if (r > FIELD) return 0.0;
    // The rim thins out so the field ends softly.
    if (hash21(c * 0.731 + 5.3) > 1.0 - 0.7 * smoothstep(FIELD * 0.6, FIELD, r)) return 0.0;
    float hr = hash21(c + 17.17);
    // A slow rolling landscape, with a few taller monoliths standing out of it.
    float land = valueNoise(c * 0.21 + 3.7);
    float tall = step(0.93, hash21(c * 2.37 + 0.71)) * (1.0 - smoothstep(3.0, FIELD, r));
    float base = 0.7 + variance * (2.0 * land * land + 0.4 * hr + tall * (1.8 + 1.4 * hr)) - 0.3 * smoothstep(FIELD * 0.5, FIELD, r);
    float b = bump1(c, ages.x, amps.x, vec2(ox.x, oz.x))
            + bump1(c, ages.y, amps.y, vec2(ox.y, oz.y))
            + bump1(c, ages.z, amps.z, vec2(ox.z, oz.z))
            + bump1(c, ages.w, amps.w, vec2(ox.w, oz.w));
    return min(base + punch * 2.4 * b, HMAX - 0.01);
}

// Steps through the grid cell by cell. Returns (t, what): what is 0 for sky,
// 1 ground, 2 a side facing x, 3 a top, 4 a side facing z.
vec2 castRay(vec3 ro, vec3 rd, vec4 ages, vec4 amps, vec4 ox, vec4 oz) {
    vec3 inv = 1.0 / rd;
    vec3 bmin = vec3(-FIELD - 0.5, 0.0, -FIELD - 0.5);
    vec3 bmax = vec3(FIELD + 0.5, HMAX, FIELD + 0.5);
    vec3 ta = (bmin - ro) * inv;
    vec3 tb = (bmax - ro) * inv;
    vec3 tlo = min(ta, tb);
    vec3 thi = max(ta, tb);
    float t0 = max(max(tlo.x, tlo.y), max(tlo.z, 0.0));
    float t1 = min(min(thi.x, thi.y), thi.z);
    vec2 result = vec2(1e9, 0.0);
    if (t0 < t1) {
        vec3 p = ro + rd * (t0 + 1e-4);
        vec2 cell = floor(p.xz + 0.5);
        vec2 dir = sign(rd.xz);
        vec2 tMax = ((cell + 0.5 * dir) - ro.xz) * inv.xz;
        vec2 tDelta = abs(inv.xz);
        float tg = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
        bool done = false;
        for (int i = 0; i < 44; i++) {
            if (!done) {
                float tExit = min(min(tMax.x, tMax.y), t1);
                float h = slabHeight(cell, ages, amps, ox, oz);
                if (h > 0.0) {
                    vec2 hs = slabHalf(cell);
                    vec3 lo = vec3(cell.x - hs.x, 0.0, cell.y - hs.y);
                    vec3 hi = vec3(cell.x + hs.x, h, cell.y + hs.y);
                    vec3 qa = (lo - ro) * inv;
                    vec3 qb = (hi - ro) * inv;
                    vec3 qn = min(qa, qb);
                    vec3 qf = max(qa, qb);
                    float tn = max(max(qn.x, qn.y), qn.z);
                    float tf = min(min(qf.x, qf.y), qf.z);
                    if (tn <= tf && tf > 0.0 && tn < tg) {
                        float what = (qn.x >= qn.y && qn.x >= qn.z) ? 2.0 : ((qn.y >= qn.z) ? 3.0 : 4.0);
                        result = vec2(tn, what);
                        done = true;
                    }
                }
                if (!done && tg <= tExit) {
                    result = vec2(tg, 1.0);
                    done = true;
                }
                if (!done && tExit >= t1) done = true;
                if (!done) {
                    if (tMax.x < tMax.y) {
                        cell.x += dir.x;
                        tMax.x += tDelta.x;
                    } else {
                        cell.y += dir.y;
                        tMax.y += tDelta.y;
                    }
                }
            }
        }
    }
    return result;
}

// Hard shadow toward the key light: 0 if any slab is in the way.
float shadowRay(vec3 ro, vec3 rd, vec4 ages, vec4 amps, vec4 ox, vec4 oz) {
    vec3 inv = 1.0 / rd;
    vec2 cell = floor(ro.xz + 0.5);
    vec2 dir = sign(rd.xz);
    vec2 tMax = ((cell + 0.5 * dir) - ro.xz) * inv.xz;
    vec2 tDelta = abs(inv.xz);
    float lit = 1.0;
    float tIn = 0.0;
    bool done = false;
    for (int i = 0; i < 22; i++) {
        if (!done) {
            // Above every slab: nothing further can block the light.
            if (ro.y + rd.y * tIn > HMAX) done = true;
            if (!done) {
                float h = slabHeight(cell, ages, amps, ox, oz);
                if (h > 0.0) {
                    vec2 hs = slabHalf(cell);
                    vec3 lo = vec3(cell.x - hs.x, 0.0, cell.y - hs.y);
                    vec3 hi = vec3(cell.x + hs.x, h, cell.y + hs.y);
                    vec3 qa = (lo - ro) * inv;
                    vec3 qb = (hi - ro) * inv;
                    vec3 qn = min(qa, qb);
                    vec3 qf = max(qa, qb);
                    float tn = max(max(qn.x, qn.y), qn.z);
                    float tf = min(min(qf.x, qf.y), qf.z);
                    if (tn <= tf && tf > 1e-3) {
                        lit = 0.0;
                        done = true;
                    }
                }
                tIn = min(tMax.x, tMax.y);
                if (tMax.x < tMax.y) {
                    cell.x += dir.x;
                    tMax.x += tDelta.x;
                } else {
                    cell.y += dir.y;
                    tMax.y += tDelta.y;
                }
            }
        }
    }
    return lit;
}

// Shades one ray: matte stone lit by the key (with hard shadows) and the rim.
vec3 renderRay(vec3 ro, vec3 rd, vec4 ages, vec4 amps, vec4 ox, vec4 oz, vec3 L1, vec3 L2, vec2 newestCell, float newestAge, vec2 fw) {
    vec2 hit = castRay(ro, rd, ages, amps, ox, oz);
    vec3 col = vec3(0.0);
    if (hit.y > 0.5) {
        float t = hit.x;
        vec3 pos = ro + rd * t;
        vec2 cell = floor(pos.xz + 0.5);
        vec3 nrm = vec3(0.0, 1.0, 0.0);
        if (hit.y > 1.5 && hit.y < 2.5) nrm = vec3(-sign(rd.x), 0.0, 0.0);
        if (hit.y > 3.5) nrm = vec3(0.0, 0.0, -sign(rd.z));
        bool ground = hit.y < 1.5;

        float k1 = max(dot(nrm, L1), 0.0);
        if (k1 > 0.0) k1 *= shadowRay(pos + nrm * 2e-3, L1, ages, amps, ox, oz);
        float k2 = max(dot(nrm, L2), 0.0);
        float albedo = ground ? 0.06 : 0.3 + 0.07 * hash21(cell + 9.1);
        // A fine grain in the stone.
        vec2 fc = abs(nrm.x) > 0.5 ? pos.zy : (abs(nrm.z) > 0.5 ? pos.xy : pos.xz);
        albedo *= 0.9 + 0.1 * valueNoise(fc * 23.0 + cell * 7.0) + 0.06 * valueNoise(fc * vec2(3.0, 0.7) + cell);
        // Darker toward the foot of each slab.
        float ao = ground ? 1.0 : mix(0.25, 1.0, smoothstep(0.0, 3.0, pos.y));
        float ambient = mix(0.05, 0.0, contrast);
        float lum = albedo * (2.1 * k1 + 0.4 * k2 + ambient) * ao;
        lum = pow(lum, mix(0.85, 1.6, contrast));
        // The ground fades out toward the rim of the field.
        if (ground) lum *= 1.0 - smoothstep(FIELD * 0.45, FIELD + 0.5, length(pos.xz));

        float accentEdge = 0.0;
        if (!ground && all(equal(cell, newestCell)) && newestAge > -0.5) {
            float h = slabHeight(cell, ages, amps, ox, oz);
            vec2 hs = slabHalf(cell);
            vec3 q = pos - vec3(cell.x, 0.0, cell.y);
            float e;
            if (hit.y > 2.5 && hit.y < 3.5) e = min(hs.x - abs(q.x), hs.y - abs(q.z));
            else if (hit.y < 2.5) e = min(hs.y - abs(q.z), h - q.y);
            else e = min(hs.x - abs(q.x), h - q.y);
            // One stored pixel, measured on the slab at this distance.
            float wpx = t * fw.y / (FOCAL * RENDERSIZE.y) / max(abs(dot(nrm, -rd)), 0.3);
            float line = 1.0 - smoothstep(1.0 * wpx, 2.0 * wpx, e);
            float flash = 0.6 + 0.4 * exp(-newestAge / 0.45);
            accentEdge = line * flash * edgeLight;
        }
        float fogged = exp(-max(t - 15.0, 0.0) * mix(0.0, 0.3, fog));
        col = ink.rgb * lum * fogged;
        col = mix(col, accent.rgb, clamp(accentEdge, 0.0, 1.0) * fogged);
    }
    return col;
}

// Camera stations, one per bar, cycling every four bars.
vec3 station(float s) {
    if (s < 0.5) return vec3(0.0, 0.56, 20.0);
    if (s < 1.5) return vec3(0.14, 0.5, 18.5);
    if (s < 2.5) return vec3(0.24, 0.62, 21.0);
    return vec3(0.1, 0.46, 19.0);
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    // State lives in 1x1 targets. rippleAge: per slot, 1 + seconds since its hit
    // (0 = empty). rippleAmp: per slot, the strength of its hit. lastHit: the count.
    if (PASSINDEX < 2) {
        vec4 v = PASSINDEX == 0 ? IMG_NORM_PIXEL(rippleAge, vec2(0.5)) : IMG_NORM_PIXEL(rippleAmp, vec2(0.5));
        float last = IMG_NORM_PIXEL(lastHit, vec2(0.5)).r;
        if (FRAMEINDEX < 2) v = vec4(0.0);
        if (PASSINDEX == 0) {
            vec4 alive = step(0.5, v);
            v = (v + dt) * alive;
            v *= 1.0 - step(6.0, v);
        }
        if (FRAMEINDEX >= 2 && abs(n - last) > 0.5) {
            float slot = mod(n, 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            float strength = (0.55 + 0.45 * clamp(vxVel, 0.0, 1.0)) * (mod(n, 4.0) < 0.5 ? 1.25 : 1.0);
            v = mix(v, vec4(PASSINDEX == 0 ? 1.0 : strength), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 2) {
        gl_FragColor = vec4(n, 0.0, 0.0, 1.0);
        return;
    }

    // Ripples, newest first in slot order.
    vec4 ages = IMG_NORM_PIXEL(rippleAge, vec2(0.5));
    vec4 amps = IMG_NORM_PIXEL(rippleAmp, vec2(0.5));
    vec4 ox = vec4(0.0);
    vec4 oz = vec4(0.0);
    for (int s = 0; s < 4; s++) {
        float fs = float(s);
        // The count that last wrote slot s.
        float c = n - mod(n - fs + 64.0, 4.0);
        vec2 o = rippleOrigin(c);
        vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - fs));
        ox += pick * o.x;
        oz += pick * o.y;
    }
    float newestSlot = mod(n, 4.0);
    vec4 pickNew = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - newestSlot));
    float newestAge = dot(ages, pickNew) - 1.0;
    vec2 newestCell = rippleOrigin(n);

    // Camera: a slow orbit from the motion clock, plus a station per bar that
    // it eases into over the first beat.
    float moveAmt = min(camSpeed * 2.5, 1.0);
    float st = mod(vxBars, 4.0);
    float ease = smoothstep(0.0, 1.0, vxBar);
    vec3 stn = mix(station(mod(st + 3.0, 4.0)), station(st), ease);
    float az = 0.75 + vxPhase * mix(0.0, 0.05, camSpeed) + stn.x * moveAmt;
    float el = mix(0.55, stn.y, moveAmt) + 0.03 * sin(vxPhase * 0.021);
    float dist = mix(21.5, stn.z + 1.5, moveAmt);
    vec3 target = vec3(0.0, 0.6, 0.0);
    vec3 ro = target + dist * vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);

    // Lights: a low hard key from one side, a dimmer rim from behind.
    float la = az + mix(-2.6, 2.6, lightAngle);
    vec3 L1 = normalize(vec3(cos(0.42) * sin(la), sin(0.42), cos(0.42) * cos(la)));
    vec3 L2 = normalize(vec3(cos(0.95) * sin(la + 2.6), sin(0.95), cos(0.95) * cos(la + 2.6)));

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    // Four rays per stored pixel on a rotated grid keep the edges and shadows clean.
    vec3 col = vec3(0.0);
    for (int k = 0; k < 4; k++) {
        vec2 o = vec2(-0.375, -0.125);
        if (k == 1) o = vec2(0.125, -0.375);
        if (k == 2) o = vec2(0.375, 0.125);
        if (k == 3) o = vec2(-0.125, 0.375);
        vec2 ps = p + o * fw / RENDERSIZE.y;
        vec3 rd = normalize(fwd * FOCAL + right * ps.x + up * ps.y);
        rd = rd + vec3(equal(rd, vec3(0.0))) * 1e-5;
        col += renderRay(ro, rd, ages, amps, ox, oz, L1, L2, newestCell, newestAge, fw) * 0.25;
    }

    float lit = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lit);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
