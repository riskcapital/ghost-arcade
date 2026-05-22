/*{
    "DESCRIPTION": "Magpie Bloom — slowly evolving organic coral mass with rising violet plume + yellow ember sparks on a warm tan ground. Inspired by Andy Thomas (Visual Magpie). Body geometry is a domain-warped SDF with cellular FBM roughness; the plume is a volumetric noise field drifting upward; embers are threshold-noise specks. Body color modulates by surface density (yellow-green ridges / olive flats / violet shadows).",
    "CREDIT": "Ghost Arcade — Justin Wood, after @andythomasartist 'Visual Magpie'",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Organic", "Volumetric"],
    "INPUTS": [
        { "NAME": "speed",       "TYPE": "float", "MIN": 0.0,  "MAX": 2.0,  "DEFAULT": 0.30, "LABEL": "Time scale" },
        { "NAME": "formScale",   "TYPE": "float", "MIN": 0.6,  "MAX": 1.8,  "DEFAULT": 1.00, "LABEL": "Form size" },
        { "NAME": "roughness",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.55, "LABEL": "Coral roughness" },
        { "NAME": "verticalStretch", "TYPE": "float", "MIN": 0.6, "MAX": 1.8, "DEFAULT": 1.25, "LABEL": "Vertical stretch" },
        { "NAME": "plumeStrength","TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.70, "LABEL": "Plume strength" },
        { "NAME": "plumeReach",  "TYPE": "float", "MIN": 0.5,  "MAX": 3.0,  "DEFAULT": 1.80, "LABEL": "Plume reach" },
        { "NAME": "emberDensity","TYPE": "float", "MIN": 0.0,  "MAX": 1.5,  "DEFAULT": 0.75, "LABEL": "Ember density" },
        { "NAME": "audioBoost",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.00, "LABEL": "Audio reactivity" },
        { "NAME": "exposure",    "TYPE": "float", "MIN": 0.5,  "MAX": 2.0,  "DEFAULT": 1.00, "LABEL": "Exposure" },

        { "NAME": "bodyHi",      "TYPE": "color", "DEFAULT": [0.85, 0.95, 0.30, 1.0], "LABEL": "Body — ridges (yellow)" },
        { "NAME": "bodyMid",     "TYPE": "color", "DEFAULT": [0.45, 0.55, 0.32, 1.0], "LABEL": "Body — mids (olive)" },
        { "NAME": "bodyLo",      "TYPE": "color", "DEFAULT": [0.30, 0.18, 0.50, 1.0], "LABEL": "Body — shadows (violet)" },
        { "NAME": "plumeColor",  "TYPE": "color", "DEFAULT": [0.62, 0.42, 0.98, 1.0], "LABEL": "Plume color" },
        { "NAME": "emberColor",  "TYPE": "color", "DEFAULT": [1.00, 0.95, 0.30, 1.0], "LABEL": "Ember color" },
        { "NAME": "bgInner",     "TYPE": "color", "DEFAULT": [0.46, 0.40, 0.30, 1.0], "LABEL": "Background center" },
        { "NAME": "bgOuter",     "TYPE": "color", "DEFAULT": [0.16, 0.13, 0.10, 1.0], "LABEL": "Background edge" }
    ]
}*/

// ─────────────────────────────────────────────────────────────
// Noise primitives — value noise + FBM. Hash from David Hoskins.
// ─────────────────────────────────────────────────────────────
float hash13(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1, 0, 0));
    float n010 = hash13(i + vec3(0, 1, 0));
    float n110 = hash13(i + vec3(1, 1, 0));
    float n001 = hash13(i + vec3(0, 0, 1));
    float n101 = hash13(i + vec3(1, 0, 1));
    float n011 = hash13(i + vec3(0, 1, 1));
    float n111 = hash13(i + vec3(1, 1, 1));
    return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z);
}

// 2-octave FBM — cheap, used inside SDF hot path
float fbm2(vec3 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.07) * 0.35;
}

// 4-octave FBM — used for low-frequency domain warp + plume
float fbm4(vec3 p) {
    float a = 0.5, v = 0.0;
    for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p = p * 2.03 + 17.0;
        a *= 0.5;
    }
    return v;
}

// ─────────────────────────────────────────────────────────────
// Coral SDF — sphere with vertical stretch + domain-warped FBM
// displacement. The warp gives the cauliflower/coral feel; the
// vertical stretch + extra height bias gives the upright posture.
// Returns vec2(distance, surfaceDensity) so the caller can color
// by density without re-sampling fbm.
// ─────────────────────────────────────────────────────────────
vec2 coralSDF(vec3 p, float t, float pulse) {
    // Vertical stretch — squish along Y so the form is taller than wide
    vec3 q = p;
    q.y /= verticalStretch;

    // Slow drift on the warp coordinate
    vec3 warp = vec3(
        fbm4(q * 0.7 + vec3(0.0,  t * 0.20, 0.0)),
        fbm4(q * 0.7 + vec3(5.2,  t * 0.15, 1.3)),
        fbm4(q * 0.7 + vec3(8.1, -t * 0.18, 4.7))
    ) - 0.5;

    // Warped sampling coords for high-freq detail
    vec3 w = q + warp * 0.55;

    // High-freq cellular detail (sharper falloff than plain fbm)
    float detail = fbm2(w * 2.4 + t * 0.10);
    detail = pow(detail, 1.4);  // sharpen ridges

    // Base sphere — slightly larger top half for the flame-like crown
    float topBias = smoothstep(0.0, 1.2, q.y) * 0.2;
    float baseRadius = 0.9 + topBias + pulse * 0.06;
    float sphere = length(q) - baseRadius;

    float d = sphere - (detail - 0.35) * roughness * 0.85;
    return vec2(d, detail);
}

// SDF gradient — six-tap central difference (forward+backward per axis)
vec3 coralNormal(vec3 p, float t, float pulse) {
    vec2 e = vec2(0.012, 0.0);
    return normalize(vec3(
        coralSDF(p + e.xyy, t, pulse).x - coralSDF(p - e.xyy, t, pulse).x,
        coralSDF(p + e.yxy, t, pulse).x - coralSDF(p - e.yxy, t, pulse).x,
        coralSDF(p + e.yyx, t, pulse).x - coralSDF(p - e.yyx, t, pulse).x
    ));
}

// ─────────────────────────────────────────────────────────────
// Plume density — vertical noise field that drifts upward.
// Densest just above the form, fading with height and lateral
// distance from the central axis.
// ─────────────────────────────────────────────────────────────
float plumeDensity(vec3 p, float t) {
    // Drift downward in source coords so plume appears to rise
    vec3 q = p - vec3(0.0, t * 0.45, 0.0);

    // Vertical mask — peak around y=0.6, fade above
    float vMask = smoothstep(-0.1, 0.5, p.y) * smoothstep(plumeReach + 0.6, 0.0, p.y);

    // Radial mask — concentrate around the form's vertical axis
    float rMask = exp(-length(p.xz) * 1.6);

    // Sample density. fbm4 is overkill here; use fbm2 for cheaper plume.
    float n = fbm2(q * 1.6);

    return clamp((n - 0.32) * 2.0, 0.0, 1.0) * vMask * rMask * plumeStrength;
}

// ─────────────────────────────────────────────────────────────
// Embers — sparse bright specks. Threshold a high-frequency noise
// field and modulate by distance from the form so they cluster
// where it's "burning". Drift up faster than the plume.
// ─────────────────────────────────────────────────────────────
float emberField(vec3 p, float t) {
    vec3 q = p - vec3(0.0, t * 0.65, 0.0);
    q *= 5.5;

    float n = vnoise(q);
    // Tight threshold — only the brightest peaks survive
    float spark = smoothstep(0.74, 0.92, n);

    // Cluster around the form
    float clust = exp(-length(p) * 0.7);

    // Slight vertical bias so embers favor the upper half
    float vBias = smoothstep(-0.6, 1.2, p.y);

    return spark * clust * vBias * emberDensity;
}

// ─────────────────────────────────────────────────────────────
// Camera — slow orbital drift around the form
// ─────────────────────────────────────────────────────────────
mat3 cameraBasis(vec3 ro, vec3 ta) {
    vec3 fwd = normalize(ta - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    return mat3(right, up, fwd);
}

// ─────────────────────────────────────────────────────────────
// Main image
// ─────────────────────────────────────────────────────────────
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;

    // Audio-reactive pulse — drives the form's overall size and
    // brightness. sampleFFT returns 0 when the host doesn't supply
    // audio data, so this gracefully no-ops without audio.
    float bass = sampleFFT(0.05);
    float mids = sampleFFT(0.35);
    float pulse = audioBoost * (bass * 0.18 + audioLevel * 0.10);
    float brightPulse = 1.0 + audioBoost * (mids * 0.35 + audioLevel * 0.25);

    // Camera — gentle orbit + slow vertical bob
    float camAngle = sin(t * 0.07) * 0.5 + t * 0.04;
    float camDist = 3.6;
    vec3 ro = vec3(sin(camAngle) * camDist, 0.25 + sin(t * 0.13) * 0.15, cos(camAngle) * camDist);
    vec3 ta = vec3(0.0, 0.1, 0.0);
    mat3 cam = cameraBasis(ro, ta);
    vec3 rd = cam * normalize(vec3(uv, 1.45));

    // ── background — soft radial vignette ──
    float r2 = dot(uv, uv);
    vec3 col = mix(bgInner.rgb, bgOuter.rgb, smoothstep(0.0, 0.85, r2));

    // ── raymarch the coral body ──
    float tHit = 0.4;
    bool hit = false;
    float surfDensity = 0.0;
    for (int i = 0; i < 56; i++) {
        vec3 p = (ro + rd * tHit) / formScale;
        vec2 s = coralSDF(p, t, pulse);
        if (s.x < 0.0015) {
            hit = true;
            surfDensity = s.y;
            break;
        }
        if (tHit > 8.0) break;
        // Slightly under-step inside displacement zone — prevents
        // ghosting on sharp ridges at the cost of a few extra steps
        tHit += max(s.x * 0.85, 0.005);
    }

    // ── shade the body ──
    vec3 bodyCol = vec3(0.0);
    float bodyAlpha = 0.0;
    if (hit) {
        vec3 p = (ro + rd * tHit) / formScale;
        vec3 n = coralNormal(p, t, pulse);

        // Two-light setup: warm key from upper-right, cool fill behind
        vec3 keyDir = normalize(vec3(0.55, 0.80, 0.30));
        vec3 fillDir = normalize(vec3(-0.40, -0.10, -0.80));
        float key = max(dot(n, keyDir), 0.0);
        float fill = max(dot(n, fillDir), 0.0);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.4);

        // Surface density picks color band:
        //   high density → bright yellow ridges
        //   mid density  → olive flats
        //   low density  → violet shadows
        // surfDensity from coralSDF (was pre-sharpened ~0..1 range)
        float band = clamp(surfDensity, 0.0, 1.0);
        vec3 baseCol;
        if (band > 0.55) {
            baseCol = mix(bodyMid.rgb, bodyHi.rgb, smoothstep(0.55, 0.85, band));
        } else {
            baseCol = mix(bodyLo.rgb, bodyMid.rgb, smoothstep(0.20, 0.55, band));
        }

        // Cheap AO from a nearby SDF sample
        float aoSample = coralSDF(p + n * 0.18, t, pulse).x;
        float ao = clamp(aoSample / 0.18, 0.2, 1.0);

        bodyCol = baseCol * (0.30 + key * 0.85 + fill * 0.20) * ao;
        bodyCol += plumeColor.rgb * rim * 0.55;     // violet rim glow
        bodyCol += bodyHi.rgb * pow(key, 6.0) * 0.6 * brightPulse;  // yellow ridge highlights

        // Depth fade — push far parts of the form into the background
        float depthFade = exp(-max(tHit - 2.5, 0.0) * 0.35);
        bodyCol = mix(col, bodyCol, depthFade);

        bodyAlpha = 1.0;
    }
    col = mix(col, bodyCol, bodyAlpha);

    // ── volumetric plume — alpha-accumulated raymarch ──
    // Per-pixel jitter eats the banding that 24 steps would otherwise
    // show on dense plume edges.
    float jitter = hash13(vec3(fragCoord, TIME * 60.0));
    vec3 plumeAcc = vec3(0.0);
    float plumeAlpha = 0.0;
    float plumeStep = 0.16;

    for (int i = 0; i < 26; i++) {
        float tt = 0.6 + (float(i) + jitter) * plumeStep;
        if (hit && tt > tHit - 0.05) break;
        vec3 p = ro + rd * tt;
        float d = plumeDensity(p, t);
        if (d > 0.01) {
            // Self-shadow approximation — denser samples below should
            // darken this sample. Cheap: just sample one step "below".
            float shadow = 1.0 - plumeDensity(p - vec3(0.0, 0.25, 0.0), t) * 0.5;
            vec3 sc = plumeColor.rgb * (0.55 + 0.6 * d) * shadow;
            float a = d * 0.45 * (1.0 - plumeAlpha);
            plumeAcc += sc * a;
            plumeAlpha += a;
            if (plumeAlpha > 0.95) break;
        }
    }
    col = col * (1.0 - plumeAlpha) + plumeAcc;
    // Additive bloom on top for the inner-glow look
    col += plumeAcc * 0.35 * brightPulse;

    // ── embers — sparse additive specks along the ray ──
    float emberSum = 0.0;
    for (int i = 0; i < 14; i++) {
        float tt = 0.5 + (float(i) + jitter) * 0.22;
        if (hit && tt > tHit + 0.25) break;
        vec3 p = ro + rd * tt;
        emberSum += emberField(p, t);
    }
    col += emberColor.rgb * emberSum * 1.7 * brightPulse;

    // ── waveform-driven micro-shimmer on the form ──
    // Subtle: just a tiny brightness wiggle from a waveform sample
    // at the screen-x position. No-op without audio.
    if (hit && audioBoost > 0.001) {
        float wU = uv.x * 0.5 + 0.5;
        float wv = sampleWaveform(wU);
        col += vec3(0.4, 0.5, 0.9) * abs(wv) * audioBoost * 0.25;
    }

    // ── final tone ──
    col *= exposure;
    // Soft Reinhard with slight saturation boost
    col = col / (1.0 + col * 0.65);
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.08);
    col = pow(col, vec3(0.92));

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
