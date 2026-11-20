/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "One luminous thread drawing a figure in space, the kind a pendulum machine traces: each of its three directions swings as two sine waves, so the thread loops and weaves back through itself. The figure turns slowly, its nearer strands brighter and a little thicker, and a bright head runs along it. The sound's level opens the figure up and brightens it. Each hit changes the swing ratios to a new simple set, so the thread glides into a new figure, and the head flashes in the accent color. With no sound the figure hangs dim and drifts.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "complexity", "LABEL": "Complexity", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "thickness", "LABEL": "Thickness", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Thread", "TYPE": "color", "DEFAULT": [0.8, 0.9, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Head", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The thread is followed as this many short pieces round its whole loop.
const int SEGS = 96;
const float TAU = 6.2831853;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The simple swing ratios a hit chooses between: how many times the thread swings across, up
// and down, and in depth while it goes once round its loop.
vec3 ratios(float k) {
    if (k < 0.5) return vec3(2.0, 3.0, 1.0);
    if (k < 1.5) return vec3(3.0, 4.0, 1.0);
    if (k < 2.5) return vec3(3.0, 5.0, 2.0);
    if (k < 3.5) return vec3(4.0, 5.0, 1.0);
    if (k < 4.5) return vec3(1.0, 2.0, 3.0);
    if (k < 5.5) return vec3(2.0, 5.0, 3.0);
    if (k < 6.5) return vec3(5.0, 3.0, 4.0);
    return vec3(3.0, 1.0, 2.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow;

    // The figure this hit chose and the one before it; the thread glides from the old to the new
    // as the hit dies away.
    vec3 fNew = ratios(mod(n * 3.0, 8.0));
    vec3 fOld = ratios(mod((n + 63.0) * 3.0, 8.0));
    float blend = 1.0 - smoothstep(0.0, 0.7, pu);
    // The second, smaller swing on each direction.
    float m = clamp(complexity, 0.0, 1.0) * 0.6;
    vec3 gNew = fNew.yzx + 1.0;
    vec3 gOld = fOld.yzx + 1.0;

    // The swings slip slowly against each other, so the figure never holds still while the sound plays.
    float drift = flow * 0.35 + TIME * 0.02;
    vec3 ph1 = vec3(0.5, 1.2, 0.2) + drift * vec3(0.23, 0.17, 0.31);
    vec3 ph2 = vec3(1.1, 2.3, 4.0) + drift * vec3(-0.41, 0.29, 0.37);

    // Each sine is stepped round the loop by turning it through a fixed angle.
    float dth = TAU / float(SEGS);
    vec3 s1n = sin(ph1 - fNew * dth);
    vec3 c1n = cos(ph1 - fNew * dth);
    vec3 s2n = sin(ph2 - gNew * dth);
    vec3 c2n = cos(ph2 - gNew * dth);
    vec3 s1o = sin(ph1 - fOld * dth);
    vec3 c1o = cos(ph1 - fOld * dth);
    vec3 s2o = sin(ph2 - gOld * dth);
    vec3 c2o = cos(ph2 - gOld * dth);
    vec3 sd1n = sin(fNew * dth);
    vec3 cd1n = cos(fNew * dth);
    vec3 sd2n = sin(gNew * dth);
    vec3 cd2n = cos(gNew * dth);
    vec3 sd1o = sin(fOld * dth);
    vec3 cd1o = cos(fOld * dth);
    vec3 sd2o = sin(gOld * dth);
    vec3 cd2o = cos(gOld * dth);

    // The figure is wider than it is tall, to suit the frame; the sound's level opens it up.
    float open = (0.24 + 0.05 * sw) / (1.0 + 0.9 * m);
    vec3 amp = vec3(1.65, 1.0, 1.0) * open;

    // It turns slowly about its upright axis, tipped a little toward the eye.
    float ay = (flow * mix(0.05, 0.6, turn) + TIME * 0.02) + 0.6;
    float ax = 0.35 + 0.15 * sin(drift * 0.5);
    float cy = cos(ay);
    float sy = sin(ay);
    float cx = cos(ax);
    float sx = sin(ax);
    mat3 view = mat3(cy, sx * sy, -cx * sy, 0.0, cx, sx, sy, -sx * cy, cx * cy);

    // Widths in pixels, kept in proportion on a larger or smaller picture.
    float res = RENDERSIZE.y / 1080.0;
    float wBase = mix(0.5, 2.4, thickness) * res;
    float gw = mix(5.0, 22.0, glow) * max(res, 0.35);
    float haloAmt = 0.1 + 0.35 * glow;

    // The head's place on the loop.
    float sHead = fract(flow * 0.07 + 0.2);

    vec3 pA = vec3(0.0);
    vec3 pB = vec3(0.0);
    vec3 pC = vec3(0.0);
    vec3 pD = vec3(0.0);
    float inkV = 0.0;
    float accV = 0.0;
    float headV = 0.0;
    float wideV = 0.0;

    for (int i = 0; i < SEGS + 3; i++) {
        // This point of the thread, turned to the eye and drawn in perspective (x, y on screen, z depth).
        vec3 q = mix(s1o + m * s2o, s1n + m * s2n, blend) * amp;
        q = view * q;
        float persp = 1.0 / (1.0 + q.z * 0.6);
        pA = pB;
        pB = pC;
        pC = pD;
        pD = vec3(q.xy * persp, q.z);

        // Step every sine on.
        vec3 tmp = s1n * cd1n + c1n * sd1n;
        c1n = c1n * cd1n - s1n * sd1n;
        s1n = tmp;
        tmp = s2n * cd2n + c2n * sd2n;
        c2n = c2n * cd2n - s2n * sd2n;
        s2n = tmp;
        tmp = s1o * cd1o + c1o * sd1o;
        c1o = c1o * cd1o - s1o * sd1o;
        s1o = tmp;
        tmp = s2o * cd2o + c2o * sd2o;
        c2o = c2o * cd2o - s2o * sd2o;
        s2o = tmp;

        if (i < 3) continue;

        // The nearest point of the piece between B and C. The piece is bowed to follow the true
        // curve (from the points either side of it), so the thread shows no corners.
        vec2 ba = pC.xy - pB.xy;
        vec2 pa = p - pB.xy;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
        vec2 bow = (pA.xy - pB.xy - pC.xy + pD.xy) * 0.25;
        vec2 off = pa - ba * h + bow * h * (1.0 - h);
        for (int k = 0; k < 2; k++) {
            vec2 tang = ba - bow * (1.0 - 2.0 * h);
            h = clamp(h + dot(off, tang) / max(dot(tang, tang), 1e-9), 0.0, 1.0);
            off = pa - ba * h + bow * h * (1.0 - h);
        }
        float d = length(off) * RENDERSIZE.y;
        float z = mix(pB.z, pC.z, h);

        // Nearer strands are brighter and a little thicker.
        float near = clamp(0.5 - z * 1.3, 0.0, 1.0);
        float b = mix(0.36, 1.0, near * near);
        // A thread thinner than a pixel is drawn a pixel wide and dimmer, so it never breaks into dots.
        float w = max(wBase * (0.7 + 0.7 * near), 0.6);
        float sig = max(w, 0.85);
        float line = (w / sig) * exp(-(d * d) / (sig * sig));
        float halo = 1.0 / (1.0 + (d * d) / (gw * gw));
        wideV = max(wideV, b / (1.0 + (d * d) / (gw * gw * 36.0)));

        // How far behind the head this point is, round the loop: the thread is brightest just
        // behind the head and fades along its length.
        float s = (float(i - 3) + h) / float(SEGS);
        float behind = fract(sHead - s);
        // Just in front of the head the light falls away over a very short stretch, not at a cut.
        float front = exp(-(1.0 - behind) * 160.0);
        float trail = 0.5 + 0.5 * max(exp(-behind * 3.5), front);
        float val = b * trail * (line + haloAmt * halo);

        // A hit colors the stretch just behind the head.
        float acc = clamp(pu * 1.3 * max(exp(-behind * 9.0), front), 0.0, 1.0);
        inkV = max(inkV, val * (1.0 - acc));
        accV = max(accV, val * acc);

        // The head: a short bright bead with its own glow.
        float head = max(exp(-behind * 70.0), front);
        float bw = w * 2.6 + 1.6 * max(res, 0.5);
        float bead = exp(-(d * d) / (bw * bw));
        headV = max(headV, head * (0.55 + 0.45 * b) * (bead + 0.6 * halo));
    }

    float level = 0.85 + 0.9 * sw;
    vec3 headC = mix(mix(ink.rgb, vec3(1.0), 0.6), accent.rgb, 0.4 + 0.4 * pu);
    vec3 col = ink.rgb * inkV * level;
    col += accent.rgb * accV * level * 1.4;
    col += headC * headV * (1.1 + 0.6 * sw + 1.6 * pu);
    // The thread's light hangs faintly in the air round the whole figure.
    col += ink.rgb * wideV * wideV * (0.03 + 0.07 * glow) * (0.6 + 0.6 * sw);

    // Tone map on the brightest channel so the thread keeps its color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark ground lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
