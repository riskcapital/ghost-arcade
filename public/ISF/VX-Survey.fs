/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A flight over a mountain landscape captured as a laser survey: thousands of points on a grid, joined by faint contour lines, sharp in the distance and softening into large out-of-focus dots close to the camera, streaking as they rush past. A laser line sweeps out across the ground, lighting the points it passes and leaving a fading glow. Ridges roll away across the land and every hit throws them up in the laser's color before they settle; the music speeds the flight and the note's pitch raises or flattens the mountains.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "quake", "LABEL": "Quake", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "relief", "LABEL": "Mountains", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "contours", "LABEL": "Contour lines", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "scan", "LABEL": "Laser", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Sweeping", "Sweeps on each hit", "Off"] },
        { "NAME": "ink", "LABEL": "Ground", "TYPE": "color", "DEFAULT": [0.6, 0.95, 0.85, 1.0] },
        { "NAME": "accent", "LABEL": "Laser", "TYPE": "color", "DEFAULT": [1.0, 0.25, 0.35, 1.0] },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// Grid spacing of the survey points (world units), camera height and focal length.
const float G = 0.05;
const float CAMH = 0.5;
const float FOC = 1.5;
const float PITCH = 0.17;
const float ZNEAR = 1.0;
const float ZFAR = 9.0;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Ground height at a world point (z already includes the distance flown).
float ground(vec2 xz, float amp, float wave) {
    float r = 1.0 - abs(2.0 * vnoise(xz * 0.55) - 1.0);
    float h = r * r * 0.75;
    h += 0.35 * vnoise(xz * 1.3 + 7.1);
    h += 0.12 * vnoise(xz * 3.1 - 3.7);
    // Keep a valley down the middle so the flight path stays clear.
    float valley = smoothstep(0.2, 1.6, abs(xz.x - 0.4 * sin(xz.y * 0.23)));
    return (h * (0.3 + 0.9 * valley) - 0.3) * amp + 0.45 * wave;
}

// Height of the rolling ridges at a distance z from the camera.
float quakeAt(float z, float qAmt, float qz) {
    float c = 0.5 + 0.5 * cos((z - qz) * 1.6);
    c *= c;
    return qAmt * c * c * smoothstep(0.8, 2.0, z);
}

void main() {
    // Distance flown, on the flow clock: the music speeds the flight up and slows it down.
    float travel = vxFlow * mix(0.12, 1.0, speed);
    float pls = clamp(vxPulse, 0.0, 1.0);
    // Ground covered in about a frame (the flow clock's rate follows the studio's smoothing).
    float shutterZ = mix(0.12, 1.0, speed) * (0.25 + 1.4 * clamp(vxSwell, 0.0, 1.0) + 0.9 * pls) / 26.0;

    vec2 res = RENDERSIZE;
    float px = 1.0 / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) * px;
    float env = clamp(vxSwell, 0.0, 1.0);

    // Camera: drifting gently side to side, pitched down at the land.
    float sway = 0.25 * sin(travel * 0.21) + 0.1 * sin(travel * 0.53 + 1.0);
    float bank = -0.06 * cos(travel * 0.21);
    vec2 pr = vec2(p.x * cos(bank) - p.y * sin(bank), p.x * sin(bank) + p.y * cos(bank));
    float cp = cos(PITCH);
    float sp = sin(PITCH);
    vec3 rd0 = normalize(vec3(pr, FOC));
    vec3 rd = vec3(rd0.x, rd0.y * cp - rd0.z * sp, rd0.y * sp + rd0.z * cp);
    vec3 ro = vec3(sway, CAMH, 0.0);

    float amp = mix(0.35, 1.5, relief) * mix(0.6, 1.4, clamp(vxGlide, 0.0, 1.0));
    // Low ridges roll away across the ground; each surge throws them up, then they settle.
    float qAmt = quake * (0.06 + 0.12 * env + 0.6 * pls);
    float qz = vxFlow * 0.7;

    // March to the ground.
    float t = ZNEAR / max(rd.z, 0.2);
    float hitT = -1.0;
    for (int i = 0; i < 72; i++) {
        vec3 q = ro + rd * t;
        if (q.z > ZFAR || q.y > 1.2) break;
        float w = quakeAt(q.z, qAmt, qz);
        float d = q.y - ground(vec2(q.x, q.z + travel), amp, w);
        if (d < 0.0015 * t) {
            hitT = t;
            break;
        }
        t += max(d * 0.6, 0.006 * t);
    }

    float alpha = 0.0;
    float shadow = 0.0;
    vec3 light = vec3(0.0);
    float body = 0.0;
    // Where the laser line is now (distance from the camera).
    // It sweeps out on the flow clock, or once per hit on the smoothed hit count; it fades in
    // near the camera and out in the distance, so it never jumps back.
    float beamPos = scan == 1 ? fract(vxMorph) : fract(vxFlow * 0.25);
    float zBeam = mix(ZNEAR, ZFAR * 0.85, beamPos * beamPos * 0.6 + beamPos * 0.4);
    float beamFade = smoothstep(0.0, 0.12, beamPos) * (1.0 - smoothstep(0.7, 0.98, beamPos));
    bool beamOn = scan != 2;

    if (hitT > 0.0) {
        vec3 hp = ro + rd * hitT;
        float zw = hp.z + travel;
        float fog = 1.0 - smoothstep(ZFAR * 0.55, ZFAR, hp.z);
        body = fog;
        float ix0 = floor(hp.x / G);
        float iz0 = floor(zw / G + 0.5) - 2.0;
        // Rows per pixel here: far rows crowd together, so their dots shrink to fit.
        float fz = max(fwidth(zw / G), 1e-3);
        float flash = pls * quake;
        float sizeBase = max(mix(1.0, 2.6, pointSize) * res.y / 1080.0, 1.2) * (1.0 + 0.35 * env);
        for (int jz = 0; jz < 4; jz++) {
            for (int jx = 0; jx < 2; jx++) {
                vec2 cell = vec2(ix0 + float(jx), iz0 + float(jz));
                vec2 jit = vec2(hash21(cell), hash21(cell + 17.3)) - 0.5;
                vec2 gx = cell * G + jit * G * 0.3;
                float zc = gx.y - travel;
                float w = quakeAt(zc, qAmt, qz);
                vec3 P = vec3(gx.x, ground(gx, amp, w), zc);
                vec3 v = P - ro;
                vec3 vc = vec3(v.x, v.y * cp + v.z * sp, -v.y * sp + v.z * cp);
                if (vc.z < 0.2) continue;
                vec2 s = FOC * vc.xy / vc.z;
                s = vec2(s.x * cos(bank) + s.y * sin(bank), -s.x * sin(bank) + s.y * cos(bank));
                // Motion blur: a short streak back to where the point was a frame ago (farther
                // off), so the ground streams past instead of strobing.
                vec3 vq = vc + vec3(0.0, sp, cp) * shutterZ;
                vec2 s2 = FOC * vq.xy / vq.z;
                s2 = vec2(s2.x * cos(bank) + s2.y * sin(bank), -s2.x * sin(bank) + s2.y * cos(bank));
                vec2 seg = s2 - s;
                float tt = clamp(dot(p - s, seg) / max(dot(seg, seg), 1e-10), 0.0, 1.0);
                float d = length(s + seg * tt - p) / px;
                float streak = length(seg) / px;
                // Near points go out of focus: larger, softer, fainter.
                float blur = clamp((3.0 - vc.z) / 1.9, 0.0, 1.0);
                float rad = min(sizeBase * (vxClear ? 1.85 : 1.0) * (1.0 + 2.5 * blur * blur) * (1.0 + 0.6 * clamp(w * 1.6, 0.0, 1.0)), max((vxClear ? 0.5 : 0.45) / fz, 0.8));
                float soft = 0.6 + 5.0 * blur;
                float cov = clamp((rad - d) / soft + 0.5, 0.0, 1.0);
                float pf0 = 1.0 - smoothstep(ZFAR * 0.5, ZFAR, vc.z);
                shadow = max(shadow, clamp((rad + 1.3 - d) / 0.9, 0.0, 1.0) * pf0);
                if (cov <= 0.0) continue;
                float pf = 1.0 - smoothstep(ZFAR * 0.5, ZFAR, vc.z);
                // Lit by the laser as it passes, with a fading trail behind it.
                float behind = zBeam - zc;
                float lit = beamOn ? (exp(-pow(behind / 0.08, 2.0)) * 2.0 + smoothstep(-0.05, 0.05, behind) * exp(-max(behind, 0.0) * 1.5) * 0.6) * beamFade : 0.0;
                float hl = clamp((P.y + 0.2 * amp) / (0.8 * amp), 0.0, 1.0);
                vec3 col = mix(ink.rgb * (0.85 + 0.8 * hl), accent.rgb, clamp(lit * 0.6, 0.0, 1.0)) * (1.0 + lit * 0.5);
                float wn = clamp(w * 3.0, 0.0, 1.0);
                col = mix(col, accent.rgb, wn) * (1.0 + 0.6 * wn + 0.35 * flash);
                float op = cov * pf * mix(1.0, vxClear ? 0.55 : 0.3, blur) * rad / (rad + 0.4 * streak);
                alpha = alpha + op * (1.0 - alpha);
                light += col * op * (vxClear ? 1.6 : 1.0);
            }
        }
        // Faint contour lines along each row of points.
        float rz = abs(fract(zw / G + 0.5) - 0.5);
        float line = (1.0 - smoothstep(0.0, 1.2, rz / fz)) * contours * 0.4 * fog * clamp(0.15 / fz, 0.0, 1.0);
        float wh = quakeAt(hp.z, qAmt, qz);
        line *= 1.0 + 3.0 * wh;
        alpha = alpha + line * (1.0 - alpha);
        light += mix(ink.rgb, accent.rgb, clamp(wh * 2.0, 0.0, 1.0)) * line * 0.8;
        // The laser line itself, where the beam meets the ground.
        if (beamOn) {
            float bz = abs(hp.z - zBeam);
            float fb = max(fwidth(hp.z), 1e-4);
            // Fade the beam in as it leaves the camera, so it never floods the foreground.
            float bfade = smoothstep(ZNEAR + 0.1, ZNEAR + 0.7, zBeam) * beamFade;
            float laser = exp(-pow(bz / (fb * 1.5), 2.0)) * fog * bfade;
            float halo = exp(-bz / (fb * 10.0 + 0.02)) * 0.35 * fog * bfade;
            alpha = alpha + (laser + halo) * (1.0 - alpha);
            light += mix(accent.rgb, vec3(1.0), 0.6) * laser * 1.5 + accent.rgb * halo;
        }
    }

    light *= 0.9 + 0.35 * env + 0.25 * pls;
    if (!vxClear) light = min(light, vec3(1.0));
    alpha = clamp(alpha, 0.0, 1.0);

    vec4 outC;
    if (vxClear) {
        // Keep the hue at full strength: scale over-bright light down rather than clipping it to white,
        // and let a thin dark rim round each point lift it off a bright picture.
        float mx = max(max(light.r, light.g), max(light.b, 1e-4));
        // Points stay bright: dimmer ones fade out rather than going dark.
        float lev = clamp(mx / max(alpha, 1e-4), 0.0, 1.0);
        float aPt = alpha * smoothstep(0.0, 0.45, lev);
        vec3 rgb = light / mx * aPt * mix(0.8, 1.0, lev);
        float aOut = aPt + shadow * 0.32 * (1.0 - aPt);
        outC = vec4(rgb, aOut);
    } else {
        // Night sky fading to a faint glow on the horizon.
        float hy = p.y + 0.18;
        vec3 bg = mix(vec3(0.03, 0.035, 0.05), vec3(0.0), smoothstep(-0.2, 0.5, hy));
        bg += mix(ink.rgb, accent.rgb, 0.3) * 0.08 * exp(-abs(hy - 0.12) * 9.0);
        bg *= 1.0 - 0.7 * body;
        outC = vec4(bg * (1.0 - alpha) + light, 1.0);
    }
    gl_FragColor = outC * vxPresence;
}
