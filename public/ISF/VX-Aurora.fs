/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Curtains of light: one folded aurora curtain per sounding note, placed across the sky by pitch, with fine vertical rays rising from a bright hem. Each curtain glows with its note's energy and fades as the note lets go. A faint horizon and its still-water reflection give the sky its scale.",
    "PASSES": [
        {
            "TARGET": "curtainState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH",
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "height", "LABEL": "Height", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "fold", "LABEL": "Fold", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "sway", "LABEL": "Sway", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "rayDetail", "LABEL": "Ray detail", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "softness", "LABEL": "Softness", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "horizon", "LABEL": "Horizon", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Curtains", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Hems", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

// Six curtain slots (midi, energy). A note keeps its slot while it sounds,
// so its curtain stays put; released curtains fade in their own slot.
const float SLOTS = 6.0;
const float PI = 3.14159265;

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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), u);
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
    return IMG_NORM_PIXEL(curtainState, vec2((i + 0.5) / SLOTS, 0.5));
}

vec2 liveNote(int i) {
    vec2 n = i == 0 ? vec2(vxNote0, vxNoteE0) : i == 1 ? vec2(vxNote1, vxNoteE1) : i == 2 ? vec2(vxNote2, vxNoteE2) : vec2(vxNote3, vxNoteE3);
    return vec2(floor(n.x * 127.0 + 0.5), n.x > 0.0 ? n.y : 0.0);
}

// Light from one layer of sheet crossing this column at position sr.
vec2 sheetLight(float qy, float sr, float swing, float w, float hem0, float amp, float halfLen, float tall, float t, float h1, float h2, float edgeOn, vec2 px, vec2 fw) {
    float hem = hem0 + 0.06 * amp * swing + 0.07 * sin(sr / halfLen * 1.7 + t * 0.13 + h1 * 6.2831)
              + 0.025 * sin(sr / halfLen * 5.0 - t * 0.27 + h2 * 6.2831)
              + 0.04 * (noise1(sr * 3.0 + t * 0.15 + h2 * 40.0) - 0.5) + 0.015 * (noise1(sr * 11.0 - t * 0.3 + h1 * 20.0) - 0.5);
    float v = qy - hem;
    // Rays: fine vertical striations that flicker and drift along the sheet.
    float freq = mix(40.0, 170.0, rayDetail);
    float rs = sr * freq + t * 0.5 + h1 * 300.0;
    float detail = smoothstep(0.7, 0.25, freq * px.x * fw.x * edgeOn);
    float r1 = noise2(vec2(rs, t * 0.8));
    float r2 = noise2(vec2(rs * 2.7 + 17.0, t * 1.3 + 3.0));
    float rays = mix(0.45, r1 * 0.65 + r2 * 0.35, detail);
    rays = pow(clamp(rays * 1.3, 0.0, 1.0), mix(4.5, 1.6, softness)) * 1.7;
    float rn = noise1(rs * 0.19 + h2 * 50.0);
    float reach = tall * (0.35 + 1.2 * rn * rn);
    float base = 0.012 + 0.05 * tall;
    float above = 0.0;
    float below = 0.0;
    if (v > 0.0) {
        float rise = 1.0 - exp(-v / (0.002 + 0.008 * softness));
        above = rise * (exp(-v / base) * 0.9 + exp(-v / reach) * (1.0 - smoothstep(reach * 2.0, reach * 4.0, v)) * 0.55);
    } else {
        below = exp(v / (0.004 + 0.02 * softness)) * 0.18;
    }
    float pulse = 0.7 + 0.3 * sin(sr * 11.0 - t * 1.6 + h2 * 6.0);
    float hw = max(0.9 + 2.2 * softness, 0.8 * fw.y) * px.y;
    float bodyL = (above * (0.25 + rays) + below * (0.4 + 0.6 * rays)) * w * pulse;
    float hemL = exp(-v * v / (hw * hw)) * (0.45 + 0.9 * rays) * w * pulse;
    return vec2(bodyL, hemL);
}

// The sheet's path seen from below: screen x as a function of the position
// s along the sheet, plus its depth swing, which lifts the far side of each
// fold so the fold curls. Where x doubles back, the sheet folds over itself.
vec2 sheetX(float s, vec4 fp, float t, float h1) {
    float th = fp.z * s + fp.w + 1.3 * sin(fp.z * s * 0.37 + t * 0.12 + h1 * 9.0);
    return vec2(s + fp.x * sin(th) + 0.3 / (fp.z * 2.7) * sin(fp.z * 2.7 * s - t * 0.9 + h1 * 13.0), cos(th));
}

// One curtain at screen point q (x scaled by aspect, y up from 0).
// Returns (body light, hem light).
vec2 curtain(vec2 q, float midi, float energy, float t, float aspect, vec2 px, vec2 fw) {
    float h1 = hash11(midi * 7.13 + 1.0);
    float h2 = hash11(midi * 3.71 + 5.0);
    // Pitch sets where the curtain hangs: across by pitch, and higher notes
    // hang a little higher and farther, so they are smaller and fainter.
    float pitchUp = clamp((midi - 48.0) / 36.0, 0.0, 1.0);
    // Across the sky by pitch, eased so the highest and lowest notes stay in frame.
    float xc = 0.36 * aspect * tanh((midi - 63.0) * mix(0.015, 0.11, spread)) + (h1 - 0.5) * 0.06;
    float halfLen = mix(0.42, 0.28, pitchUp) * mix(0.85, 1.15, h2);
    float hem0 = 0.2 + 0.32 * pitchUp + (h2 - 0.5) * 0.08;
    float tall = (0.025 + 0.2 * height) * mix(1.1, 0.75, pitchUp);
    float lx = q.x - xc;
    float v0 = q.y - hem0;
    float period = halfLen * 0.7;
    float omega = 6.2831 / period;
    float amp = (0.2 + 1.6 * fold) / omega;
    float span = amp + 0.3 / (omega * 2.7) + 0.02;
    if (abs(lx) > halfLen + span + 0.02) return vec2(0.0);
    if (v0 < -0.14 || v0 > tall * 6.0 + 0.12) return vec2(0.0);

    // Sway bends the tops of the rays; rays also lean out a little, as if overhead.
    float vb = max(v0, 0.0);
    float lxr = lx - sway * 0.3 * sin(t * 0.37 + h1 * 6.0) * vb * vb - vb * q.x * 0.1;
    vec4 fp = vec4(amp, period, omega, t * 0.45 + h1 * 6.2831);

    // Find every place the sheet crosses this column; each is a layer of light,
    // brighter where the sheet is seen edge-on. Just past a fold the sheet
    // misses the column narrowly; it still glows a little there, as if thick.
    const int N = 12;
    float s0 = lxr - span;
    float ds = 2.0 * span / float(N - 1);
    vec2 pPrev = sheetX(s0, fp, t, h1);
    float gPrev = pPrev.x - lxr;
    float gPrev2 = gPrev;
    vec2 light = vec2(0.0);
    float thick = 0.02;
    for (int k = 1; k < N; k++) {
        float sk = s0 + ds * float(k);
        vec2 pk = sheetX(sk, fp, t, h1);
        float g = pk.x - lxr;
        if (gPrev * g <= 0.0 && gPrev != g) {
            float fr = gPrev / (gPrev - g);
            float sr = sk - ds + ds * fr;
            float ends = smoothstep(halfLen, halfLen * 0.4, abs(sr));
            if (ends > 0.0) {
                float edgeOn = clamp(1.0 / max(abs(g - gPrev) / ds, 0.35), 0.0, 2.5);
                light += sheetLight(q.y, sr, mix(pPrev.y, pk.y, fr), ends * edgeOn, hem0, amp, halfLen, tall, t, h1, h2, edgeOn, px, fw);
            }
        } else if (k > 1 && abs(gPrev) < abs(gPrev2) && abs(gPrev) <= abs(g)) {
            // A fold turns just short of this column.
            float curv = g - 2.0 * gPrev + gPrev2;
            float off = abs(curv) > 1e-6 ? clamp(0.5 * (gPrev2 - g) / curv, -0.5, 0.5) : 0.0;
            float gmin = gPrev - 0.25 * (gPrev2 - g) * off;
            float sr = sk - ds + off * ds;
            float ends = smoothstep(halfLen, halfLen * 0.4, abs(sr));
            float miss = exp(-abs(gmin) / thick);
            if (ends * miss > 0.01) {
                light += sheetLight(q.y, sr, pPrev.y, ends * miss * 2.0, hem0, amp, halfLen, tall, t, h1, h2, 2.5, px, fw);
            }
        }
        gPrev2 = gPrev;
        gPrev = g;
        pPrev = pk;
    }
    return light * energy * mix(1.0, 0.75, pitchUp);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    if (PASSINDEX == 0) {
        float me = floor(uv.x * SLOTS);
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        float mp[6];
        float ep[6];
        float tg[6];
        float used[6];
        for (int j = 0; j < 6; j++) {
            vec4 st = slotAt(float(j));
            mp[j] = st.x;
            ep[j] = FRAMEINDEX < 2 ? 0.0 : st.y;
            tg[j] = 0.0;
            used[j] = 0.0;
        }
        // Notes already holding a curtain keep it.
        float matched[4];
        for (int i = 0; i < 4; i++) {
            matched[i] = 0.0;
            vec2 ln = liveNote(i);
            if (ln.y < 0.001) continue;
            for (int j = 0; j < 6; j++) {
                if (used[j] < 0.5 && ep[j] > 0.0005 && abs(mp[j] - ln.x) < 0.5) {
                    tg[j] = ln.y;
                    used[j] = 1.0;
                    matched[i] = 1.0;
                    break;
                }
            }
        }
        // New notes take the dimmest free slot and grow from nothing.
        for (int i = 0; i < 4; i++) {
            vec2 ln = liveNote(i);
            if (ln.y < 0.001 || matched[i] > 0.5) continue;
            int best = -1;
            float bestE = 1e9;
            for (int j = 0; j < 6; j++) {
                if (used[j] < 0.5 && ep[j] < bestE) {
                    bestE = ep[j];
                    best = j;
                }
            }
            if (best >= 0) {
                for (int j = 0; j < 6; j++) {
                    if (j == best) {
                        mp[j] = ln.x;
                        ep[j] = 0.0;
                        tg[j] = ln.y;
                        used[j] = 1.0;
                    }
                }
            }
        }
        vec4 outc = vec4(0.0);
        for (int j = 0; j < 6; j++) {
            if (abs(float(j) - me) < 0.5) {
                // Quick to light, slow to let go.
                float rate = tg[j] > ep[j] ? 1.0 - exp(-dt / 0.07) : 1.0 - exp(-dt / 0.5);
                float e = ep[j] + (tg[j] - ep[j]) * rate;
                outc = vec4(mp[j], e < 0.0004 ? 0.0 : e, 0.0, 1.0);
            }
        }
        gl_FragColor = outc;
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxPhase * (0.25 + sway * 0.9);
    // Size of a pixel in screen units, for thin lines and ray anti-aliasing.
    vec2 px = vec2(aspect / RENDERSIZE.x, 1.0 / RENDERSIZE.y);
    // How many of our pixels one stored pixel covers; thin things never go below it.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float horizonY = horizon > 0.001 ? 0.02 + 0.2 * horizon : -1.0;

    vec2 q = vec2((uv.x - 0.5) * aspect, uv.y);
    float reflected = 0.0;
    if (uv.y < horizonY) {
        // Still water: the sky mirrored, dimmed, with a slow fine ripple.
        float depthBelow = horizonY - uv.y;
        q.y = horizonY + depthBelow * 1.6;
        q.x += 0.004 * sin(depthBelow * 900.0 + t * 1.3) * smoothstep(0.0, 0.05, depthBelow);
        reflected = 1.0;
    }

    vec2 light = vec2(0.0);
    float total = 0.0;
    for (int j = 0; j < 6; j++) {
        vec4 st = slotAt(float(j));
        total += st.y;
        if (st.y > 0.002) light += curtain(q, st.x, st.y, t, aspect, px, fw);
    }
    // At rest a single faint curtain idles, and gives way as real ones arrive.
    float ghost = 0.14 * (1.0 - smoothstep(0.0, 0.35, total));
    if (ghost > 0.001) light += curtain(q, 61.0, ghost, t * 0.6, aspect, px, fw);

    float gain = 0.4 + 1.8 * brightness;
    float bodyL = light.x * gain;
    float hemL = light.y * gain;
    vec3 col = ink.rgb * (1.0 - exp(-(bodyL + hemL * 0.8) * 1.3));
    // Gold only where the hem burns brightest.
    float gold = smoothstep(0.45, 1.3, hemL);
    col = mix(col, accent.rgb * min(hemL, 1.2), gold * 0.75);

    if (reflected > 0.5) {
        col *= 0.13 * smoothstep(0.0, 0.015, horizonY - uv.y) * exp(-(horizonY - uv.y) * 6.0);
    }
    if (horizonY > 0.0) {
        // The ground line, a hairline lit a little by the sky above it.
        float dpx = abs(uv.y - horizonY) / px.y / fw.y;
        col += ink.rgb * exp(-dpx * dpx / 0.6) * (0.05 + 0.25 * min(total, 1.0)) * smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x);
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
