/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A ripple tank drawn as fine contour lines of the water's height. Each hit of the sound it follows sets one of the point sources ringing, taking turns, and the circular wave trains cross and interfere into moire bands; the highest crests are marked in the accent.",
    "PASSES": [
        {
            "TARGET": "hits",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 24,
            "HEIGHT": 24
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "sources", "LABEL": "Sources", "TYPE": "float", "DEFAULT": 2, "MIN": 2, "MAX": 4 },
        { "NAME": "spacing", "LABEL": "Source spacing", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "waveSpeed", "LABEL": "Wave speed", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "wavelength", "LABEL": "Wavelength", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "damping", "LABEL": "Damping", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "contours", "LABEL": "Contours", "TYPE": "float", "DEFAULT": 6, "MIN": 2, "MAX": 14 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Contours", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Crests", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// hits: a 3 x 3 grid of cells, 8 x 8 texels each, read at their centres. Cells 0..7
// hold the newest hits as (whole seconds of age, fraction of a second, velocity,
// source + 1); cell 8 holds (last count + 1, 0, 0, 0).
const float CELLS = 3.0;
const float TAU = 6.2831853;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 cellAt(float i) {
    return IMG_NORM_PIXEL(hits, vec2((mod(i, CELLS) + 0.5) / CELLS, (floor(i / CELLS) + 0.5) / CELLS));
}

float sourceCount() {
    return floor(clamp(sources, 2.0, 4.0) + 0.5);
}

// Two sources side by side; three in a triangle; four in a diamond.
vec2 sourcePos(float i, float ns) {
    float d = mix(0.12, 0.42, spacing);
    if (ns < 2.5) return vec2(i < 0.5 ? -d : d, 0.0);
    float a = TAU * i / ns + (ns < 3.5 ? TAU * 0.25 : 0.0);
    return d * vec2(cos(a), sin(a)) * vec2(1.15, 0.9);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float ci = floor(uv.x * CELLS) + CELLS * floor(uv.y * CELLS);
        vec4 meta = cellAt(8.0);
        float n = floor(vxCount + 0.5);
        bool ready = meta.x > 0.5 && FRAMEINDEX >= 2;
        bool fresh = ready && abs(meta.x - (n + 1.0)) > 0.5;
        if (ci < 7.5) {
            vec4 s = cellAt(ci);
            if (!ready) {
                s = vec4(0.0);
            } else {
                s.y += dt;
                if (s.y >= 1.0) {
                    s.y -= 1.0;
                    s.x = min(s.x + 1.0, 60.0);
                }
            }
            // Hits take turns round the sources.
            if (fresh && abs(ci - mod(n, 8.0)) < 0.5) s = vec4(0.0, 0.0, clamp(vxVel, 0.2, 1.0), mod(n, sourceCount()) + 1.0);
            gl_FragColor = s;
        } else {
            gl_FragColor = vec4(n + 1.0, 0.0, 0.0, 0.0);
        }
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float pxs = max(1.0, max(fwp.x, fwp.y));
    float px = pxs / RENDERSIZE.y;
    float ns = sourceCount();

    float c = mix(0.18, 0.7, waveSpeed);
    float lam = mix(0.045, 0.16, wavelength);
    float k = TAU / lam;
    float om = k * c;
    float T = mix(2.2, 0.45, damping);
    float alpha = mix(0.4, 2.6, damping);

    // Height: every hit rings its source for a while; the ring leaves at the wave speed,
    // spreads and dies away with distance.
    float h = 0.0;
    float envSum = 0.0;
    for (int i = 0; i < 8; i++) {
        vec4 s = cellAt(float(i));
        if (s.w > 0.5) {
            float age = s.x + s.y;
            vec2 sp = sourcePos(s.w - 1.0, ns);
            float r = length(p - sp);
            float tau = age - r / c;
            if (tau > 0.0) {
                float spread = 1.0 / sqrt(1.0 + r / 0.06);
                float env = s.z * exp(-tau / T) * spread * exp(-r * alpha) * smoothstep(0.0, 0.04, tau);
                h += env * sin(om * tau);
                envSum += env;
            }
        }
    }
    // At rest each source still trembles, a few faint rings and no more.
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        if (fi < ns) {
            vec2 sp = sourcePos(fi, ns);
            float r = length(p - sp);
            float env = 0.42 / sqrt(1.0 + r / 0.05) * exp(-r * 5.0);
            h += env * sin(TAU * (vxPhase * 1.4 + fi * 0.37) - k * r);
            envSum += env;
        }
    }

    // Contours: lines at even steps of height. The zero line only shows where waves are.
    float levels = floor(contours + 0.5);
    float step0 = 1.2 / levels;
    float q = h / step0;
    float fw = max(fwidth(q), 1e-5);
    float d = abs(fract(q + 0.5) - 0.5) / fw;
    float w = mix(0.55, 1.4, lineWidth);
    float line = exp(-d * d / (w * w)) * (1.0 - smoothstep(0.35, 0.6, fw));
    float lvl = floor(q + 0.5);
    float zeroOk = smoothstep(1.5 * step0, 3.0 * step0, envSum);
    line *= lvl == 0.0 ? zeroOk * 0.4 : 1.0;
    // Troughs a touch dimmer than crests, so the field has a lit side.
    float tone = lvl > 0.0 ? 1.0 : (lvl < 0.0 ? 0.62 : 0.5);
    // Constructive peaks: the highest crests change to the accent.
    float peak = smoothstep(levels * 0.4, levels * 0.6, lvl);
    vec3 col = mix(ink.rgb * tone, accent.rgb, peak) * line;

    // The sources: small rings at the dippers.
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        if (fi < ns) {
            float ds = abs(length(p - sourcePos(fi, ns)) - 0.008) / px;
            col += ink.rgb * exp(-ds * ds / 0.6) * 0.5;
        }
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
