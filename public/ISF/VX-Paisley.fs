/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A paisley rosette like a sixties poster border come to life: a ring of teardrops with curling tails turns around a jewelled centre, each one inked with bold outlines, nested bands, a ring of dots and a scalloped fringe. The music turns it: the louder it plays, the faster the rosette revolves; each hit flings the teardrops' tails out long and straight and lets them curl back, easing the rosette a little further round, and held notes flare the fringe and keep the tails open.",
    "PASSES": [
        {
            "TARGET": "ease",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 2,
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
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// ease (2x1): left texel, the pulse eased once more (quick and slow) and the
// swell, so the shapes they move glide rather than jump; right texel, the clock
// time of the last step (a redraw at the same time does not step).

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
        vec4 tk = IMG_NORM_PIXEL(ease, vec2(0.75, 0.5));
        float dt = clamp(TIME - tk.x, 0.0, 0.1);
        if (gl_FragCoord.x > 1.0) {
            gl_FragColor = vec4(TIME, dt, 0.0, 0.0);
            return;
        }
        vec4 e = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
        e.x += (vxPulse - e.x) * (1.0 - exp(-dt / 0.2));
        e.y += (vxSwell - e.y) * (1.0 - exp(-dt / 0.2));
        e.z += (vxPulse - e.z) * (1.0 - exp(-dt / 0.3));
        gl_FragColor = clamp(e, 0.0, 1.0);
        return;
    }
    vec4 ez = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
    // Eased once more: push (pulse, quick), sw (swell), slow (pulse, lingering).
    float push = ez.x;
    float sw = ez.y;
    float slow = ez.z;
    // Unfurl: hits fling the tails out long and they relax back; held sound keeps them open.
    float op = unfurl * (0.3 * vxPulse + 0.35 * push + 0.25 * slow + 0.3 * sw);
    float n = floor(clamp(drops, 3.0, 8.0) + 0.5);
    // Each hit eases the rosette a little further round (whole turns every 64 hits).
    float notch = vxMorph * TAU * 3.0 / 64.0;

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = vxFlow * (0.05 + 0.25 * spin);
    float sc = 0.95 + 0.5 * size;
    p /= sc * (1.0 + 0.05 * sw) / (1.0 + 0.25 * clamp(op, 0.0, 1.0));

    float rot0 = t + notch;
    vec2 pr = rot(p, -rot0);
    float rr = length(pr);

    // The rosette: teardrops on a ring, tails trailing round the centre.
    float Rr = 0.15;
    float r = 0.5 / (n + 1.6);
    float T = 3.0 + 1.5 * op;
    // The tails sway gently on the music's clock even when nothing plays.
    float cu = curl * 2.6 * (1.0 - 0.75 * clamp(op, 0.0, 1.0)) * (1.0 + 0.08 * sin(vxFlow * 1.3));
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
    float flare = fringe * (0.12 + 0.08 * sw + 0.1 * clamp(op, 0.0, 1.0));
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
    col += c0 * 0.25 * vxPulse * cover;

    float halo = (1.0 - cover) * exp(-max(best - fe, 0.0) * 4.0) * 0.5 * (0.5 + 0.4 * sw + 0.4 * push);

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
