/*{
    "DESCRIPTION": "A web. An orb web hung in the dark and lit from behind, every thread a hair of light, strung with dew. Its spokes are a little uneven, its rings sag between them, parts of it are torn, and it shivers when the air moves. Now and then it is plucked from somewhere out of frame and the tremor runs across it and dies. A second web hangs behind, out of focus. Bass shakes the web, beats pluck it, spectral centroid sets the wind.",
    "CREDIT": "Ghost Arcade Halloween pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Moon Silver", "Gaslight", "Frost", "Venom", "Widow", "Ultraviolet", "Ash"]},
        {"NAME": "spokes",    "TYPE": "float", "DEFAULT": 22.0, "MIN": 8.00, "MAX": 40.0},
        {"NAME": "rings",     "TYPE": "float", "DEFAULT": 22.0, "MIN": 6.00, "MAX": 50.0},
        {"NAME": "sag",       "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "uneven",    "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "tears",     "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "thread",    "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "dew",       "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "shiver",    "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "pluck",     "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "backlight", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "secondWeb", "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "size",      "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.40, "MAX": 2.50},
        {"NAME": "centreX",   "TYPE": "float", "DEFAULT": 0.56, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "centreY",   "TYPE": "float", "DEFAULT": 0.56, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * An orb web is two things: straight spokes from the hub, and one sticky
 * thread wound round and round across them. Between any two spokes the
 * winding thread is nearly straight, and under its own weight and the dew it
 * hangs in a shallow curve. So the web is described per sector: find which
 * two spokes a pixel lies between, how far across that gap it is, and the
 * ring threads there are simply radii, pulled inward in the middle of the
 * gap by the sag.
 *
 * Nothing is uniform in a real one. Each spoke is nudged off its even
 * angle, each ring thread in each sector sits a little off its radius, and
 * whole runs are missing where something flew through.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float w = 0.5;
    for (int i = 0; i < 4; i++) {
        v += w * noise2(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 7.7);
        w *= 0.5;
    }
    return v;
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

vec3 saturate3(vec3 c, float amount) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(g), c, amount), 0.0);
}


/* Columns: [thread, night, dew]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Gaslight */
        a = vec3(1.00, 0.82, 0.52); b = vec3(0.016, 0.010, 0.006); c = vec3(1.00, 0.94, 0.80);
    } else if (mode == 2) {     /* Frost */
        a = vec3(0.80, 0.92, 1.00); b = vec3(0.008, 0.014, 0.024); c = vec3(1.00, 1.00, 1.00);
    } else if (mode == 3) {     /* Venom */
        a = vec3(0.56, 1.00, 0.36); b = vec3(0.006, 0.016, 0.006); c = vec3(0.86, 1.00, 0.60);
    } else if (mode == 4) {     /* Widow - black web, red dew */
        a = vec3(0.50, 0.46, 0.48); b = vec3(0.012, 0.008, 0.010); c = vec3(1.00, 0.10, 0.10);
    } else if (mode == 5) {     /* Ultraviolet */
        a = vec3(0.70, 0.46, 1.00); b = vec3(0.010, 0.004, 0.028); c = vec3(0.90, 0.80, 1.00);
    } else if (mode == 6) {     /* Ash */
        a = vec3(0.70, 0.68, 0.64); b = vec3(0.020, 0.018, 0.016); c = vec3(0.92, 0.90, 0.86);
    } else {                    /* Moon Silver */
        a = vec3(0.74, 0.82, 0.96); b = vec3(0.006, 0.008, 0.018); c = vec3(0.96, 0.98, 1.00);
    }
    return mat3(a, b, c);
}

/* Light from one web. Returns (thread light, dew light). `blurPx` softens it for the far web. */
vec2 web(vec2 p, float nSpokes, float nRings, float seed, float pixel, float blurPx, float sagAmt, float unevenAmt, float tearAmt, float threadW, float dewAmt) {
    float r = length(p);
    float a = atan(p.y, p.x);
    float seg = TAU / nSpokes;
    float idx = floor(a / seg);
    /* The two spokes either side, each nudged off its even angle. */
    float a0 = (idx + (hash21(vec2(idx, seed)) - 0.5) * 0.7 * unevenAmt) * seg;
    float a1 = (idx + 1.0 + (hash21(vec2(idx + 1.0, seed)) - 0.5) * 0.7 * unevenAmt) * seg;
    if (a < a0) { idx -= 1.0; a1 = a0; a0 = (idx + (hash21(vec2(idx, seed)) - 0.5) * 0.7 * unevenAmt) * seg; }
    float f = clamp((a - a0) / max(a1 - a0, 1e-4), 0.0, 1.0);            /* 0 .. 1 across the gap */

    float w = pixel * (0.7 + 1.6 * threadW) + blurPx;
    /* Spokes. */
    float dSpoke = r * min(abs(sin(a - a0)), abs(sin(a1 - a)));
    float spokeLight = (1.0 - smoothstep(0.0, w, dSpoke)) * smoothstep(0.0, 0.02, r) * (1.0 - smoothstep(0.95, 1.05, r));

    /* Ring threads: radius pulled inward mid-gap by the sag. */
    float gap = 0.9 / nRings;
    float chord = cos((a1 - a0) * 0.5) / max(cos((a1 - a0) * (f - 0.5)), 0.2);     /* a straight thread between two spokes */
    float hang = 1.0 - sagAmt * 0.16 * sin(PI * f) * (a1 - a0) / seg;
    float rr = r / (chord * hang);
    float ringIdx = floor(rr / gap);
    float jitter = (hash21(vec2(ringIdx, idx + seed * 3.0)) - 0.5) * 0.5 * unevenAmt;
    float dRing = abs(rr - (ringIdx + 0.5 + jitter) * gap);
    /* No sticky thread at the hub or beyond the frame threads. */
    float zone = smoothstep(0.10, 0.14, r) * (1.0 - smoothstep(0.88, 0.92, r));
    /* Tears: whole sectors of rings missing, in patches. */
    float torn = step(1.0 - tearAmt * 0.5, noise2(vec2(idx * 0.45 + seed, ringIdx * 0.22)));
    float ringLight = (1.0 - smoothstep(0.0, w, dRing)) * zone * (1.0 - torn);

    /* Dew: beads along the ring threads, bigger where the thread hangs lowest. */
    float beads = 5.0 + floor(8.0 * r);
    float bf = fract(f * beads) - 0.5;
    float beadSize = (0.10 + 0.20 * hash21(vec2(floor(f * beads), ringIdx + idx * 7.0 + seed))) * dewAmt;
    float along = bf * (a1 - a0) * r / beads * beads;                     /* distance along the thread */
    float dBead = length(vec2(bf * (a1 - a0) * r, dRing));
    float beadR = beadSize * gap * 0.55;
    float bead = (1.0 - smoothstep(beadR * 0.5, beadR + blurPx, dBead)) * zone * (1.0 - torn);

    return vec2(max(spokeLight, ringLight * 0.8), bead);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    vec3 THREAD = hueRotate(pal[0], hueShift);
    vec3 NIGHT = pal[1];
    vec3 DEW = hueRotate(pal[2], hueShift);

    vec2 centre = vec2((centreX - 0.5) * aspect, centreY - 0.5);
    float unit = 0.62 * size;
    vec2 p = (uv - centre) / unit;
    float pixel = 1.0 / (res.y * unit);

    /* Wind: the whole web bellies and trembles. */
    float wind = shiver * (0.5 + 0.9 * centroid) * (0.6 + 0.9 * bass);
    vec2 sway = 0.020 * wind * vec2(sin(TIME * 1.7 + p.y * 3.0), cos(TIME * 2.1 + p.x * 3.0));
    sway += 0.006 * wind * vec2(sin(TIME * 13.0 + p.y * 17.0), cos(TIME * 11.0 + p.x * 19.0));
    /* A pluck: a tremor that starts at one edge and runs across. */
    float strike = TIME * 0.18 + beat * 0.3;
    float strikeId = floor(strike);
    float strikeAge = fract(strike);
    vec2 from = normalize(vec2(hash21(vec2(strikeId, 1.0)) - 0.5, hash21(vec2(strikeId, 2.0)) - 0.5));
    float travel = dot(p, from) + 1.0 - strikeAge * 3.0;
    sway += pluck * 0.035 * from.yx * vec2(1.0, -1.0) * sin(travel * 38.0) * exp(-travel * travel * 9.0) * (1.0 - strikeAge);
    p += sway * smoothstep(0.0, 0.5, length(p));

    vec3 col = NIGHT;
    /* The light behind: a soft bloom the web is seen against. */
    float behind = exp(-dot(p - vec2(0.25, 0.3), p - vec2(0.25, 0.3)) * 0.9);
    col += THREAD * behind * backlight * 0.060;

    /* The far web: bigger, off to one side, out of focus. */
    if (secondWeb > 0.01) {
        vec2 p2 = (uv - centre - vec2(-0.55 * aspect * 0.5, -0.22)) / (unit * 1.7) + sway * 0.5;
        vec2 far = web(p2, floor(spokes * 0.8), floor(rings * 0.8), 31.0, pixel / 1.7, 0.012, sag, uneven, tears, thread, dew);
        col += THREAD * far.x * 0.16 * secondWeb + DEW * far.y * 0.10 * secondWeb;
    }

    vec2 near = web(p, floor(spokes), floor(rings), 7.0, pixel, 0.0, sag, uneven, tears, thread, dew);
    /* Threads catch more light where they face it. */
    float catchLight = 0.45 + 0.75 * behind * backlight;
    col += THREAD * near.x * catchLight * (0.85 + 0.4 * level);
    /* Each bead is a lens: a hard point of light, twinkling as the web moves. */
    float twinkle = 0.6 + 0.4 * sin(TIME * 3.0 + dot(floor(p * 60.0), vec2(1.3, 2.1)) + length(sway) * 400.0);
    col += DEW * near.y * (0.9 + 1.4 * behind * backlight) * twinkle;

    col *= 1.0 - 0.35 * dot(uv * vec2(0.7, 1.0), uv * vec2(0.7, 1.0));
    col *= exposure * 1.15;
    col = col / (1.0 + 0.20 * col);
    col *= 1.20;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
