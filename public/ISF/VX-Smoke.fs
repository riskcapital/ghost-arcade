/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Sound-system smoke. Every note of the sound it follows breathes smoke in from the floor, low notes to the left and high notes to the right, and each hit shoves a short puff upward. The smoke curls and rises through a slow swirling flow and is lit from one side, dark and dense, never grey.",
    "PASSES": [
        {
            "TARGET": "flow",
            "FLOAT": true,
            "WIDTH": "$WIDTH/4",
            "HEIGHT": "$HEIGHT/4"
        },
        {
            "TARGET": "guess1",
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {
            "TARGET": "smoke",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "density", "LABEL": "Density", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "rise", "LABEL": "Rise", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "swirl", "LABEL": "Swirl", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "scale", "LABEL": "Scale", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "dissipation", "LABEL": "Dissipation", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "lightAngle", "LABEL": "Light angle", "TYPE": "float", "DEFAULT": 0.42, "MIN": 0, "MAX": 1 },
        { "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "grain", "LABEL": "Grain", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Smoke", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Floor marks", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// flow: curl-noise velocity (height units per second) on a coarse grid.
// guess1: first advection guess. smoke: r = density.

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash31(vec3 p) {
    vec3 p3 = fract(p * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

// Stream function for the swirl: three octaves, slowly evolving.
float potential(vec2 q, float tz) {
    float s = noise3(vec3(q, tz));
    s += 0.5 * noise3(vec3(q * 2.03 + vec2(5.2, 1.3), tz * 1.4 + 3.1));
    s += 0.25 * noise3(vec3(q * 4.07 + vec2(2.7, 8.4), tz * 1.9 + 7.7));
    s += 0.12 * noise3(vec3(q * 8.11 + vec2(9.1, 3.6), tz * 2.6 + 1.9));
    return s;
}

// Notes enter along the floor, low on the left, folded into twenty semitones.
float noteX(float note) {
    float n = floor(note * 127.0 + 0.5);
    if (n > 50.0) n -= 12.0 * ceil((n - 50.0) / 12.0);
    if (n < 30.0) n += 12.0 * ceil((30.0 - n) / 12.0);
    return 0.08 + 0.84 * (n - 30.0) / 20.0;
}

float riseSpeed() {
    return mix(0.04, 0.34, rise);
}

// The flow that carries the smoke: swirl, buoyancy, and the puff over the newest note.
vec2 smokeVelocity(vec2 uv, float aspect) {
    vec2 vel = IMG_NORM_PIXEL(flow, uv).xy;
    float cur = IMG_NORM_PIXEL(smoke, uv).r;
    // Buoyancy: thick smoke rises a little faster.
    vel.y += riseSpeed() * (0.45 + 0.55 * clamp(cur, 0.0, 1.5));
    float x0 = noteX(vxNote0 > 0.0 ? vxNote0 : vxGlide);
    float hit = vxHit * vxHit;
    vec2 dp = vec2((uv.x - x0) * aspect, uv.y);
    float jet = exp(-dp.x * dp.x / 0.016) * exp(-dp.y / 0.18);
    vel.y += hit * mix(0.6, 2.0, density) * jet;
    vel.x += hit * 5.0 * dp.x * jet;
    return vel;
}

// Nothing comes in through the floor or the sides except what we breathe in.
float insideFloor(vec2 p) {
    return step(0.0, p.y) * step(0.0, p.x) * step(p.x, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float f60 = dt * 60.0;

    if (PASSINDEX == 0) {
        float freq = mix(4.2, 1.2, scale);
        vec2 q = vec2(uv.x * aspect, uv.y) * freq;
        // The eddies rise with the smoke.
        q.y -= vxPhase * riseSpeed() * freq * 0.6;
        float tz = vxPhase * 0.07;
        float e = 0.06;
        float p0 = potential(q, tz);
        float px1 = potential(q + vec2(e, 0.0), tz);
        float py1 = potential(q + vec2(0.0, e), tz);
        vec2 curl = vec2(py1 - p0, -(px1 - p0)) / e;
        float strength = mix(0.015, 0.3, swirl) * mix(0.75, 1.3, uv.y);
        gl_FragColor = vec4(curl * strength, 0.0, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        // First guess: plain semi-Lagrangian step back along the flow.
        vec2 vel = smokeVelocity(uv, aspect);
        vec2 back = uv - vel * dt * vec2(1.0 / aspect, 1.0);
        gl_FragColor = IMG_NORM_PIXEL(smoke, clamp(back, 0.0, 1.0)) * insideFloor(back);
        return;
    }

    if (PASSINDEX == 2) {
        // MacCormack correction: step the guess forward again, take back half the error,
        // and clamp to the cell it came from. Keeps the smoke crisp instead of mushy.
        vec2 vel = smokeVelocity(uv, aspect);
        vec2 dv = vel * dt * vec2(1.0 / aspect, 1.0);
        vec2 back = uv - dv;
        vec4 guess = IMG_NORM_PIXEL(guess1, uv);
        vec4 there = IMG_NORM_PIXEL(guess1, clamp(uv + dv, 0.0, 1.0));
        vec4 now = IMG_NORM_PIXEL(smoke, uv);
        vec4 adv = guess + 0.5 * (now - there);
        vec2 h = 0.5 / RENDERSIZE;
        vec2 bc = clamp(back, 0.0, 1.0);
        vec4 a = IMG_NORM_PIXEL(smoke, bc + vec2(-h.x, -h.y));
        vec4 b = IMG_NORM_PIXEL(smoke, bc + vec2(h.x, -h.y));
        vec4 c = IMG_NORM_PIXEL(smoke, bc + vec2(-h.x, h.y));
        vec4 d4 = IMG_NORM_PIXEL(smoke, bc + vec2(h.x, h.y));
        adv = clamp(adv, min(min(a, b), min(c, d4)), max(max(a, b), max(c, d4))) * insideFloor(back);

        // Fade, and take a little off the bottom so the dark stays black.
        float keep = pow(mix(0.9998, 0.991, dissipation), f60);
        float d = max(adv.r * keep - 0.0004 * f60, 0.0);

        // Breathe smoke in at the floor. The mouth flickers so the plume is never a tube.
        float x0 = noteX(vxNote0 > 0.0 ? vxNote0 : vxGlide);
        float x1 = noteX(vxNote1);
        float e1 = vxNote1 > 0.0 ? vxNoteE1 : 0.0;
        float hit = vxHit * vxHit;
        float flick = 0.45 + 1.1 * noise3(vec3(uv.x * aspect * 26.0, uv.y * 26.0 - vxPhase * 3.0, vxPhase * 0.7));
        vec2 m0 = vec2((uv.x - x0) * aspect, uv.y);
        vec2 m1 = vec2((uv.x - x1) * aspect, uv.y);
        float mouth0 = exp(-m0.x * m0.x / 0.006 - m0.y * m0.y / 0.006);
        float mouth1 = exp(-m1.x * m1.x / 0.006 - m1.y * m1.y / 0.006);
        float amount = mix(1.2, 5.5, density);
        float inj = (mouth0 * (vxEnv * amount + hit * amount * 4.0) + mouth1 * e1 * amount * 0.8) * dt * flick;

        // At rest a thin wisp still curls up from somewhere along the floor.
        float xr = 0.5 + 0.3 * sin(vxPhase * 0.37) * cos(vxPhase * 0.13);
        vec2 mr = vec2((uv.x - xr) * aspect, uv.y);
        inj += exp(-mr.x * mr.x / 0.0012 - mr.y * mr.y / 0.002) * 0.45 * dt * flick;

        d += inj;
        if (FRAMEINDEX < 2) d = 0.0;
        gl_FragColor = vec4(min(d, 4.0), 0.0, 0.0, 1.0);
        return;
    }

    // Fine wisps: nudge the lookup with a small turbulent offset at full size.
    vec2 w = vec2(uv.x * aspect, uv.y) * mix(16.0, 7.0, scale);
    w.y -= vxPhase * riseSpeed() * 4.0;
    float tz = vxPhase * 0.2;
    vec2 warp = vec2(noise3(vec3(w, tz)), noise3(vec3(w + 17.3, tz))) - 0.5;
    warp += 0.5 * (vec2(noise3(vec3(w * 2.3, tz * 1.3)), noise3(vec3(w * 2.3 + 5.1, tz * 1.3))) - 0.5);
    vec2 suv = uv + warp * 0.014 * vec2(1.0 / aspect, 1.0);
    vec4 s = IMG_NORM_PIXEL(smoke, suv);
    float d = s.r;

    // Light from one side: march a few steps toward it to find how much smoke is in the way.
    float ang = lightAngle * 6.2832;
    vec2 toLight = vec2(cos(ang), sin(ang));
    vec2 stepUV = toLight * 0.022 * vec2(1.0 / aspect, 1.0);
    float occ = 0.0;
    for (int i = 1; i <= 6; i++) {
        occ += IMG_NORM_PIXEL(smoke, suv + stepUV * float(i)).r * (1.0 - float(i) * 0.08);
    }
    float trans = exp(-occ * 1.05);
    // The side of a billow facing the light catches it.
    float dl = IMG_NORM_PIXEL(smoke, suv + toLight * 0.006 * vec2(1.0 / aspect, 1.0)).r;
    float facing = clamp((d - dl) * 5.0, -1.0, 1.0);

    float body = 1.0 - exp(-d * 1.8);
    float lit = body * (0.03 + 1.6 * trans * (0.62 + 0.6 * facing));
    lit = pow(max(lit, 0.0), mix(0.7, 1.9, contrast)) * mix(0.9, 1.4, contrast);

    vec3 col = ink.rgb * lit;

    // Film grain rides on the smoke only, so the black stays black.
    float g = hash21(gl_FragCoord.xy + fract(TIME * 7.13) * 113.0) - 0.5;
    col *= 1.0 + g * grain * 0.9;

    // Floor marks in the accent: a short dash where each note breathes in.
    float x0 = noteX(vxNote0 > 0.0 ? vxNote0 : vxGlide);
    float x1 = noteX(vxNote1);
    float xr = 0.5 + 0.3 * sin(vxPhase * 0.37) * cos(vxPhase * 0.13);
    vec2 fw = fwidth(gl_FragCoord.xy);
    float pxs = max(1.0, max(fw.x, fw.y));
    float yPx = gl_FragCoord.y / pxs;
    float band = smoothstep(4.0, 5.0, yPx) * (1.0 - smoothstep(6.0, 7.0, yPx));
    float hw = 0.035;
    float edge = 1.5 * pxs / RENDERSIZE.y;
    float dash0 = 1.0 - smoothstep(hw, hw + edge, abs(uv.x - x0) * aspect);
    float dash1 = 1.0 - smoothstep(hw, hw + edge, abs(uv.x - x1) * aspect);
    float dashR = 1.0 - smoothstep(0.012, 0.012 + edge, abs(uv.x - xr) * aspect);
    float marks = dash0 * (vxEnv * 0.55 + vxHit * vxHit * 0.45) + dash1 * (vxNote1 > 0.0 ? vxNoteE1 * 0.4 : 0.0) + dashR * 0.12;
    col += accent.rgb * band * min(marks, 1.0);
    col += (hash21(gl_FragCoord.xy * 1.37 + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
