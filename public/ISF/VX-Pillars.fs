/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Pillars of creation: towering columns of dark dust rise through glowing gas, lit from behind by unseen stars so every ragged edge burns bright, with wisps boiling off their tips. Each hit sends a flare of light rolling down the columns and sparks a newborn star at a tip; held sound brightens the gas and lengthens the streaming wisps.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "flare", "LABEL": "Flare", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "wisps", "LABEL": "Wisps", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "erosion", "LABEL": "Erosion", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "stars", "LABEL": "Stars", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Gas", "TYPE": "color", "DEFAULT": [0.3, 0.75, 0.8, 1.0] },
        { "NAME": "accent", "LABEL": "Burning edges", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.35, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last hit count, seconds since that hit plus one (zero = fresh), how hard it was,
// and a slowly eased copy of the envelope.

const float TAU = 6.2831853;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

float fbm(vec2 p, int oct) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        s += a * vnoise(p);
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return s;
}

// A leaning column from base a to tip b, thinning from ra to rb.
float column(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// The three pillars, before erosion. Tips are returned for the wisps.
float pillarsRaw(vec2 p) {
    float d = column(p, vec2(-0.5, -0.8), vec2(-0.36, 0.2), 0.17, 0.085);
    d = smin(d, column(p, vec2(0.04, -0.8), vec2(0.12, -0.02), 0.12, 0.065), 0.04);
    d = smin(d, column(p, vec2(0.53, -0.8), vec2(0.43, -0.22), 0.1, 0.055), 0.04);
    return d;
}

// Erosion: a broad lumpy warp, knobbly globules along the sides and a
// fine ragged edge.
vec2 pillars(vec2 p, float t) {
    float e = 0.4 + 0.9 * erosion;
    vec2 w1 = vec2(fbm(p * 1.6 + vec2(0.0, t * 0.015), 3), fbm(p * 1.6 + vec2(5.2, 1.3 - t * 0.015), 3));
    vec2 q = p + w1 * 0.07 * e;
    vec2 w2 = vec2(fbm(q * 4.0 + vec2(2.0, 7.0), 3), fbm(q * 4.0 + vec2(8.0, 3.0), 3));
    q += w2 * 0.035 * e;
    float d = pillarsRaw(q);
    float coarse = d;
    // Knobs: ridged noise pushes out globules and pulls in hollows.
    float knob = 1.0 - abs(vnoise(q * 9.0 + w2 * 1.5));
    d -= 0.038 * e * (knob * knob - 0.45);
    d += 0.018 * e * fbm(q * 22.0 + w2 * 3.0, 3);
    return vec2(d, coarse);
}

void main() {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        // An all-zero texel means a fresh buffer (the voice was just added):
        // start as if the last hit was long ago. The age is stored plus one,
        // so a live clock never reads zero there.
        if (FRAMEINDEX < 2 || c.g < 0.5) c = vec4(n, 31.0, 0.7, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g - 1.0 + dt, 30.0);
        float vel = newHit ? clamp(vxVel, 0.2, 1.0) : c.b;
        float env = mix(c.a, vxEnv, 1.0 - exp(-dt * 2.0));
        gl_FragColor = vec4(n, age + 1.0, vel, env);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    bool fresh = clk.g < 0.5;
    float age = fresh ? 30.0 : clk.g - 1.0;
    if (vxHit > 0.01) age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
    float vel = fresh ? 0.7 : clk.b;
    float env = max(clk.a, vxEnv * 0.6);

    vec2 res = RENDERSIZE;
    vec2 p0 = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = vxPhase * (0.05 + 0.3 * drift) + TIME * 0.02;
    // A slow drift of the view, the pillars sliding against the far gas.
    vec2 cam = vec2(0.03 * sin(t * 0.05), 0.015 * sin(t * 0.07));
    vec2 p = p0 + cam;
    float px = 1.0 / res.y;

    vec2 dd = pillars(p, t);
    float d = dd.x;
    // Facing the light (from above, a little right), from the slope of the
    // smooth outline so the rim stays steady.
    vec2 L = normalize(vec2(0.25, 1.0));
    // Divided by the slope of p itself, so a flipped screen axis can't flip the light.
    vec2 grad = vec2(dFdx(dd.y) / dFdx(p0.x), dFdy(dd.y) / dFdy(p0.y));
    float facing = clamp(dot(grad / max(length(grad), 1e-6), L) * 1.15, -1.0, 1.0);

    // The hit: a flare that rolls down from the top of the frame.
    float front = 0.55 - age * 0.9;
    float sweep = exp(-pow((p0.y - front) * 5.0, 2.0)) * exp(-age * 0.8) * (0.5 + 0.7 * vel) * flare * 1.6;
    float flash = exp(-age * 2.5) * (0.4 + 0.6 * vel) * flare;
    float gain = 0.7 + 0.8 * glow + 0.6 * env + 2.2 * sweep + 1.4 * flash;

    // Inside: dark dust, thinner (lit through) near the edges.
    float inside = smoothstep(px * 1.5, -px * 1.5, d);
    float depthIn = max(-d, 0.0);
    float dust = 0.5 + 0.5 * fbm(p * 7.0 + vec2(3.0, t * 0.01), 4);
    float trans = exp(-depthIn * 70.0) * smoothstep(-0.2, 0.8, facing);
    vec3 dustC = mix(accent.rgb, ink.rgb, 0.3) * (0.02 + 0.16 * dust * dust * dust) * (0.6 + 0.4 * gain) + accent.rgb * trans * 0.35 * gain;
    // The burning rim on the lit side, thin and hot, with a glow outside it.
    float rimW = 0.004 + 0.004 * glow;
    float rim = exp(-abs(d) / rimW) * smoothstep(-0.2, 0.7, facing);
    float rimGlow = exp(-max(d, 0.0) / (0.008 + 0.012 * glow)) * smoothstep(0.0, 0.9, facing) * step(0.0, d);
    vec3 rimC = mix(accent.rgb, vec3(1.0, 0.97, 0.9), 0.45) * rim * gain * 1.2
              + accent.rgb * rimGlow * 0.35 * gain;

    // Wisps boiling off the tips, streaming toward the light.
    float wisp = 0.0;
    vec2 tips[3];
    tips[0] = vec2(-0.36, 0.29);
    tips[1] = vec2(0.12, 0.05);
    tips[2] = vec2(0.43, -0.16);
    for (int k = 0; k < 3; k++) {
        vec2 q = p - tips[k];
        float up = q.y;
        float wid = 0.03 + 0.06 * max(up, 0.0);
        float lean = q.x - up * 0.25;
        if (up < -0.04 || abs(lean) > wid * 3.2) continue;
        float plume = exp(-lean * lean / (wid * wid)) * smoothstep(-0.03, 0.02, up)
                    * exp(-max(up, 0.0) / (0.08 + 0.22 * wisps + 0.12 * env));
        float streaks = 0.5 + 0.5 * fbm(vec2(lean * 30.0, up * 5.0 - t * 0.6 + float(k) * 7.0), 3);
        wisp += plume * streaks * streaks;
    }
    wisp *= (0.6 + 0.9 * wisps) * smoothstep(-0.01, 0.01, d);
    vec3 wispC = mix(ink.rgb, accent.rgb, 0.5) * wisp * gain * 0.8;

    // Newborn stars: a hit lights one at a tip.
    int which = int(mod(n, 3.0));
    vec2 tip = which == 0 ? vec2(-0.37, 0.26) : (which == 1 ? vec2(0.11, 0.03) : vec2(0.44, -0.19));
    float sd = length(p - tip);
    float born = exp(-age * 0.7) * smoothstep(0.0, 0.05, age + 0.03) * (0.4 + 0.6 * vel) * flare;
    float starCore = exp(-sd * sd / (px * px * 9.0)) + 0.35 * exp(-sd / 0.03);
    float spikes = exp(-abs(p.x - tip.x) / (px * 1.5)) * exp(-abs(p.y - tip.y) / 0.06)
                 + exp(-abs(p.y - tip.y) / (px * 1.5)) * exp(-abs(p.x - tip.x) / 0.06);
    float newStar = born * (starCore + 0.5 * spikes);

    // Background gas: brighter toward the light, layered and drifting.
    vec2 gq = p0 * 0.97 + cam * 0.3;
    float g1 = fbm(gq * 2.2 + vec2(t * 0.02, 0.0), 4);
    float g2 = fbm(gq * 4.5 + vec2(-t * 0.03, 4.0) + g1, 3);
    float lightUp = smoothstep(-0.6, 0.6, p0.y + 0.15 * g1);
    float gas = (0.35 + 0.65 * lightUp) * (0.45 + 0.55 * smoothstep(-0.4, 0.5, g1 + 0.4 * g2));
    vec3 gasC = mix(ink.rgb * 0.5, mix(ink.rgb, accent.rgb, 0.35), smoothstep(0.0, 0.6, g2 + 0.2)) * gas;
    gasC *= (0.35 + 0.4 * glow + 0.3 * env + 0.6 * sweep + 0.5 * flash);
    gasC += ink.rgb * 0.02;
    // A light halo behind the pillars' outline.
    gasC += accent.rgb * 0.25 * exp(-max(d, 0.0) * 14.0) * smoothstep(-0.3, 0.8, facing) * gain;

    // Stars in the gas.
    vec2 sp = gl_FragCoord.xy / (5.0 * res.y / 1080.0);
    vec2 sid = floor(sp);
    float sh = hash21(sid);
    float starL = 0.0;
    if (sh < 0.05 * stars) {
        vec2 sc = sid + 0.25 + 0.5 * hash22(sid);
        float sdd = length(sp - sc) * 5.0 * res.y / 1080.0;
        starL = exp(-sdd * sdd * 0.6) * (0.3 + 1.2 * pow(hash21(sid + 3.1), 4.0));
    }

    vec3 subject = dustC * inside + rimC + wispC + accent.rgb * newStar + vec3(newStar * 0.6);
    // Coverage of the subject: solid dust, plus the light around it.
    float lum = max(max(rimC.r, rimC.g), rimC.b) + max(max(wispC.r, wispC.g), wispC.b) + newStar;
    float cover = clamp(inside + (1.0 - inside) * clamp(lum, 0.0, 1.0), 0.0, 1.0);

    vec3 bg = gasC + vec3(starL);
    vec3 col = bg * (1.0 - inside) + subject;
    col = 1.0 - exp(-col * 1.3);

    float outA = 1.0;
    vec3 outC = col;
    if (vxClear) {
        vec3 sc = 1.0 - exp(-subject * 1.3);
        outA = max(cover, max(sc.r, max(sc.g, sc.b)));
        outC = sc;
    }
    outC *= vxPresence;
    outA *= vxPresence;
    outC = min(clamp(outC, 0.0, 1.0), vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
