/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A deep, slow flight through stars: several layers of sharp points at different depths drift toward you, the near ones faster, with a gentle sideways parallax. Each swell of the sound it follows draws the stars out into soft streaks toward the centre, then lets them settle back to points. A few rare stars burn gold.",
    "PASSES": [
        {
            "TARGET": "swellState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "density", "LABEL": "Density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "depthLayers", "LABEL": "Depth layers", "TYPE": "float", "DEFAULT": 5, "MIN": 3, "MAX": 8 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "warp", "LABEL": "Warp", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "twinkle", "LABEL": "Twinkle", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "starSize", "LABEL": "Star size", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "temperature", "LABEL": "Colour temperature", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Stars", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Gold stars", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// swellState: r = the sound's level eased in and let go slowly; g = the same
// over a much longer time. Their gap is the swell: it grows as the sound
// rises and relaxes even while it holds, so the warp never snaps or sticks.

// Stars per unit of screen height in the farthest layer.
const float GRID = 34.0;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hash32(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// Distance to a segment, and where along it the nearest point lies.
vec2 sdSegmentT(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float bb = max(dot(ba, ba), 1e-12);
    float t = clamp(dot(pa, ba) / bb, 0.0, 1.0);
    return vec2(length(pa - ba * t), t);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 st = IMG_NORM_PIXEL(swellState, vec2(0.5));
        if (FRAMEINDEX < 2) st = vec4(0.0);
        float level = clamp(vxEnv, 0.0, 1.0);
        float r = st.r + (level - st.r) * (1.0 - exp(-dt / (level > st.r ? 0.7 : 1.8)));
        float g = st.g + (r - st.g) * (1.0 - exp(-dt / 3.5));
        gl_FragColor = vec4(r, g, 0.0, 1.0);
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float px = max(fw.x, fw.y) / RENDERSIZE.y;

    // Flight: a whole number of layer cycles per phase wrap, so the wrap is seamless.
    float rate = floor(mix(10.0, 120.0, speed * speed)) / 1000.0;
    float travel = vxPhase * rate;
    // A slow sideways drift of the eye gives the layers parallax.
    vec2 eyeOff = vec2(sin(vxPhase * 0.031) * 0.6 + sin(vxPhase * 0.013 + 1.7) * 0.4, cos(vxPhase * 0.023 + 0.4) * 0.35) * 0.05;

    vec4 sw = IMG_NORM_PIXEL(swellState, vec2(0.5));
    float swell = clamp(0.25 * sw.r + 1.5 * max(sw.r - sw.g, 0.0), 0.0, 1.0);
    float stretch = smoothstep(0.02, 0.8, swell) * warp;
    // How far toward the centre a star's tail reaches, as a share of its distance.
    float tailShare = 1.0 - 1.0 / (1.0 + 0.09 * stretch);

    float N = floor(depthLayers + 0.5);
    float sigma0 = max(0.42, mix(0.42, 0.9, starSize));
    vec2 outward = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);

    vec3 col = vec3(0.0);
    for (int k = 0; k < 8; k++) {
        float fk = float(k);
        if (fk < N) {
            float cyc = travel + fk / N;
            float z = 1.0 - fract(cyc);
            float gen = floor(cyc);
            // Each pass of a layer brings a fresh set of stars.
            vec2 seed = vec2(fk * 17.31 + gen * 3.17, gen * 11.7 - fk * 5.3);
            float fadeIn = smoothstep(1.0, 0.72, z);
            float fadeNear = smoothstep(0.02, 0.12, z);
            float near = 1.0 - z;
            float cellScr = 1.0 / (GRID * z);
            vec2 q = (p * z + eyeOff) * GRID;
            vec2 c0 = floor(q);
            for (int j = 0; j < 4; j++) {
                vec2 off = vec2(j == 1 || j == 3 ? outward.x : 0.0, j >= 2 ? outward.y : 0.0);
                vec2 cell = c0 + off;
                vec3 h = hash32(cell + seed);
                if (h.x < density * 0.42) {
                    vec2 sq = cell + 0.15 + 0.7 * h.yz;
                    vec2 ps = (sq / GRID - eyeOff) / z;
                    // The warp draws each star back toward the centre, never past a cell.
                    float lenS = min(length(ps) * tailShare, 0.9 * cellScr);
                    vec2 tail = ps - normalize(ps + 1e-6) * lenS;
                    vec2 seg = sdSegmentT(p, ps, tail);
                    float t = seg.y;
                    float d = seg.x / px;
                    float h4 = hash21(cell + seed + 7.7);
                    float h5 = hash21(cell + seed + 3.1);
                    float mag = 0.3 + 1.6 * pow(h4, 7.0);
                    float sig = sigma0 * mix(1.0, 1.7, near * near) * (0.85 + 0.4 * pow(h4, 4.0));
                    float tw = 1.0 - twinkle * 0.55 * (0.5 + 0.5 * sin(vxPhase * (2.0 + 4.0 * h5) + h5 * 40.0));
                    // A streak keeps the star's light, spread thinner toward its tail.
                    float spreadL = 1.0 / (1.0 + lenS / (px * 12.0));
                    float along = mix(1.0, (0.55 + 0.45 * spreadL) * mix(1.0, 0.12, sqrt(t)), smoothstep(0.0, 2.0 * px, lenS));
                    float L = exp(-d * d / (2.0 * sig * sig)) * mag * tw * along * fadeIn * fadeNear * (0.35 + 0.9 * near);
                    // Colour temperature: hotter stars run whiter, cooler ones deeper in the ink.
                    float temp = (h5 - 0.5) * 2.0 * temperature;
                    vec3 tint = mix(ink.rgb, vec3(max(max(ink.r, ink.g), ink.b)), clamp(temp, 0.0, 1.0) * 0.6) * (1.0 - 0.25 * clamp(-temp, 0.0, 1.0));
                    bool gold = hash21(cell + seed + 13.3) < 0.018;
                    col += (gold ? accent.rgb * 1.15 : tint) * L;
                }
            }
        }
    }

    float gain = 0.5 + 1.4 * brightness;
    col = 1.0 - exp(-col * gain * 1.4);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
