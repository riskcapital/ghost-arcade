/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Thin rings of light nested one inside another like an armillary sphere, each spinning about its own tilted axis at its own rate, seen in depth so that the nearer arcs are brighter and the farther ones dim. A small bead of light runs round each ring, and a faint core glows at the center. The sound's clock turns the rings; its level brightens them and opens them a little. Each hit snaps one ring to a new tilt, lights it in the accent color, and makes every bead jump forward. With no sound the rings glow dim and turn very slowly.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "rings", "LABEL": "Rings", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "tiltSpread", "LABEL": "Tilt spread", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Rings", "TYPE": "color", "DEFAULT": [0.82, 0.9, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Struck ring", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Rings at most, and the short straight pieces each is first searched as.
const int MAX_RINGS = 11;
const int SEGS = 10;
const float TAU = 6.2831853;
// The eye's distance from the center (the outer ring's radius is 1) and the lens.
const float EYE = 3.4;
const float FOCAL = 1.38;

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

// A point in space as the eye sees it: (x, y on screen, depth).
vec3 seen(vec3 P) {
    return vec3(P.xy * (FOCAL / (EYE + P.z)), P.z);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow + TIME * 0.02;

    float count = floor(mix(7.0, float(MAX_RINGS) + 0.99, rings));
    // Each hit strikes the next ring in a fixed shuffled order. From the hit count alone, each
    // ring can then work out which hit struck it last (inv undoes the shuffle).
    float inv = count < 7.5 ? 6.0 : (count < 8.5 ? 5.0 : (count < 10.5 ? 7.0 : 6.0));
    float struck = mod(n * 13.0, count);

    // The whole instrument is seen a little from above.
    float tip = 0.42;
    mat3 view = mat3(1.0, 0.0, 0.0, 0.0, cos(tip), sin(tip), 0.0, -sin(tip), cos(tip));

    // Widths in pixels, kept in proportion on a larger or smaller picture.
    float res = RENDERSIZE.y / 1080.0;
    float wBase = 1.15 * res;
    float gw = mix(4.0, 16.0, glow) * max(res, 0.35);
    float haloAmt = 0.12 + 0.4 * glow;
    float reach = gw * 7.0;
    float spread = clamp(tiltSpread, 0.0, 1.0);
    float spinRate = mix(0.08, 1.3, spin);
    float open = 1.0 + 0.07 * sw;
    float dth = TAU / float(SEGS);
    float cd = cos(dth);
    float sd = sin(dth);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec3 col = vec3(0.0);
    float pr = length(p);

    for (int i = 0; i < MAX_RINGS; i++) {
        float fi = float(i);
        if (fi >= count) break;
        // Radii step outward, not quite evenly.
        float R = mix(0.26, 1.0, (fi + 0.35 * (hash11(fi * 4.1 + 2.0) - 0.5)) / (count - 1.0) + 0.02) * open;
        // No part of this ring or its glow can reach a pixel farther out than this.
        if ((pr - R * FOCAL / (EYE - R)) * RENDERSIZE.y > reach) continue;

        // The hit that last struck this ring gives it its tilt (hits before the count wrapped included).
        float back = mod(n - fi * inv, count);
        float seed = n - back;
        if (seed < 0.0) seed = 63.0 - mod(63.0 - fi * inv, count);
        float h1 = hash11(fi * 7.1 + seed * 3.3 + 0.7);
        float h2 = hash11(fi * 3.7 + seed * 5.9 + 4.2);
        float h3 = hash11(fi * 5.3 + 1.9);

        // The ring spins about an axis through its own rim. The axis leans away from upright by the ring's tilt.
        vec3 a = normalize(vec3((h1 - 0.5) * 3.2 * spread, 1.0, (h2 - 0.5) * 3.2 * spread));
        vec3 b = normalize(cross(a, vec3(0.0, 0.0, 1.0)));
        vec3 c = cross(a, b);
        float turnDir = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
        float alpha = flow * spinRate * turnDir * (0.3 + 0.7 * h3) + h3 * TAU + seed * 1.7;
        vec3 u = view * a * R;
        vec3 v = view * (sin(alpha) * b - cos(alpha) * c) * R;

        // Find the piece of the ring nearest this pixel on screen...
        float ck = 1.0;
        float sk = 0.0;
        vec2 prev = seen(u).xy;
        float best = 1e9;
        float theta = 0.0;
        for (int k = 0; k < SEGS; k++) {
            float cn = ck * cd - sk * sd;
            float sn = sk * cd + ck * sd;
            ck = cn;
            sk = sn;
            vec2 cur = seen(u * ck + v * sk).xy;
            vec2 ba = cur - prev;
            vec2 pa = p - prev;
            float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
            vec2 off = pa - ba * h;
            float d2 = dot(off, off);
            if (d2 < best) {
                best = d2;
                theta = (float(k) + h) * dth;
            }
            prev = cur;
        }
        // ...then close in on the true circle from there, so the ring is a clean curve. (Should
        // the closing-in ever stray, as it can at the tip of a ring seen edge on, the first find is kept.)
        vec3 S = seen(u * cos(theta) + v * sin(theta));
        float dBest = dot(S.xy - p, S.xy - p);
        float th = theta;
        for (int k = 0; k < 4; k++) {
            float ct = cos(th);
            float st = sin(th);
            vec3 P = u * ct + v * st;
            vec3 T = seen(P);
            vec2 off = T.xy - p;
            float dd = dot(off, off);
            if (dd < dBest) {
                dBest = dd;
                S = T;
                theta = th;
            }
            if (k == 3) break;
            vec3 dP = v * ct - u * st;
            vec2 dS = (dP.xy - T.xy * dP.z / FOCAL) * (FOCAL / (EYE + P.z));
            th -= clamp(dot(off, dS) / max(dot(dS, dS), 1e-9), -0.3, 0.3);
        }
        float d = sqrt(dBest) * RENDERSIZE.y;

        // Nearer arcs are brighter and a little thicker; nothing hides anything.
        float near = clamp(0.5 - S.z * 0.5, 0.0, 1.0);
        float bri = mix(0.2, 1.0, near * near);
        float w = max(wBase * (0.7 + 0.6 * near), 0.6);
        float sig = max(w, 0.85);
        float line = (w / sig) * exp(-(d * d) / (sig * sig));
        float fade = clamp(1.0 - d / reach, 0.0, 1.0);
        float halo = fade * fade / (1.0 + (d * d) / (gw * gw));

        // The bead: it runs round the ring, every hit throws it forward, and the ring is
        // brighter just behind it.
        float beadDir = -turnDir;
        float beta = beadDir * (flow * (0.5 + 0.6 * h3) + n * 0.9) + h3 * 40.0;
        vec3 B = seen(u * cos(beta) + v * sin(beta));
        float bd = length(B.xy - p) * RENDERSIZE.y;
        float bnear = clamp(0.5 - B.z * 0.5, 0.0, 1.0);
        float bw = (2.4 + 2.2 * bnear) * max(res, 0.5);
        float bfade = clamp(1.0 - bd / reach, 0.0, 1.0);
        float bead = exp(-(bd * bd) / (bw * bw)) + 0.5 * haloAmt * bfade * bfade / (1.0 + (bd * bd) / (gw * gw));
        float behind = fract((beta - theta) * beadDir / TAU);
        float wake = 1.0 + 1.3 * max(exp(-behind * 9.0), exp(-(1.0 - behind) * 140.0));

        // The ring the latest hit struck is lit in the accent color, and flares while the hit lasts.
        float hot = (n > 0.5 && fi == struck) ? 1.0 : 0.0;
        vec3 rc = mix(inkC, accC, hot);
        float level = (0.5 + 0.7 * sw) * (1.0 + hot * (0.25 + 1.3 * pu));
        col += rc * bri * wake * (line + haloAmt * halo) * level;
        col += mix(rc, vec3(1.0), 0.55) * bead * mix(0.35, 1.0, bnear) * (0.75 + 0.6 * sw + 0.9 * pu);
    }

    // The core: a small soft light at the center, swelling with the sound.
    float cr = pr * RENDERSIZE.y / max(res, 0.35);
    col += mix(inkC, vec3(1.0), 0.4) * (0.35 + 0.6 * sw + 0.4 * pu) * exp(-(cr * cr) / (22.0 * 22.0 * (1.0 + sw)));
    col += inkC * (0.035 + 0.05 * sw + 0.04 * glow) / (1.0 + (cr * cr) / (90.0 * 90.0));

    // Tone map on the brightest channel so the rings keep their color, then dither against banding.
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
