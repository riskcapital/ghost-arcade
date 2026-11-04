/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A kaleidoscope that blooms. Every frame the picture is folded into mirrored segments, carried outward through a curved lens, turned and stirred, so the light poured in at the centre - a turning rose of light and petals that orbit it - streams outward as layered, symmetrical echoes. The trails age through the palette's colours and catch light like glass. The music sets how fast it blooms and turns; the swell opens the rose; each hit punches the bloom outward, lurches the spin and flares the light, then it settles. Segments change smoothly as the hits add up.",
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/16", "HEIGHT": "$HEIGHT/16" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "bloom", "LABEL": "Bloom", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "segments", "LABEL": "Segments", "TYPE": "float", "DEFAULT": 6, "MIN": 3, "MAX": 12 },
        { "NAME": "echo", "LABEL": "Echo", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "relief", "LABEL": "Glass", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Colour drift", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "stir", "LABEL": "Stir", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.3, 0.8, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.6, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Rotate a colour's hue about the grey axis.
vec3 hueTurn(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// Fold a point into one mirrored kaleidoscope segment.
vec2 kaleido(vec2 p, float n) {
    float a = atan(p.y, p.x);
    float r = length(p);
    float seg = TAU / n;
    a = mod(a + seg * 0.5, seg) - seg * 0.5;
    a = abs(a);
    return vec2(cos(a), sin(a)) * r;
}

// The look's motion: where this pixel's light was last frame.
vec2 sourceOf(vec2 uv, float aspect, float t, float s) {
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(p);
    float level = clamp(vxLevel, 0.0, 3.0);
    float pulse = vxPulse;
    // Bloom: carried outward through a curved lens (faster further out),
    // punched by each hit and pushed by a part playing above its usual level.
    float rate = (0.002 + 0.01 * bloom) * max(0.25, 1.0 + 0.7 * (level - 1.0)) + 0.035 * bloom * pulse;
    float zoom = 1.0 + s * rate * (0.55 + 1.1 * r);
    // Spin: a slow turn of two mismatched speeds, lurching on hits.
    float turn = s * (0.0015 + 0.007 * spin) * (sin(t * 0.21) + 0.55 * sin(t * 0.083 + 1.7));
    turn += s * 0.018 * spin * pulse * (fract(vxMorph * 0.5) < 0.5 ? 1.0 : -1.0) * smoothstep(0.0, 0.3, pulse);
    p = rot2(turn) * p / zoom;
    // Stir: soft eddies that swell with the music.
    vec2 q = p * 4.0;
    vec2 eddy = vec2(sin(q.y * 1.3 + t * 0.61) + 0.6 * sin(q.y * 2.7 - q.x + t * 0.37),
                     cos(q.x * 1.5 - t * 0.53) + 0.6 * cos(q.x * 2.3 + q.y - t * 0.41));
    p += eddy * s * 0.0009 * stir * (1.0 + 1.5 * vxSwell + 3.0 * pulse);
    // Fold into segments: the count glides between whole numbers as hits add up.
    float n = clamp(segments, 3.0, 12.0);
    vec2 a = kaleido(p, floor(n));
    p = a;
    return p / vec2(aspect, 1.0) + 0.5;
}

// The look's new light: a turning rose curve and petals orbiting it.
vec3 pourIn(vec2 p, float t, out float cover) {
    float r = length(p);
    float a = atan(p.y, p.x);
    float open = 0.08 + 0.1 * vxSwell + 0.06 * vxPulse;
    float k = 3.0 + floor(mod(vxMorph * 0.25, 3.0)) * 0.0;
    // Rose curve r = open * cos(k * (a - spin)), drawn as a soft line.
    float petalsK = 2.5 + 1.5 * (0.5 + 0.5 * sin(vxMorph * 0.39));
    float rr = open * abs(cos(petalsK * (a - t * 0.4)));
    float d = abs(r - rr);
    float line = exp(-d * d / (0.0025 * 0.0025 + 0.00003 * vxPulse)) * smoothstep(0.0, 0.02, r);
    vec3 col = mix(ink.rgb, accent.rgb, 0.5 + 0.5 * sin(a * 2.0 + t * 0.7)) * line * (0.25 + 0.45 * vxSwell + 0.8 * vxPulse);
    // Orbiting petals.
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float ang = t * (0.9 + 0.23 * fi) * (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0) + fi * 1.57;
        vec2 c = vec2(cos(ang), sin(ang)) * (open * 1.6 + 0.02 * sin(t + fi));
        vec2 dv = p - c;
        vec2 dl = rot2(-ang) * dv;
        float e = length(dl / vec2(0.016 + 0.01 * vxPulse, 0.006));
        col += mix(accent.rgb, ink.rgb, fi / 3.0) * exp(-e * e) * (0.3 + 0.7 * vxPulse + 0.25 * vxSwell);
    }
    // A hit flares a soft core of light.
    col += mix(ink.rgb, accent.rgb, 0.5) * exp(-r * r / (0.0008 + 0.002 * vxPulse)) * vxPulse * 0.5;
    cover = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxFlow;
    float s = frameStep();

    if (PASSINDEX == 0) {
        // Quarter-size blur of last frame.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 3.0);
            acc += IMG_NORM_PIXEL(feedback, uv + vec2(float(i), float(j)) * px * 4.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 1) {
        // A much wider blur, for the deep glow.
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float ws = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            float w = exp(-float(i * i + j * j) / 4.0);
            acc += IMG_NORM_PIXEL(blurA, uv + vec2(float(i), float(j)) * px * 16.0) * w;
            ws += w;
        }
        gl_FragColor = acc / ws;
        return;
    }
    if (PASSINDEX == 2) {
        vec2 src = sourceOf(uv, aspect, t, s);
        // Stream along the image's own contours (perpendicular to its gradient).
        vec2 bpx = 4.0 / RENDERSIZE;
        float gx = luma(IMG_NORM_PIXEL(blurA, src + vec2(bpx.x, 0.0)).rgb) - luma(IMG_NORM_PIXEL(blurA, src - vec2(bpx.x, 0.0)).rgb);
        float gy = luma(IMG_NORM_PIXEL(blurA, src + vec2(0.0, bpx.y)).rgb) - luma(IMG_NORM_PIXEL(blurA, src - vec2(0.0, bpx.y)).rgb);
        src += vec2(-gy, gx) * s * 0.004 * stir * (1.0 + vxSwell + 2.0 * vxPulse);
        vec4 prev = clamp(IMG_NORM_PIXEL(feedback, src), 0.0, 1.0);
        // Age through the palette: turn the hue a little each second.
        prev.rgb = clamp(hueTurn(prev.rgb, s * 0.004 * drift * (1.0 + vxSwell)), 0.0, 1.0);
        // Fade: Echo sets how long the past lingers. Always at least a frame's worth.
        float keep = pow(mix(0.9, 0.978, echo) + 0.006 * vxSwell, max(s, 1.0));
        vec4 col = max(prev * keep - vec4(0.0015 * max(s, 1.0)), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        float cv;
        vec3 add = pourIn(p, t, cv);
        col.rgb = col.rgb + add * (1.0 - col.rgb);
        col.a = clamp(col.a + cv * (1.0 - col.a), 0.0, 1.0);
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture: glass-like relief lit from above-left, with a deep glow.
    vec4 fb = IMG_NORM_PIXEL(feedback, uv);
    vec2 bpx = 4.0 / RENDERSIZE;
    float hx = luma(IMG_NORM_PIXEL(blurA, uv + vec2(bpx.x, 0.0)).rgb) - luma(IMG_NORM_PIXEL(blurA, uv - vec2(bpx.x, 0.0)).rgb);
    float hy = luma(IMG_NORM_PIXEL(blurA, uv + vec2(0.0, bpx.y)).rgb) - luma(IMG_NORM_PIXEL(blurA, uv - vec2(0.0, bpx.y)).rgb);
    vec3 n = normalize(vec3(-hx * 6.0, -hy * 6.0, 1.0));
    vec3 L = normalize(vec3(-0.45, 0.6, 0.65));
    float lit = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
    vec3 glow = IMG_NORM_PIXEL(blurB, uv).rgb;
    vec3 base = fb.rgb * mix(1.0, 0.55 + 0.75 * lit, relief) + spec * relief * 0.6 * smoothstep(0.02, 0.2, luma(fb.rgb));
    vec3 light = base * 1.3 + glow * (0.18 + 0.2 * vxSwell + 0.35 * vxPulse);
    vec3 col = 1.0 - exp(-light * 1.5);
    // A firmer curve: deep blacks between the streams, so it never reads foggy.
    col = col * col * (3.0 - 2.0 * col);
    float alpha = 1.0;
    if (vxClear) {
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.3, 0.0, 1.0);
    } else {
        vec3 bg = mix(vec3(0.008, 0.009, 0.016), mix(ink.rgb, accent.rgb, 0.5) * 0.025, 0.6);
        col = bg + col * (1.0 - bg);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
