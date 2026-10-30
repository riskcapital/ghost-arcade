/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Narrow light beams cutting down through smoke from a rig above. Every sounding note hangs one beam, placed across the rig by pitch, bright while the note plays and fading as it lets go. The beams sweep slowly, the smoke turns inside them, and outside them the room stays black. The newest note's lamp burns in the accent colour.",
    "PASSES": [
        {
            "TARGET": "beamState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH",
            "HEIGHT": 1
        },
        {
            "TARGET": "smokeField",
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "beamWidth", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "fan", "LABEL": "Fan", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sweep", "LABEL": "Sweep", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "smoke", "LABEL": "Smoke", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "falloff", "LABEL": "Falloff", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "rigHeight", "LABEL": "Rig height", "TYPE": "float", "DEFAULT": 0.75, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beams", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Newest lamp", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0.47, "MIN": 0, "MAX": 1 },
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

// beamState: six beam slots (midi, energy). A note keeps its slot while it
// sounds, so its beam stays put; a released beam fades in its own slot.
// Slot 6 holds the register the notes have been sitting in (midi), so the
// rig is always spread across the frame. Each slot is a seventh of the target.
// smokeField: r = smoke density, 0..1.
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

float fbm(vec2 q, int octaves) {
    vec2 p = q;
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        sum += amp * noise2(p);
        norm += amp;
        p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.07 + vec2(5.3, 1.7);
        amp *= 0.5;
    }
    return sum / norm;
}

vec4 slotAt(float i) {
    return IMG_NORM_PIXEL(beamState, vec2((i + 0.5) / STATE_W, 0.5));
}

vec2 liveNote(int i) {
    vec2 n = i == 0 ? vec2(vxNote0, vxNoteE0) : i == 1 ? vec2(vxNote1, vxNoteE1) : i == 2 ? vec2(vxNote2, vxNoteE2) : vec2(vxNote3, vxNoteE3);
    return vec2(floor(n.x * 127.0 + 0.5), n.x > 0.0 ? n.y : 0.0);
}

float rigY() {
    return mix(0.72, 1.0, rigHeight);
}

// Where a note's lamp hangs on the rig, which way its beam points
// (radians from straight down, positive leans right), and how far back it hangs.
vec3 lampFor(float midi, float regMidi, float aspect) {
    float h1 = hash11(midi * 7.13 + 1.0);
    float h2 = hash11(midi * 3.71 + 5.0);
    float xc = 0.5 + 0.42 * tanh((midi - regMidi) * mix(0.035, 0.2, spread));
    float x = (xc - 0.5) * aspect;
    // Lamps lean outward with fan, each a little its own way, so beams cross.
    float side = h1 < 0.5 ? -1.0 : 1.0;
    float lean = (xc - 0.5) * mix(0.0, 0.9, fan) + side * mix(0.06, 0.55, fan) * (0.55 + 0.9 * abs(h1 - 0.5));
    float swing = sweep * 0.42 * sin(vxPhase * (0.09 + 0.07 * h2) + h1 * 6.2832)
                + sweep * 0.12 * sin(vxPhase * (0.23 + 0.1 * h1) + h2 * 6.2832);
    return vec3(x, lean + swing, h2);
}

// Light scattered toward us by one beam at point p (x centred and scaled
// by aspect, y up). Returns (beam light, lamp-head light).
vec2 beam(vec2 p, vec3 lamp, float energy, float px) {
    vec2 o = vec2(lamp.x, rigY() - 0.012);
    // Lamps further back throw thinner, dimmer beams.
    float far = lamp.z;
    vec2 dir = vec2(sin(lamp.y), -cos(lamp.y));
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 v = p - o;
    float s = dot(v, dir);
    float lat = dot(v, nrm);
    float halfAngle = mix(0.008, 0.1, beamWidth) * mix(1.15, 0.7, far);
    float w0 = mix(0.003, 0.008, beamWidth) * mix(1.1, 0.75, far);
    float w = w0 + max(s, 0.0) * halfAngle;
    // Seen from the side, a round shaft of lit haze is brightest down its middle
    // and ends crisply at its edge.
    float x = lat / w;
    float chord = sqrt(max(1.0 - x * x, 0.0));
    float edge = clamp((w - abs(lat)) / (1.2 * px) + 0.5, 0.0, 1.0);
    // Faint striations from the lens run down the beam.
    float striae = 0.8 + 0.4 * noise2(vec2(x * 3.5 + far * 40.0, 0.5));
    float across = (chord * 0.75 * striae + 0.35 * exp(-x * x * 9.0)) * edge;
    float along = exp(-max(s, 0.0) * mix(0.3, 3.6, falloff)) * pow(w0 / w, 0.4) * (1.0 + 1.2 * exp(-max(s, 0.0) / 0.03));
    float start = smoothstep(-0.002, 0.012, s);
    float shaft = across * along * start * energy * mix(1.0, 0.6, far);
    // The lamp head: a short bar across the beam where it leaves the rig.
    float sBar = dot(p - (o + dir * 0.004), dir);
    float lBar = dot(p - (o + dir * 0.004), nrm);
    float hw = w0 * 1.9;
    float bar = clamp((hw - abs(lBar)) / px + 0.5, 0.0, 1.0) * clamp((0.0045 - abs(sBar)) / px + 0.5, 0.0, 1.0);
    return vec2(shaft, bar * (0.25 + 0.75 * energy));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX == 0) {
        float me = floor(uv.x * STATE_W);
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (me > SLOTS - 0.5) {
            // Ease the register toward the notes sounding now.
            vec4 rs = slotAt(SLOTS);
            float reg = rs.x;
            float known = rs.y;
            if (FRAMEINDEX < 2 || reg < 1.0) {
                reg = 62.0;
                known = 0.0;
            }
            float sumN = 0.0;
            float sumE = 0.0;
            for (int i = 0; i < 4; i++) {
                vec2 ln = liveNote(i);
                sumN += ln.x * ln.y;
                sumE += ln.y;
            }
            if (sumE > 0.01) {
                // The first notes set it outright; after that it follows slowly.
                reg = known > 0.5 ? reg + (sumN / sumE - reg) * (1.0 - exp(-dt / 2.0)) : sumN / sumE;
                known = 1.0;
            }
            gl_FragColor = vec4(reg, known, 0.0, 1.0);
            return;
        }
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
        // Notes already holding a beam keep it.
        float matched[4];
        for (int i = 0; i < 4; i++) {
            matched[i] = 0.0;
            vec2 ln = liveNote(i);
            if (ln.y > 0.001) {
                for (int j = 0; j < 6; j++) {
                    if (matched[i] < 0.5 && used[j] < 0.5 && ep[j] > 0.0005 && abs(mp[j] - ln.x) < 0.5) {
                        tg[j] = ln.y;
                        used[j] = 1.0;
                        matched[i] = 1.0;
                    }
                }
            }
        }
        // New notes take the dimmest free slot and grow from nothing.
        for (int i = 0; i < 4; i++) {
            vec2 ln = liveNote(i);
            if (ln.y > 0.001 && matched[i] < 0.5) {
                int best = -1;
                float bestE = 1e9;
                for (int j = 0; j < 6; j++) {
                    if (used[j] < 0.5 && ep[j] < bestE) {
                        bestE = ep[j];
                        best = j;
                    }
                }
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
                // Snaps on with the note, lets go a little slower than it.
                float rate = tg[j] > ep[j] ? 1.0 - exp(-dt / 0.04) : 1.0 - exp(-dt / 0.3);
                float e = ep[j] + (tg[j] - ep[j]) * rate;
                outc = vec4(mp[j], e < 0.0005 ? 0.0 : e, 0.0, 1.0);
            }
        }
        gl_FragColor = outc;
        return;
    }

    if (PASSINDEX == 1) {
        // Smoke: slow billows drifting across and up, gently warped.
        vec2 p = vec2(uv.x * aspect, uv.y) * 2.8;
        float t = vxPhase * 0.06;
        vec2 q = p + vec2(t * 0.9, -t * 0.35);
        vec2 wv = vec2(fbm(q * 0.5 + vec2(t * 0.3, 0.0), 3), fbm(q * 0.5 + vec2(7.1, 3.3 - t * 0.25), 3));
        float d = fbm(q + (wv - 0.5) * 3.6 + vec2(0.0, t * 0.2), 5);
        gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
        return;
    }

    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float px = max(fw.x, fw.y) / RENDERSIZE.y;
    float newest = floor(vxPitch * 127.0 + 0.5);
    float regMidi = slotAt(SLOTS).x;

    float shafts = 0.0;
    float heads = 0.0;
    float accentHead = 0.0;
    float total = 0.0;
    for (int j = 0; j < 6; j++) {
        vec4 st = slotAt(float(j));
        total += st.y;
        if (st.y > 0.002) {
            vec2 b = beam(p, lampFor(st.x, regMidi, aspect), st.y, px);
            shafts += b.x;
            if (abs(st.x - newest) < 0.5) {
                accentHead = max(accentHead, b.y);
            } else {
                heads += b.y;
            }
        }
    }
    // At rest one faint beam idles, and gives way as real ones arrive.
    float ghost = 0.2 * (1.0 - smoothstep(0.0, 0.3, total));
    if (ghost > 0.001) {
        vec2 b = beam(p, lampFor(61.0, 62.0, aspect), ghost, px);
        shafts += b.x;
        heads += b.y * 0.6;
    }

    // The smoke only shows where a beam lights it.
    float sm = IMG_NORM_PIXEL(smokeField, uv).r;
    float billow = smoothstep(0.34, 0.68, sm);
    float dens = mix(1.0, billow * billow * 3.0 + 0.03, smoke);
    float gain = 0.4 + 1.6 * brightness;
    float L = shafts * dens * gain;
    vec3 col = ink.rgb * (1.0 - exp(-L * 1.5));

    // The rig: a hairline across the top, lamps hanging from it.
    float ry = rigY();
    float rd = abs(uv.y - ry) / px;
    float rig = exp(-rd * rd / 0.6) * 0.09 * smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
    col += ink.rgb * (rig + heads * 0.55);
    col = mix(col, accent.rgb, clamp(accentHead, 0.0, 1.0));

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
