/*{
    "DESCRIPTION": "Magpie Bloom v2 — domain-warped SDF coral mass with rising violet plume, 80 discrete orbiting yellow particle orbs, screen-space lightning flashes, and bass-driven body emission. Inspired by Andy Thomas (Visual Magpie). All emissive channels audio-mappable: bass → body glow + form pulse, mids → lightning trigger, highs → particle brightness.",
    "CREDIT": "Ghost Arcade — Justin Wood, after @andythomasartist 'Visual Magpie'",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Organic", "Audio Reactive"],
    "INPUTS": [
        { "NAME": "speed",          "TYPE": "float", "MIN": 0.0,  "MAX": 2.0,  "DEFAULT": 0.30, "LABEL": "Time scale" },
        { "NAME": "formScale",      "TYPE": "float", "MIN": 0.6,  "MAX": 1.8,  "DEFAULT": 1.00, "LABEL": "Form size" },
        { "NAME": "roughness",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.55, "LABEL": "Coral roughness" },
        { "NAME": "verticalStretch","TYPE": "float", "MIN": 0.6,  "MAX": 1.8,  "DEFAULT": 1.25, "LABEL": "Vertical stretch" },

        { "NAME": "plumeStrength",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.70, "LABEL": "Plume strength" },
        { "NAME": "plumeReach",     "TYPE": "float", "MIN": 0.5,  "MAX": 3.0,  "DEFAULT": 1.80, "LABEL": "Plume reach" },

        { "NAME": "particleCount",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.75, "LABEL": "Particle density" },
        { "NAME": "particleSize",   "TYPE": "float", "MIN": 0.2,  "MAX": 2.0,  "DEFAULT": 1.00, "LABEL": "Particle size" },
        { "NAME": "particleSpread", "TYPE": "float", "MIN": 0.5,  "MAX": 3.0,  "DEFAULT": 1.50, "LABEL": "Particle spread" },

        { "NAME": "lightning",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.50, "LABEL": "Lightning strength" },
        { "NAME": "lightningSharp", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.65, "LABEL": "Lightning sharpness" },

        { "NAME": "emissionStrength","TYPE": "float", "MIN": 0.0, "MAX": 2.0,  "DEFAULT": 0.80, "LABEL": "Body emission" },

        { "NAME": "audioBass",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.0,  "LABEL": "Audio → bass channel" },
        { "NAME": "audioMids",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.0,  "LABEL": "Audio → mids channel" },
        { "NAME": "audioHighs",     "TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.0,  "LABEL": "Audio → highs channel" },
        { "NAME": "exposure",       "TYPE": "float", "MIN": 0.5,  "MAX": 2.0,  "DEFAULT": 1.00, "LABEL": "Exposure" },

        { "NAME": "bodyHi",         "TYPE": "color", "DEFAULT": [0.85, 0.95, 0.30, 1.0], "LABEL": "Body — ridges (yellow)" },
        { "NAME": "bodyMid",        "TYPE": "color", "DEFAULT": [0.45, 0.55, 0.32, 1.0], "LABEL": "Body — mids (olive)" },
        { "NAME": "bodyLo",         "TYPE": "color", "DEFAULT": [0.30, 0.18, 0.50, 1.0], "LABEL": "Body — shadows (violet)" },
        { "NAME": "emissionColor",  "TYPE": "color", "DEFAULT": [1.00, 0.55, 0.20, 1.0], "LABEL": "Body emission (bass)" },
        { "NAME": "plumeColor",     "TYPE": "color", "DEFAULT": [0.62, 0.42, 0.98, 1.0], "LABEL": "Plume color" },
        { "NAME": "particleColor",  "TYPE": "color", "DEFAULT": [1.00, 0.92, 0.30, 1.0], "LABEL": "Particle orb color" },
        { "NAME": "lightningColor", "TYPE": "color", "DEFAULT": [0.85, 0.90, 1.00, 1.0], "LABEL": "Lightning color" },
        { "NAME": "bgInner",        "TYPE": "color", "DEFAULT": [0.46, 0.40, 0.30, 1.0], "LABEL": "Background center" },
        { "NAME": "bgOuter",        "TYPE": "color", "DEFAULT": [0.16, 0.13, 0.10, 1.0], "LABEL": "Background edge" }
    ]
}*/

// ─────────────────────────────────────────────────────────────
// Noise primitives — value noise + cheap FBM. Hash from D. Hoskins.
// ─────────────────────────────────────────────────────────────
float hash13(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
}
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash13(i),                  hash13(i + vec3(1,0,0)), f.x),
            mix(hash13(i + vec3(0,1,0)),    hash13(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash13(i + vec3(0,0,1)),    hash13(i + vec3(1,0,1)), f.x),
            mix(hash13(i + vec3(0,1,1)),    hash13(i + vec3(1,1,1)), f.x), f.y),
        f.z);
}
float vnoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 2-octave 3D fbm — replaces v1's fbm4 in hot SDF path. 4× cheaper.
float fbm2(vec3 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.07 + 17.0) * 0.35;
}
// 2-octave 2D fbm — for screen-space lightning turbulence
float fbm2D(vec2 p) {
    return vnoise2(p) * 0.6 + vnoise2(p * 2.1 + 11.0) * 0.4;
}

// ─────────────────────────────────────────────────────────────
// Coral SDF — sphere with vertical stretch + cheap domain warp.
// Returns vec2(distance, surfaceDensity) so the shader can color
// by density without re-sampling. v2: warp uses fbm2 instead of
// fbm4 — same look, ~4× fewer noise lookups per SDF call.
// ─────────────────────────────────────────────────────────────
vec2 coralSDF(vec3 p, float t, float pulse) {
    vec3 q = p;
    q.y /= verticalStretch;

    // Cheap 3-channel warp — 3 fbm2 calls instead of v1's 3 fbm4
    vec3 warp = vec3(
        fbm2(q * 0.7 + vec3(0.0,  t * 0.20, 0.0)),
        fbm2(q * 0.7 + vec3(5.2,  t * 0.15, 1.3)),
        fbm2(q * 0.7 + vec3(8.1, -t * 0.18, 4.7))
    ) - 0.5;

    vec3 w = q + warp * 0.55;
    float detail = pow(fbm2(w * 2.4 + t * 0.10), 1.4);

    float topBias = smoothstep(0.0, 1.2, q.y) * 0.2;
    float baseRadius = 0.9 + topBias + pulse * 0.06;
    float sphere = length(q) - baseRadius;

    float d = sphere - (detail - 0.35) * roughness * 0.85;
    return vec2(d, detail);
}

// 4-tap tetrahedral normal — 33% fewer SDF calls than 6-tap central diff.
vec3 coralNormal(vec3 p, float t, float pulse) {
    const vec2 e = vec2(1.0, -1.0) * 0.012;
    return normalize(
        e.xyy * coralSDF(p + e.xyy, t, pulse).x +
        e.yyx * coralSDF(p + e.yyx, t, pulse).x +
        e.yxy * coralSDF(p + e.yxy, t, pulse).x +
        e.xxx * coralSDF(p + e.xxx, t, pulse).x
    );
}

// Bounding sphere intersection — early-skip pixels whose ray misses
// the form's bounding volume entirely. Big win on screen periphery.
vec2 sphIntersect(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return vec2(1e9, -1e9);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}

// ─────────────────────────────────────────────────────────────
// Plume density — vertical noise drift. v2: 1-octave instead of 2.
// ─────────────────────────────────────────────────────────────
float plumeDensity(vec3 p, float t) {
    vec3 q = p - vec3(0.0, t * 0.45, 0.0);
    float vMask = smoothstep(-0.1, 0.5, p.y) * smoothstep(plumeReach + 0.6, 0.0, p.y);
    float rMask = exp(-length(p.xz) * 1.6);
    return clamp((vnoise(q * 1.6) - 0.32) * 2.0, 0.0, 1.0) * vMask * rMask * plumeStrength;
}

// ─────────────────────────────────────────────────────────────
// Discrete particle orbs — 80 procedural points orbiting the form.
//
// Each particle has a deterministic home position (clustered around
// the form with vertical bias) and animates via 3-axis trig drift
// + an overall upward velocity. We accumulate point-line distance
// from the camera ray to each particle and shade as a soft additive
// disk. The audioHighs channel boosts brightness; randomized per-
// particle phase keeps the motion organic rather than synchronized.
//
// Cost: 80 iterations × ~12 ops = ~1000 ops per pixel. Roughly
// matches v1's threshold-noise ember cost but produces actual
// discrete orbs instead of speckles.
// ─────────────────────────────────────────────────────────────
vec3 sampleParticleOrbs(vec3 ro, vec3 rd, float tMax, float t, float boost) {
    vec3 acc = vec3(0.0);
    // Each particle gets a unique deterministic seed
    for (int i = 0; i < 80; i++) {
        float fi = float(i);

        // Home position — distributed in a vertical capsule via hash
        vec3 seed = vec3(fi * 0.13, fi * 0.41, fi * 0.83);
        vec3 h = hash33(seed) * 2.0 - 1.0;
        h.x *= particleSpread;
        h.z *= particleSpread;
        h.y = h.y * 1.6 + 0.2;  // bias upward

        // Per-particle phase + speed so they don't sync
        vec3 phase = hash33(seed + 9.0) * 6.283;
        float speedMod = 0.6 + hash13(seed) * 0.6;

        // Drift — slow trig oscillation + global upward velocity
        // The upward velocity is modulo'd into the home Y so particles
        // wrap rather than fly off, giving the illusion of a continuous
        // stream of orbs rising through the form.
        float upT = mod(t * 0.5 * speedMod + phase.y, 4.0) - 2.0;
        vec3 drift = vec3(
            sin(t * 0.7 * speedMod + phase.x) * 0.35,
            upT,
            cos(t * 0.55 * speedMod + phase.z) * 0.35
        );
        vec3 pPos = h + drift;

        // Skip particle if too far from the form's vicinity
        // (cheap early-cull before the expensive projection math)
        if (abs(pPos.x) > 3.0 || abs(pPos.z) > 3.0) continue;

        // Point-to-ray distance — project particle onto ray
        vec3 toP = pPos - ro;
        float tProj = dot(toP, rd);
        if (tProj < 0.05 || tProj > tMax + 0.5) continue;
        vec3 closest = ro + rd * tProj;
        float d = length(closest - pPos);

        // Per-particle size variation (some are tiny dust, some are
        // larger orbs). hash13 returns [0,1]; biased so most are small.
        float sizeRand = hash13(seed + 3.0);
        float sz = (0.04 + sizeRand * sizeRand * 0.10) * particleSize;

        // Soft additive disk — sharp center, exponential falloff
        float bright = exp(-d * d / (sz * sz));

        // Depth fade — particles behind the camera-near don't show
        bright *= smoothstep(0.05, 0.3, tProj);

        // Per-particle brightness modulation — some flicker more than
        // others. Sine of phase + time gives organic intensity bobs.
        float flicker = 0.55 + 0.45 * sin(t * 2.0 + phase.x * 3.0 + fi);

        // Audio highs boost: hi-freq peaks turn the orbs into bright
        // sparks. Linear in boost so 0 = normal, 1 = ~2× brighter.
        float aBoost = 1.0 + boost * 1.0;

        acc += particleColor.rgb * bright * flicker * aBoost;
    }
    return acc * particleCount;
}

// ─────────────────────────────────────────────────────────────
// Lightning / electric flash — screen-space turbulence threshold.
//
// Takes 2D fbm noise, takes its absolute value to create thin
// ridge filaments (the "lightning bolts"), thresholds tightly so
// only the sharpest ridges survive, and modulates by an audio
// pulse so flashes trigger on mid-band energy spikes.
//
// Centered on the form so bolts appear to emanate from it; falls
// off radially. Uses fbm2D (cheap 2-octave 2D fbm) — total cost
// is ~30 ops per pixel.
// ─────────────────────────────────────────────────────────────
float lightningField(vec2 uv, float t, float trigger) {
    // Radial bias — concentrate near the form's projected center
    float r = length(uv);
    if (r > 1.4) return 0.0;  // outside the active zone, skip

    // Slow time evolution + a fast jitter that resets the pattern
    // every ~0.4s, so flashes look discrete rather than continuous
    float jitter = floor(t * 2.5);
    vec2 q = uv * 3.5 + vec2(jitter * 17.3, jitter * 23.1);

    // Turbulence — abs(noise - 0.5) creates ridge filaments
    float n = fbm2D(q);
    float ridge = 1.0 - abs(n - 0.5) * 2.0;
    ridge = pow(ridge, mix(8.0, 28.0, lightningSharp));

    // Radial falloff — bolts brightest near the form, fade outward
    float radial = exp(-r * r * 2.5);

    // Per-jitter intensity scramble — some "flashes" are bright,
    // most are nearly invisible. Without this every frame would
    // have similar-energy bolts and it'd look like static.
    float burst = step(0.75, hash12(vec2(jitter, 0.0))) * (0.4 + hash12(vec2(jitter, 1.0)) * 0.6);

    return ridge * radial * burst * trigger;
}

mat3 cameraBasis(vec3 ro, vec3 ta) {
    vec3 fwd = normalize(ta - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    return mat3(right, up, fwd);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;

    // ── Audio channels ──
    // sampleFFT(0) → DC; sample slightly into the band to avoid that.
    // The three audio*Param uniforms gate each band so users can
    // dial in/out individual reactivities without touching the host.
    float bassRaw  = sampleFFT(0.06) + audioLevel * 0.20;
    float midsRaw  = sampleFFT(0.35) + audioLevel * 0.10;
    float highsRaw = sampleFFT(0.72) + audioLevel * 0.05;

    float bass  = bassRaw  * audioBass;
    float mids  = midsRaw  * audioMids;
    float highs = highsRaw * audioHighs;

    // Bass-driven form pulse + bright pulse
    float pulse = bass * 0.20;
    float brightPulse = 1.0 + bass * 0.45 + audioLevel * audioBass * 0.15;

    // Camera — slow orbit + slight vertical bob
    float camAngle = sin(t * 0.07) * 0.5 + t * 0.04;
    vec3 ro = vec3(sin(camAngle) * 3.6, 0.25 + sin(t * 0.13) * 0.15, cos(camAngle) * 3.6);
    mat3 cam = cameraBasis(ro, vec3(0.0, 0.1, 0.0));
    vec3 rd = cam * normalize(vec3(uv, 1.45));

    // ── Background — soft radial vignette ──
    float r2 = dot(uv, uv);
    vec3 col = mix(bgInner.rgb, bgOuter.rgb, smoothstep(0.0, 0.85, r2));

    // ── Bounding sphere test — skip body raymarch if ray misses ──
    // Form fits inside a radius-1.6 sphere (accounting for vertical
    // stretch + displacement amplitude). If the ray doesn't enter
    // this volume, skip the expensive body march entirely.
    vec2 boundsHit = sphIntersect(ro, rd, 1.6 * formScale);
    bool rayHitsBounds = boundsHit.y > boundsHit.x && boundsHit.y > 0.0;

    // ── Body raymarch ──
    float tHit = 0.0;
    bool hit = false;
    float surfDensity = 0.0;
    if (rayHitsBounds) {
        tHit = max(boundsHit.x, 0.1);  // start at sphere entry
        float tEnd = boundsHit.y + 0.2;
        for (int i = 0; i < 40; i++) {
            vec3 p = (ro + rd * tHit) / formScale;
            vec2 s = coralSDF(p, t, pulse);
            if (s.x < 0.0015) { hit = true; surfDensity = s.y; break; }
            if (tHit > tEnd) break;
            tHit += max(s.x * 0.85, 0.008);
        }
    }

    // ── Shade body ──
    vec3 bodyCol = vec3(0.0);
    float bodyAlpha = 0.0;
    if (hit) {
        vec3 p = (ro + rd * tHit) / formScale;
        vec3 n = coralNormal(p, t, pulse);

        vec3 keyDir = normalize(vec3(0.55, 0.80, 0.30));
        vec3 fillDir = normalize(vec3(-0.40, -0.10, -0.80));
        float key = max(dot(n, keyDir), 0.0);
        float fill = max(dot(n, fillDir), 0.0);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.4);

        // Color band by surface density (ridges → yellow, flats →
        // olive, recesses → violet)
        float band = clamp(surfDensity, 0.0, 1.0);
        vec3 baseCol;
        if (band > 0.55) {
            baseCol = mix(bodyMid.rgb, bodyHi.rgb, smoothstep(0.55, 0.85, band));
        } else {
            baseCol = mix(bodyLo.rgb, bodyMid.rgb, smoothstep(0.20, 0.55, band));
        }

        // Cheap AO from a far-step SDF sample along the normal
        float aoSample = coralSDF(p + n * 0.18, t, pulse).x;
        float ao = clamp(aoSample / 0.18, 0.2, 1.0);

        bodyCol = baseCol * (0.30 + key * 0.85 + fill * 0.20) * ao;
        bodyCol += plumeColor.rgb * rim * 0.55;
        bodyCol += bodyHi.rgb * pow(key, 6.0) * 0.6 * brightPulse;

        // ── Body emission — audio-driven inner glow ──
        // Drives the body color toward emissionColor where the
        // surface is densest (ridges + heat-pockets). Bass-amplified
        // so kicks light the form from within. emissionStrength
        // is the baseline (visible without audio); audio adds on top.
        float emiss = pow(band, 2.5) * (emissionStrength + bass * 0.8);
        bodyCol += emissionColor.rgb * emiss * 0.9;

        // Depth fade — pull far parts back into the background
        float depthFade = exp(-max(tHit - 2.5, 0.0) * 0.35);
        bodyCol = mix(col, bodyCol, depthFade);

        bodyAlpha = 1.0;
    }
    col = mix(col, bodyCol, bodyAlpha);

    // ── Volumetric plume ──
    // 16 steps with per-pixel jitter. Stops when alpha saturates
    // or when ray reaches the form surface.
    float jitter = hash13(vec3(fragCoord, TIME * 60.0));
    vec3 plumeAcc = vec3(0.0);
    float plumeAlpha = 0.0;
    for (int i = 0; i < 16; i++) {
        float tt = 0.6 + (float(i) + jitter) * 0.22;
        if (hit && tt > tHit - 0.05) break;
        vec3 p = ro + rd * tt;
        float d = plumeDensity(p, t);
        if (d > 0.01) {
            float shadow = 1.0 - plumeDensity(p - vec3(0.0, 0.25, 0.0), t) * 0.5;
            vec3 sc = plumeColor.rgb * (0.55 + 0.6 * d) * shadow;
            float a = d * 0.5 * (1.0 - plumeAlpha);
            plumeAcc += sc * a;
            plumeAlpha += a;
            if (plumeAlpha > 0.95) break;
        }
    }
    col = col * (1.0 - plumeAlpha) + plumeAcc;
    col += plumeAcc * 0.35 * brightPulse;

    // ── Particle orbs (additive over body + plume) ──
    // Highs-driven brightness boost on top of the per-particle flicker
    float tMaxForOrbs = hit ? tHit + 0.3 : 6.0;
    col += sampleParticleOrbs(ro, rd, tMaxForOrbs, t, highs);

    // ── Lightning flashes (additive screen-space overlay) ──
    // Trigger = mid-band energy + a baseline so it sparkles even
    // without audio (set lightning > 0 in the params for ambient,
    // turn audioMids up for true reactive bursts).
    float trigger = lightning * (0.18 + mids * 1.5);
    float bolt = lightningField(uv, TIME, trigger);
    col += lightningColor.rgb * bolt * 1.4;
    // Lightning also faintly illuminates the form (rim-style)
    if (hit) col += lightningColor.rgb * bolt * 0.5;

    // ── Tone ──
    col *= exposure;
    col = col / (1.0 + col * 0.65);
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.08);
    col = pow(col, vec3(0.92));

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
