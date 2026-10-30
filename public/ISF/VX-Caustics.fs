/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Light on the floor of still water: a slow net of thin caustic filaments on a dark floor that fades away into the depth. Every strike of the sound it follows drops a ring on the surface that rolls outward, bending the light as it passes, then the water calms. The brightest crossings of the net burn gold.",
    "PASSES": [
        {
            "TARGET": "rippleState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH",
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 10, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "scale", "LABEL": "Scale", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "sharpness", "LABEL": "Sharpness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "rippleStrength", "LABEL": "Ripple strength", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "rippleSpeed", "LABEL": "Ripple speed", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "calm", "LABEL": "Calm time", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "depthFade", "LABEL": "Depth fade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Crossings", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.47, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// rippleState: slots 0..5 hold the newest strikes as (floor x, floor y, age
// in seconds, strength); slot 6 holds (last count + 1, ready). Each slot is
// a seventh of the target wide and read at its centre.
const float SLOTS = 6.0;
const float STATE_W = 7.0;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
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

vec4 slotAt(float i) {
    return IMG_NORM_PIXEL(rippleState, vec2((i + 0.5) / STATE_W, 0.5));
}

// One caustic net: the gap between the nearest and second-nearest of a field
// of slowly orbiting points. Zero on the net, growing into the dark cells.
float net(vec2 p, float t, float seed) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 h = hash22(i + g + seed);
            vec2 o = 0.5 + 0.38 * sin(t * (0.6 + 0.8 * h.yx) + 6.2832 * h);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < d1) {
                d2 = d1;
                d1 = d;
            } else if (d < d2) {
                d2 = d;
            }
        }
    }
    return sqrt(d2) - sqrt(d1);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float me = floor(uv.x * STATE_W);
        vec4 meta = slotAt(SLOTS);
        float n = floor(vxCount + 0.5);
        bool ready = meta.y > 0.5 && FRAMEINDEX >= 2;
        bool fresh = ready && abs(meta.x - (n + 1.0)) > 0.5;
        if (me < SLOTS) {
            vec4 s = slotAt(me);
            s.z = min(s.z + dt, 30.0);
            if (!ready) s = vec4(0.0, 0.0, 30.0, 0.0);
            if (fresh && abs(me - mod(n, SLOTS)) < 0.5) {
                // Each strike lands somewhere new near the middle; pitch leans it sideways.
                vec2 at = vec2((hash11(n * 3.17 + 1.0) - 0.5) * 0.9 + (vxGlide - 0.5) * 0.8,
                               (hash11(n * 7.31 + 4.0) - 0.5) * 0.5 + 0.05);
                s = vec4(at, 0.0, clamp(vxVel, 0.2, 1.0));
            }
            gl_FragColor = s;
        } else {
            gl_FragColor = vec4(n + 1.0, 1.0, 0.0, 1.0);
        }
        return;
    }

    // The floor, seen at a slant: further away toward the top of the frame.
    vec2 sp = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float w = 1.0 / (1.0 - 0.95 * sp.y);
    vec2 fp = vec2(sp.x * w, sp.y * w * 1.25);

    // Ripples on the surface: rings that roll out on real time and bend the light.
    float rs = mix(0.18, 0.9, rippleSpeed);
    float life = mix(1.2, 4.0, calm);
    vec2 bend = vec2(0.0);
    float ringLight = 0.0;
    for (int i = 0; i < 6; i++) {
        vec4 st = slotAt(float(i));
        if (st.w > 0.0 && st.z < life * 2.5) {
            vec2 dv = fp - st.xy;
            float d = length(dv);
            float r = rs * st.z;
            float x = d - r;
            float width = 0.07 + 0.06 * st.z;
            float env = exp(-st.z / life) * st.w / (1.0 + 1.5 * r);
            float wave = sin(x * 30.0) * exp(-x * x / (width * width));
            bend += dv / max(d, 1e-4) * wave * env;
            ringLight += exp(-x * x / (0.06 * width * width)) * env * smoothstep(0.0, 0.08, r);
        }
    }
    vec2 q = fp + bend * mix(0.0, 0.22, rippleStrength);

    // Two nets at different sizes, drifting, gently warped like a moving surface.
    float zoom = mix(7.0, 2.6, scale);
    float t = vxPhase * mix(0.08, 0.7, speed);
    vec2 wq = q * zoom;
    vec2 warpv = vec2(noise2(wq * 0.35 + vec2(t * 0.11, 3.0)), noise2(wq * 0.35 + vec2(7.0, -t * 0.09))) - 0.5;
    warpv += 0.5 * (vec2(noise2(wq * 0.8 + vec2(-t * 0.13, 11.0)), noise2(wq * 0.8 + vec2(5.0, t * 0.12))) - 0.5);
    vec2 a = wq + warpv * 1.6 + vec2(t * 0.05, t * 0.03);
    vec2 b = wq * 1.43 + warpv * 2.2 + vec2(-t * 0.04, t * 0.06) + 19.0;
    float na = net(a, t, 0.0);
    float nb = net(b, t * 1.2, 41.0);
    // Net units per stored pixel, from the smooth mapping rather than the net itself.
    float fa = max(length(fwidth(wq)) * 1.2, 1e-5);
    float fb = fa * 1.43;

    // Thin bright filaments, a stored pixel or two wide, with a tight soft edge
    // where the light gathers; the cells between stay dark.
    float lw = mix(2.2, 0.8, sharpness);
    float soft = mix(0.16, 0.05, sharpness);
    float da = na / fa;
    float db = nb / fb;
    float la = exp(-da * da / (lw * lw)) + 0.12 * exp(-na / soft);
    float lb = exp(-db * db / (lw * lw)) + 0.12 * exp(-nb / (soft * 1.43));
    // The light comes and goes along the net, as it does under real water:
    // a few strands burn, most are faint.
    float va = noise2(a * 0.45 + vec2(-t * 0.07, t * 0.05));
    float vb = noise2(b * 0.4 + vec2(t * 0.06, 3.0));
    va = 0.12 + 1.5 * va * va * va;
    vb = 0.08 + 1.2 * vb * vb * vb;
    float L = la * va + lb * vb * 0.7;
    float vary = sqrt(va * vb);
    float knot = la * lb * vary * 1.6;

    float depth = exp(-max(w - 0.75, 0.0) * mix(0.0, 2.6, depthFade)) * smoothstep(1.02, 0.86, uv.y);
    float gain = (0.45 + 1.5 * brightness) * (0.75 + 0.35 * vxEnv);
    L = L * gain * depth * (1.0 + 1.2 * ringLight * rippleStrength) + ringLight * 0.12 * rippleStrength * depth;

    vec3 col = ink.rgb * (1.0 - exp(-L * 1.3));
    float gold = smoothstep(0.22, 0.75, knot * gain) * depth;
    col = mix(col, accent.rgb * min(L, 1.1), gold * 0.85);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
