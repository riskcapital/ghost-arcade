/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A colourizer in the manner of the early analog image processors. A slowly flowing field of soft light is sliced by a bank of comparators into bands, each keyed to its own level, alternating with black and edged with hairlines: a topographic map that flows. Each note moves the comparator thresholds by its pitch, so the contours jump and re-slice; the sound's level sets the contrast.",
    "PASSES": [
        {
            "TARGET": "czState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "czField",
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 8, "MIN": 6, "MAX": 10 },
        { "NAME": "fieldScale", "LABEL": "Field scale", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "edgeLines", "LABEL": "Edge lines", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "accentBand", "LABEL": "Accent band", "TYPE": "float", "DEFAULT": 0.75, "MIN": 0, "MAX": 1 },
        { "NAME": "thresholdShift", "LABEL": "Threshold shift", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "softness", "LABEL": "Comparator softness", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "smear", "LABEL": "Smear", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Ink", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// czState = (threshold shift now, its target, contrast, note count + 100).
// czField = the luma field, soft and smooth, at half size.

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// The source: three soft lights drifting on slow loops, a tilted ramp,
// and a low warp of noise, mixed as a video mixer would.
float lumaField(vec2 p, float t) {
    float sc = mix(1.6, 0.6, fieldScale);
    vec2 q = p * sc;
    vec2 w = vec2(noise2(q * 1.3 + vec2(t * 0.07, 3.1)), noise2(q * 1.3 + vec2(7.7, -t * 0.06))) - 0.5;
    q += w * 0.6;
    vec2 c1 = vec2(0.55 * sin(t * 0.13), 0.28 * sin(t * 0.17 + 1.0)) * sc;
    vec2 c2 = vec2(0.6 * sin(t * 0.09 + 2.1), 0.3 * cos(t * 0.11)) * sc;
    vec2 c3 = vec2(0.45 * cos(t * 0.07 + 4.0), 0.25 * sin(t * 0.15 + 2.6)) * sc;
    float g = exp(-dot(q - c1, q - c1) * 2.2) * 0.75
            + exp(-dot(q - c2, q - c2) * 4.0) * 0.55
            + exp(-dot(q - c3, q - c3) * 6.5) * 0.4;
    float ramp = 0.08 * (q.x * 0.5 + q.y * 0.8) / sc - 0.25 * dot(p, p);
    float n = noise2(q * 2.1 + vec2(-t * 0.05, t * 0.04)) * 0.18;
    return g + ramp + n;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 st = IMG_NORM_PIXEL(czState, vec2(0.5));
        bool ready = FRAMEINDEX >= 2 && st.w > 99.5;
        float count = floor(vxCount + 0.5);
        float shift = ready ? st.x : 0.0;
        float target = ready ? st.y : 0.0;
        if (ready && abs(count - (st.w - 100.0)) > 0.5) {
            // A note moves every threshold by its pitch: round the circle of
            // fifths, so neighbouring notes re-slice the map differently.
            float midi = floor(vxPitch * 127.0 + 0.5);
            target = mod(midi * 7.0, 12.0) / 12.0 + floor(midi / 12.0) * 0.37;
            target = fract(target);
        }
        // The contours jump: a fast glide, never a cut, along the short way round.
        float diff = target - shift;
        diff -= floor(diff + 0.5);
        shift = fract(shift + diff * (1.0 - exp(-dt / 0.07)));
        float con = ready ? st.z : 0.0;
        con += (vxEnv - con) * (1.0 - exp(-dt / (vxEnv > con ? 0.15 : 0.9)));
        gl_FragColor = vec4(shift, target, con, count + 100.0);
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX == 1) {
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        float t = vxPhase * mix(0.6, 4.0, flow);
        gl_FragColor = vec4(lumaField(p, t), 0.0, 0.0, 1.0);
        return;
    }

    vec4 st = IMG_NORM_PIXEL(czState, vec2(0.5));
    float con = smoothstep(0.0, 0.8, st.z);
    float nb = floor(bands + 0.5);
    // Threshold offset in bands.
    float off = st.x * thresholdShift;

    // A bandwidth-limited signal: a short smear trails each edge along the line.
    vec2 px = 1.0 / RENDERSIZE;
    float lum = IMG_NORM_PIXEL(czField, uv).r;
    float lumS = (IMG_NORM_PIXEL(czField, uv - vec2(px.x * 3.0, 0.0)).r + IMG_NORM_PIXEL(czField, uv - vec2(px.x * 7.0, 0.0)).r) * 0.5;
    lum = mix(lum, max(lum, lumS), smear * 0.6);

    // The comparator bank. Below the lowest threshold is black.
    float q = lum * nb * 0.95 + off - 1.6;
    float k = floor(q);
    float f = q - k;
    // Slope of the field from a wide central difference, so edge widths stay
    // smooth over the half-size field's texels.
    vec2 e = 1.5 / RENDERSIZE;
    float gx = IMG_NORM_PIXEL(czField, uv + vec2(e.x, 0.0)).r - IMG_NORM_PIXEL(czField, uv - vec2(e.x, 0.0)).r;
    float gy = IMG_NORM_PIXEL(czField, uv + vec2(0.0, e.y)).r - IMG_NORM_PIXEL(czField, uv - vec2(0.0, e.y)).r;
    float fw = max(length(vec2(gx, gy)) / 3.0 * nb * 0.95, 1e-4);
    float soft = fw * (0.8 + 4.0 * softness);
    // Smoothly switch levels across each threshold.
    float rise = smoothstep(0.0, soft, f);
    float kk = k;
    float lower = kk - 1.0;
    // Level of a band: alternating ink and black, ink bands brighter higher up.
    float lvlUp = (kk >= 0.0 && mod(kk, 2.0) > 0.5) ? (0.03 + 0.3 * pow(clamp(kk / nb, 0.0, 1.0), 1.5)) : 0.0;
    float lvlDn = (lower >= 0.0 && mod(lower, 2.0) > 0.5) ? (0.03 + 0.3 * pow(clamp(lower / nb, 0.0, 1.0), 1.5)) : 0.0;
    float level = mix(lvlDn, lvlUp, rise);
    float accIdx = 1.0 + 2.0 * floor(accentBand * (nb * 0.5 - 1.0) + 0.5);
    float isAcc = (abs(kk - accIdx) < 0.5 ? rise : 0.0) + (abs(lower - accIdx) < 0.5 ? 1.0 - rise : 0.0);
    // Contrast: quiet, the levels sink towards a dim even grey-green; loud, they spread.
    float lift = mix(0.25, 1.0, con);
    level *= lift;

    // Hairlines at every threshold.
    float dEdge = min(f, 1.0 - f) / fw;
    vec2 fwp = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float hair = (1.0 - smoothstep(0.25 * fwp.x, 0.85 * fwp.x, dEdge)) * step(-0.5, kk) * edgeLines * (0.25 + 0.55 * con);

    vec3 col = ink.rgb * level;
    col = mix(col, accent.rgb * level * 0.9, isAcc);
    col += ink.rgb * hair * 0.9;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
