/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A dark corridor drawn only in thin lines of light, receding to one vanishing point. Every hit of the sound it follows launches a frame of light from the far end that rushes at the camera, gathering speed, and passes it, leaving streaks along the rails. The corridor flares on each hit and settles to a faint structure.",
    "PASSES": [
        {
            "TARGET": "launchA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "launchB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "lastHit",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "depth", "LABEL": "Depth", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "corridorWidth", "LABEL": "Corridor width", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "corridorHeight", "LABEL": "Corridor height", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "rush", "LABEL": "Rush speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "frames", "LABEL": "Frames on screen", "TYPE": "float", "DEFAULT": 6, "MIN": 1, "MAX": 8 },
        { "NAME": "wallLines", "LABEL": "Wall lines", "TYPE": "float", "DEFAULT": 3, "MIN": 0, "MAX": 8 },
        { "NAME": "drift", "LABEL": "Camera drift", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "afterglow", "LABEL": "Afterglow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Newest frame", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Focal length: the view is one unit tall at distance F.
const float F = 0.8;
const float RIBS = 7.0;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float sdBox(vec2 q, vec2 b) {
    vec2 d = abs(q) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Coverage of a line w pixels wide at distance d pixels. aa is the size of one
// stored pixel across the line: lines never get thinner than that, and dim instead.
float lineCov(float d, float w, float aa) {
    float ww = max(w, aa);
    return clamp((0.5 * ww - d) / aa + 0.5, 0.0, 1.0) * min(w / aa, 1.0);
}

// Stored-pixel size across the nearest side of a box outline.
float boxAA(vec2 q, vec2 b, vec2 fw) {
    vec2 d = abs(q) - b;
    return d.x > d.y ? fw.x : fw.y;
}

// Run position (0 far end, 1 past the camera) to depth ease: a quick burst out of
// the far end on the hit, then a geometric glide that gathers pace toward the camera,
// so frames spread evenly along the corridor.
float runEase(float u) {
    return 0.1 * (1.0 - exp(-u / 0.04)) + 0.9 * u * (0.8 + 0.2 * u);
}

void main() {
    float n = floor(vxCount + 0.5);

    // State lives in 1x1 targets (one value per channel), which stay exact however
    // the core scales its pass buffers. launchA/launchB: each slot holds 1 + seconds
    // since its frame launched, or 0 when empty. lastHit: the count, the last beat
    // position, and the measured seconds per beat.
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    if (PASSINDEX < 2) {
        vec4 v = PASSINDEX == 0 ? IMG_NORM_PIXEL(launchA, vec2(0.5)) : IMG_NORM_PIXEL(launchB, vec2(0.5));
        float last = IMG_NORM_PIXEL(lastHit, vec2(0.5)).r;
        if (FRAMEINDEX < 2) v = vec4(0.0);
        // Frames age in real time; a slot empties once its frame is long gone.
        vec4 alive = step(0.5, v);
        v = (v + dt) * alive;
        v *= 1.0 - step(13.0, v);
        if (FRAMEINDEX >= 2 && abs(n - last) > 0.5) {
            float slot = mod(n, 8.0) - (PASSINDEX == 0 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            v = mix(v, vec4(1.0), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 2) {
        // Tempo from the beat clock, smoothed; 120 bpm until the clock moves.
        vec4 prev = IMG_NORM_PIXEL(lastHit, vec2(0.5));
        float spb = (FRAMEINDEX < 2 || prev.b < 0.1) ? 0.5 : prev.b;
        float step01 = mod(vxBeat - prev.g + 1.0, 1.0);
        if (FRAMEINDEX >= 2 && dt > 0.0 && step01 > 0.0005 && step01 < 0.3) {
            float measured = clamp(dt / step01, 0.25, 1.4);
            spb = mix(spb, measured, 1.0 - exp(-dt / 0.6));
        }
        gl_FragColor = vec4(n, vxBeat, spb, 1.0);
        return;
    }

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float pxs = 1.0 / RENDERSIZE.y;
    // The core may store this layer coarser than its render size; fw is one stored pixel.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float lw = max(mix(1.0, 3.6, lineWidth) * RENDERSIZE.y / 1080.0, 1.0);
    float Wc = mix(0.7, 2.6, corridorWidth);
    float Hc = mix(0.45, 1.5, corridorHeight);
    float zFar = mix(6.0, 26.0, depth);

    // The camera sways slowly inside the corridor and pans a little.
    float ph = vxPhase;
    vec2 cam = drift * vec2(0.32 * Wc * sin(ph * 0.45 + 0.3), 0.26 * Hc * sin(ph * 0.31 + 1.7));
    vec2 vp = drift * vec2(0.06 * sin(ph * 0.23 + 2.1), 0.035 * sin(ph * 0.19 + 0.5));
    vec2 q = p - vp;

    // Which surface this pixel sees, and how deep.
    float zh = 1e6;
    float zw = 1e6;
    if (q.y < -1e-5) zh = F * (-Hc - cam.y) / q.y;
    else if (q.y > 1e-5) zh = F * (Hc - cam.y) / q.y;
    if (q.x > 1e-5) zw = F * (Wc - cam.x) / q.x;
    else if (q.x < -1e-5) zw = F * (-Wc - cam.x) / q.x;
    bool horiz = zh < zw;
    float Z = min(zh, zw);
    bool inside = Z <= zFar;
    float fog = mix(1.0, 0.5, clamp(Z / zFar, 0.0, 1.0));

    // Rails: lines running the length of the corridor; the corners are the brightest.
    float rails = 0.0;
    float railMask = 0.0;
    if (inside) {
        float N = floor(wallLines + 0.5);
        float U = horiz ? Wc : Hc;
        float u = horiz ? cam.x + q.x * Z / F : cam.y + q.y * Z / F;
        float side = horiz ? sign(q.y) : sign(q.x);
        float uN = (u + U) / (2.0 * U) * (N + 1.0);
        float i0 = clamp(floor(uN), 0.0, N + 1.0);
        for (int j = 0; j < 2; j++) {
            float i = min(i0 + float(j), N + 1.0);
            float ui = -U + 2.0 * U * i / (N + 1.0);
            vec2 dir = horiz ? vec2(ui - cam.x, side * Hc - cam.y) : vec2(side * Wc - cam.x, ui - cam.y);
            dir = normalize(dir);
            float d = abs(q.x * dir.y - q.y * dir.x) / pxs;
            float aa = abs(dir.y) * fw.x + abs(dir.x) * fw.y;
            float corner = (i < 0.5 || i > N + 0.5) ? 1.0 : 0.0;
            float c = lineCov(d, lw, aa);
            rails = max(rails, c * mix(0.085, 0.19, corner));
            railMask = max(railMask, c * mix(0.6, 1.0, corner));
        }
        rails *= fog;
    }

    // Ribs: faint cross-sections at even depths; the last one is the far portal.
    float ribs = 0.0;
    {
        float ribGap = zFar / RIBS;
        float k0 = clamp(floor(Z / ribGap), 1.0, RIBS);
        for (int j = 0; j < 3; j++) {
            float k = clamp(k0 - 1.0 + float(j), 1.0, RIBS);
            float zk = k * ribGap;
            vec2 qk = q + cam * F / zk;
            vec2 bk = vec2(Wc, Hc) * F / zk;
            float d = abs(sdBox(qk, bk)) / pxs;
            float portal = (k > RIBS - 0.5) ? 1.0 : 0.0;
            ribs = max(ribs, lineCov(d, lw, boxAA(qk, bk, fw)) * mix(0.04, 0.14, portal) * mix(1.0, 0.5, zk / zFar));
        }
    }

    // Frames of light, newest first. Each travels in real time: the whole run takes
    // 2.5 beats at the default speed and gathers pace toward the camera (the last
    // stretch, from mid-corridor past the camera, takes about a beat).
    float nf = clamp(floor(frames + 0.5), 1.0, 8.0);
    float spb = clamp(IMG_NORM_PIXEL(lastHit, vec2(0.5)).b, 0.25, 1.4);
    float travel = 2.5 * spb / pow(2.0, (rush - 0.5) * 3.0);
    float zFill = 2.0 * F * max(Hc, Wc / aspect);
    // Run ends just past the edges of the view, so most of the run is on screen.
    float zEnd = 0.75 * zFill;
    float trail = mix(0.3, 6.0, afterglow * afterglow);
    float echoGap = mix(0.015, 0.06, afterglow);
    float frameLight = 0.0;
    float newest = 0.0;
    float streak = 0.0;
    vec4 slotsA = IMG_NORM_PIXEL(launchA, vec2(0.5));
    vec4 slotsB = IMG_NORM_PIXEL(launchB, vec2(0.5));
    for (int k = 0; k < 8; k++) {
        float slot = mod(n - float(k) + 64.0, 8.0);
        vec4 pickA = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
        vec4 pickB = 1.0 - step(0.5, abs(vec4(4.0, 5.0, 6.0, 7.0) - slot));
        float stored = dot(slotsA, pickA) + dot(slotsB, pickB);
        float age = stored - 1.0;
        float u = age / travel;
        if (float(k) < nf && stored > 0.5 && u < 1.0) {
            float zf = zFar * pow(zEnd / zFar, runEase(u));
            // Snaps on bright at launch, holds, and fades as it passes the camera.
            float b = (0.85 + 0.15 * exp(-age / 0.12)) * (1.0 - smoothstep(0.86, 1.0, u));
            float wpx = min(max(lw, 0.012 * F / zf * RENDERSIZE.y), 4.0 * lw + 2.0);
            vec2 qf = q + cam * F / zf;
            vec2 bf = vec2(Wc, Hc) * F / zf;
            float d = abs(sdBox(qf, bf)) / pxs;
            float c = lineCov(d, wpx, boxAA(qf, bf, fw));
            // A faint, tight halo so the frame carries at full size.
            c = (c + 0.1 * exp(-max(d - 0.5 * wpx, 0.0) / (1.5 * wpx))) * b;
            if (k == 0) newest = c;
            else frameLight += c;
            // Two faint echoes trail it, like a long exposure.
            for (int j = 1; j < 3; j++) {
                float ue = u - float(j) * echoGap;
                if (ue > 0.0) {
                    float ze = zFar * pow(zEnd / zFar, runEase(ue));
                    vec2 qe = q + cam * F / ze;
                    vec2 be = vec2(Wc, Hc) * F / ze;
                    float de = abs(sdBox(qe, be)) / pxs;
                    frameLight += lineCov(de, lw, boxAA(qe, be, fw)) * b * afterglow * (j == 1 ? 0.35 : 0.15);
                }
            }
            // It lights the rails behind it as it goes.
            if (inside && Z > zf) streak += b * exp(-(Z - zf) / trail);
        }
    }

    // Each hit flares the corridor for a moment, then it sinks back.
    float flare = clamp(vxEnv, 0.0, 1.0);
    float white = rails * (1.0 + 3.0 * flare) + railMask * min(streak, 1.0) * 0.8 + ribs * (1.0 + 1.5 * flare) + frameLight;
    white = min(white, 1.0);
    float acc = clamp(newest, 0.0, 1.0);
    vec3 col = ink.rgb * white * (1.0 - acc) + accent.rgb * acc;

    // Dither only where there is light, so black stays black.
    float lit = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lit);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
