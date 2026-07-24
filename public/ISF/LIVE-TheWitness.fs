/*{
    "DESCRIPTION": "An infinite fall into a living fractal organism. Bilateral filament flesh, synaptic lightning on the beat — and at the heart, an eye with biological saccades that watches the room. Pareidolia as a weapon.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "presence", "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "fall",     "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "neural",   "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "flesh",    "TYPE": "float", "DEFAULT": 0.65, "MIN": 0.2, "MAX": 1.0},
        {"NAME": "hueDrift", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0, "MAX": 0.2}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash11(float n) { return fract(sin(n) * 43758.5453); }
float hash21(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// One layer of the organism: bilateral kali fold with orbit traps.
// Returns: x = filament trap, y = membrane trap, z = orbit magnitude.
vec3 organism(vec2 p, vec2 c, float t) {
    float filaments = 1e5;
    float membrane = 1e5;
    float mag = 0.0;
    for (int i = 0; i < 11; i++) {
        p = abs(p) / max(dot(p, p), 0.001) - c;
        float r = length(p);
        // Filaments: distance to a slowly orbiting point — nerve fibers.
        filaments = min(filaments, length(p - vec2(sin(t * 0.21) * 0.3, cos(t * 0.17) * 0.2)));
        // Membrane: distance to the fold axis — connective tissue sheets.
        membrane = min(membrane, abs(p.y) + abs(p.x) * 0.15);
        mag += r;
    }
    return vec3(filaments, membrane, mag / 11.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float level = max(audioLevel, 0.3 + 0.1 * sin(TIME * 0.6));
    float bass = max(audioBass, 0.3 + 0.12 * sin(TIME * 0.43));
    float beat = audioBeat;
    float beatPhase = audioBeatPhase;
    float t = TIME;

    // ── The gaze ─────────────────────────────────────────────────────────
    // Slow drift + hash-timed saccades: every few seconds the fixation point
    // JUMPS, then holds. Biological eye movement — this is what reads alive.
    float epoch = floor(t / 2.7);
    float saccadeT = smoothstep(0.0, 0.08, fract(t / 2.7)); // 200ms dart
    vec2 gazeA = (vec2(hash11(epoch), hash11(epoch + 13.7)) - 0.5) * 0.22;
    vec2 gazeB = (vec2(hash11(epoch + 1.0), hash11(epoch + 14.7)) - 0.5) * 0.22;
    vec2 gaze = mix(gazeA, gazeB, saccadeT);
    gaze += vec2(sin(t * 0.31), cos(t * 0.23)) * 0.02; // micro-drift

    // ── The fall ─────────────────────────────────────────────────────────
    // Log-spiral infinite zoom: the organism reassembles itself forever.
    float zoomT = t * fall * 0.4;
    float zoomCycle = fract(zoomT);
    float spin = sin(t * 0.05) * 0.14; // breathing tilt, spine stays readable
    mat2 R = mat2(cos(spin), -sin(spin), sin(spin), cos(spin));

    // Bilateral symmetry: fold across the spine. Brains see faces in mirrors.
    vec2 q = R * uv;
    q.x = abs(q.x);

    // ── Three depth shells of the same being, phase-staggered in the zoom ─
    vec3 col = vec3(0.0);
    float hue = t * hueDrift;
    // Synapse wavefront clock: fires from the heart on each beat.
    float pulseClock = beatPhase;

    for (int s = 0; s < 3; s++) {
        float fs = float(s);
        float phase = fract(zoomCycle + fs / 3.0);
        float scale = pow(3.2, phase) * 0.55;            // 1 → 3.2 then wraps
        float shellFade = sin(phase * 3.14159);          // born small, dies large
        vec2 p = q * scale;

        vec2 c = vec2(0.83 + 0.06 * sin(t * 0.09 + fs), 0.55 + 0.05 * cos(t * 0.11 + fs * 2.0));
        vec3 tr = organism(p, c, t + fs * 3.0);

        // Synaptic lightning: brightness wavefronts crawling OUT along the
        // filament distance field from the heart, launched by the beat.
        float wave = fract(tr.z * 2.2 - pulseClock - fs * 0.33);
        float synapse = pow(1.0 - wave, 7.0) * neural * (0.4 + beat * 1.6);

        // Filament glow — cyan-white nerves, the structural element.
        vec3 nerveCol = mix(vec3(0.25, 0.85, 1.0), vec3(0.9, 0.5, 1.0), fract(hue + fs * 0.13));
        col += nerveCol * exp(-tr.x * 22.0) * shellFade * (1.5 + synapse * 3.0);

        // Membrane flesh — deep violet tissue, kept translucent and sparse.
        vec3 fleshCol = mix(vec3(0.13, 0.02, 0.26), vec3(0.24, 0.02, 0.16), fract(hue + 0.4));
        col += fleshCol * exp(-tr.y * 11.0) * shellFade * flesh * (0.5 + bass * 0.4);

        // Ambient body glow — faint, lets the void stay void.
        col += fleshCol * exp(-tr.z * 3.2) * shellFade * 0.18;
    }

    // ── Convergence veins: luminous nerves flowing toward the eye ────────
    {
        vec2 ve = uv - gaze * 0.3;
        float vr = length(ve);
        float vang = atan(ve.y, ve.x);
        float wob = vnoise(vec2(vang * 2.2, vr * 3.0 - t * 0.5)) * 1.6;
        float veins = pow(abs(sin(vang * 7.0 + wob + sin(t * 0.1))), 24.0);
        veins += pow(abs(sin(vang * 3.0 - wob * 0.7 + 1.3)), 32.0) * 0.7;
        // Fade near the socket (they dive under the eye) and at distance.
        float vmask = smoothstep(0.10, 0.35, vr) * exp(-vr * 1.7);
        // Nerve signal crawling INWARD to the eye on the beat clock.
        float inward = pow(fract(vr * 3.0 + beatPhase), 6.0) * neural;
        vec3 veinCol = mix(vec3(0.2, 0.8, 1.0), vec3(1.0, 0.4, 0.9), inward);
        col += veinCol * veins * vmask * (0.5 + inward * 1.8 + beat * 0.4) * presence;
    }

    // ── The eye ──────────────────────────────────────────────────────────
    vec2 e = uv - gaze * 0.3;                            // socket barely moves
    float er = length(e);
    float socket = 0.11;
    // Iris looks toward the gaze point: the pupil offsets INSIDE the socket.
    vec2 look = gaze * 0.55;
    float ir = length(e - look * socket * 2.2);

    // Blink envelope: rare, fast, hash-jittered. Also blinks on hard beats.
    float blinkSeed = floor(t / 4.3);
    float blinkAt = hash11(blinkSeed) * 3.0;
    float blinkT = fract(t / 4.3) * 4.3 - blinkAt;
    float lid = 1.0 - exp(-pow(blinkT / 0.09, 2.0));     // closed→open spike
    lid = min(lid, 1.0);

    float pupil = socket * (0.30 + 0.25 * level);        // music dilates it
    float irisMask = smoothstep(socket, socket - 0.008, er);
    float pupilMask = smoothstep(pupil, pupil - 0.008, ir);
    vec2 pc = e - look * socket * 2.2;                   // pupil-centered coords

    // Iris fibers: two interleaved frequencies, kinked by noise so no two
    // sectors repeat — real irises are chaotic.
    float fang = atan(pc.y, pc.x);
    float fkink = vnoise(vec2(fang * 3.0, 4.7)) * 2.4;
    float fibers = 0.55 + 0.45 * sin(fang * 34.0 + fkink + sin(fang * 7.0) * 2.0);
    fibers *= 0.75 + 0.25 * sin(fang * 61.0 - fkink * 1.7);
    // Radial shading: dark collarette at the pupil, rich mid, dark rim.
    float radial = clamp((ir - pupil) / max(socket - pupil, 0.01), 0.0, 1.0);
    float ringShade = smoothstep(0.0, 0.25, radial) * (1.0 - smoothstep(0.72, 1.0, radial) * 0.85);
    vec3 irisCol = mix(vec3(1.0, 0.6, 0.12), vec3(0.62, 0.25, 0.05), radial);
    irisCol *= (0.35 + 0.65 * fibers) * (0.4 + ringShade);
    // The iris answers the synapses: amber embers on the beat.
    irisCol *= 1.0 + beat * 0.5;

    vec3 eyeCol = irisCol * irisMask * (1.0 - pupilMask);
    // Pupil: void with a faint inner reflection of the cyan nerves below.
    eyeCol += vec3(0.015, 0.045, 0.07) * pupilMask * (0.4 + 0.6 * vnoise(pc * 40.0 + t * 0.2));
    // Sphere shading: soft top-light dome + lower crescent occlusion.
    float dome = clamp(1.0 - er / socket, 0.0, 1.0);
    eyeCol *= 0.55 + 0.65 * pow(dome, 0.6);
    eyeCol *= 1.0 - smoothstep(0.3, 1.0, (e.y + socket * 0.55) / socket) * 0.25;
    // Wet highlights: one broad soft gleam, one pin spark — both offset
    // up-left like a studio softbox. This is what makes it read as WET.
    eyeCol += vec3(0.9, 0.95, 1.0) * exp(-pow(length(e - vec2(-0.032, 0.038)) / 0.02, 2.0)) * 0.8;
    eyeCol += vec3(1.0) * exp(-pow(length(pc - vec2(-0.016, 0.02)) / 0.006, 2.0)) * 2.2;
    // Dark limbal ring, then a whisper of bioluminescent sclera outside it.
    eyeCol *= 1.0 - smoothstep(0.014, 0.0, abs(er - socket * 0.97)) * 0.6;

    // Blink as a curtain: the lid slides DOWN over the eye, not a fade.
    float lidPos = mix(-socket * 1.3, socket * 1.2, lid); // closed → open
    float lidMask = smoothstep(lidPos, lidPos + 0.02, -(e.y));
    float eyeAmt = presence * smoothstep(0.4, 0.15, length(uv));
    float eyeMix = clamp(irisMask * eyeAmt * (1.0 - lidMask), 0.0, 1.0);
    col = mix(col, eyeCol, eyeMix);
    // Socket shadow: tissue parts around the eye — grounds it in the flesh.
    col *= 1.0 - smoothstep(socket * 2.1, socket * 1.0, er) * 0.45 * eyeAmt * (1.0 - irisMask);
    // Faint glow cast BY the eye onto the surrounding tissue.
    col += vec3(1.0, 0.55, 0.15) * exp(-pow((er - socket) / 0.1, 2.0)) * 0.12 * eyeAmt * lid;

    // ── Finish ───────────────────────────────────────────────────────────
    // Chromatic pull toward the edges: the void lenses the light.
    float rr = length(uv);
    col.r *= 1.0 + rr * 0.06;
    col.b *= 1.0 - rr * 0.04;
    col *= 1.0 - smoothstep(0.55, 1.15, rr) * 0.9;       // deep vignette
    col *= 0.9 + beat * 0.15;

    col = col / (col + 0.75);
    col = pow(col, vec3(0.92));
    col = col * col * (3.0 - 2.0 * col); // s-curve: deep blacks, luminous peaks
    col += (hash21(gl_FragCoord.xy + fract(t)) - 0.5) / 220.0;

    gl_FragColor = vec4(col, 1.0);
}
