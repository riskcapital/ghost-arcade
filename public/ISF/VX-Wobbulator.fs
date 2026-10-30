/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wobbulator: a raster of thin scan lines carrying a simple picture, its beam deflected by the note's own waveform at the moment the beam passes. Low notes bend the picture across many lines, high notes comb each line; where the beam slows the phosphor burns brighter. Collapse squeezes the raster into one dancing line.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "lines", "LABEL": "Lines", "TYPE": "float", "DEFAULT": 96, "MIN": 40, "MAX": 160 },
        { "NAME": "hDefl", "LABEL": "Horizontal deflection", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "vDefl", "LABEL": "Vertical deflection", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "harmonics", "LABEL": "Harmonics", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "collapse", "LABEL": "Collapse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "roll", "LABEL": "Roll", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "beam", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "picture", "LABEL": "Picture", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Ring", "Bars", "Gradient"] },
        { "NAME": "ink", "LABEL": "Beam", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Hot spots", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBar", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 }
    ]
}*/

const float TAU = 6.2831853;
// Most scan lines looked at for one pixel.
const int CAP = 48;
// Share of the frame the undeflected raster covers.
const float RASTER_W = 0.9;
const float RASTER_H = 0.86;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The note's waveform at a phase in cycles: a sine plus its 2nd to 4th
// harmonics (a soft sawtooth). Returns the value and its slope per cycle.
vec2 wave(float th) {
    float a = TAU * th;
    float s1 = sin(a);
    float c1 = cos(a);
    float s2 = 2.0 * s1 * c1;
    float c2 = c1 * c1 - s1 * s1;
    float s3 = s1 * c2 + c1 * s2;
    float c3 = c1 * c2 - s1 * s2;
    float s4 = 2.0 * s2 * c2;
    float c4 = c2 * c2 - s2 * s2;
    float h = harmonics;
    float norm = 1.0 / (1.0 + h * 1.08);
    float v = (s1 + h * (0.5 * s2 + 0.33 * s3 + 0.25 * s4)) * norm;
    float dv = TAU * (c1 + h * (c2 + c3 + c4)) * norm;
    return vec2(v, dv);
}

// The picture the beam carries, at a point of the undeflected raster.
// A faint field fades out towards the edges so the raster melts into black.
float pictureAt(float s, float yRest, float aspect) {
    vec2 q = vec2((s - 0.5) * RASTER_W * aspect, (yRest - 0.5) * RASTER_H);
    float r = length(q);
    float lum;
    if (picture == 1) {
        // Thin vertical bars.
        float b = 0.5 + 0.5 * cos(TAU * (s - 0.5) * 7.0);
        lum = pow(b, 16.0) * (1.0 - smoothstep(0.3, 0.42, abs(yRest - 0.5)));
    } else if (picture == 2) {
        // A ramp left to right inside a soft-edged window.
        float win = (1.0 - smoothstep(0.32, 0.45, abs(s - 0.5))) * (1.0 - smoothstep(0.3, 0.42, abs(yRest - 0.5)));
        lum = 0.75 * s * s * s * win;
    } else {
        // A bright thin ring with a fainter one inside.
        float d1 = (r - 0.28) / 0.02;
        float d2 = (r - 0.17) / 0.012;
        lum = exp(-d1 * d1) + 0.45 * exp(-d2 * d2);
    }
    float field = 0.06 * (1.0 - smoothstep(0.25, 0.75, r));
    return field + 0.94 * lum;
}

void main() {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float px = gl_FragCoord.x / RENDERSIZE.x;
    // Screen y, top down, like the beam.
    float py = 1.0 - gl_FragCoord.y / RENDERSIZE.y;

    float n = floor(clamp(lines, 40.0, 160.0));
    float hs = max(RASTER_H * (1.0 - collapse), 0.0015);

    // The note: cycles of its waveform per frame, from its pitch.
    float note = vxGlide > 0.02 ? vxGlide : 0.33;
    float perFrame = 2.0 * exp2((note * 127.0 - 36.0) / 12.0 * 1.4);
    // Cycles per line period: the beam's own time is line + position along it.
    // Collapsing also syncs the sweep to the note, so every line traces the
    // same stretch of waveform and they fuse into one dancing line.
    float c = perFrame / n;
    float cLine = c * (1.0 - collapse) + 0.0025 * collapse;
    float cAlong = mix(c, clamp(perFrame / 12.0, 1.0, 4.0), collapse * collapse);
    // The waveform drifts against the frame.
    float drift = vxPhase * 0.22;

    // Deflection: the sound's level drives the yoke; a hit snaps it.
    float amp = 0.25 + 0.75 * vxEnv + 0.5 * vxHit * vxHit;
    // The yoke is a coil: the higher the note, the less it swings.
    float coil = 1.0 / (1.0 + perFrame / 16.0);
    float h = harmonics;
    float slopeMax = TAU * cAlong * (1.0 + 3.0 * h) / (1.0 + 1.08 * h);
    // Keep the horizontal sweep moving forward so each line stays one stroke.
    float ah = min(hDefl * 0.09 * amp * coil, 0.8 * RASTER_W / max(slopeMax, 1e-4));
    float av = vDefl * 0.16 * amp * coil;
    // Collapsed, the vertical swing grows into the dancing line.
    av *= 1.0 + collapse * 1.5;

    // Roll: the raster slides down through the picture, a line per bar at the default.
    float rollOff = (vxBars + vxBar) * roll * 4.0;
    float rollFrac = fract(rollOff);
    float rollWhole = rollOff - rollFrac;

    // Lines that can reach this pixel. The core may store fewer pixels than
    // RENDERSIZE, so a beam is never drawn thinner than a stored pixel.
    float sigma = 0.55 + beam * 1.6;
    vec2 fwPx = max(fwidth(gl_FragCoord.xy), vec2(1e-3));
    float reach = av + (max(sigma, 0.8 * max(fwPx.x, fwPx.y)) * 4.0) / RENDERSIZE.y;
    float jLo = ((py - reach - 0.5) / hs + 0.5) * n - 0.5 - rollFrac;
    float jHi = ((py + reach - 0.5) / hs + 0.5) * n - 0.5 - rollFrac;
    jLo = max(jLo, -1.0);
    jHi = min(jHi, n - 1.0);
    // When the raster is squeezed, look at every k-th line (the same lines everywhere).
    float span = min(((2.0 * reach) / hs) * n + 2.0, n + 1.0);
    float stride = max(1.0, ceil(span / float(CAP)));
    float i0 = ceil(jLo / stride) * stride;

    float light = 0.0;
    for (int k = 0; k < CAP; k++) {
        float i = i0 + float(k) * stride;
        if (i > jHi) break;
        float rest = i + rollFrac;
        float yRest = (rest + 0.5) / n;
        float tLine = (i + rollWhole + rollFrac) * cLine + drift;
        // Where along its line was the beam when it crossed this column?
        float s = 0.5 + (px - 0.5) / RASTER_W;
        for (int it = 0; it < 3; it++) {
            float w0 = wave(tLine + s * cAlong).x;
            s = 0.5 + (px - 0.5 - ah * w0) / RASTER_W;
        }
        float bt = tLine + s * cAlong;
        vec2 wx = wave(bt);
        // The vertical coil gets the same sound a quarter cycle later.
        vec2 wy = wave(bt + 0.25);
        float y = 0.5 + (yRest - 0.5) * hs + av * wy.x;
        // Beam velocity, in pixels per line period.
        float dxp = (RASTER_W + ah * wx.y * cAlong) * RENDERSIZE.x;
        float dyp = (av * wy.y * cAlong) * RENDERSIZE.y;
        float slopeY = dyp / dxp;
        float across = 1.0 / sqrt(1.0 + slopeY * slopeY);
        float d = abs(py - y) * RENDERSIZE.y * across;
        // A stored pixel measured across the line; a wider beam keeps its light.
        float foot = abs(slopeY) * across * fwPx.x + across * fwPx.y;
        float sig = max(sigma, 0.8 * foot);
        // Thin core, faint tight halo.
        float prof = (exp(-d * d / (sig * sig)) + 0.05 * exp(-d / (sig * 2.5))) * sigma / sig;
        // A fast beam leaves less light per pixel.
        float speed = sqrt(dxp * dxp + dyp * dyp) / (RASTER_W * RENDERSIZE.x);
        float dwell = 1.0 / pow(max(speed, 0.35), 0.85);
        // Line ends ease in and out; lines rolling in and out fade.
        float ends = smoothstep(0.0, 0.015, s) * smoothstep(1.0, 0.985, s);
        float edge = clamp(rest + 1.0, 0.0, 1.0) * clamp(n - rest, 0.0, 1.0);
        light += pictureAt(s, yRest, aspect) * prof * dwell * ends * edge * stride;
    }

    // Phosphor: the beam saturates softly; where lines pile up it runs hot.
    float gain = 0.45 + 0.55 * clamp(vxEnv * 1.4, 0.0, 1.0);
    // Fused lines share their light.
    float lum = light * gain / (1.0 + collapse * collapse * n * 0.025);
    float hot = smoothstep(1.2, 2.6, lum);
    vec3 col = ink.rgb * tanh(lum) * (1.0 - 0.55 * hot) + accent.rgb * hot * 0.85;
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
