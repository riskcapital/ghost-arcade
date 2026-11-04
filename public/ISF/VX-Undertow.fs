/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Light poured into a slowly turning current. Every frame the picture is carried a little inward, twisted and stirred, and it drifts along its own contours, so what you see is the music's last few seconds folding over itself. A ring of light breathes with the sound and sheds its colour into the current; points of light circle it and leave trails. The music sets how fast the current turns and pulls, the swell widens the ring, and each hit throws a bright pulse into the stream.",
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "pull", "LABEL": "Pull", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "twist", "LABEL": "Twist", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "stir", "LABEL": "Stir", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "memory", "LABEL": "Memory", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "contour", "LABEL": "Contour flow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ringSize", "LABEL": "Ring", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.35, 0.85, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Second light", "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.75, 1.0] },
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

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

// Frames' worth of time this frame took (1 at 60 fps), so every rate below
// is per second and the look runs the same at any frame rate.
float frameStep() {
    return clamp(TIMEDELTA * 60.0, 0.25, 4.0);
}

// Where this pixel's light came from last frame: the current's motion.
vec2 currentSource(vec2 uv, float aspect, float t, float s) {
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(p);
    float level = clamp(vxLevel, 0.0, 3.0);
    // Pull toward the centre, stronger when the part plays above its usual level.
    float zoom = 1.0 + s * (0.001 + 0.004 * pull) * max(0.2, 1.0 + 0.8 * (level - 1.0) + 2.0 * vxPulse);
    // A slow turn that never quite repeats (two mismatched speeds), more at the rim.
    float turn = s * (0.0012 + 0.006 * twist) * (sin(t * 0.137) + 0.6 * sin(t * 0.0613 + 2.1)) * (0.6 + 0.8 * r);
    turn += s * 0.004 * twist * vxPulse * sin(vxMorph * 0.9);
    float c = cos(turn);
    float sn = sin(turn);
    p = mat2(c, sn, -sn, c) * p / zoom;
    // Stir: a soft field of eddies drifting with the music's clock.
    vec2 q = p * 3.1;
    vec2 eddy = vec2(sin(q.y * 1.7 + t * 0.53) + 0.5 * sin(q.y * 3.3 - t * 0.29 + q.x),
                     cos(q.x * 1.9 - t * 0.47) + 0.5 * cos(q.x * 2.9 + t * 0.37 - q.y));
    p += eddy * s * 0.0011 * stir * (1.0 + 1.2 * vxSwell + 2.0 * vxPulse);
    return p / vec2(aspect, 1.0) + 0.5;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxFlow;
    float s = frameStep();

    // Pass 0: a quarter-size blurred copy of last frame, for the contour flow and the glow.
    if (PASSINDEX == 0) {
        vec2 px = 1.0 / RENDERSIZE;
        vec4 acc = vec4(0.0);
        float wsum = 0.0;
        for (int j = -2; j <= 2; j++) {
            for (int i = -2; i <= 2; i++) {
                float w = exp(-float(i * i + j * j) / 3.0);
                acc += IMG_NORM_PIXEL(feedback, uv + vec2(float(i), float(j)) * px * 4.0) * w;
                wsum += w;
            }
        }
        gl_FragColor = acc / wsum;
        return;
    }

    // Pass 1: the feedback image. Carry last frame along the current, let it
    // drift along its own contours, let it fade, then pour in new light.
    if (PASSINDEX == 1) {
        vec2 src = currentSource(uv, aspect, t, s);
        // Contour flow: move along the blurred image's contour lines (at right
        // angles to its gradient), so shapes stream and curl into themselves.
        vec2 bpx = 4.0 / RENDERSIZE;
        float gx = luma(IMG_NORM_PIXEL(blurA, src + vec2(bpx.x, 0.0)).rgb) - luma(IMG_NORM_PIXEL(blurA, src - vec2(bpx.x, 0.0)).rgb);
        float gy = luma(IMG_NORM_PIXEL(blurA, src + vec2(0.0, bpx.y)).rgb) - luma(IMG_NORM_PIXEL(blurA, src - vec2(0.0, bpx.y)).rgb);
        vec2 along = vec2(-gy, gx);
        src += along * s * 0.006 * contour * (1.0 + vxSwell);
        vec4 prev = IMG_NORM_PIXEL(feedback, src);
        // A touch of sharpening against the blur keeps the streams crisp.
        vec4 soft = IMG_NORM_PIXEL(blurA, src);
        // Sharpen brightness only (per channel it overshoots into stray colours).
        float detail = luma(prev.rgb) - luma(soft.rgb);
        prev.rgb *= 1.0 + clamp(detail * 0.5 * s, -0.08, 0.08);
        // Fade per second: Memory sets how long the past lingers (~1-6 s).
        float keep = pow(mix(0.9, 0.975, memory) + 0.008 * vxSwell, s);
        vec4 col = max(prev * keep - vec4(0.002 * s), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);

        // New light: a ring that breathes with the sound, its edge rippling.
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        float r = length(p);
        float a = atan(p.y, p.x);
        float baseR = (0.1 + 0.18 * ringSize) * (1.0 + 0.45 * vxSwell + 0.35 * vxPulse);
        float ripple = 0.02 * (0.4 + vxSwell) * sin(a * 5.0 + t * 1.3) + 0.008 * sin(a * 3.0 - t * 0.9 + vxMorph);
        float d = abs(r - baseR - ripple * baseR * 4.0);
        float width = 0.0025 + 0.004 * vxPulse;
        float ringLight = smoothstep(width * 2.0, 0.0, d) * (0.1 + 0.32 * vxSwell + 0.55 * vxPulse);
        float hueSwing = 0.5 + 0.5 * sin(a * 2.0 + t * 0.41);
        vec3 ringCol = mix(ink.rgb, accent.rgb, hueSwing);
        // Points of light circling the ring, leaving trails in the current.
        vec3 dots = vec3(0.0);
        for (int k = 0; k < 5; k++) {
            float fk = float(k);
            float ang = t * (0.55 + 0.17 * fk) * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0) + fk * 1.256;
            vec2 c = vec2(cos(ang), sin(ang)) * baseR * (1.35 + 0.25 * sin(t * 0.3 + fk));
            float dd = length(p - c);
            float sz = 0.004 + 0.006 * vxPulse;
            dots += mix(accent.rgb, ink.rgb, fk / 4.0) * exp(-dd * dd / (sz * sz)) * (0.25 + 0.5 * vxPulse + 0.2 * vxSwell);
        }
        vec3 add = ringCol * ringLight + dots;
        // Lay it in like light (never past white), with coverage for the cut-out.
        col.rgb = col.rgb + add * (1.0 - col.rgb);
        col.a = clamp(col.a + max(add.r, max(add.g, add.b)) * (1.0 - col.a), 0.0, 1.0);
        gl_FragColor = col;
        return;
    }

    // Pass 2: the picture: the feedback image toned, with a soft glow.
    vec4 fb = IMG_NORM_PIXEL(feedback, uv);
    vec3 glow = IMG_NORM_PIXEL(blurA, uv).rgb;
    vec3 light = fb.rgb * 1.25 + glow * 0.35;
    vec3 col = 1.0 - exp(-light * 1.6);
    float alpha = 1.0;
    if (vxClear) {
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.35, 0.0, 1.0);
    } else {
        // A deep background tinted by the light, so it reads as a space.
        vec3 bg = mix(vec3(0.01, 0.012, 0.02), ink.rgb * 0.03, 0.5);
        col = bg + col * (1.0 - bg);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
