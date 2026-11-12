/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of tall vertical slats, like a venetian blind turned on end, lit from one side with a colored light glowing behind it. Each slat is a flat plane turning about its own axis, so its shading, its dark edge and the glint along its turning edge show its angle, and light spills through the gaps as the slats open. The sound's swell sets how far the wall opens, and each hit sends a ripple of turning slats travelling across it from the note's place in the octave. With no sound the blind rests nearly shut, breathing slowly.",
    "PASSES": [
        {
            "TARGET": "ripples",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 24,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "slats", "LABEL": "Slats", "TYPE": "float", "DEFAULT": 14, "MIN": 6, "MAX": 32 },
        { "NAME": "lightSide", "LABEL": "Light angle", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "rippleSpeed", "LABEL": "Ripple speed", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "opening", "LABEL": "Opening", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Slats", "TYPE": "color", "DEFAULT": [1.0, 0.66, 0.34, 1.0] },
        { "NAME": "accent", "LABEL": "Light behind", "TYPE": "color", "DEFAULT": [0.22, 0.42, 1.0, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Half the width of a slat, in slat pitches: a little over a half, so shut slats overlap.
const float HALF = 0.53;
// Slat thickness, in slat pitches.
const float THICK = 0.045;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The turn a ripple gives a slat: a bump of opening that travels out from where
// the hit landed, overshoots a little shut, and settles. r = (hit time, origin, strength).
float rippleTurn(float i, vec4 r, float n, float speed) {
    float age = TIME - r.x;
    if (age < 0.0 || age > 6.0) return 0.0;
    float d = abs(i + 0.5 - r.y * n);
    float behind = speed * age - d;
    float g = exp(-(behind - 1.3) * (behind - 1.3) / 1.4) - 0.3 * exp(-(behind - 3.6) * (behind - 3.6) / 2.2);
    return r.z * g * exp(-age * 1.1) * smoothstep(-1.5, 0.0, behind);
}

float slatAngle(float i, vec4 r0, vec4 r1, float base, float n, float speed, float drift) {
    float idle = 0.07 * sin(drift * 0.9 + i * 0.55) + 0.04 * sin(drift * 0.37 - i * 1.3);
    // A ripple opens a shut wall and shuts an open one, so it shows either way.
    float dir = mix(1.0, -1.1, smoothstep(0.5, 0.95, base));
    float a = base + idle + 0.9 * dir * (rippleTurn(i, r0, n, speed) + rippleTurn(i, r1, n, speed));
    return clamp(a, 0.03, 1.5);
}

// Tone map on luminance so bright light keeps its color.
vec3 toneMap(vec3 c) {
    float lum = max(max(c.r, c.g), c.b);
    return c / max(lum, 1e-4) * (1.0 - exp(-lum * 1.4));
}

// Half the screen width a slat covers at angle a, thickness included.
float slatHalf(float a) {
    return HALF * cos(a) + 0.5 * THICK * sin(a);
}

void main() {
    float n = clamp(floor(slats + 0.5), 6.0, 32.0);
    float speed = mix(4.0, 30.0, clamp(rippleSpeed, 0.0, 1.0));

    if (PASSINDEX == 0) {
        // Slots (eight texels each): 0 and 1 hold the last even and odd hit as
        // (time, origin across the wall, strength); slot 2 holds the hit count seen.
        // Two ripples so a new hit never cuts off the one still crossing.
        float slot = clamp(floor(gl_FragCoord.x / 8.0), 0.0, 2.0);
        vec4 prev = IMG_NORM_PIXEL(ripples, vec2((slot + 0.5) / 3.0, 0.5));
        vec4 seen = IMG_NORM_PIXEL(ripples, vec2(2.5 / 3.0, 0.5));
        float cnt = floor(vxCount + 0.5);
        float par = mod(cnt, 2.0);
        // Drums carry no pitch and ripple in from the lit side; a note starts at its place in the octave.
        float pc = fract(vxPitch * 127.0 / 12.0);
        float origin = vxPitch < 0.01 ? 0.0 : 0.08 + 0.84 * pc;
        float strength = mix(0.55, 1.0, clamp(vxVel, 0.0, 1.0));
        bool cold = FRAMEINDEX < 2 || prev.a < 0.5 || seen.a < 0.5;
        vec4 o = prev;
        if (slot > 1.5) {
            o = vec4(cnt, 0.0, 0.0, 1.0);
        } else if (cold) {
            // Starting mid-hit: show its ripple already on its way.
            o = (abs(par - slot) < 0.5 && vxPulse > 0.05) ? vec4(TIME - 0.32, origin, strength, 1.0) : vec4(-100.0, 0.0, 0.0, 1.0);
        } else if (abs(cnt - seen.x) > 0.5 && abs(par - slot) < 0.5) {
            o = vec4(TIME, origin, strength, 1.0);
        }
        gl_FragColor = o;
        return;
    }

    vec4 r0 = IMG_NORM_PIXEL(ripples, vec2(0.5 / 3.0, 0.5));
    vec4 r1 = IMG_NORM_PIXEL(ripples, vec2(1.5 / 3.0, 0.5));

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // With the lamp on the right the whole wall is built mirrored, so the slats
    // always turn their faces toward the light as they open.
    float side = clamp(lightSide, 0.0, 1.0);
    if (side > 0.5) {
        p.x = -p.x;
        side = 1.0 - side;
    }
    float pitch = asp / n;                 // slat pitch in frame units
    float u = (p.x + 0.5 * asp) / pitch;   // across the wall, in slat pitches
    float pxU = 1.0 / (RENDERSIZE.y * pitch);

    float sw = clamp(vxSwell, 0.0, 1.0);
    float rest = mix(0.1, 0.42, clamp(opening, 0.0, 1.0));
    float base = mix(rest, 1.22, sw * (0.55 + 0.45 * clamp(opening, 0.0, 1.0) + 0.0));
    float drift = vxFlow * 0.8 + TIME * 0.05;

    // The key light: a lamp off to one side, a little above and in front of the wall.
    vec3 lamp = vec3(mix(-0.95, -0.1, side * 2.0) * asp, 0.5, 0.75);
    vec3 V = vec3(0.0, 0.0, 1.0);
    // A soft window on the other side, seen only as a glint on the rounded slat edges.
    vec3 Hg = normalize(normalize(vec3(mix(0.75, -0.75, side), 0.4, 0.8)) + V);

    // Find the front-most slat at this point among the nearest three.
    float i0 = floor(u);
    float best = -1e5;
    float hitI = -100.0;
    float hitS = 0.0;
    float hitEdge = 0.0;
    float hitA = 0.0;
    float hitCov = 0.0;
    for (int k = -1; k <= 1; k++) {
        float i = i0 + float(k);
        float a = slatAngle(i, r0, r1, base, n, speed, drift);
        float ca = cos(a);
        float sa = sin(a);
        float xc = i + 0.5;
        // Front face runs from xc - HALF*ca - t*sa/2 to xc + HALF*ca - t*sa/2;
        // the edge strip continues from there for THICK*sa.
        float fx0 = xc - HALF * ca - 0.5 * THICK * sa;
        float fx1 = xc + HALF * ca - 0.5 * THICK * sa;
        float ex1 = fx1 + THICK * sa;
        float cov = clamp((u - fx0) / pxU + 0.5, 0.0, 1.0) * clamp((ex1 - u) / pxU + 0.5, 0.0, 1.0);
        if (cov > 0.0) {
            float s = clamp((u - fx0) / max(ca, 1e-3) - HALF, -HALF, HALF);
            float z = s * sa;
            if (z > best) {
                best = z;
                hitI = i;
                hitS = s;
                hitA = a;
                hitCov = cov;
                // 0 on the face, 1 on the edge strip, anti-aliased across the corner.
                hitEdge = clamp((u - fx1) / pxU + 0.5, 0.0, 1.0);
            }
        }
    }

    // Light behind the wall: a broad glow, hottest away from the lamp.
    vec2 hot = vec2(mix(0.55, -0.55, side) * asp, 0.12);
    vec2 dh = (p - hot) / vec2(1.1 * asp, 0.95);
    float backI = 0.06 + 0.9 * exp(-dot(dh, dh) * 2.2);
    vec3 back = accent.rgb * backI;

    // How open the nearby gaps are: the light that comes through them hangs in the air in front.
    float spill = 0.0;
    for (int k = -2; k <= 2; k++) {
        float i = i0 + float(k);
        float aL = slatAngle(i, r0, r1, base, n, speed, drift);
        float aR = slatAngle(i + 1.0, r0, r1, base, n, speed, drift);
        float g0 = i + 0.5 + slatHalf(aL);
        float g1 = i + 1.5 - slatHalf(aR);
        float gw = max(g1 - g0, 0.0);
        float gc = 0.5 * (g0 + g1);
        float dd = (u - gc);
        spill += gw * exp(-dd * dd / 0.55);
    }

    vec3 col = back;
    vec3 slatCol = vec3(0.0);
    float cover = 0.0;
    if (hitI > -50.0) {
        float a = hitA;
        float ca = cos(a);
        float sa = sin(a);
        float xc = hitI + 0.5;
        vec3 Nf = vec3(-sa, 0.0, ca);
        vec3 Ne = vec3(ca, 0.0, sa);
        // Position on the face: across and out of the wall in slat pitches, and in frame units.
        vec2 q = vec2(xc + hitS * ca, hitS * sa);
        vec3 wp = vec3((q.x - 0.5 * asp / pitch) * pitch, p.y, q.y * pitch);
        vec3 Lv = lamp - wp;
        float ld = length(Lv);
        vec3 L = Lv / ld;
        float att = 2.4 / (1.0 + ld * ld * 1.1);
        vec3 H = normalize(L + V);
        // The neighbors between this point and the lamp throw soft shadows across it.
        vec2 lq = vec2((lamp.x + 0.5 * asp) / pitch, lamp.z / pitch);
        vec2 rd = normalize(lq - q);
        float occ = 0.0;
        for (int k = -2; k <= 2; k++) {
            if (k != 0) {
                float j = hitI + float(k);
                float aj = slatAngle(j, r0, r1, base, n, speed, drift);
                vec2 dj = vec2(cos(aj), sin(aj));
                vec2 A = vec2(j + 0.5, 0.0) - HALF * dj;
                vec2 e = dj * (2.0 * HALF);
                float den = rd.x * e.y - rd.y * e.x;
                if (abs(den) > 1e-4) {
                    vec2 aq = A - q;
                    float t = (aq.x * e.y - aq.y * e.x) / den;
                    float w = (aq.x * rd.y - aq.y * rd.x) / den;
                    float soft = 0.015 + 0.05 * t;
                    float o = smoothstep(-soft, soft, w * 2.0 * HALF) * smoothstep(-soft, soft, (1.0 - w) * 2.0 * HALF);
                    occ = max(occ, o * step(0.0, t));
                }
            }
        }
        float lit = 1.0 - 0.94 * occ;
        // Slats are slightly crowned, so light rolls across each one as it turns, and the
        // rounded long edges carry the glints (the near edge on the right, the far one on the left).
        float bevR = smoothstep(HALF - 0.08, HALF, hitS);
        float bevL = smoothstep(-HALF + 0.08, -HALF, hitS);
        vec3 Nc = normalize(Nf + Ne * (0.32 * hitS / HALF));
        vec3 Nb = normalize(Nc + Ne * (bevR * 1.6 - bevL * 1.2));
        vec3 N = mix(Nb, Ne, hitEdge);
        float dif = max(dot(mix(Nc, Ne, hitEdge), L), 0.0);
        float sheen = pow(max(dot(N, H), 0.0), 14.0) * (1.0 - hitEdge);
        float spec = pow(max(dot(N, H), 0.0), 60.0) * max(bevR, bevL) * (1.0 - hitEdge);
        // The key light comes up with the sound.
        float key = att * lit * (0.45 + 0.55 * sw);
        // Faint brushed grain along the length of the slat, so it reads as a material.
        float grain = 0.95 + 0.05 * hash21(vec2(hitI * 7.1, floor(p.y * RENDERSIZE.y * 0.25)));
        vec3 face = ink.rgb * (0.005 + 0.3 * dif * key) * grain;
        face += mix(ink.rgb, vec3(1.0), 0.3) * (sheen * 0.35 + spec * 2.2) * key;
        float glint = pow(max(dot(N, Hg), 0.0), 120.0) * max(bevR, bevL) * (1.0 - hitEdge);
        face += mix(ink.rgb, vec3(1.0), 0.7) * glint * (0.5 + 0.5 * sw);
        // Light from behind bounces off the slat's back half where the gap beside it is open.
        face += accent.rgb * backI * 0.1 * clamp(spill, 0.0, 1.0) * smoothstep(0.1, -HALF, hitS);
        // The edge: dark, picking up a rim of the light behind where the gap is open.
        vec3 edge = ink.rgb * 0.01 + accent.rgb * 0.45 * clamp(spill * 1.4, 0.0, 1.0) * backI;
        slatCol = mix(face, edge, hitEdge);
        col = mix(back, slatCol, hitCov);
        cover = hitCov;
    }
    // Light from the gaps hanging in the air in front of the wall; each hit pushes it a little.
    vec3 glow = accent.rgb * backI * spill * (0.22 + 0.1 * clamp(vxPulse, 0.0, 1.0));
    col += glow;

    vec3 outc = toneMap(col);
    float outa = 1.0;
    if (vxClear) {
        // The slats are solid; what shows between them is the picture underneath.
        outa = cover;
        outc = toneMap(slatCol + glow * 0.5) * cover;
    }
    outc += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0 * outa;
    outc = clamp(outc, vec3(0.0), vec3(outa));
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
