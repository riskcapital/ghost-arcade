/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A lighthouse on a dark headland turns one broad beam through the haze over a night sea, and the water holds a broken reflection of it. Between hits the lamp turns slowly. Each hit swings the beam round and past you, so the lamp blooms on the lens for half a second as it looks straight at you, and the glitter path on the water flares under it. With a transparent background only the beam, its reflection and the dark headland are drawn.",
    "PASSES": [
        {
            "TARGET": "lamp",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 16,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "haze", "LABEL": "Haze", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "width", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn speed", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "swellSea", "LABEL": "Swell", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beam", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.52, 1.0] },
        { "NAME": "accent", "LABEL": "Night sky", "TYPE": "color", "DEFAULT": [0.22, 0.5, 0.95, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 63 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// Camera one unit above the sea, looking out level; the horizon sits this far below centre.
const float HZ = 0.15;
const float FOC = 1.25;
// The lamp: left of centre, out on the headland, a little above the camera.
const vec3 LAMP = vec3(-8.5, 1.9, 34.0);
// Where the beam points with nothing added: toward the camera's right, across the frame.
const float BASE = 0.2;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm3(vec2 x) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        v += amp * noise2(x);
        x = mat2(1.6, 1.2, -1.2, 1.6) * x + 1.7;
        amp *= 0.5;
    }
    return v;
}

// The beam's direction for a turn angle: 0 looks straight at the camera.
vec3 beamDir(float th) {
    vec2 toCam = normalize(vec2(-LAMP.x, -LAMP.z));
    float c = cos(th);
    float s = sin(th);
    vec2 d = vec2(toCam.x * c - toCam.y * s, toCam.x * s + toCam.y * c);
    return normalize(vec3(d.x, -0.03, d.y));
}

// Light scattered toward the eye along a ray (origin o, direction r, up to tMax) from a cone
// round the beam axis. The ray meets the cone's Gaussian cross-section over a short stretch
// centred where it passes nearest the axis; that stretch is integrated in closed-form pieces
// (ten evaluations of the analytic density, no marching through the scene), with a
// forward-scattering phase.
float scatter(vec3 o, vec3 r, vec3 dir, float tMax, float spreadK, float g) {
    vec3 w0 = o - LAMP;
    float b = dot(r, dir);
    float d = dot(r, w0);
    float e = dot(dir, w0);
    float den = max(1.0 - b * b, 1e-4);
    float t = clamp((b * e - d) / den, 0.0, tMax);
    float s = max(dot(o + r * t - LAMP, dir), 0.0);
    t = clamp(dot(LAMP + dir * s - o, r), 0.0, tMax);
    float sinG = max(sqrt(den), 0.05);
    float hw = min(3.2 * (0.3 + s * spreadK) / sinG, 90.0);
    float t0 = max(t - hw, 0.0);
    float t1 = min(t + hw, tMax);
    float dt = (t1 - t0) / 10.0;
    float acc = 0.0;
    for (int k = 0; k < 10; k++) {
        float tk = t0 + (float(k) + 0.5) * dt;
        vec3 v = o + r * tk - LAMP;
        float sk = dot(v, dir);
        float rho2 = max(dot(v, v) - sk * sk, 0.0);
        float rad = 0.3 + max(sk, 0.0) * spreadK;
        // The beam starts at the lens; haze right round the camera is thin.
        acc += exp(-rho2 / (rad * rad)) / (rad * rad) * smoothstep(-0.4, 0.4, sk) * exp(-0.012 * (sk + tk)) * smoothstep(3.0, 20.0, tk);
    }
    acc *= dt * 0.56;
    float ph = (1.0 - g * g) / pow(1.0 + g * g + 2.0 * g * b, 1.5);
    // Texture: the haze the beam lights drifts in slow banks.
    vec3 q = LAMP + dir * s;
    float bank = 0.55 + 0.9 * fbm3(vec2(q.x * 0.11 + vxFlow * 0.06, q.z * 0.07 + q.y * 0.3 - vxFlow * 0.03));
    return acc * ph * bank;
}

// The headland's skyline, in screen space: low land rising to the lighthouse, then dropping into the sea.
float landTop(float x) {
    float lx = LAMP.x / LAMP.z * FOC;
    float hill = 0.035 * exp(-pow((x - lx + 0.02) / 0.32, 2.0)) + 0.012 * smoothstep(lx + 0.25, lx - 0.6, x);
    hill += 0.006 * (noise2(vec2(x * 22.0, 3.1)) - 0.5) + 0.004 * (noise2(vec2(x * 61.0, 7.3)) - 0.5);
    float edge = smoothstep(lx + 0.21, lx + 0.15, x);
    return -HZ - 0.1 + (hill + 0.1) * edge;
}

void main() {
    if (PASSINDEX == 0) {
        // Slot 0: the extra turn the hits have added (x), the sweep still to run (y), the hit
        // count last seen (z). Slot 1: how far the beam turned this frame, for motion blur.
        float i = floor(gl_FragCoord.x / 8.0);
        vec4 st = IMG_NORM_PIXEL(lamp, vec2(0.25, 0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        float slow = vxFlow * (0.1 + 0.6 * turn) + BASE;
        float off = st.x;
        float rem = st.y;
        float cnt = st.z;
        float turned = 0.0;
        if (FRAMEINDEX < 2 || st.a < 0.5) {
            // Cold start: at a hit, the beam has just swept past the lens; otherwise it rests aside.
            off = vxPulse > 0.3 ? 0.12 - slow : 0.0;
            rem = vxPulse > 0.3 ? 1.05 : 0.0;
            cnt = vxCount;
            turned = rem * 0.3;
        } else {
            if (abs(vxCount - cnt) > 0.5) {
                // A new hit: run forward past the lens (angle 0) and on to rest well aside, so the
                // beam faces you about a tenth of a second after the hit, as the lens blooms.
                float cur = slow + off + rem;
                rem += mod(-cur, TAU) + 1.2;
                cnt = vxCount;
            }
            turned = rem * (1.0 - exp(-dt * 12.0));
            off = mod(off + turned, TAU);
            rem -= turned;
        }
        gl_FragColor = i < 0.5 ? vec4(off, rem, cnt, 1.0) : vec4(turned, 0.0, 0.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);

    vec4 st0 = IMG_NORM_PIXEL(lamp, vec2(0.25, 0.5));
    vec4 st1 = IMG_NORM_PIXEL(lamp, vec2(0.75, 0.5));
    float th = vxFlow * (0.1 + 0.6 * turn) + BASE + st0.x;
    float blurStep = min(st1.x, 1.2);

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pulse = clamp(vxPulse, 0.0, 1.0);
    float power = 0.6 + 0.4 * sw;
    float spreadK = 0.025 + 0.08 * width;
    float sigma = 0.25 + 1.1 * haze;
    float g = 0.3;

    vec3 r = normalize(vec3(p.x, p.y + HZ, FOC));
    vec2 lampS = vec2(LAMP.x / LAMP.z * FOC, LAMP.y / LAMP.z * FOC - HZ);
    float px = 1.0 / RENDERSIZE.y;

    // Where the ray meets the sea (camera height 1).
    bool sea = r.y < -0.0005;
    float tSea = sea ? 1.0 / (-r.y) : 1e4;
    float top = landTop(p.x);
    // The headland stands in the sea at the lamp's distance; its foot is that far's waterline.
    float foot = -HZ - FOC / LAMP.z;
    float land = smoothstep(top + px, top - px, p.y) * smoothstep(foot - px, foot + px, p.y);
    float tMax = mix(tSea, LAMP.z - 2.0, land);

    vec3 col = vec3(0.0);
    vec3 beamC = ink.rgb;

    // The beam through the air, blurred over this frame's turn.
    float sc = 0.0;
    float scR = 0.0;
    vec3 hp = r * tSea;
    vec3 rr = r;
    vec3 rg = r;
    float fres = 0.0;
    float glit = 0.0;
    float waveDetail = 0.0;
    if (sea) {
        // Wave normal from a few travelling swells; detail fades with distance so it never shimmers.
        vec2 w = hp.xz;
        float fade = 1.0 / (1.0 + tSea * 0.04);
        float amp = (0.04 + 0.16 * swellSea);
        vec2 gr = vec2(0.0);
        gr += vec2(0.8, 0.6) * cos(dot(w, vec2(0.8, 0.6)) * 1.3 + TIME * 0.9) * 1.3;
        gr += vec2(-0.5, 0.86) * cos(dot(w, vec2(-0.5, 0.86)) * 2.1 + TIME * 1.2 + 1.7) * 2.1 * 0.6;
        gr += vec2(0.2, 0.98) * cos(dot(w, vec2(0.2, 0.98)) * 3.7 - TIME * 1.6 + 0.4) * 3.7 * 0.3 * fade;
        gr += vec2(0.95, -0.3) * cos(dot(w, vec2(0.95, -0.3)) * 6.3 + TIME * 2.1) * 6.3 * 0.15 * fade;
        vec3 n = normalize(vec3(-gr.x * amp * 0.12, 1.0, -gr.y * amp * 0.12));
        // The broad beam reflection sees a calmer surface than the lamp's glints do.
        vec3 nSoft = normalize(vec3(n.x * 0.35, 1.0, n.z * 0.35));
        rr = reflect(r, nSoft);
        rg = reflect(r, n);
        rr.y = max(rr.y, 0.002);
        rr = normalize(rr);
        float cosI = clamp(dot(-r, n), 0.0, 1.0);
        fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
        waveDetail = fade;
    }
    for (int k = 0; k < 4; k++) {
        float a = th - blurStep * float(k) * 0.25;
        vec3 dir = beamDir(a);
        sc += scatter(vec3(0.0), r, dir, tMax, spreadK, g) * 0.25;
        if (sea) {
            scR += scatter(hp, rr, dir, 300.0, spreadK, g) * 0.25;
            // The lamp's glint on the water: bright where the lamp is aimed at that patch of sea.
            vec3 toL = normalize(LAMP - hp);
            float aimAt = dot(dir, -toL);
            float lit = exp(-(1.0 - aimAt) / (spreadK * spreadK * 0.9)) + 0.04;
            float spec = pow(max(dot(rg, toL), 0.0), 700.0);
            glit += spec * lit * 0.25;
        }
    }
    sc *= sigma * power * 0.45;
    col += beamC * sc;

    // The lantern itself: a small steady glow, and the full glare of the lens when it faces you.
    vec3 dirNow = beamDir(th);
    vec3 toCam = normalize(-LAMP);
    float face = exp(-(1.0 - dot(dirNow, toCam)) / (spreadK * spreadK * 1.6));
    vec2 lv = p - lampS;
    float ld = length(lv);
    float lantern = 0.5 * exp(-ld * ld / 0.000016) + 0.08 * exp(-ld / 0.012);
    float glare = face * power * (3.0 * exp(-ld * ld / 0.00006) + 0.5 * exp(-ld / 0.035) + 0.12 * exp(-ld / 0.12));
    // A hit over-exposes the lens round the lamp for about half a second, warm core, cool fringe.
    float bloom = pulse * sqrt(pulse);
    vec3 bloomC = beamC * (2.2 * exp(-ld * ld / 0.0022) + 0.7 * exp(-ld / 0.07)) + accent.rgb * 0.35 * exp(-ld / 0.16);
    vec3 lampLight = beamC * (lantern * (0.4 + 0.6 * power) + glare) + bloomC * bloom * (0.5 + 0.5 * face);

    // Sea: the reflected beam (Fresnel-weighted), the glitter path, and the lamp's mirror image.
    if (sea) {
        float refl = scR * sigma * power * 0.45 * fres * (1.0 - land);
        col += beamC * refl;
        float gl = glit * (0.6 + 2.5 * face * power + 1.5 * bloom) * (0.3 + 0.7 * waveDetail) * (1.0 - land);
        col += mix(beamC, vec3(1.0), 0.4) * gl * 1.4;
        // The lamp's own reflection: a stretched streak straight below it, broken by the swell.
        float mx = (p.x - lampS.x);
        float below = lampS.y - p.y;
        float streak = exp(-mx * mx / (0.00012 + 0.0004 * swellSea + below * 0.002)) * exp(-below * 3.0) * step(0.0, below);
        float rip = noise2(vec2(hp.x * 0.9 + TIME * 0.15, hp.z * 3.0 - TIME * 0.4));
        float broken = smoothstep(0.35, 0.75, rip) * (0.4 + 0.6 * waveDetail) + 0.15;
        col += beamC * streak * broken * (0.04 + 0.6 * face * power + 0.5 * bloom) * (1.0 - land) * fres * 6.0;
    }

    // Night: a faint cool glow along the horizon, mirrored dimly in the sea.
    float horiz = exp(-abs(p.y + HZ) / 0.09);
    vec3 night = accent.rgb * (0.06 * horiz + 0.014 * exp(-abs(p.y + HZ) / 0.35));
    // Light the beam throws back into the wider haze round the lamp.
    night += beamC * 0.05 * power * exp(-ld / 0.3) * (0.4 + 0.6 * haze);
    col += night * (1.0 - land) * (sea ? 0.6 : 1.0);

    // The headland and tower block what is behind them; the near lantern glow sits in front.
    float lx = lampS.x;
    float towerW = 0.0045 + 0.004 * clamp((lampS.y - p.y) / 0.06, 0.0, 1.0);
    float tower = smoothstep(towerW + px, towerW - px, abs(p.x - lx)) * step(p.y, lampS.y - 0.004) * step(top - 0.004, p.y);
    float solid = max(land, tower);
    col *= 1.0 - tower;
    // The rock is faintly lit by the beam's own haze, a dark warm-cool gray, never pure black.
    vec3 rock = mix(accent.rgb, beamC, 0.5) * 0.004 * (1.0 + 4.0 * face * power);
    col += rock * solid;
    col += lampLight;

    // Tone map on luminance so the beam keeps its colour, then a little dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.4));
    // Very hot light burns toward white, as it does on film.
    float burn = clamp(lum - 1.2, 0.0, 3.0) / 3.0;
    col = mix(col, vec3(1.0 - exp(-lum * 1.4)), burn * 0.7);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Light is as solid as it is bright; the headland and tower are solid silhouettes.
        float la = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        outa = max(la, solid);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
