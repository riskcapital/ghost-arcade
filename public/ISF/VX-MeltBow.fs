/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A seventies poster rainbow that is melting: a fat striped arch with glossy bands and inked outlines, its legs and underside sagging into drips that stretch, swell into drops and let go. Every hit slides the colours a band along the arch, squashes it like jelly and lets it spring back, and sends fresh drips racing down; the louder the sound, the more it wobbles and the faster it melts. Colour shift: off, one band or two bands per hit.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "drip", "LABEL": "Drip", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "melt", "LABEL": "Melt", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "shift", "LABEL": "Colour shift", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "squash", "LABEL": "Squash", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 6, "MIN": 3, "MAX": 9 },
        { "NAME": "gloss", "LABEL": "Gloss", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Outer bands", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.2, 1.0] },
        { "NAME": "accent", "LABEL": "Inner bands", "TYPE": "color", "DEFAULT": [0.25, 0.6, 1.0, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const int MAX_BANDS = 9;
const int INNER_DRIPS = 5;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

vec3 sat3(vec3 c, float s) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(l), c, s), 0.0);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// A drip hanging from (x0, y0): a tapering column ending in a swelling drop
// that lets go and falls when the drip is long enough. u is its life, 0..1.
float dripSd(vec2 p, float x0, float y0, float w, float L, float u) {
    float grow = u < 0.78 ? pow(u / 0.78, 1.4) : 1.0 - (u - 0.78) / 0.22;
    float l = L * grow;
    float yEnd = y0 - l;
    float t = clamp((y0 - p.y) / max(l, 1e-4), 0.0, 1.0);
    float ww = w * (1.0 - 0.35 * t);
    float col = max(abs(p.x - x0) - ww, max(p.y - y0 - w, yEnd - p.y));
    float bulb = length(p - vec2(x0, yEnd)) - w * (1.0 + 0.45 * grow);
    float d = smin(col, bulb, w * 0.6);
    // The drop that let go, falling away.
    if (u > 0.78) {
        float f = (u - 0.78) / 0.22;
        vec2 dc = vec2(x0, y0 - L - 0.02 - f * f * 0.9);
        float dr = w * 1.4 * (1.0 - 0.3 * f) * smoothstep(1.0, 0.85, f);
        vec2 e = (p - dc) / vec2(dr * 0.9, dr * 1.15);
        d = min(d, (length(e) - 1.0) * dr);
    }
    return d;
}

vec3 bandColour(float i, vec3 c0, vec3 c1, vec3 mid, vec3 deep) {
    float k = mod(i, 6.0);
    if (k < 0.5) return c0;
    if (k < 1.5) return mix(c0, vec3(1.0), 0.45);
    if (k < 2.5) return mid;
    if (k < 3.5) return c1;
    if (k < 4.5) return mix(c1, vec3(1.0), 0.45);
    // The mix's complement, for a sixties clash.
    vec3 comp = sat3(vec3(1.0) - mid, 1.3);
    return comp * 0.95 / max(max(comp.r, comp.g), max(comp.b, 0.1));
}


void main() {
    float kick = vxPulse;
    float swl = vxSwell;
    // Jelly: each hit squashes the arch down and it relaxes as the pulse fades.
    float jel = squash * (0.85 * kick + 0.15 * swl);

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    p *= 0.86;
    float px = 0.86 / RENDERSIZE.y;
    // Wobble and drips run on the music's clock: they quicken as the sound rises.
    float t = vxFlow * (0.25 + 0.6 * melt);
    float td = vxFlow * (0.15 + 0.35 * melt);

    // The arch stands on a base line; squash about that line.
    float yb = -0.06;
    p.y = yb + (p.y - yb) / (1.0 - 0.12 * jel);
    p.x /= 1.0 + 0.08 * jel;
    // Melting wobble, stronger lower down and with the sound.
    float wob = (0.004 + 0.012 * melt) * (1.0 + 1.2 * swl + 0.8 * kick);
    p.x += wob * sin(p.y * 14.0 + t * 2.3) * (1.0 + smoothstep(0.2, -0.3, p.y) * 1.5);
    p.y += wob * 0.6 * sin(p.x * 11.0 - t * 1.7);

    float Ro = 0.38;
    float Ri = 0.15;
    float cy = yb + 0.07;
    vec2 q = p - vec2(0.0, cy);
    float xr = abs(q.x);
    float rr = q.y > 0.0 ? length(q) : xr;
    float d = max(rr - Ro, Ri - rr);
    d = max(d, yb - p.y);

    // Drips: from the legs' feet, carrying the leg's bands, and from the underside.
    float dl = 0.08 + 0.26 * drip;
    float boost = 1.0 + 0.5 * kick * drip;
    float bw = (Ro - Ri);
    float dd = 1e3;
    float nb = floor(clamp(bands, 3.0, 9.0) + 0.5);
    // One drip per band on each leg, so every colour runs.
    for (int i = 0; i < MAX_BANDS * 2; i++) {
        float fi = float(i);
        float side = i < MAX_BANDS ? -1.0 : 1.0;
        float j = mod(fi, float(MAX_BANDS));
        if (j >= nb) continue;
        float h = hash11(fi * 4.13 + 0.7);
        float x0 = side * (Ri + bw * (j + 0.5 + 0.12 * (h - 0.5)) / nb);
        float w = bw / nb * (0.3 + 0.12 * hash11(fi * 2.9));
        // Each hit glides the drips' lives forward an eighth, so fresh ones race down.
        float u = fract(td * (0.7 + 0.6 * h) + h + vxMorph * 0.125);
        dd = min(dd, dripSd(p, x0, yb, w, dl * (0.6 + 0.6 * hash11(fi * 7.7)) * boost, u));
    }
    for (int i = 0; i < INNER_DRIPS; i++) {
        float fi = float(i) + 20.0;
        float h = hash11(fi * 4.13 + 0.7);
        float x0 = (float(i) - 2.0) / 2.0 * Ri * 0.75 + (h - 0.5) * 0.02;
        float y0 = cy + sqrt(max(Ri * Ri - x0 * x0, 0.0));
        float w = 0.011 + 0.006 * hash11(fi * 2.9);
        float u = fract(td * (0.6 + 0.5 * h) + h + vxMorph * 0.125);
        dd = min(dd, dripSd(p, x0, y0, w, dl * 0.6 * (0.6 + 0.6 * hash11(fi * 7.7)) * boost, u));
    }
    d = smin(d, dd, 0.018);
    float cover = clamp(0.5 - d / px, 0.0, 1.0);

    // Bands: across the arch, straight down the legs and their drips.
    float s = clamp((rr - Ri) / bw, 0.0, 0.9999) * nb;
    float bi = floor(s);
    float bf = fract(s);
    // The colours slide along by (nearly) one band per hit, gliding with the hit
    // count; 64 hits make a whole number of palette turns, so the wrap is seamless.
    float sh = vxMorph * 0.9375 * floor(shift * 2.0 + 0.5);
    vec3 c0 = sat3(ink.rgb, 1.2);
    vec3 c1 = sat3(accent.rgb, 1.2);
    vec3 mid = sat3(mix(ink.rgb, accent.rgb, 0.5), 1.7);
    vec3 deep = sat3(ink.rgb * accent.rgb + 0.04, 1.5);
    deep *= 0.6 / max(max(deep.r, deep.g), max(deep.b, 0.08));
    float idx = nb - 1.0 - bi + sh;
    float i0 = floor(idx);
    vec3 bandA = bandColour(i0, c0, c1, mid, deep);
    vec3 bandB = bandColour(i0 + 1.0, c0, c1, mid, deep);
    vec3 col = mix(bandA, bandB, fract(idx));

    // Gloss: a highlight streak along each band and darker band edges.
    float ridge = 1.0 - abs(bf - 0.38) * 2.0;
    col *= 0.78 + 0.3 * smoothstep(0.0, 1.0, ridge);
    col += vec3(1.0) * gloss * 0.35 * exp(-pow((bf - 0.3) / 0.07, 2.0)) * (q.y > -0.05 ? 1.0 : 0.6);
    // Ink lines between bands.
    float sw = max(fwidth(s), 1e-4);
    float lineB = clamp(1.0 - min(bf, 1.0 - bf) / (sw * 1.3), 0.0, 1.0) * step(0.5, s) * step(s, nb - 0.5);
    vec3 inkLine = deep * 0.12;
    col = mix(col, inkLine, lineB * 0.9);
    // Drips are glossy too: a bright bead of light down their left side.
    float dripOnly = clamp(0.5 - dd / px, 0.0, 1.0) * smoothstep(yb - 0.005, yb - 0.03, p.y);
    col += vec3(1.0) * gloss * 0.25 * dripOnly * smoothstep(0.004, 0.0, abs(dd + 0.009));
    // Outline round the whole shape.
    col = mix(col, inkLine, clamp(1.0 + d / (px * 3.0), 0.0, 1.0) * 0.95);
    col += mid * kick * 0.3;

    float pres = vxPresence;
    vec4 outc;
    float shadow = exp(-max(d, 0.0) / 0.02) * (1.0 - cover);
    if (vxClear) {
        // A soft drop shadow keeps the cut-out legible over busy pictures.
        float aS = shadow * 0.45;
        float a = cover + aS * (1.0 - cover);
        vec3 rgb = col * cover;
        outc = vec4(min(rgb, vec3(a)), a) * pres;
    } else {
        // Poster ground: sunrise rings echoing the arch, in deep tones.
        vec2 g = p - vec2(0.0, cy);
        float ringC = 0.5 + 0.5 * sin(length(g * vec2(1.0, 1.15)) * 40.0 - t * 3.0);
        vec3 tint = mix(c0, c1, 0.5 + 0.5 * sin(atan(g.y, g.x) * 2.0 + t * 0.5));
        vec3 bg = mix(tint * 0.05, tint * 0.11, smoothstep(0.4, 0.6, ringC));
        bg *= 1.0 - 0.5 * smoothstep(0.3, 1.0, length(g));
        bg *= 1.0 - 0.6 * shadow;
        outc = vec4(mix(bg, col, cover) * pres, 1.0);
    }
    gl_FragColor = outc;
}
