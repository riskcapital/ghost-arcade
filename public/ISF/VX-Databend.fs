/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A photograph opened as if it were sound and run through audio effects. The picture is a still life: three lit spheres on a table against a graded wall. The frame is cut into bands, the way a file is processed in chunks, and each band gets one treatment: an echo that repeats the picture sideways and fades, a comb of bright and dark ripples, a crush down to a few flat tones, or its color channels read out of step. Each hit gives some of the bands a new treatment; the sound's level turns the effects up. With no sound most of the picture is clean, with one or two bands quietly wrong.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "damage", "LABEL": "Damage", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "echo", "LABEL": "Echo length", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "split", "LABEL": "Channel split", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.86, 0.9, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const int LOOKBACK = 12;

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

// One lit sphere of the still life: adds its shaded disc and the shadow it throws on the table.
void sphere(vec2 p, vec2 c, float r, vec3 tone, inout vec3 col) {
    // Its shadow, stretched to the right along the table.
    vec2 sh = (p - vec2(c.x + r * 0.9, -0.22)) / vec2(r * 1.7, r * 0.28);
    col *= 1.0 - 0.6 * exp(-dot(sh, sh));
    float d = length(p - c);
    float px = 1.5 / RENDERSIZE.y;
    float disc = smoothstep(r + px, r - px, d);
    // Lit from the upper left, with a soft terminator and a little light bounced up from the table.
    vec2 q = (p - c) / r;
    float z = sqrt(max(1.0 - dot(q, q), 0.0));
    vec3 nrm = vec3(q, z);
    float lit = max(dot(nrm, normalize(vec3(-0.55, 0.6, 0.58))), 0.0);
    float bounce = max(-nrm.y, 0.0) * 0.12;
    float spec = pow(max(dot(nrm, normalize(vec3(-0.35, 0.45, 0.82))), 0.0), 40.0);
    vec3 body = tone * (0.04 + 0.95 * lit * lit + bounce) + vec3(1.0) * spec * 0.5;
    col = mix(col, body, disc);
}

// The photograph: a graded wall, a table edge, three spheres. x is in frame heights from the middle.
vec3 photo(vec2 uv, float asp) {
    uv = fract(uv);
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // Wall: a pool of light from the upper left falling off to the right.
    vec2 w = p - vec2(-0.45, 0.3);
    vec3 col = ink.rgb * (0.02 + 0.5 * exp(-dot(w, w) / 0.28));
    // Table: lighter than the wall near the front, with a hard back edge.
    float table = smoothstep(0.003, -0.003, p.y + 0.2);
    vec3 top = ink.rgb * (0.16 + 0.3 * smoothstep(-0.5, -0.2, p.y)) * (0.6 + 0.4 * exp(-pow(p.x + 0.2, 2.0) / 0.6));
    col = mix(col, top, table);
    sphere(p, vec2(-0.42, -0.02), 0.2, ink.rgb, col);
    sphere(p, vec2(0.05, -0.1), 0.12, accent.rgb, col);
    sphere(p, vec2(0.46, 0.0), 0.22, ink.rgb * 0.55 + 0.1, col);
    return col;
}

// Hit m gives a band a new treatment by chance.
bool retreated(float m, float band) {
    return hash11(m * 13.17 + band * 3.71 + 1.9) < 0.3;
}

// The hit that last changed a band, up to hit n.
float bandSeed(float band, float n) {
    for (int k = 0; k < LOOKBACK; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        if (retreated(m, band)) return m;
    }
    return 99.0;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    float n = floor(vxCount + 0.5);
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);

    // Bands of uneven height down the frame.
    float count = floor(mix(5.0, 22.0, bands));
    float y = uv.y * count;
    float band = floor(y + 0.35 * sin(floor(y) * 12.9898));
    float seed = bandSeed(band, n);
    float fresh = (n > 0.5 && retreated(n, band)) ? pu : 0.0;
    // How many bands are treated at all rises with the damage and the level; a band just hit is always treated.
    float chance = hash11(band * 7.77 + seed * 1.31);
    float wet = step(chance, 0.18 + 0.8 * damage * (0.35 + 0.65 * sw)) * (0.55 + 0.45 * sw);
    wet = max(wet, fresh);
    float kind = hash11(band * 3.13 + seed * 5.7 + 0.5);
    float amt = wet * (0.4 + 0.6 * damage);

    vec3 clean = photo(uv, asp);
    vec3 col = clean;
    if (wet > 0.0) {
        if (kind < 0.32) {
            // Echo: the picture repeats to the right, each repeat fainter, as a delay line does to a sound.
            float gap = (0.02 + 0.1 * echo) * (0.6 + 0.8 * hash11(seed + band));
            vec3 sum = clean;
            float gain = 1.0;
            float total = 1.0;
            for (int k = 1; k <= 5; k++) {
                gain *= 0.62;
                sum += photo(vec2(uv.x - gap * float(k), uv.y), asp) * gain;
                total += gain;
            }
            col = mix(clean, sum / total * 1.5, amt);
        } else if (kind < 0.55) {
            // A comb: bright and dark ripples run along the band, closer together toward one end.
            float f = 30.0 + 160.0 * hash11(seed * 2.1 + band);
            float phase = uv.x * f * (0.5 + uv.x) + vxFlow * 3.0;
            float ripple = 0.5 + 0.5 * sin(phase);
            col = clean * mix(1.0, 0.25 + 1.5 * ripple, amt);
        } else if (kind < 0.78) {
            // Crushed: a few flat tones, and the picture read in short repeated chunks.
            float chunk = mix(0.004, 0.03, hash11(seed + band * 1.7));
            vec2 held = vec2(floor(uv.x / chunk) * chunk + chunk * 0.5, uv.y);
            vec3 c = photo(held, asp);
            float levels = floor(mix(7.0, 2.0, amt) + 0.5);
            c = floor(c * levels + 0.5) / levels;
            col = mix(clean, c, step(0.15, amt));
        } else {
            // Channels out of step: red, green and blue read from different places along the row.
            float off = (0.01 + 0.07 * split) * amt * (hash11(seed * 3.3 + band) < 0.5 ? 1.0 : -1.0);
            col = vec3(photo(vec2(uv.x - off, uv.y), asp).r, clean.g, photo(vec2(uv.x + off * 1.6, uv.y), asp).b);
        }
        // The whole band also sits a little off to one side, where the read lost its place.
        float slip = (hash11(seed * 9.1 + band * 2.3) - 0.5) * 0.06 * amt * step(0.6, hash11(seed + band * 4.4));
        col = mix(col, photo(vec2(uv.x + slip, uv.y), asp), step(0.001, abs(slip)) * 0.5);
    }
    // A band changed by this hit flashes for a moment.
    col += col * fresh * 0.5;
    // A hairline where one band meets the next.
    float seam = abs(fract(y + 0.35 * sin(floor(y) * 12.9898)) - 0.5);
    col *= 1.0 - 0.25 * wet * smoothstep(0.49, 0.5, seam);

    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.8));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the treated bands are solid.
        outa = clamp(wet * 1.5, 0.0, 1.0) * clamp(max(max(col.r, col.g), col.b) * 1.8, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
