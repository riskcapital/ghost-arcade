/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Full-frame op-art in the manner of a sixties gallery painting: bold bands of ink on black that bend into waves, the waves growing taller across the frame. The swell of the sound it follows sets how far the bands bend and how heavy they are, the note's pitch slides the wave along, and every hit sends a fold travelling through the bands from one side to the other. With no sound the bands rest thin and gently curved, drifting slowly.",
    "PASSES": [
        {
            "TARGET": "state",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 16,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 22, "MIN": 10, "MAX": 40 },
        { "NAME": "wave", "LABEL": "Wave", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "waveLength", "LABEL": "Wavelength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "weight", "LABEL": "Weight", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fold", "LABEL": "Fold", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Bands", "TYPE": "color", "DEFAULT": [0.95, 0.93, 0.88, 1.0] },
        { "NAME": "accent", "LABEL": "Fold", "TYPE": "color", "DEFAULT": [1.0, 0.32, 0.18, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// How fast a fold travels across the frame (frame heights per second) and how long it lasts.
const float FOLD_SPEED = 1.35;
const float FOLD_LIFE = 1.1;
// The wave's phase never moves faster than this (radians per second), so the
// bands never sweep past a point fast enough to flicker.
const float PHASE_RATE = 1.4;

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

vec4 slot(float i) {
    return IMG_NORM_PIXEL(state, vec2((i + 0.5) / 2.0, 0.5));
}

// One travelling fold: a smooth hump in the bands that rides across the frame.
// Returns (displacement in bands, how strongly this point is inside the fold).
vec2 foldAt(vec2 p, float asp, float tHit, float cnt) {
    float age = TIME - tHit;
    if (age < 0.0 || age > FOLD_LIFE + 0.6) return vec2(0.0);
    float dir = mod(cnt, 2.0) < 0.5 ? 1.0 : -1.0;
    float start = -0.5 * asp - 0.25;
    float xf = (start + age * FOLD_SPEED) * dir;
    float w = 0.13 + 0.06 * age;
    float d = (p.x - xf) / w;
    float env = exp(-age / FOLD_LIFE) * smoothstep(0.0, 0.06, age);
    // The fold leans: it bends harder in some rows than others.
    float lean = 0.65 + 0.35 * sin(p.y * 4.0 + hash11(cnt * 1.37) * TAU);
    float g = exp(-d * d);
    return vec2(1.7 * env * g * lean, env * g);
}

void main() {
    if (PASSINDEX == 0) {
        // slot 0: (hit count seen, time of the latest hit, time of the one before, 1)
        // slot 1: (eased swell, eased wave phase, 0, 1)
        float i = floor(gl_FragCoord.x / 8.0);
        vec4 s0 = slot(0.0);
        vec4 s1 = slot(1.0);
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        float n = floor(vxCount + 0.5);
        float target = vxGlide * TAU * 2.0;
        bool cold = FRAMEINDEX < 2 || s0.a < 0.5 || s1.a < 0.5;
        if (i < 0.5) {
            vec4 o = s0;
            if (cold) {
                // From a cold start, show the fold of a hit that is under way.
                o = vec4(n, vxPulse > 0.05 ? TIME - 0.45 : -100.0, -100.0, 1.0);
            } else if (abs(n - s0.x) > 0.5) {
                o = vec4(n, TIME, s0.y, 1.0);
            }
            gl_FragColor = o;
        } else {
            float sw = clamp(vxSwell, 0.0, 1.0);
            float a = s1.x + (sw - s1.x) * (1.0 - exp(-dt / (sw > s1.x ? 0.45 : 1.1)));
            // The taller the wave, the slower its phase may move, so bands cross a point
            // at most about one and a half times a second.
            float ampMax = (0.5 + 1.9 * a) * (0.25 + 1.1 * wave);
            float rate = PHASE_RATE / max(ampMax, 1.0);
            float ph = s1.y + clamp(target - s1.y, -rate * dt, rate * dt);
            if (cold) {
                a = sw;
                ph = target;
            }
            gl_FragColor = vec4(a, ph, 0.0, 1.0);
        }
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);

    vec4 s0 = slot(0.0);
    vec4 s1 = slot(1.0);
    float sw = clamp(s1.x, 0.0, 1.0);
    float N = clamp(bands, 10.0, 40.0);

    // Across the frame the waves grow taller and a little tighter, as in the paintings.
    float across = smoothstep(-0.5 * asp, 0.5 * asp, p.x);
    float grow = 0.3 + 0.7 * across;
    float k = mix(2.6, 0.9, waveLength) * (0.85 + 0.3 * across);
    float ampB = (0.5 + 1.9 * sw) * (0.25 + 1.1 * wave) * grow;
    // The crests lean through the rows, so each band bends a little later than the one above.
    float ph = s1.y + TIME * 0.12 + p.y * 2.2;
    float phx = p.x * k * TAU / asp * 1.6 + ph;
    float disp = ampB * sin(phx) + 0.18 * ampB * sin(phx * 2.0 + 1.3 + TIME * 0.07);

    // Two folds can be on their way at once.
    vec2 f0 = foldAt(p, asp, s0.y, s0.x);
    vec2 f1 = foldAt(p, asp, s0.z, s0.x - 1.0);
    float fa = fold * (f0.x + f1.x);
    float fe = smoothstep(0.0, 0.55, fold * max(f0.y, f1.y));
    disp += fa;

    // Band coordinate, drifting slowly with the music's clock.
    float v = p.y * N + disp + vxFlow * 0.15;

    // Weight: the ink fraction of each band. Heavier with the swell, and graded
    // across the frame so the field has a light and a dark side.
    float duty = mix(0.2, 0.42, weight) + 0.16 * sw;
    duty += 0.09 * sin(p.x * 1.4 / asp * TAU * 0.5 - p.y * 1.3 + 0.6);
    duty = clamp(duty, 0.12, 0.78);

    float fw = max(fwidth(v), 1e-4);
    float c = clamp((0.5 * duty - abs(fract(v) - 0.5)) / fw + 0.5, 0.0, 1.0);
    // Where bands would crowd below a few pixels, settle to their average instead of shimmering.
    c = mix(c, duty, smoothstep(0.22, 0.45, fw));

    // The fold carries the accent through the bands it bends.
    vec3 bandCol = mix(ink.rgb, accent.rgb, fe);
    vec3 col = bandCol * c;
    // A whisper of the accent in the black of the fold, so it reads as a pressure wave.
    col += accent.rgb * fe * 0.05 * (1.0 - c);

    vec3 outc;
    float outa;
    if (vxClear) {
        outa = max(c, fe * 0.05 * (1.0 - c) * max(max(accent.r, accent.g), accent.b));
        outc = min(col, vec3(outa));
    } else {
        outc = col + (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
        outc = max(outc, 0.0);
        outa = 1.0;
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
