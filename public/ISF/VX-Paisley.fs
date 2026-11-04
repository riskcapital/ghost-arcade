/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A paisley rosette like a sixties poster border come to life: a ring of teardrops with curling tails turns around a jewelled centre, each one inked with bold outlines, nested bands, a ring of dots and a scalloped fringe. Every hit makes the teardrops unfurl, their tails flicking out long and straight before curling back, and kicks the rosette round a notch; held notes flare the fringe.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "unfurl", "LABEL": "Unfurl", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "curl", "LABEL": "Curl", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "fringe", "LABEL": "Fringe", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "drops", "LABEL": "Teardrops", "TYPE": "float", "DEFAULT": 5, "MIN": 3, "MAX": 8 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Teardrops", "TYPE": "color", "DEFAULT": [1.0, 0.55, 0.15, 1.0] },
        { "NAME": "accent", "LABEL": "Bands and fringe", "TYPE": "color", "DEFAULT": [0.2, 0.75, 0.85, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen (plus 1000), clock time of the last hit, its strength,
// turn of the rosette so far (eased towards on every hit).

const float TAU = 6.2831853;
const int MAXD = 8;

vec3 sat3(vec3 c, float s) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(l), c, s), 0.0);
}

vec2 rot(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// 0 outside an edge at e, 1 inside, antialiased over w.
float inside(float s, float e, float w) {
    return clamp((e - s) / w + 0.5, 0.0, 1.0);
}

void main() {
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        // The count is stored offset by 1000, so an all-zero texel (a voice
        // added mid-session) reads as fresh and starts with no hit pending.
        if (c.r < 500.0) c = vec4(vxCount + 1000.0, TIME - 30.0, 0.0, 0.0);
        if (abs(vxCount + 1000.0 - c.r) > 0.5) {
            c.g = TIME;
            c.b = mix(0.55, 1.0, clamp(vxVel, 0.0, 1.0));
            c.a = mod(c.a + 1.0, 64.0);
        }
        c.r = vxCount + 1000.0;
        gl_FragColor = c;
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = TIME - clk.g;
    if (age < 0.0) age = 30.0;
    // Unfurl: snaps open, then springs back with a little wobble.
    float op = clk.b * exp(-age * 2.6) * cos(age * 6.0);
    op = max(op, vxHit * 0.8) * unfurl;
    // Each hit turns the rosette a notch, eased.
    float n = floor(clamp(drops, 3.0, 8.0) + 0.5);
    float notch = (clk.a - 1.0 + smoothstep(0.0, 0.35, age)) * TAU / n * 0.5 * spin;

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = vxPhase * 0.02 * (0.3 + spin) + TIME * 0.03;
    float sc = 0.95 + 0.5 * size;
    p /= sc * (1.0 + 0.04 * vxEnv) / (1.0 + 0.25 * clamp(op, 0.0, 1.0));

    float rot0 = t + notch;
    vec2 pr = rot(p, -rot0);
    float rr = length(pr);

    // The rosette: teardrops on a ring, tails trailing round the centre.
    float Rr = 0.15;
    float r = 0.5 / (n + 1.6);
    float T = 3.0 + 1.5 * op;
    float cu = curl * 2.6 * (1.0 - 0.75 * clamp(op, 0.0, 1.0));
    float best = 1e3;
    float bphi = 0.0;
    float bi = 0.0;
    float bhead = 1e3;
    for (int i = 0; i < MAXD; i++) {
        float fi = float(i);
        if (fi >= n) break;
        float a = TAU * fi / n;
        vec2 c = vec2(cos(a), sin(a)) * Rr;
        // Local frame: tail along +x, pointing round the ring.
        vec2 q = rot(pr - c, -(a + 0.3));
        float lq = length(q);
        // Bend the tail so it hooks round.
        float bend = cu * max(lq - r * 0.8, 0.0) / r * 0.45;
        vec2 qb = rot(q, -bend);
        float ph = atan(qb.y, qb.x);
        float lobe = pow(0.5 + 0.5 * cos(ph), 14.0);
        float rho = r * (1.0 + T * lobe);
        float s = lq / rho;
        if (s < best) {
            best = s;
            bphi = ph;
            bi = fi;
            bhead = lq / r;
        }
    }

    float w = max(fwidth(best), 1e-4) * 0.8;
    vec3 c0 = sat3(ink.rgb, 1.15);
    vec3 c1 = sat3(accent.rgb, 1.15);
    vec3 deep = sat3(ink.rgb * accent.rgb + 0.04, 1.5);
    deep *= 0.55 / max(max(deep.r, deep.g), max(deep.b, 0.08));
    vec3 pale = mix(ink.rgb, vec3(1.0), 0.65);
    vec3 line = mix(c0, c1, 0.5) * 0.06;

    // Fringe: scallops round each teardrop that flare with the sound.
    float flare = fringe * (0.12 + 0.06 * vxEnv + 0.1 * clamp(op, 0.0, 1.0));
    float scal = 0.5 + 0.5 * cos(bphi * 22.0);
    float fe = 1.0 + flare * (0.35 + 0.65 * sqrt(scal)) * smoothstep(1.0, 0.0, abs(bphi) / 3.14159 - 0.2);
    float fringeIn = inside(best, fe, w);
    float bodyIn = inside(best, 1.0, w);

    // Inside the teardrop: bold outline, a band of dots, a stripe band, the eye.
    vec3 col = mix(line, c1, smoothstep(0.15, 0.45, scal));
    col = mix(col, line, bodyIn);
    col = mix(col, c0, inside(best, 0.9, w));
    // Dots riding round the outer band.
    float dotsN = 14.0;
    float dphi = fract(bphi / TAU * dotsN + 0.5) - 0.5;
    float dd = length(vec2(dphi * 0.38, (best - 0.79) * 1.4));
    col = mix(col, pale, inside(dd, 0.05, w * 1.2) * inside(best, 0.9, w));
    col = mix(col, line, inside(best, 0.66, w));
    // Stripe band, the second colour, with fine petal stripes.
    float stripes = 0.5 + 0.5 * cos(bphi * 18.0 + best * 6.0);
    vec3 band = mix(c1, deep, smoothstep(0.55, 0.75, stripes) * 0.7);
    col = mix(col, band, inside(best, 0.62, w));
    col = mix(col, line, inside(best, 0.42, w));
    col = mix(col, deep, inside(best, 0.38, w));
    // The eye: a jewel in the head, lit by the hit.
    float ein = inside(bhead, 0.36, w * 1.4);
    vec3 jewel = mix(deep * 1.4, pale, smoothstep(0.32, 0.0, bhead));
    jewel += c0 * clamp(op, 0.0, 1.0) * 0.6;
    col = mix(col, jewel, ein * inside(best, 0.4, w));
    float cover = fringeIn;

    // The centre: a medallion of rings and tiny petals.
    float cr = 0.065 * (1.0 + 0.2 * clamp(op, 0.0, 1.0));
    float ca = atan(pr.y, pr.x);
    float cs = rr / cr;
    float cw = max(fwidth(cs), 1e-4) * 0.8;
    float petal = 1.0 + 0.12 * (0.5 + 0.5 * cos(ca * n * 2.0));
    float medIn = inside(cs, petal, cw);
    vec3 med = line;
    med = mix(med, c1, inside(cs, petal - 0.12, cw));
    med = mix(med, line, inside(cs, 0.72, cw));
    med = mix(med, c0, inside(cs, 0.66, cw));
    med = mix(med, pale, inside(cs, 0.3, cw));
    col = mix(col, med, medIn);
    cover = max(cover, medIn);

    // Soft shading so the rosette reads as printed on a curved card.
    col *= 0.85 + 0.25 * (1.0 - smoothstep(0.0, 0.5, rr));
    col += c0 * 0.25 * clamp(vxHit, 0.0, 1.0) * cover;

    float halo = (1.0 - cover) * exp(-max(best - fe, 0.0) * 4.0) * 0.5 * (0.5 + 0.5 * vxEnv);

    float pres = vxPresence;
    vec4 outc;
    if (vxClear) {
        float aH = halo * 0.5;
        float a = cover + aH * (1.0 - cover);
        vec3 rgb = col * cover + c0 * aH * 0.9 * (1.0 - cover);
        outc = vec4(min(rgb, vec3(a)), a) * pres;
    } else {
        // Paper: a deep poster ground with a faint woven pattern.
        vec2 g = p * 18.0;
        float weave = 0.5 + 0.5 * sin(g.x + sin(g.y * 0.5)) * sin(g.y + sin(g.x * 0.5));
        vec3 bg = deep * (0.18 + 0.05 * weave) * (1.0 - smoothstep(0.3, 1.2, length(p)) * 0.6);
        bg += c0 * halo * 0.4;
        outc = vec4(mix(bg, col, cover) * pres, 1.0);
    }
    gl_FragColor = outc;
}
