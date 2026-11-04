/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A spiral galaxy seen at an angle: a hot golden core, curling arms studded with bright star clusters and dark dust lanes, turning slowly. The music sets its turning speed; each hit sends a surge of light running along the arms and winds them a little tighter before they ease back, and the sound's swell widens and brightens the arms as waves of light ride out through the disk. With a transparent background the galaxy floats on its own, its dust lanes darkening whatever sits behind it.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "flare", "LABEL": "Flare", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.72, "MIN": 0, "MAX": 0.92 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.9, "MIN": 0.3, "MAX": 1.2 },
        { "NAME": "arms", "LABEL": "Arms", "TYPE": "long", "DEFAULT": 2, "VALUES": [2, 3, 4], "LABELS": ["Two", "Three", "Four"] },
        { "NAME": "dust", "LABEL": "Dust lanes", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Arms", "TYPE": "color", "DEFAULT": [0.45, 0.62, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Clusters", "TYPE": "color", "DEFAULT": [1.0, 0.38, 0.62, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 x) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
        v += amp * noise2(x);
        x = mat2(1.6, 1.2, -1.2, 1.6) * x + 3.1;
        amp *= 0.5;
    }
    return v;
}

// Sharp background stars on a grid, one per cell at most.
float stars(vec2 p, float cells) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    vec2 o = vec2(hash21(id + 7.1), hash21(id + 3.7)) - 0.5;
    float d = length(f - o * 0.7);
    float on = step(0.86, h);
    return on * smoothstep(0.08, 0.0, d) * (0.4 + 0.6 * hash21(id + 1.3));
}

vec3 tone(vec3 c) {
    return 1.0 - exp(-c);
}

void main() {
    vec2 res = RENDERSIZE;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = vxFlow * 0.15;
    float swell = clamp(vxSwell * 0.85 + vxEnergy * 0.15, 0.0, 1.0);
    float pulse = clamp(vxPulse, 0.0, 1.0) * flare;

    // Disk frame: a slight roll, then foreshorten the vertical by the tilt.
    float roll = 0.32;
    vec2 q = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * p;
    float ci = cos(tilt * 1.35);
    vec2 d = vec2(q.x, q.y / max(ci, 0.12)) / (size * 0.62);
    float r = length(d);
    float ang = atan(d.y, d.x);

    float nArms = float(arms);
    float rot = t * (0.6 + 2.4 * spin);
    // Each hit winds the arms a little tighter; they spring back as the pulse dies.
    float wind = 2.6 + 1.2 * pulse + 0.5 * swell;
    // Logarithmic spiral phase. The pattern turns rigidly (a density wave), with
    // a gentle breathing sway so the inner disk seems to lead.
    float lr = log(max(r, 0.02));
    float arot = rot + 0.12 * sin(t * 1.3) / (0.4 + r);
    float ph = ang * nArms - lr * wind * nArms * 0.5 + arot * nArms;

    // Turbulent warp so the arms are ragged, not neat sine bands.
    vec2 wp = vec2(lr * 3.0, ang * 2.0 / PI);
    // A frame that turns with the arm pattern at this radius, so texture rides the arms.
    float ca = ang + arot;
    vec2 dr = r * vec2(cos(ca), sin(ca));
    float n1 = fbm(dr * 3.2);
    float n2 = fbm(dr * 7.5 + 11.0);
    float phw = ph + (n1 - 0.5) * 2.2;

    float armSharp = mix(3.6, 2.0, swell);
    float armWave = 0.5 + 0.5 * cos(phw);
    float armD = pow(armWave, armSharp);

    // Light travels along the arms: a bright patch whose place glides on with each
    // hit (a quarter turn of the galaxy per hit), lit by the pulse.
    float runA = ang + arot - TAU * vxMorph * 0.25;
    float run = 0.5 + 0.5 * cos(runA);
    run = run * run * run;
    // Density waves ride outward through the disk; the pulse lights them.
    float wv = 0.0;
    for (int k = 0; k < 2; k++) {
        float wr = fract(t * 0.9 + float(k) * 0.5) * 1.5;
        float wa = smoothstep(0.0, 0.25, wr) * smoothstep(1.5, 1.0, wr);
        wv += exp(-pow((r - wr) / 0.09, 2.0)) * wa;
    }
    float pk = pulse * pulse * (3.0 - 2.0 * pulse);
    float glow = pk * (0.8 + 1.8 * run) + wv * (0.3 * swell + 1.6 * pk);
    float armBoost = 1.35 + swell * 0.9 + glow;

    // Radial falloff of the disk.
    float diskR = exp(-r * 2.1) * smoothstep(1.35, 0.6, r);
    float inner = smoothstep(0.06, 0.28, r);

    // Arm light.
    float armLum = armD * diskR * inner * (0.55 + 0.9 * n2) * armBoost;
    // Smooth diffuse disk between arms.
    float diskLum = diskR * 0.22 * (0.6 + 0.6 * n1);

    // Star-forming knots on the arms: small bright blobs in the accent colour.
    vec2 kg = dr * 10.0;
    vec2 kid = floor(kg);
    vec2 ko = vec2(hash21(kid + 2.3), hash21(kid + 8.9)) - 0.5;
    float kd = length(fract(kg) - 0.5 - ko * 0.6);
    float kon = step(0.62, hash21(kid)) * (0.6 + 0.8 * hash21(kid + 4.4));
    float knotShape = smoothstep(0.16, 0.0, kd) + 0.3 * smoothstep(0.4, 0.0, kd);
    float knots = kon * knotShape * smoothstep(0.35, 0.8, armWave) * inner * smoothstep(1.3, 0.3, r);
    knots *= 1.0 + swell * 0.6 + glow * 1.4;

    // Dust lanes: sit on the inner (trailing) edge of each arm.
    float dustWave = 0.5 + 0.5 * cos(phw - 0.95);
    float dustD = pow(dustWave, 7.0) * smoothstep(0.08, 0.3, r) * smoothstep(1.2, 0.35, r);
    dustD *= smoothstep(0.25, 0.65, fbm(dr * 9.0 + 5.0)) * dust * 1.6;
    dustD = clamp(dustD, 0.0, 0.92);

    // Bulge: round-ish in screen space (it is a spheroid), stretched a touch along the disk.
    vec2 bq = vec2(q.x, q.y / mix(1.0, ci, 0.4)) / (size * 0.62);
    float br = length(bq);
    float bulge = exp(-br * br * 38.0) * 2.6 + exp(-br * 7.5) * 0.65;
    bulge *= 1.0 + pulse * 0.5 + swell * 0.4;

    vec3 armCol = ink.rgb * 1.15 + 0.08;
    vec3 coreCol = mix(vec3(1.0, 0.82, 0.55), accent.rgb, 0.18);
    vec3 knotCol = mix(accent.rgb, vec3(1.0), 0.25);
    // Arms turn warmer toward the core.
    vec3 diskCol = mix(coreCol, armCol, smoothstep(0.1, 0.55, r));

    vec3 col = diskCol * (armLum * 1.5 + diskLum) + knotCol * knots * 1.8 + coreCol * bulge;
    // Hot flash on the flaring arm toward white.
    col += vec3(1.0) * armD * diskR * inner * glow * 0.45;
    col *= 1.0 - dustD * 0.85;

    // Coverage of the galaxy itself (for the transparent mode).
    float lum = max(max(col.r, col.g), col.b);
    // The disk is a body, not just light: arms and bulge are fairly solid.
    float body = armD * diskR * inner * 1.6 + diskR * 0.15 + bulge * 0.8 + knots;
    float glowA = clamp(1.0 - exp(-(lum * 3.2 + body * 1.0)), 0.0, 1.0);
    float dustA = dustD * smoothstep(1.2, 0.5, r) * 0.6;
    vec3 gal = tone(col * 1.25);

    vec3 outc;
    float outa;
    if (vxClear) {
        float a = clamp(glowA + dustA * (1.0 - glowA), 0.0, 1.0);
        vec3 c = gal;
        c = min(c, vec3(a));
        outc = c;
        outa = a;
    } else {
        // Deep background: faint stars and a whisper of colour.
        vec3 bg = vec3(0.004, 0.006, 0.014) + ink.rgb * 0.02 * fbm(p * 1.5 + 2.0);
        float s = stars(p + 1.0, 60.0) + stars(p * 1.7 + 4.0, 60.0) * 0.6;
        bg += vec3(0.85, 0.9, 1.0) * s * 0.8;
        bg *= 1.0 - dustA;
        outc = gal + bg * (1.0 - glowA);
        outa = 1.0;
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
