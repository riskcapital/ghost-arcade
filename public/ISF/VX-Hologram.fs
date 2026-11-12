/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A projected hologram of a head and shoulders, drawn as glowing contour slices with a bright rim, slowly turning to look about above its projector. A ring of light orbits it, a scan line sweeps up through it, and the picture carries the faint interference ripple and color fringe of a projection. Hits of the sound it follows make the signal stumble: the figure breaks into slices that slide apart, its colors split, parts of it drop out and it dims and flickers before it steadies again. Signal loss sets how hard hits break it, Slices how finely the figure is sliced, Fringe the color split, Interference the ripple, Sweep how often the scan line passes, and Turn how far the head looks about.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "holo",
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "loss", "LABEL": "Signal loss", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "slices", "LABEL": "Slices", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fringe", "LABEL": "Fringe", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "interference", "LABEL": "Interference", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sweep", "LABEL": "Sweep", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Figure", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Fringe", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): r last count seen, g seconds since the last hit, b its strength.
// holo: the figure, r its light, g how much of that is rim, b coverage.

const float PI = 3.14159265;

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

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
    return -smin(-a, -b, k);
}

float sdEll(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

float sdCap(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// Head and shoulders, facing -z, y up.
float bust(vec3 p) {
    vec3 q = vec3(abs(p.x), p.y, p.z);
    float d = sdEll(p - vec3(0.0, 0.1, 0.04), vec3(0.33, 0.36, 0.4));
    d = smin(d, sdEll(p - vec3(0.0, -0.1, -0.07), vec3(0.25, 0.27, 0.29)), 0.12);
    d = smin(d, sdEll(p - vec3(0.0, -0.31, -0.16), vec3(0.11, 0.08, 0.1)), 0.08);
    // Cheekbones and brow.
    d = smin(d, sdEll(q - vec3(0.15, -0.04, -0.25), vec3(0.09, 0.07, 0.08)), 0.06);
    d = smin(d, sdEll(p - vec3(0.0, 0.1, -0.31), vec3(0.24, 0.055, 0.09)), 0.06);
    // Eye sockets.
    d = smax(d, -sdEll(q - vec3(0.115, 0.03, -0.39), vec3(0.08, 0.05, 0.07)), 0.04);
    // Eyes.
    d = smin(d, length(q - vec3(0.112, 0.03, -0.33)) - 0.042, 0.01);
    // Nose and lips.
    d = smin(d, sdCap(p, vec3(0.0, 0.04, -0.37), vec3(0.0, -0.09, -0.46), 0.042), 0.05);
    d = smin(d, sdEll(p - vec3(0.0, -0.1, -0.4), vec3(0.06, 0.03, 0.05)), 0.03);
    d = smin(d, sdEll(p - vec3(0.0, -0.19, -0.345), vec3(0.085, 0.026, 0.05)), 0.02);
    d = smin(d, sdEll(p - vec3(0.0, -0.235, -0.335), vec3(0.075, 0.028, 0.05)), 0.02);
    // Ears.
    d = smin(d, sdEll(q - vec3(0.335, -0.02, 0.06), vec3(0.045, 0.1, 0.065)), 0.03);
    // Neck and shoulders.
    d = smin(d, sdCap(p, vec3(0.0, -0.25, 0.06), vec3(0.0, -0.7, 0.1), 0.15), 0.08);
    d = smin(d, sdEll(p - vec3(0.0, -0.82, 0.12), vec3(0.8, 0.22, 0.32)), 0.2);
    return max(d, -0.98 - p.y);
}

vec3 bustNormal(vec3 p) {
    vec2 e = vec2(0.003, 0.0);
    return normalize(vec3(bust(p + e.xyy) - bust(p - e.xyy), bust(p + e.yxy) - bust(p - e.yxy), bust(p + e.yyx) - bust(p - e.yyx)));
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = min(c.g + dt, 30.0);
        float amt = c.b;
        if (newHit) {
            age = 0.0;
            amt = mix(0.55, 1.0, clamp(vxVel, 0.0, 1.0));
        }
        gl_FragColor = vec4(n, age, amt, 0.0);
        return;
    }

    float t = vxPhase;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX == 1) {
        vec2 uv = isf_FragNormCoord;
        vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
        vec3 ro = vec3(0.0, -0.38, -3.6);
        vec3 rd = normalize(vec3(p, 1.75));
        // The head looks about; the shoulders follow a little.
        float yaw = (sin(t * 0.31) * 0.75 + sin(t * 0.13 + 1.0) * 0.35) * mix(0.15, 1.2, turn);
        float pitchA = sin(t * 0.23) * 0.08 * turn;
        float cy = cos(yaw);
        float sy = sin(yaw);
        float lw = 1.0 / RENDERSIZE.y * 3.5 * 1.3;
        vec3 res = vec3(0.0);
        float hitT = 1e9;
        // March inside the bust's bounds.
        float tb = 2.3;
        float te = 4.8;
        float tt = tb;
        bool hit = false;
        vec3 hp = vec3(0.0);
        for (int i = 0; i < 48; i++) {
            vec3 w = ro + rd * tt;
            vec3 o = vec3(cy * w.x + sy * w.z, w.y, -sy * w.x + cy * w.z);
            o.yz = vec2(o.y * cos(pitchA) - o.z * sin(pitchA), o.y * sin(pitchA) + o.z * cos(pitchA)) * vec2(1.0, 1.0);
            float d = bust(o);
            if (d < 0.0015) {
                hit = true;
                hp = o;
                break;
            }
            tt += d * 0.9;
            if (tt > te) break;
        }
        if (hit) {
            hitT = tt;
            vec3 nr = bustNormal(hp);
            vec3 rdo = vec3(cy * rd.x + sy * rd.z, rd.y, -sy * rd.x + cy * rd.z);
            float facing = clamp(-dot(nr, rdo), 0.0, 1.0);
            float rim = pow(1.0 - facing, 2.2);
            // Contour slices in the figure's height.
            float sp = mix(0.045, 0.014, slices);
            float sv = hp.y / sp;
            float swid = fwidth(sv) * 1.2 + 0.04;
            float contour = smoothstep(swid, 0.0, abs(fract(sv) - 0.5) - 0.5 + swid) ;
            contour = smoothstep(0.5 - swid, 0.5, abs(fract(sv) - 0.5));
            // Faint meridians wrapping round the head.
            float mer = atan(hp.x, -hp.z) / PI * 18.0;
            float mwid = fwidth(mer) * 1.2;
            float meridian = smoothstep(0.5 - mwid, 0.5, abs(fract(mer) - 0.5)) * step(-0.75, hp.y) * 0.35;
            float lightV = 0.1 + 0.45 * facing * facing;
            float v = lightV * 0.35 + contour * (0.35 + 0.65 * facing) + meridian * facing + rim * 0.95;
            // Every sixth slice carries the accent.
            float accSlice = step(mod(floor(sv + 0.5), 6.0), 0.5) * contour;
            res = vec3(v, max(rim, accSlice), 1.0);
        }
        // The orbit ring of light round the shoulders.
        float yr = -0.95 + sin(t * 0.4) * 0.03;
        if (abs(rd.y) > 1e-4) {
            float tr = (yr - ro.y) / rd.y;
            if (tr > 0.0) {
                vec3 q = ro + rd * tr;
                float r = length(q.xz);
                float ang = atan(q.z, q.x) + t * 0.6;
                float band = smoothstep(0.012 + tr * 0.002, 0.0, abs(r - 1.05));
                float dash = step(0.35, fract(ang / (2.0 * PI) * 48.0));
                float ring = band * dash;
                float behind = tr > hitT ? 0.2 : 1.0;
                res.r += ring * 0.8 * behind;
                res.g = max(res.g, ring * behind);
                res.b = max(res.b, ring * 0.5 * behind);
            }
        }
        gl_FragColor = vec4(res, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    float amt = clk.b * loss;
    // Signal loss: sharp on the hit, steadying over about half a second.
    float e = exp(-age * 6.0) * amt;
    float eSlow = exp(-age * 3.0) * amt;

    vec2 uv = isf_FragNormCoord;
    float top = 1.0 - uv.y;
    float fr = floor(TIME * 24.0);

    // The figure breaks into slices that slide apart.
    float sliceN = floor(mix(10.0, 40.0, hash11(n * 1.3)));
    float si = floor(top * sliceN + hash11(n + 4.0));
    float hs = hash21(vec2(si, n));
    float slide = (hs - 0.5) * 0.12 * e * step(0.45, hash21(vec2(si + 3.0, n + fr * 0.0)));
    float gone = step(hash21(vec2(si * 1.7, n + 9.0)), 0.35 * eSlow);
    // A steady fine wobble, like a projection through haze.
    float wob = sin(top * 90.0 + TIME * 3.0) * 0.0006 + sin(top * 13.0 - TIME * 1.7) * 0.0012;
    vec2 su = vec2(uv.x + slide + wob, uv.y);
    // During loss the figure jitters a little vertically.
    su.y += (hash11(fr + n) - 0.5) * 0.01 * e;

    // Colour fringe: the accent copy leads, a cooler copy trails.
    float fx = (0.002 + 0.006 * fringe) + 0.03 * e;
    vec3 hc = IMG_NORM_PIXEL(holo, su).rgb;
    vec3 ha = IMG_NORM_PIXEL(holo, su + vec2(fx, 0.0)).rgb;
    vec3 hb = IMG_NORM_PIXEL(holo, su - vec2(fx * 0.7, 0.0)).rgb;
    vec3 third = mix(ink.rgb, accent.rgb, 0.5).bgr * 0.5 + mix(ink.rgb, accent.rgb, 0.5) * 0.5;

    vec3 col = ink.rgb * hc.r;
    col = mix(col, accent.rgb * hc.r, clamp(hc.g * 0.6, 0.0, 1.0));
    col += accent.rgb * max(ha.r - hc.r, 0.0) * (0.45 + fringe * 0.6);
    col += third * max(hb.r - hc.r, 0.0) * (0.25 + fringe * 0.4);

    // The scan sweep: a bright line rises through the figure now and then.
    float period = mix(4.5, 1.2, sweep);
    float sw = fract(TIME / period + 0.3);
    float sweepY = mix(-0.1, 1.15, sw);
    float dSweep = uv.y - sweepY;
    float near = max(max(hc.b, ha.b), 0.0);
    col += ink.rgb * exp(-abs(dSweep) * 140.0) * (0.15 + 1.2 * near);
    col += accent.rgb * exp(-max(-dSweep, 0.0) * 18.0) * step(dSweep, 0.0) * near * 0.35;

    // Interference: two fine gratings beating against each other.
    vec2 fc = gl_FragCoord.xy;
    float g1 = cos((fc.y * 0.92 + fc.x * 0.05) * 1.1 + TIME * 2.0);
    float g2 = cos((fc.y * 1.0 - fc.x * 0.035) * 1.05 - TIME * 1.3);
    float moire = 0.5 + 0.5 * g1 * g2;
    col *= mix(1.0, 0.55 + 0.75 * moire, interference);
    // Slow broad bands of the projection brightening and fading.
    col *= 0.85 + 0.15 * sin(top * 7.0 - TIME * 1.1);

    // The projector below: a glowing pad and a faint cone of light.
    vec2 pc = vec2((uv.x - 0.5) * aspect, uv.y - 0.08);
    float pad = length(pc * vec2(1.0, 4.2));
    float padRing = exp(-abs(pad - 0.62) * 70.0) * 0.55 + exp(-abs(pad - 0.48) * 120.0) * 0.3 + exp(-pad * 6.0) * 0.12;
    col += mix(ink.rgb, accent.rgb, 0.35) * padRing * (0.8 + 0.2 * vxEnv);
    float coneH = uv.y - 0.08;
    if (coneH > 0.0) {
        float halfW = 0.62 - coneH * 0.25;
        float inCone = smoothstep(halfW, halfW - 0.25, abs(pc.x));
        col += ink.rgb * inCone * 0.05 * exp(-coneH * 2.0) * (0.7 + 0.3 * sin(pc.x * 60.0 + TIME));
    }

    // Loss: slices drop out, the image dims and stutters.
    col *= 1.0 - gone * 0.9;
    float dim = 1.0 - eSlow * 0.55 * step(0.4, hash11(fr * 1.3 + n));
    col *= dim;
    // A scatter of noise in the broken figure.
    col += ink.rgb * step(0.985, hash21(floor(fc / 3.0) + fr)) * e * near * 0.8;

    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
