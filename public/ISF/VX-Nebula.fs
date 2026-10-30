/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Deep-space light: veils of warped gas at two depths, a far dim layer and a near bright one drifting at different speeds, traced by braided filaments along their shock fronts, with dark dust lanes and a sparse field of sharp twinkling stars. The sound slowly opens the light from near-black; each new chord bends the gas into a new shape over a couple of seconds.",
    "PASSES": [
        {
            "TARGET": "seedState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "veils",
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "scale", "LABEL": "Scale", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.4, "MAX": 2.5 },
        { "NAME": "warp", "LABEL": "Warp", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "openness", "LABEL": "Openness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "contrast", "LABEL": "Contrast", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "veilLayers", "LABEL": "Veil layers", "TYPE": "float", "DEFAULT": 2, "MIN": 1, "MAX": 3 },
        { "NAME": "stars", "LABEL": "Stars", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "grain", "LABEL": "Grain", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Cores", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The seed walks a loop that repeats every 64 notes, so the count can wrap freely.
const float TAU64 = 0.0981748;
// Where the gas begins: its edge is the shock front the filaments trace.
const float FRONT = 0.04;

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

float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(hash22(i) * 2.0 - 1.0, f);
    float b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
    float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
    float d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 q, int octaves) {
    vec2 p = q;
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        sum += amp * gnoise(p);
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(3.1, 7.7);
        amp *= 0.5;
    }
    return sum;
}

// The two fields a veil is built from: a smooth body whose edge is the
// front, and finer wisps that braid the filaments. Both are domain-warped.
vec2 veilFields(vec2 p, float t, float s, float warpAmt, int octaves) {
    vec2 o1 = 2.2 * vec2(cos(s * TAU64), sin(s * TAU64 * 2.0 + 1.3));
    vec2 o2 = 2.2 * vec2(sin(s * TAU64 * 3.0 + 2.1), cos(s * TAU64 * 2.0 + 0.4));
    vec2 q = vec2(fbm(p * 0.55 + o1 + vec2(0.0, 0.05 * t), 4),
                  fbm(p * 0.55 + o2 + vec2(5.2, 1.3) - vec2(0.04 * t, 0.0), 4));
    vec2 w = p + warpAmt * 2.4 * q;
    vec2 r = vec2(fbm(w * 0.9 + o2 + vec2(1.7, 9.2) + 0.03 * t, 3),
                  fbm(w * 0.9 + o1 + vec2(8.3, 2.8) - 0.03 * t, 3));
    float body = fbm(w * 0.42 + warpAmt * 0.8 * r + vec2(0.02 * t, 0.0), 3);
    float fine = fbm(w * 2.3 + warpAmt * 2.0 * r + o1, octaves);
    return vec2(body, fine);
}

// Light of a veil: glow inside the front, fading deeper in, plus braided
// strands, kept a steady width in stored pixels through the screen derivative.
float veilLight(vec2 f, float depth, float strandW, float strandAmt) {
    float lv0 = f.x + 0.1 * f.y - FRONT;
    float nearFront = exp(-abs(lv0) * 12.0);
    float inside = smoothstep(-0.02, 0.05, lv0);
    // The gas is lumpy: the fine field thickens and thins it.
    float wisp = smoothstep(-0.12, 0.32, f.y);
    float glow = inside * exp(-max(lv0, 0.0) * depth) * (0.25 + 1.1 * wisp * wisp);
    float strands = 0.0;
    for (int k = 0; k < 6; k++) {
        float fk = float(k);
        float a = 0.16 * sin(fk * 2.4 + 0.7);
        float lv = f.x + f.y * a - FRONT + 0.011 * (fk - 2.5);
        float fw = max(fwidth(lv), 1e-5);
        float d = abs(lv) / fw;
        // The first strand is the sharp one; the rest are softer and fainter.
        float wk = strandW * (k == 0 ? 0.7 : 1.0 + 1.6 * fract(fk * 0.618));
        // Strands come and go along their length, like wisps rather than cracks.
        float along = (0.5 + 0.5 * sin(f.y * (13.0 + 2.0 * fk) + fk * 1.7 + f.x * 5.0))
                    * (0.5 + 0.5 * sin(f.y * 5.3 - f.x * 9.0 + fk * 2.9));
        along = smoothstep(0.08, 0.7, along);
        float line = exp(-d * d / wk) + 0.16 * exp(-d / (wk * 4.0));
        strands += line * along * (k == 0 ? 1.0 : 0.6 - 0.05 * fk);
    }
    return glow * 0.62 + strands * nearFront * strandAmt;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        // A critically damped spring eases the seed toward the note count.
        // Whole and fractional parts are kept apart so half floats hold them exactly.
        vec4 st = IMG_NORM_PIXEL(seedState, vec2(0.5));
        float target = floor(vxCount + 0.5);
        float s = st.r + st.g;
        float v = st.b;
        if (st.a < 0.5 || FRAMEINDEX < 2) {
            s = target;
            v = 0.0;
        }
        float d = target - s;
        d -= 64.0 * floor((d + 32.0) / 64.0);
        float omega = 1.6;
        v += (omega * omega * d - 2.0 * omega * v) * dt;
        s = mod(s + v * dt, 64.0);
        gl_FragColor = vec4(floor(s), fract(s), v, 1.0);
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxPhase * (0.04 + flow * 0.4);
    vec2 drift = normalize(vec2(1.0, 0.32));
    float open = openness * (0.1 + 0.9 * smoothstep(0.0, 0.85, vxEnv));
    float depth = mix(11.0, 2.6, open);

    if (PASSINDEX == 1) {
        vec4 st = IMG_NORM_PIXEL(seedState, vec2(0.5));
        float s = st.r + st.g;
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * (1.8 / scale);
        // Near veil: kept as raw fields so the final pass can draw sharp filaments.
        vec2 nearF = veilFields(p + drift * t * 0.2, t, s, warp, 5);
        // Far veils: finer, dimmer, slower, finished here at half size.
        float farW = clamp(veilLayers - 1.0, 0.0, 1.0);
        float midW = clamp(veilLayers - 2.0, 0.0, 1.0);
        float farL = 0.0;
        if (farW > 0.0) {
            vec2 ff = veilFields(p * 1.9 + vec2(13.0, 7.0) + drift * t * 0.07, t * 0.6, s + 17.0, warp * 0.85, 4);
            farL += veilLight(ff, depth * 1.4, 0.6, 0.3) * farW * 0.6;
        }
        if (midW > 0.0) {
            vec2 mf = veilFields(p * 1.35 + vec2(-7.0, 21.0) + drift * t * 0.12, t * 0.8, s + 31.0, warp * 0.9, 4);
            farL += veilLight(mf, depth * 1.15, 0.6, 0.5) * midW * 0.65;
        }
        // Dust lanes that hide what lies behind the near veil.
        float dust = fbm(p * 0.7 + nearF * 1.5 + vec2(19.0, 3.0) + drift * t * 0.2, 3);
        gl_FragColor = vec4(farL, nearF.x, nearF.y, dust);
        return;
    }

    vec4 v = IMG_NORM_PIXEL(veils, uv);
    float lift = 0.12 + 2.0 * open;
    float gamma = mix(0.8, 1.8, contrast);
    float dust = smoothstep(0.0, 0.32, v.a);
    // Thin dark rifts cut through the near gas.
    float rift = 1.0 - 0.75 * exp(-abs(v.a - 0.06) * 22.0);
    float nearL = veilLight(v.gb, depth, 1.4, 1.0) * rift;
    float farL = v.r * (1.0 - 0.85 * dust);
    float light = pow(nearL + farL, gamma) * lift;

    vec3 col = ink.rgb * (1.0 - exp(-light * 1.6));
    float core = smoothstep(0.7, 1.5, light);
    col = mix(col, accent.rgb * (0.75 + 0.25 * core), core * 0.75);

    // Stars: at most one per cell, sub-pixel placed, about a pixel wide.
    vec2 fragPx = gl_FragCoord.xy;
    vec2 fwPx = fwidth(fragPx);
    float cell = max(3.0, RENDERSIZE.y / 160.0);
    vec2 sp = fragPx / cell + drift * t * 0.6;
    vec2 id = floor(sp);
    float h = hash21(id);
    float starL = 0.0;
    // Stars gather in loose drifts rather than an even sprinkle.
    float clump = smoothstep(-0.35, 0.35, gnoise(uv * vec2(aspect, 1.0) * 1.3 + vec2(7.0, 3.0)));
    if (h < stars * 0.22 * (0.3 + 0.9 * clump)) {
        vec2 pos = id + 0.25 + 0.5 * hash22(id + 3.7);
        vec2 dd = (sp - pos) * cell;
        float mag = 0.3 + 1.4 * pow(hash21(id + 9.1), 5.0);
        float tw = 0.62 + 0.38 * sin(vxPhase * (2.0 + 5.0 * fract(h * 37.0)) + h * 91.0)
                          * sin(vxPhase * (1.3 + 2.0 * fract(h * 53.0)) + h * 17.0);
        // Never smaller than one stored pixel, so stars stay steady at any quality.
        vec2 sgs = max(vec2(0.46), 0.55 * fwPx);
        float norm = pow(0.2116 / (sgs.x * sgs.y), 0.35);
        vec2 dn = dd / sgs;
        starL = mag * tw * norm * exp(-0.5 * dot(dn, dn)) * (1.0 - 0.9 * dust);
    }
    col += ink.rgb * starL * 0.9 + vec3(starL * 0.12);

    // Grain rides on the light only, so black stays black.
    float g = hash21(fragPx + fract(TIME * 7.3) * 113.0) - 0.5;
    col *= 1.0 + grain * 0.6 * g;
    col += (hash21(fragPx.yx + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
