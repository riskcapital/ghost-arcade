/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Looking up at a rippling water surface from below: a bright round window of sky with a coloured rim, the moving net of sun on the waves, and long shafts of light slanting down into the deep. Each hit drops a ring on the surface and makes the shafts flash; a held sound lengthens and brightens them, and pitch leans the sun. With the background off only the light is left: the bright surface and its rays.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "rays", "LABEL": "Light shafts", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "waves", "LABEL": "Waves", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "drops", "LABEL": "Drop rings", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "depth", "LABEL": "Depth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "lookUp", "LABEL": "Look up", "TYPE": "float", "DEFAULT": 0.75, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.6, 0.95, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Rim", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.4, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

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

// Sun on a moving water surface: an iterated wave field whose bright folds
// form the sharp, branching lines of real ripple light.
float waterLight(vec2 p, float t) {
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int k = 0; k < 5; k++) {
        float tk = t * (1.0 - (3.5 / float(k + 1)));
        i = p + vec2(cos(tk - i.x) + sin(tk + i.y), sin(tk - i.y) + cos(tk + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + tk) / inten), p.y / (cos(i.y + tk) / inten)));
    }
    c /= 5.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
}

void main() {
    float n = floor(vxCount + 0.5);
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        // An all-zero texel means a fresh buffer (the voice was just added):
        // start from "no hit for a long time" rather than a fake hit.
        if (c.a < 0.5) c = vec4(n, 30.0, 0.0, 1.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float vel = newHit ? clamp(vxVel, 0.4, 1.0) : c.b;
        gl_FragColor = vec4(n, age, vel, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    bool fresh = clk.a < 0.5;
    float age = fresh ? 30.0 : clk.g;
    float hv = fresh ? 0.0 : clk.b;
    if (vxHit > 0.01) {
        age = min(age, 0.25 * (1.0 - clamp(vxHit, 0.0, 1.0)) + 0.05);
        hv = max(hv, max(vxVel, 0.5));
    }
    float flash = exp(-age * 4.0) * hv;

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    p *= max(1.0, 1.5 / aspect);
    bool clearMode = vxClear;

    float t = vxPhase * mix(0.05, 0.4, speed) + TIME * 0.04;
    float energy = clamp(vxEnv, 0.0, 1.0);

    // Camera under water, tilted up toward the surface.
    float pitch = mix(0.05, 0.35, lookUp);
    vec3 fw = vec3(0.0, sin(pitch), cos(pitch));
    vec3 rt = vec3(1.0, 0.0, 0.0);
    vec3 upv = cross(fw, rt);
    vec3 rd = normalize(fw * 0.75 + rt * p.x + upv * p.y);

    // Sun direction under water: steep, leaned by pitch and slowly wandering.
    float lean = (vxGlide - 0.5) * 0.5 + 0.12 * sin(t * 0.21);
    vec3 Lw = normalize(vec3(lean, 1.0, 0.25 + 0.1 * cos(t * 0.17)));

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // Where the shafts converge on screen: the sun's direction projected.
    float lz = dot(Lw, fw);
    vec2 vp = vec2(dot(Lw, rt), dot(Lw, upv)) / max(lz, 0.05) * 0.75;

    // The surface overhead.
    float surfH = 1.0;
    float cosV = rd.y;
    float surfMask = smoothstep(0.0, 0.04, cosV);
    vec2 sp = rd.xz / max(cosV, 0.02) * surfH;

    // Drop ring: lands near the middle of the window, a new spot every hit.
    vec2 dropAt = vec2((hash11(n * 3.7 + 1.0) - 0.5) * 1.8, 1.0 + hash11(n * 5.3 + 2.0) * 0.8);
    float rr = length(sp - dropAt);
    float front = age * 2.2 + 0.03;
    float ringEnv = exp(-age * 1.1) * hv * drops;
    float ringX = rr - front;
    float ringWave = sin(ringX * 26.0) * exp(-ringX * ringX / (0.02 + 0.06 * age)) * ringEnv;
    vec2 bend = (sp - dropAt) / max(rr, 1e-3) * ringWave * 0.12;

    float wz = mix(1.2, 3.0, waves);
    vec2 wq = (sp + bend) * wz;
    vec2 warpv = vec2(noise2(wq * 0.5 + vec2(t * 0.3, 0.0)), noise2(wq * 0.5 + vec2(4.0, -t * 0.25))) - 0.5;
    float wl = waterLight(wq * 1.3 - 250.0, t * 1.2);
    // Far away the pattern shrinks below a pixel: let it fade to its average.
    float fw2 = length(fwidth(wq));
    float lines = mix(clamp(wl * 3.0, 0.0, 4.0), 0.3, smoothstep(0.08, 0.35, fw2));
    float facets = smoothstep(0.0, 0.6, wl);
    float ringX2 = ringX + 0.12 + 0.1 * age;
    float ringLine = (exp(-ringX * ringX / 0.004) + 0.5 * exp(-ringX2 * ringX2 / 0.003)) * ringEnv;

    // Snell's window: straight up you see the bright sky, beyond 48.6 degrees
    // the surface turns into a dark mirror. The edge carries a coloured rim.
    float cosUp = dot(rd, vec3(0.0, 1.0, 0.0));
    float wEdge = 0.6613;
    float window = smoothstep(wEdge - 0.015, wEdge + 0.03, cosUp + 0.03 * (warpv.x - 0.25) + 0.02 * ringWave);
    float rimD = cosUp - wEdge - 0.01 + 0.03 * (warpv.x - 0.25) + 0.02 * ringWave;
    float rim = exp(-rimD * rimD / 0.00004);
    float sunDisk = pow(max(dot(rd, Lw), 0.0), 120.0);

    float surfLight = (lines * (0.5 + 0.5 * energy) + facets * 0.1) * mix(0.35, 1.0, window) + ringLine * 2.4;
    float distFade = exp(-max(1.0 / max(cosV, 0.02) - 1.2, 0.0) * 0.35);
    surfLight *= distFade;
    vec3 surfCol = ink.rgb * surfLight;
    surfCol += mix(ink.rgb, vec3(1.0), 0.6) * window * (0.18 + 0.25 * facets) * distFade;
    surfCol += mix(accent.rgb, ink.rgb, smoothstep(-0.01, 0.01, rimD)) * rim * (0.7 + 0.8 * flash) * distFade;
    surfCol += vec3(1.0) * sunDisk * (1.0 + flash);

    // Shafts: streaks fanning down from the sun's point, carrying the
    // surface pattern down into the water.
    vec2 dv = p - vp;
    float ang = atan(dv.x, -dv.y);
    float rlen = length(dv);
    float a1 = ang * 34.0;
    float sh = noise2(vec2(a1, t * 0.6)) * 0.6 + noise2(vec2(a1 * 2.3 + 7.0, t * 0.9)) * 0.4;
    sh = pow(smoothstep(0.3, 0.9, sh), 1.6);
    float sh2 = pow(noise2(vec2(ang * 18.0 + 3.0, t * 0.3)), 2.0);
    float reach = mix(0.6, 1.8, depth) * (0.7 + 0.5 * energy + 0.3 * flash);
    // Distance from where the shafts leave the surface on this column.
    float fromTop = max(rlen - (vp.y - 0.3), 0.0);
    float shaftFade = exp(-fromTop / reach);
    float shaft = (sh * 0.9 + sh2 * 0.5) * shaftFade * rays * (1.2 + 0.5 * energy + 1.0 * flash);
    vec3 shaftCol = mix(ink.rgb, mix(ink.rgb, accent.rgb, 0.35), smoothstep(0.0, 1.0, fromTop)) * shaft * 0.9;

    vec3 light = surfCol * surfMask + shaftCol;
    float lum = dot(light, vec3(0.3333));

    if (clearMode) {
        alpha = 1.0 - exp(-2.6 * lum);
        alpha = max(alpha, surfMask * window * 0.25 * distFade);
        vec3 c2 = light / (1.0 + 0.2 * max(light.r, max(light.g, light.b)));
        c2 = min(max(c2, 0.0), vec3(alpha));
        gl_FragColor = vec4(c2, alpha) * vxPresence;
    } else {
        // Water: brighter toward the surface, dark below, tinted by the light.
        vec3 deep = mix(vec3(0.003, 0.01, 0.02), ink.rgb * 0.07 + vec3(0.0, 0.02, 0.04), smoothstep(-0.7, 0.3, p.y));
        vec3 mirror = mix(vec3(0.01, 0.02, 0.035), ink.rgb * 0.12, 0.5) * (0.7 + 0.6 * facets);
        vec3 base = mix(deep, mirror, surfMask * (1.0 - window));
        base = mix(base, mix(ink.rgb, vec3(1.0), 0.4) * 0.35, surfMask * window * distFade);
        col = base + light;
        col = col / (1.0 + 0.2 * max(col.r, max(col.g, col.b)));
        col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(col, 0.0, 1.0) * vxPresence, 1.0);
    }
}
