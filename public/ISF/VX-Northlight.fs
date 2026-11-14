/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "DESCRIPTION": "Polar light seen from below. A few curtains float at different heights across a starry sky, their bright hems rippling through S-shaped folds and curling spirals. Every frame the light they leave is drawn up toward a point overhead, so each curtain trails rays that converge into the sky: clusters of faint rays, a few long brilliant ones, and dark sky between. The rays age from the first color at the hem to the second color high up. The music sets how fast the rays climb and the curtains sweep; the swell brightens them; each hit flares the hems toward white, sends a bright pulse racing along every curtain and ripples the whole sky, then it settles.",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "PASSES": [
        { "TARGET": "blurA", "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "blurB", "WIDTH": "$WIDTH/16", "HEIGHT": "$HEIGHT/16" },
        { "TARGET": "feedback", "PERSISTENT": true, "FLOAT": true },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "rise", "LABEL": "Rise", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "folds", "LABEL": "Folds", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ripple", "LABEL": "Ripple", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "echo", "LABEL": "Echo", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "wind", "LABEL": "Sweep", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "stars", "LABEL": "Stars", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.3, 1.0, 0.65, 1.0] },
        { "NAME": "accent", "LABEL": "Upper light", "TYPE": "color", "DEFAULT": [0.75, 0.3, 1.0, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxLevel", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 3 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Frames' worth of time this frame took (1 at 60 fps): every rate is per second.
float frameStep() { return clamp(TIMEDELTA * 60.0, 0.25, 4.0); }

float hash11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), u);
}

// The hits glide the folds: a phase that turns a whole number of times per 64 hits,
// so the wrap of the hit count is seamless.
float morphPhase(float turns) { return vxMorph * TAU * turns / 64.0; }

// The point overhead the rays climb toward (in height units, x across the width).
vec2 zenith(float aspect) { return vec2(aspect * 0.5, 1.75); }

// Rise: the fraction of the way to the zenith the light climbs each frame.
float riseRate(float s) {
    float level = clamp(vxLevel, 0.0, 3.0);
    return clamp(s * (0.0012 + 0.0036 * rise) * max(0.3, 1.0 + 0.6 * (level - 1.0)) * (1.0 + 0.4 * vxSwell)
               + s * 0.005 * rise * vxPulse, 0.0, 0.05);
}

// The feedback, filtered by hand: float targets may be fetched unfiltered, and the
// slow climb needs smooth in-between samples or it steps into fine lines.
vec4 fbAt(vec2 uv) {
    vec2 q = uv * RENDERSIZE - 0.5;
    vec2 i = floor(q);
    vec2 f = q - i;
    vec2 c = (i + 0.5) / RENDERSIZE;
    vec2 d = 1.0 / RENDERSIZE;
    vec4 a = mix(IMG_NORM_PIXEL(feedback, c), IMG_NORM_PIXEL(feedback, c + vec2(d.x, 0.0)), f.x);
    vec4 b = mix(IMG_NORM_PIXEL(feedback, c + vec2(0.0, d.y)), IMG_NORM_PIXEL(feedback, c + d), f.x);
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return mix(a, b, f.y) * inside;
}

// Where a hit's bright pulse is along the curtains (0..1 and a little beyond), and
// which way it runs. The hit count glides on a spring, so the pulse races off as
// it starts to move and slows as it settles.
float pulseAlong(float i) {
    float m = vxMorph;
    float k = ceil(m - 0.02);
    float prog = clamp(1.0 - (k - m), 0.0, 1.0);
    prog = clamp(prog * 1.25 - 0.12 * i, 0.0, 1.0);
    float u = mix(-0.25, 1.25, prog);
    return hash11(mod(k, 64.0) * 3.7 + i) < 0.5 ? u : 1.0 - u;
}

// One curtain's light poured this frame: rgb feeds the rays, a feeds the hem (a
// short-lived line of fresh light). p is in height units; climb is how far the
// light here moves this frame.
vec4 curtain(vec2 p, float aspect, float t, float i, float climb) {
    // The curtain's path across the sky: a bowed sweep between two ends that drift.
    float sweep = (0.08 + 0.2 * wind) * sin(t * 0.021 + i * 2.1);
    vec2 a, b;
    float bow;
    if (i < 0.5) {
        // Low and near: rising from the lower left, sagging like hung cloth.
        a = vec2(aspect * 0.04 + sweep, 0.12 + 0.04 * sin(t * 0.031));
        b = vec2(aspect * 0.6 + sweep, 0.38 + 0.05 * sin(t * 0.027 + 1.0));
        bow = -0.08;
    } else if (i < 1.5) {
        // Further off: falling from the middle of the sky to the lower right.
        a = vec2(aspect * 0.48 - sweep, 0.58 + 0.04 * sin(t * 0.024 + 2.0));
        b = vec2(aspect * 1.05 - sweep, 0.24 + 0.04 * sin(t * 0.033 + 3.0));
        bow = -0.06;
    } else {
        // Overhead: a long arc high in the sky, its rays fanning into the zenith.
        a = vec2(aspect * 0.08 + 0.5 * sweep, 0.64 + 0.03 * sin(t * 0.029 + 4.0));
        b = vec2(aspect * 0.94 + 0.5 * sweep, 0.73 + 0.03 * sin(t * 0.022 + 5.0));
        bow = 0.1;
    }
    vec2 D = b - a;
    float L = length(D);
    vec2 T = D / L;
    vec2 N = vec2(-T.y, T.x);
    // Cheap reject: far from the bowed path, this curtain adds nothing here.
    float along = dot(p - a, T) / L;
    float off = dot(p - a, N);
    float Rmax = 0.03 + 0.07 * folds;
    float ac = clamp(along, 0.0, 1.0);
    if (abs(off - bow * 4.0 * ac * (1.0 - ac)) > Rmax * 1.2 + 0.07 || along < -0.12 || along > 1.12) return vec4(0.0);
    // Folds and curls: the hem winds around its path at an uneven pace and an
    // uneven reach, so some folds stay gentle S-bends and others loop back on
    // themselves into spirals.
    float k = (4.0 + 1.3 * i) * TAU;
    float ph = t * 0.05 + i * 1.7 + morphPhase(1.0);
    float wob = t * 0.045 + i * 3.0;
    float rph = t * 0.05 + i * 1.3;
    const float STEP = 0.015;
    float u = along - 7.0 * STEP;
    // Poured as a soft line about as wide as the light climbs in one frame, so the
    // frames overlap into an even trail and never print as steps.
    float sig = max(0.7 * climb, 1.2 / RENDERSIZE.y);
    float inv2 = 1.0 / (2.0 * sig * sig);
    vec2 prev = vec2(0.0);
    float best = 0.0;
    float bu = 0.0;
    vec2 bdir = vec2(1.0, 0.0);
    for (int j = 0; j < 15; j++) {
        float ang = k * u + ph + 2.4 * sin(u * 4.7 + wob) + 0.9 * sin(u * 11.3 - wob * 1.3);
        float reach = 0.5 + 0.5 * sin(u * 3.1 + rph);
        float R = Rmax * (0.2 + 0.8 * reach * reach);
        vec2 cur = a + D * u + N * (bow * 4.0 * u * (1.0 - u)) + R * (T * sin(ang) - N * 0.75 * cos(ang));
        if (j > 0) {
            vec2 seg = cur - prev;
            float sl = max(dot(seg, seg), 1e-8);
            float h = clamp(dot(p - prev, seg) / sl, 0.0, 1.0);
            vec2 dv = p - prev - seg * h;
            // The strongest nearby stretch of hem wins; its own taper counts, so a
            // curl crossing a faded end never cuts a notch.
            float uu = u - STEP * (1.0 - h);
            float sc = exp(-dot(dv, dv) * inv2) * smoothstep(0.0, 0.14, uu) * smoothstep(1.0, 0.82, uu);
            if (sc > best) { best = sc; bu = uu; bdir = seg / sqrt(sl); }
        }
        prev = cur;
        u += STEP;
    }
    float line = best * 0.57 * min(climb / sig, 1.6);
    if (line < 0.001) return vec4(0.0);
    float taper = 1.0;
    // Uneven rays: clusters and gaps, many faint threads, a few long brilliant rays.
    float fine = noise1(bu * L * 60.0 + i * 31.0);
    float cluster = noise1(bu * L * 6.0 + i * 11.0 + t * 0.02);
    float rare = smoothstep(0.8, 0.96, noise1(bu * L * 19.0 + i * 7.0));
    float rays = (0.06 + 0.9 * fine * fine * fine) * (0.15 + 1.4 * cluster * cluster) + 2.2 * rare * (0.4 + cluster);
    // Edge-on folds, where the hem runs along the rays, gather into bright lines.
    float edgeOn = 1.0 + 2.2 * smoothstep(0.55, 0.95, abs(dot(bdir, normalize(zenith(aspect) - p))));
    // A hit's pulse racing along the curtain.
    float pu = pulseAlong(i);
    float du = (bu - pu) * L;
    float race = vxPulse * exp(-du * du / 0.012);
    float depth = 1.0 - 0.25 * i;
    float lvl = (0.08 + 0.3 * vxSwell + 0.2 * vxPulse) * depth;
    vec3 c = mix(ink.rgb, mix(ink.rgb, accent.rgb, 0.4), i * 0.5);
    float e = line * taper * (rays * edgeOn * lvl + race * 0.25 * min(rays, 1.5));
    c = mix(c, vec3(1.0), clamp(race * 0.3 + 0.15 * vxPulse, 0.0, 0.5));
    // The hem: an unbroken bright line along the curtain's lower edge, folds and
    // curls included, flaring on hits and where the pulse runs.
    float hem = line * taper * depth * (0.16 + 0.34 * vxSwell + 0.3 * vxPulse + 3.6 * race) * (0.6 + 0.25 * min(rays, 2.0)) * sqrt(edgeOn);
    return vec4(c * e, hem);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = vxFlow;
    float s = frameStep();

    if (PASSINDEX == 0) {
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
        vec2 p = uv * vec2(aspect, 1.0);
        vec2 Z = zenith(aspect);
        float k = riseRate(s);
        // Climb: the light is drawn toward the point overhead, so rays converge into
        // the sky and slow as they recede.
        vec2 sp = Z + (p - Z) / (1.0 - k);
        // A gentle sideways lean that drifts over the sky.
        sp.x += s * (0.0002 + 0.0005 * wind) * sin(p.y * 3.0 + t * 0.07);
        vec2 src = sp / vec2(aspect, 1.0);
        // Soften along the rays only, so their sides stay crisp.
        vec2 rd = normalize(Z - p) / vec2(aspect, 1.0) * (2.5 / RENDERSIZE.y);
        vec4 prev = fbAt(src) * 0.5 + fbAt(src + rd) * 0.25 + fbAt(src - rd) * 0.25;
        prev = clamp(prev, 0.0, 1.0);
        // Age: as the light climbs it turns toward the upper colour.
        float lum = max(prev.r, max(prev.g, prev.b));
        vec3 up = accent.rgb / max(max(accent.r, max(accent.g, accent.b)), 0.05);
        prev.rgb = mix(prev.rgb, up * lum * 0.85, clamp(s * 0.03, 0.0, 1.0));
        // Fade: Echo sets how long the rays linger.
        float keep = pow(mix(0.935, 0.983, echo) + 0.004 * vxSwell, max(s, 1.0));
        vec4 col = max(prev * keep - vec4(0.0012 * max(s, 1.0)), vec4(0.0));
        if (FRAMEINDEX < 2) col = vec4(0.0);
        float climb = length(p - Z) * k;
        // The hem line keeps only a few frames: it climbs a step or two and is gone,
        // so it stays a crisp bright edge.
        col.a = prev.a * pow(0.55, s);
        vec4 add = vec4(0.0);
        for (int i = 0; i < 3; i++) add += curtain(p, aspect, t, float(i), climb);
        col = col + add * (1.0 - col);
        gl_FragColor = clamp(col, 0.0, 1.0);
        return;
    }

    // The picture. A hit ripples the whole sky in travelling waves that settle; a
    // slow breath of the same waves keeps the curtains alive between hits.
    float rip = (0.0015 + 0.003 * ripple) * (1.0 + vxSwell) + (0.006 + 0.018 * ripple) * vxPulse;
    vec2 wob = vec2(sin(uv.y * 9.0 + uv.x * aspect * 3.0 - t * 1.6 + morphPhase(3.0)),
                    0.6 * sin(uv.x * aspect * 7.0 - uv.y * 2.0 - t * 1.3));
    vec2 q = uv + rip * wob * vec2(1.0 / aspect, 1.0);
    vec3 fb = clamp(IMG_NORM_PIXEL(feedback, q).rgb, 0.0, 1.0);
    // Glow that streams up along the rays, toward the point overhead.
    vec2 p = q * vec2(aspect, 1.0);
    vec2 rdir = normalize(zenith(aspect) - p) / vec2(aspect, 1.0) * (5.0 / RENDERSIZE.y);
    vec3 streak = vec3(0.0);
    float sw = 0.0;
    for (int j = -2; j <= 8; j++) {
        float fj = float(j);
        float w = exp(-fj * fj / (j < 0 ? 3.0 : 24.0));
        streak += IMG_NORM_PIXEL(blurA, q - rdir * fj).rgb * w;
        sw += w;
    }
    streak /= sw;
    vec3 wide = IMG_NORM_PIXEL(blurB, q).rgb;
    vec4 fb4 = clamp(IMG_NORM_PIXEL(feedback, q), 0.0, 1.0);
    float hemA = IMG_NORM_PIXEL(blurA, q).a;
    vec3 hemCol = mix(ink.rgb, vec3(1.0), 0.25 + 0.35 * vxPulse);
    vec3 light = fb * 1.8 + hemCol * (fb4.a * 2.2 + hemA * (0.4 + 0.6 * glow)) + streak * (0.25 + 0.6 * glow) + wide * (0.15 + 0.45 * glow) * (1.0 + 0.8 * vxPulse);
    vec3 col = 1.0 - exp(-light * 1.3);
    // The hottest light blooms to white.
    col = mix(col, vec3(1.0), smoothstep(0.9, 2.2, luma(light)) * 0.75);
    float alpha = 1.0;
    if (vxClear) {
        alpha = clamp(max(col.r, max(col.g, col.b)) * 1.6, 0.0, 1.0);
    } else {
        // Night sky, deep overhead; the sky between curtains deepens further.
        vec3 tint = mix(ink.rgb, accent.rgb, 0.5);
        vec3 sky = mix(vec3(0.008, 0.012, 0.026) + tint * 0.006, vec3(0.001, 0.002, 0.007), smoothstep(0.0, 1.0, uv.y));
        float near = clamp(luma(wide) * 5.0, 0.0, 1.0);
        float here = clamp(luma(streak) * 4.0, 0.0, 1.0);
        vec3 deep = mix(vec3(0.0, 0.004, 0.03), accent.rgb * 0.02, 0.3);
        sky = mix(sky, deep, near * (1.0 - here) * 0.8);
        // Stars ride the same ripple; hidden behind the curtains.
        vec2 g = (gl_FragCoord.xy + rip * wob * RENDERSIZE.y) / RENDERSIZE.y * 85.0;
        vec2 cell = floor(g);
        float h = hash21(cell);
        vec2 spt = cell + 0.2 + 0.6 * vec2(hash21(cell + 17.3), hash21(cell + 41.9));
        float r = length(g - spt) / 85.0;
        float on = step(1.0 - 0.2 * stars, h);
        float bright = on * pow(fract(h * 37.0), 3.0) * (0.75 + 0.25 * sin(TIME * (0.6 + 1.2 * fract(h * 91.0)) + h * 50.0));
        float star = exp(-r * r / (0.0011 * 0.0011)) * bright;
        sky += vec3(0.85, 0.9, 1.0) * star * (1.0 - here);
        col = sky + col * (1.0 - sky);
    }
    col *= vxPresence;
    alpha *= vxPresence;
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}
