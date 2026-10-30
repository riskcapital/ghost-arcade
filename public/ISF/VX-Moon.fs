/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A large moon whose phase is the chord. The root turns the terminator and the chord's quality sets how much is lit: major chords wax towards full, minor ones thin to a crescent, diminished to a sliver. Each change turns the light smoothly over two seconds. A thin halo ring brightens as the chord sounds, faint cloud bands drift across, and earthshine glows faintly on the dark side.",
    "PASSES": [
        {
            "TARGET": "mnMeta",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "mnAim",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "mnTurn",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "moonSize", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "phaseResponse", "LABEL": "Phase response", "TYPE": "float", "DEFAULT": 0.85, "MIN": 0, "MAX": 1 },
        { "NAME": "halo", "LABEL": "Halo", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "clouds", "LABEL": "Clouds", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "surfaceDetail", "LABEL": "Surface detail", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "position", "LABEL": "Position", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "earthshine", "LABEL": "Earthshine", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Moonlight", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Earthshine", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

// State, one value set per 1x1 target:
// mnMeta = (note count + 100 once running, time since the strike, slow level, quick level)
// mnAim  = (phase the chord asks for, its angle, 0, 0)
// mnTurn = (phase now, angle now, their speeds): a critically damped spring
//          towards the aim, so the light turns smoothly and never jumps.
// Phase: 0 = new, pi = full. Angle: where the sunlit side faces, in the frame.
const float PI = 3.14159265;
const float TAU = 6.2831853;
const float LISTEN = 0.12;
// Spring rate: settles in about two seconds.
const float OMEGA = 3.3;
const vec2 REST = vec2(1.05, 3.6);

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

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i);
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
               mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// Craters on the sphere: (albedo change, slope towards the sun). Feature
// points sit in a 3D lattice; only the nearest corner cells can reach p.
vec2 craters(vec3 n, vec3 L, float freq, float seed) {
    vec3 p = n * freq;
    vec3 base = floor(p - 0.5);
    float alb = 0.0;
    float slope = 0.0;
    for (int k = 0; k < 8; k++) {
        vec3 o = vec3(float(k - 2 * (k / 2)), float((k / 2) - 2 * (k / 4)), float(k / 4));
        vec3 cell = base + o;
        float h = hash31(cell + seed);
        if (h < 0.55) {
            vec3 ctr = cell + 0.5 + (vec3(hash31(cell + seed + 1.7), hash31(cell + seed + 4.1), hash31(cell + seed + 8.3)) - 0.5) * 0.5;
            float rad = mix(0.12, 0.42, fract(h * 37.1));
            vec3 v = p - ctr;
            float dist = length(v) / rad;
            if (dist < 1.4) {
                // A bowl with a raised rim: the far wall faces the sun, the near wall turns away.
                float wall = smoothstep(0.45, 0.95, dist) * (1.0 - smoothstep(0.95, 1.35, dist));
                float floorDark = 1.0 - smoothstep(0.55, 0.9, dist);
                vec3 dirv = v / max(length(v), 1e-4);
                float facing = -dot(dirv, L) * (dist < 0.95 ? 1.0 : -0.6);
                alb += -0.05 * floorDark + 0.07 * wall;
                slope += facing * wall;
            }
        }
    }
    return vec2(alb, slope);
}

vec2 liveNote(int i) {
    if (i == 0) return vec2(vxNote0, vxNoteE0);
    if (i == 1) return vec2(vxNote1, vxNoteE1);
    if (i == 2) return vec2(vxNote2, vxNoteE2);
    return vec2(vxNote3, vxNoteE3);
}

float maxEnergy() {
    return max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
}

// 1 if pitch class pc is among the chord's notes (those near the loudest).
float hasPc(float pc, float maxE) {
    float found = 0.0;
    for (int i = 0; i < 4; i++) {
        vec2 ln = liveNote(i);
        if (ln.x > 0.0 && ln.y >= 0.45 * maxE) {
            float m = floor(ln.x * 127.0 + 0.5);
            if (abs(mod(m, 12.0) - pc) < 0.5) found = 1.0;
        }
    }
    return found;
}

// The chord as a moon: (phase, angle). The root turns the terminator round
// the circle of fifths; the quality sets how much of the disc is lit.
vec2 chordMoon(float maxE) {
    float bass = 999.0;
    for (int i = 0; i < 4; i++) {
        vec2 ln = liveNote(i);
        if (ln.x > 0.0 && ln.y >= 0.45 * maxE) bass = min(bass, floor(ln.x * 127.0 + 0.5));
    }
    float root = mod(bass, 12.0);
    float lit = 0.5;
    bool named = false;
    // Try each sounding note as the root, so inversions still read.
    for (int i = 0; i < 4; i++) {
        vec2 ln = liveNote(i);
        if (!named && ln.x > 0.0 && ln.y >= 0.45 * maxE) {
            float r = mod(floor(ln.x * 127.0 + 0.5), 12.0);
            float m3 = hasPc(mod(r + 3.0, 12.0), maxE);
            float M3 = hasPc(mod(r + 4.0, 12.0), maxE);
            float p5 = hasPc(mod(r + 7.0, 12.0), maxE);
            float d5 = hasPc(mod(r + 6.0, 12.0), maxE);
            float a5 = hasPc(mod(r + 8.0, 12.0), maxE);
            float m7 = hasPc(mod(r + 10.0, 12.0), maxE);
            if (M3 > 0.5 && p5 > 0.5) { lit = m7 > 0.5 ? 0.7 : 0.84; named = true; root = r; }
            else if (m3 > 0.5 && p5 > 0.5) { lit = m7 > 0.5 ? 0.42 : 0.3; named = true; root = r; }
            else if (m3 > 0.5 && d5 > 0.5) { lit = 0.12; named = true; root = r; }
            else if (M3 > 0.5 && a5 > 0.5) { lit = 0.95; named = true; root = r; }
        }
    }
    if (!named) {
        // Thirds alone still lean major or minor; anything else is a half moon.
        float m3 = hasPc(mod(root + 3.0, 12.0), maxE);
        float M3 = hasPc(mod(root + 4.0, 12.0), maxE);
        lit = M3 > 0.5 ? 0.75 : (m3 > 0.5 ? 0.36 : 0.5);
    }
    lit = mix(0.5, lit, phaseResponse);
    float phase = acos(clamp(1.0 - 2.0 * lit, -1.0, 1.0));
    float fifths = mod(root * 7.0, 12.0);
    float angle = mod(fifths * PI / 6.0 + 0.35, TAU);
    return vec2(phase, angle);
}

float angleDiff(float a, float b) {
    return mod(a - b + PI, TAU) - PI;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 c = vec2(0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 me = IMG_NORM_PIXEL(mnMeta, c);
        bool ready = FRAMEINDEX >= 2 && me.x > 99.5;
        float count = floor(vxCount + 0.5);
        bool strike = ready && abs(count - (me.x - 100.0)) > 0.5;
        // On start, listen at once so a chord already sounding is heard.
        float since = !ready ? 0.0 : (strike ? 0.0 : min(me.y + dt, 100.0));
        float target = maxEnergy();
        float slow = ready ? me.z : 0.0;
        slow += (target - slow) * (1.0 - exp(-dt / (target > slow ? 0.6 : 2.5)));
        float quick = ready ? me.w : 0.0;
        float e = max(vxEnv, target);
        quick += (e - quick) * (1.0 - exp(-dt / (e > quick ? 0.08 : 0.6)));
        gl_FragColor = vec4(count + 100.0, since, slow, quick);
        return;
    }

    vec4 meta = IMG_NORM_PIXEL(mnMeta, c);

    if (PASSINDEX == 1) {
        vec4 aim = IMG_NORM_PIXEL(mnAim, c);
        if (FRAMEINDEX < 2) aim = vec4(REST, 0.0, 0.0);
        float maxE = maxEnergy();
        // Just after a strike, the chord sets a new aim.
        if (meta.y < LISTEN && maxE > 0.02) aim = vec4(chordMoon(maxE), 0.0, 0.0);
        gl_FragColor = aim;
        return;
    }

    if (PASSINDEX == 2) {
        vec4 st = IMG_NORM_PIXEL(mnTurn, c);
        vec2 aim = IMG_NORM_PIXEL(mnAim, c).xy;
        if (FRAMEINDEX < 2) st = vec4(REST, 0.0, 0.0);
        vec2 err = vec2(aim.x - st.x, angleDiff(aim.y, st.y));
        vec2 vel = st.zw + (OMEGA * OMEGA * err - 2.0 * OMEGA * st.zw) * dt;
        vec2 pos = st.xy + vel * dt;
        gl_FragColor = vec4(clamp(pos.x, 0.0, PI), mod(pos.y, TAU), vel);
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float pxH = 1.0 / RENDERSIZE.y;

    vec2 moon = IMG_NORM_PIXEL(mnTurn, c).xy;
    float slowLevel = smoothstep(0.0, 0.7, meta.z);
    float quickLevel = smoothstep(0.0, 0.8, meta.w);

    float R = mix(0.125, 0.325, moonSize);
    vec2 C = vec2((position - 0.5) * (aspect - 2.6 * R), 0.02);
    vec2 d = (q - C) / R;
    float r = length(d);
    float aa = fw.y * pxH / R;

    // Cloud bands drift across in front of everything: a few wavy strata
    // with streaky edges, thinning and thickening as they go.
    float drift = vxPhase * 0.025;
    float wy = q.y + 0.09 * (noise2(vec2(q.x * 1.4 - drift * 0.7, 4.3)) - 0.5);
    float strata = pow(0.5 + 0.5 * sin(wy * 8.5 + 2.2), 4.0);
    // Streaks, turned a little off the noise lattice so it never shows.
    vec2 cp = vec2(q.x * 1.6 - drift, wy * 7.0);
    cp = vec2(0.96 * cp.x - 0.28 * cp.y, 0.28 * cp.x + 0.96 * cp.y);
    float cn = noise2(cp) * 0.48;
    cp = vec2(0.8 * cp.x - 0.6 * cp.y, 0.6 * cp.x + 0.8 * cp.y) * 2.3 + 7.1;
    cn += noise2(cp) * 0.28;
    cp = vec2(0.8 * cp.x + 0.6 * cp.y, -0.6 * cp.x + 0.8 * cp.y) * 2.2 + 3.7;
    cn += noise2(cp) * 0.16;
    cp = vec2(0.6 * cp.x - 0.8 * cp.y, 0.8 * cp.x + 0.6 * cp.y) * 2.1 + 1.3;
    cn += noise2(cp) * 0.08;
    float cloud = smoothstep(0.3, 0.85, strata * (0.35 + cn)) * min(clouds * 1.6, 1.0);

    vec3 col = vec3(0.0);
    float lightAmt = 0.32 + 0.68 * slowLevel;
    float gain = 0.45 + 0.8 * brightness;

    if (r < 1.0 + 2.0 * aa) {
        float rc = min(r, 1.0);
        vec3 n = vec3(d / max(r, 1e-4) * rc, sqrt(max(1.0 - rc * rc, 0.0)));
        // Sunlight: phase 0 comes from behind the moon, pi from behind the viewer.
        vec3 L = vec3(sin(moon.x) * cos(moon.y), sin(moon.x) * sin(moon.y), -cos(moon.x));
        // Low-contrast seas, and fine relief that roughens the terminator.
        vec3 sp = n * 1.7 + vec3(3.1, 7.7, 1.3);
        float seas = noise3(sp) * 0.6 + noise3(sp * 2.1 + 5.0) * 0.28 + noise3(sp * 4.3 + 1.0) * 0.12;
        float maria = smoothstep(0.47, 0.63, seas);
        vec3 dp = n * 11.0 + 2.0;
        float det = noise3(dp) * 0.55 + noise3(dp * 2.3 + 9.0) * 0.3 + noise3(dp * 5.1 + 4.0) * 0.15;
        vec2 cr = craters(n, L, 5.0, 0.0) + craters(n, L, 13.0, 17.0) * 0.7;
        float albedo = (0.9 - 0.2 * maria) * (1.0 + ((det - 0.5) * 0.3 + cr.x) * surfaceDetail * 1.4);
        float ndl = dot(n, L);
        float mu = max(n.z, 0.02);
        float mu0 = max(ndl, 0.0);
        // Lunar soil looks flat when lit head-on and brightens towards a crescent's limb.
        float ls = clamp(2.0 * mu0 / (mu0 + mu), 0.0, 1.15);
        // Relief catches the light where the sun is low.
        float relief = ((det - 0.5) * 0.08 + cr.y * 0.06) * (0.3 + surfaceDetail);
        float term = smoothstep(-0.02, 0.07, ndl + relief);
        float sunlit = term * mix(0.35, 1.0, ls) * (1.0 + cr.y * 0.25 * surfaceDetail * smoothstep(0.6, 0.05, mu0));
        float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
        vec3 face = ink.rgb * albedo * sunlit * gain * lightAmt;
        // Earthshine: the faintest warm light on the dark side.
        face += accent.rgb * albedo * (1.0 - term) * 0.03 * earthshine * (0.5 + 0.5 * lightAmt);
        // A cloud dims the face and glows with the light it scatters.
        col += face * disc * (1.0 - 0.6 * cloud) + ink.rgb * disc * cloud * 0.07 * gain * lightAmt;
    }

    // A tight aureole at the limb, and a thin halo ring further out with a
    // crisp inner edge that fades outward, as ice-crystal halos do.
    float outside = max(r - 1.0, 0.0);
    float aureole = exp(-outside / 0.07) * smoothstep(0.98, 1.0 + aa, r) * 0.05;
    float ringR = 2.0;
    float ringPx = (r - ringR) * R / pxH;
    float ringW = max(0.7, 0.6 * fw.y);
    // Brighter in some arcs than others, as the crystals drift.
    vec2 rim = d / max(r, 1e-4);
    float arc = 0.45 + 0.55 * noise2(rim * 1.3 + vec2(drift * 2.0, 5.5));
    float ring = exp(-0.5 * ringPx * ringPx / (ringW * ringW)) * 0.6 * arc;
    float ringTail = (r > ringR ? exp(-(r - ringR) / 0.14) : exp((r - ringR) / 0.02)) * 0.1 * arc;
    float haloLight = (0.05 + 0.45 * quickLevel) * halo;
    col += ink.rgb * (aureole * (0.4 + 0.6 * lightAmt) + (ring + ringTail) * haloLight) * gain * (1.0 - 0.7 * cloud);

    // Clouds catch the moonlight near the moon and vanish into the dark away from it.
    float glow = exp(-max(r - 0.85, 0.0) / 0.55) * (0.35 + 0.65 * lightAmt);
    col += ink.rgb * cloud * glow * 0.1 * gain;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
