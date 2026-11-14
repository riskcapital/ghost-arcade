/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A pulsar wind nebula: a dazzling neutron star inside a glowing torus of turbulent, filament-laced gas, with curving jets streaming from its poles. Two beams of light sweep round in time with the bar, lighting up the gas they pass through, and the whole sky flashes when one swings toward you. Shock fronts ride endlessly outward, setting the gas glowing as they pass and blazing while the music pulses; the music speeds the whole nebula's churn, its swell fattens and brightens the beams, and each hit flares the star. With a transparent background the star, nebula and beams float on their own.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "beams", "LABEL": "Beams", "TYPE": "float", "DEFAULT": 0.75, "MIN": 0, "MAX": 1 },
        { "NAME": "shock", "LABEL": "Shock fronts", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "gas", "LABEL": "Gas", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "wobble", "LABEL": "Beam angle", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.1, "MAX": 1 },
        { "NAME": "sweep", "LABEL": "Sweep", "TYPE": "long", "DEFAULT": 1, "VALUES": [1, 2, 4], "LABELS": ["Once a bar", "Twice a bar", "Every beat"] },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.3, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beams", "TYPE": "color", "DEFAULT": [0.55, 0.75, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Nebula", "TYPE": "color", "DEFAULT": [0.85, 0.4, 1.0, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBar", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
const int STEPS = 20;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float stars(vec2 p, float cells) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    vec2 o = vec2(hash21(id + 7.1), hash21(id + 3.7)) - 0.5;
    float d = length(f - o * 0.7);
    return step(0.87, h) * smoothstep(0.09, 0.0, d) * (0.3 + 0.7 * hash21(id + 1.3));
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm3(vec2 x) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        v += amp * noise2(x);
        x = mat2(1.6, 1.2, -1.2, 1.6) * x + 1.7;
        amp *= 0.5;
    }
    return v;
}

// Fine filaments: domain-warped ridged noise, like synchrotron wisps.
float filaments(vec2 x, float t) {
    vec2 w = vec2(fbm3(x * 1.7 + vec2(t * 0.11, 0.0)), fbm3(x * 1.7 + vec2(5.2, 1.3 - t * 0.09)));
    vec2 q = x * 3.2 + (w - 0.5) * 3.0;
    float v = 0.0;
    float amp = 0.6;
    for (int i = 0; i < 4; i++) {
        float n = 1.0 - abs(2.0 * noise2(q) - 1.0);
        n = n * n * n;
        v += amp * n;
        q = mat2(1.7, 1.1, -1.1, 1.7) * q + 2.3;
        amp *= 0.55;
    }
    return v;
}

// Filmic curve.
vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
    vec2 res = RENDERSIZE;
    float sc = size * 0.95;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y / sc;
    float t = vxFlow * 0.2;

    float pls = clamp(vxPulse, 0.0, 1.0);
    float hitK = pls * pls * (3.0 - 2.0 * pls);
    float swell = clamp(vxSwell * 0.8 + vxEnergy * 0.2, 0.0, 1.0);

    // Spin axis: the torus is seen at a slant, as in the real nebulae.
    vec3 S = normalize(vec3(0.3, 0.86, 0.5));
    vec3 E1 = normalize(cross(S, vec3(0.0, 0.0, 1.0)));
    vec3 E2 = cross(S, E1);
    // Magnetic axis swept round the spin axis in time with the bar.
    float ph = TAU * vxBar * float(sweep) + vxFlow * 0.3;
    float al = mix(0.35, 1.25, wobble);
    vec3 M = cos(al) * S + sin(al) * (cos(ph) * E1 + sin(ph) * E2);

    vec3 hot = mix(vec3(1.0, 0.97, 0.94), ink.rgb, 0.25);
    vec3 neb = accent.rgb;
    vec3 beamC = mix(ink.rgb, vec3(1.0), 0.35);

    // Beam angular width (in 1 - cos units) and strength.
    float bw = 0.006 + 0.009 * swell + 0.014 * hitK;
    float bGain = beams * (0.5 + 1.0 * swell + 1.8 * hitK);
    // Shock front: a shell racing out over each beat.
    // Shock fronts: an endless train of shells riding outward (faster with the
    // music); they light the gas as they pass, brightly while the pulse is up.
    float sr0 = 0.12 + fract(t * 0.8) * 1.2;
    float sr1 = 0.12 + fract(t * 0.8 + 0.5) * 1.2;
    float sa0 = smoothstep(0.12, 0.3, sr0) * smoothstep(1.32, 0.9, sr0);
    float sa1 = smoothstep(0.12, 0.3, sr1) * smoothstep(1.32, 0.9, sr1);
    float shockA = shock * (0.25 + 0.8 * swell + 1.8 * hitK);
    float gasK = (0.35 + 1.3 * gas) * 3.0;

    // --- March through the nebula along the view ray. ---
    float zr = 1.25;
    float dz = 2.0 * zr / float(STEPS);
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 emit = vec3(0.0);
    float tau = 0.0;
    float pr2 = dot(p, p);
    // Fine filaments: the gas is optically thin, so one structure field per pixel,
    // drifting slowly outward, carries the detail; the march carries the shape.
    // The gas turns slowly and puffs outward a little as the sound swells.
    float fr = t * 0.04;
    vec2 fp = mat2(cos(fr), sin(fr), -sin(fr), cos(fr)) * p * (1.0 - 0.07 * swell);
    float fil = pow(filaments(fp, t), 1.6) * 1.1 + 0.3;
    for (int i = 0; i < STEPS; i++) {
        // Front to back.
        float z = zr - (float(i) + jit) * dz;
        vec3 x = vec3(p, z);
        float r2 = dot(x, x);
        float rl = sqrt(r2);
        float a = dot(x, S);
        vec3 xp = x - S * a;
        float rp = length(xp);
        // Faint diffuse gas: what makes the beams visible.
        float halo = exp(-r2 * 1.4) * 0.12 + 0.02;
        float structd = 0.0;
        float jetMix = 0.0;
        if (r2 < 2.2) {
            // Torus and inner wisp.
            vec2 td = vec2(rp - 0.58, a * 1.15);
            float tor = exp(-dot(td, td) / 0.013);
            vec2 wd = vec2(rp - 0.3, a * 1.4);
            float wisp = exp(-dot(wd, wd) / 0.005) * 1.1;
            // Jets: curving, widening, fading.
            float sa = abs(a);
            vec3 jv = xp - E1 * (0.16 * a * sa) - E2 * (0.05 * sin(a * 6.0 + t * 0.6));
            float jw = 0.035 + 0.07 * sa;
            float jet = exp(-dot(jv, jv) / (jw * jw)) * smoothstep(0.04, 0.16, sa) * exp(-sa * 1.4);
            jet *= a > 0.0 ? 1.0 : 0.65;
            structd = (tor + wisp + jet * 1.6) * fil;
            jetMix = jet / max(tor + wisp + jet, 1e-3);
        }
        // Gas lit by the star: brighter near the centre.
        float lit = 0.5 + 0.9 / (1.0 + r2 * 9.0);
        // Shock front lighting the gas as it passes.
        float sh = (exp(-pow((rl - sr0) / 0.08, 2.0)) * sa0 + exp(-pow((rl - sr1) / 0.08, 2.0)) * sa1) * shockA;
        vec3 gcol = mix(hot, neb, smoothstep(0.2, 0.7, rl));
        gcol = mix(gcol, mix(beamC, hot, 0.4), jetMix * 0.7);
        vec3 e = gcol * structd * gasK * lit * (1.0 + 0.3 * swell);
        e += mix(neb, hot, 0.55) * structd * 2.6 * gasK * sh;
        // Beams: light scattered by whatever gas sits in the cone.
        float c = abs(dot(x, M)) / max(rl, 1e-3);
        // Gas inside the cone glows (a wide, smooth term; the crisp shaft is drawn after the march).
        float cone = exp(-(1.0 - c) / (bw * 5.0));
        cone *= 1.0 / (1.0 + r2 * 0.6);
        e += beamC * cone * bGain * structd * 0.9;
        float tr = exp(-tau);
        emit += e * tr * dz;
        tau += structd * gasK * dz * 0.9;
    }

    // --- Beam shafts: a cone of light through a thin uniform medium projects to a
    // soft wedge; where it crosses the nebula's filaments it lights them up. ---
    vec2 m2 = M.xy;
    float bl = max(length(m2), 1e-3);
    vec2 mu = m2 / bl;
    float spread = sqrt(2.0 * bw) / max(bl, 0.45);
    float shaft = 0.0;
    for (int k = 0; k < 2; k++) {
        vec2 b2 = k == 0 ? mu : -mu;
        float along = dot(p, b2);
        float perp = abs(dot(p, vec2(-b2.y, b2.x)));
        float w = 0.012 + along * spread;
        float inside = smoothstep(0.0, 0.08, along);
        float prof = exp(-pow(perp / w, 2.0)) * 0.7 + exp(-pow(perp / (w * 0.3), 2.0)) * 0.5;
        float fall = exp(-along / (1.6 + 1.4 * swell + 1.2 * hitK)) * (0.05 / (w + 0.04));
        float side = k == 0 ? (0.7 + 0.5 * max(M.z, 0.0)) : (0.7 + 0.5 * max(-M.z, 0.0));
        shaft += prof * fall * inside * side;
    }
    // Brighter where the shaft passes through gas.
    float gasHere = clamp(tau * 1.2, 0.0, 1.5);
    shaft *= bGain * (0.55 + fil * gasHere * 0.9);
    emit += beamC * shaft;

    // Lighthouse flash when a beam faces us.
    float facing = M.z;
    float flashG = pow(abs(facing), 6.0) * beams * (0.12 + 0.3 * swell);

    // --- The neutron star: a hard point, soft diffraction, bloom. ---
    vec2 q = p * sc;
    float r = length(q);
    float coreI = 1.0 + 1.8 * hitK + 0.3 * swell + flashG * 1.2;
    float pt = exp(-r * r / 0.000035) * 6.0;
    float bloom = 0.00025 / (r * r + 0.00025) * 0.7 + exp(-r * 30.0) * 0.18 + exp(-r * 6.0) * 0.03;
    float airy = exp(-pow((r - 0.022) / 0.004, 2.0)) * 0.12 + exp(-pow((r - 0.04) / 0.005, 2.0)) * 0.05;
    vec2 qd = mat2(0.866, 0.5, -0.5, 0.866) * q;
    float spikes = exp(-abs(qd.y) / 0.0018) * exp(-abs(qd.x) * 22.0) + exp(-abs(qd.x) / 0.0018) * exp(-abs(qd.y) * 22.0);
    vec3 starC = hot * (pt + bloom + airy) + mix(hot, beamC, 0.5) * spikes * 0.6;
    starC *= coreI;
    // The star sits inside the gas: dim it a touch by what lies in front.
    vec3 col = emit + starC;

    vec3 lin = col * 1.15;
    vec3 outc;
    float outa;
    if (vxClear) {
        vec3 tm = aces(lin);
        // Coverage follows what is actually seen after tone mapping, so faint gas
        // never leaves a dark veil; bright, dense gas reads solid.
        float tl = max(max(tm.r, tm.g), tm.b);
        outa = clamp(tl * (1.8 + 0.6 * smoothstep(0.2, 0.7, tl)), 0.0, 1.0);
        outc = min(tm, vec3(outa));
    } else {
        vec2 sp = q;
        vec3 bg = vec3(0.003, 0.003, 0.009);
        bg += vec3(0.85, 0.9, 1.0) * (stars(sp + 1.0, 60.0) + 0.6 * stars(sp * 1.7 + 6.0, 60.0)) * 0.5;
        bg += beamC * flashG * 0.2;
        outc = aces(lin + bg * exp(-tau * 0.5));
        outa = 1.0;
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
