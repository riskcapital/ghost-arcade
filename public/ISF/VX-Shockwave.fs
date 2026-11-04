/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A turning globe drawn in thousands of fine points, laid out in rings like a scan, with a smaller counter-turning core that breathes inside it. Every hit punches the globe outward and throws a shell of points off its surface that races out and fades as the hit dies away, while waves of light run outward through nested shells of sparse points around it. The sound's level swells the globe and speeds everything up, fast spins smear into soft streaks, and the note's pitch moves a bright ring of points up and down it.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "burst", "LABEL": "Burst", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "swell", "LABEL": "Swell", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "density", "LABEL": "Points", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "core", "LABEL": "Core", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Globe", "TYPE": "color", "DEFAULT": [0.85, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Shockwaves", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.15, 1.0] },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float PI = 3.14159265;
const float TAU = 6.2831853;
// Camera distance and focal length: a radius of 1 frame height at the centre fills the frame.
const float CAMD = 3.2;
const float FOC = 3.2;
const float R0 = 0.33;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

mat3 rotXY(float ax, float ay) {
    float cx = cos(ax);
    float sx = sin(ax);
    float cy = cos(ay);
    float sy = sin(ay);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
    mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
    return ry * rx;
}

vec2 project(vec3 w) {
    return w.xy * FOC / (CAMD - w.z);
}

// Point i of row j on the unit sphere: rows of latitude, each with points spread evenly round it.
vec3 latticePoint(float j, float i, float nRows, float nInRow, float seed, float jit) {
    float lat = (j + 0.5) * PI / nRows;
    float h1 = hash11(j * 7.31 + i * 1.97 + seed);
    float h2 = hash11(j * 3.17 + i * 5.13 + seed * 1.7);
    lat += (h1 - 0.5) * jit * PI / nRows;
    float lon = (i + hash11(j * 1.37 + seed) + (h2 - 0.5) * jit) * TAU / nInRow;
    float sl = sin(lat);
    return vec3(sl * cos(lon), cos(lat), sl * sin(lon));
}

// Dots of one point shell, both where the ray enters it and where it leaves.
// rot turns object space into view space; band is a latitude (0 top, 1 bottom) that glows.
void shellDots(vec2 p, vec3 rd, float R, mat3 rot, float nRows, float seed, float jit, vec3 col, float glow,
               float sizePx, float softK, float swing, float px, float band, vec3 bandCol, inout float alpha, inout vec3 light, inout float shadow) {
    vec3 ro = vec3(0.0, 0.0, CAMD);
    // A slightly fatter sphere, so dots on the rim are not clipped.
    float Rm = R + 6.0 * px * CAMD / FOC;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - Rm * Rm;
    float h = b * b - c;
    if (h < 0.0) return;
    h = sqrt(h);
    mat3 inv = transpose(rot);
    for (int side = 0; side < 2; side++) {
        float t = side == 0 ? -b - h : -b + h;
        vec3 q = normalize(inv * (ro + rd * t));
        float lat = acos(clamp(q.y, -1.0, 1.0));
        float lon = atan(q.z, q.x);
        float jr = floor(lat / PI * nRows);
        for (int dj = -1; dj <= 1; dj++) {
            float j = jr + float(dj);
            if (j < 0.0 || j > nRows - 1.0) continue;
            float latj = (j + 0.5) * PI / nRows;
            float nIn = max(3.0, floor(2.0 * nRows * sin(latj) + 0.5));
            float fi = fract(lon / TAU + 1.0) * nIn - hash11(j * 1.37 + seed);
            float i0 = floor(fi);
            for (int di = -1; di < 2; di++) {
                float i = mod(i0 + float(di) + nIn, nIn);
                vec3 u = latticePoint(j, i, nRows, nIn, seed, jit);
                vec3 w = rot * (u * R);
                vec2 sp = project(w);
                // Motion blur: each dot is drawn as a short streak back along its path over one
                // frame's turn, so fast spins smear instead of strobing.
                vec3 wPrev = w - swing * vec3(w.z, 0.0, -w.x);
                vec2 sq = project(wPrev);
                vec2 seg = sq - sp;
                float tt = clamp(dot(p - sp, seg) / max(dot(seg, seg), 1e-10), 0.0, 1.0);
                float d = length(sp + seg * tt - p) / px;
                float streak = length(seg) / px;
                // Depth of field: the far side is out of focus, larger and dimmer.
                float blur = clamp((-w.z) / R, 0.0, 1.0);
                float near = clamp(0.5 + 0.5 * w.z / R, 0.0, 1.0);
                float rad = sizePx * (1.0 + 0.9 * blur) * (FOC / (CAMD - w.z)) / (FOC / CAMD) * (vxClear ? mix(1.3, 2.1, near) : 1.0);
                float soft = (0.55 + 1.4 * blur) * softK;
                float cov = clamp((rad - d) / soft + 0.5, 0.0, 1.0);
                shadow = max(shadow, clamp((rad + 1.3 - d) / 0.9, 0.0, 1.0) * glow * mix(0.3, 1.0, near));
                if (cov > 0.0) {
                    float op = cov * mix(vxClear ? 0.35 : 0.22, 1.0, near) * rad / (rad + 0.45 * streak);
                    float bnd = 0.0;
                    float tw = 1.0;
                    if (band >= 0.0) {
                        float lt = j / nRows;
                        // The pitch ring, plus slow bands of light turning down the globe.
                        float sweep = pow(0.5 + 0.5 * sin(lt * TAU * 2.5 - vxFlow * 0.5), 10.0);
                        bnd = max(exp(-pow((lt - band) / 0.035, 2.0)), 0.55 * sweep);
                    }
                    float lum = op * glow * tw * (1.0 + 1.3 * bnd) * (vxClear ? 1.6 : 1.35);
                    // Dim points are see-through as well as dark.
                    alpha = alpha + min(vxClear ? max(lum, op) : lum, op) * (1.0 - alpha);
                    light += mix(col, bandCol, bnd) * lum;
                }
            }
        }
    }
}

void main() {
    vec2 res = RENDERSIZE;
    float px = 1.0 / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) * px;
    vec3 rd = normalize(vec3(p, -FOC));

    float env = clamp(vxSwell, 0.0, 1.0);
    float pls = clamp(vxPulse, 0.0, 1.0);
    // All motion runs on the flow clock, which the music speeds up and slows down.
    float tclk = vxFlow;
    float spinK = mix(0.15, 1.5, spin);
    float spinA = tclk * spinK;
    // How far the globe turns in about one frame (the flow clock's rate follows the studio's
    // smoothing: a quarter per second at rest, faster with the sound).
    float swing = spinK * (0.25 + 1.4 * clamp(vxSwell, 0.0, 1.0) + 0.9 * clamp(vxPulse, 0.0, 1.0)) / 22.0;
    float nRows = floor(mix(46.0, 110.0, density));
    // Never below about a pixel and a quarter, or moving points strobe on smaller outputs.
    float sizePx = max(mix(0.9, 2.6, pointSize) * res.y / 1080.0, 1.0);
    float band = 0.15 + 0.7 * (1.0 - clamp(vxGlide, 0.0, 1.0));

    // The globe breathes with the sound and is pushed outward by each surge.
    float R = R0 * (1.0 + swell * 0.18 * env + 0.16 * burst * pls);

    float alpha = 0.0;
    float shadow = 0.0;
    vec3 light = vec3(0.0);

    mat3 rot = rotXY(0.42 + 0.1 * sin(tclk * 0.3), spinA);
    float gain = 1.05 + 0.45 * env + 0.35 * pls;
    // Nested shells of sparse, soft points hang round the globe and turn slowly with it. Waves of
    // light run outward through them on the flow clock (faster when loud) and every surge
    // brightens the waves, so the shockwave travels as light rather than as flying points.
    float emit = tclk * 0.35;
    for (int s = 0; s < 3; s++) {
        float k = float(s) + 1.0;
        float Rs = R * (1.0 + k * mix(0.18, 0.55, burst));
        float wave = pow(0.5 + 0.5 * cos(TAU * (k * 0.33 - emit)), 4.0);
        float fade = ((0.14 + 0.35 * env) * (0.3 + 0.7 * wave) + 1.0 * pls * burst * wave * wave) * (1.0 - 0.2 * k);
        if (fade < 0.01 || burst < 0.01) continue;
        mat3 srot = rotXY(0.42 + k * 0.9, spinA * (1.0 - 0.25 * k) + k * 1.7);
        vec3 sc = mix(accent.rgb, vec3(1.0), 0.3 * wave * pls);
        float sRows = floor(nRows * (0.5 - 0.08 * k));
        shellDots(p, rd, Rs, srot, sRows, k * 7.31, 0.6, sc, fade * 1.2,
                  sizePx * 1.4, 2.0, swing * (1.0 - 0.25 * k), px, -1.0, sc, alpha, light, shadow);
        // The shell's edge glows where the wave is passing through it.
        float rs = Rs * FOC / sqrt(CAMD * CAMD - Rs * Rs);
        float e = (length(p) - rs) / (0.008 + 0.004 * k);
        float ringA = exp(-e * e) * min(fade * wave, 1.0) * 0.6;
        alpha = alpha + ringA * (1.0 - alpha);
        light += sc * ringA;
    }
    // The shockwave: each surge throws a shell of points off the surface; as the surge dies away
    // the shell races outward and fades. It turns with the smoothed hit count, so it never cuts.
    if (burst > 0.01 && pls > 0.01) {
        float away = 1.0 - pls;
        float Rw = R * (1.0 + away * mix(0.8, 3.2, burst));
        mat3 wrot = rotXY(vxMorph * 0.7 + 0.3, vxMorph * 1.3);
        vec3 wc = mix(accent.rgb, vec3(1.0), 0.5 * pls * pls);
        shellDots(p, rd, Rw, wrot, floor(nRows * 0.6), 11.0, 0.45 + 0.4 * away, wc, pls * 1.8,
                  sizePx * (1.2 + 0.8 * away), 1.0 + 2.0 * away, 0.0, px, -1.0, wc, alpha, light, shadow);
        float rw = Rw * FOC / sqrt(CAMD * CAMD - Rw * Rw);
        float ew = (length(p) - rw) / (0.006 + 0.03 * away);
        float ringW = exp(-ew * ew) * pls * 0.8;
        alpha = alpha + ringW * (1.0 - alpha);
        light += wc * ringW;
    }
    shellDots(p, rd, R, rot, nRows, 1.0, 0.08, ink.rgb, gain, sizePx, 1.0, swing, px, band, accent.rgb, alpha, light, shadow);
    if (core > 0.01) {
        mat3 crot = rotXY(-0.9, -spinA * 1.4 + 1.0);
        // The core breathes slowly on the flow clock and swells with each surge.
        float breath = 0.5 + 0.5 * sin(tclk * 1.2);
        float Rc = R * mix(0.3, 0.6, core) * (1.0 + 0.1 * breath + 0.35 * pls * burst);
        vec3 cc = mix(ink.rgb, accent.rgb, 0.55);
        shellDots(p, rd, Rc, crot, floor(nRows * 0.5), 3.0, 0.3, cc, gain * (0.7 + 0.4 * breath + 0.4 * pls), sizePx * 0.9, 1.0, -1.4 * swing, px, -1.0, cc, alpha, light, shadow);
    }

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
        float r = length(p);
        vec3 bg = mix(vec3(0.025, 0.027, 0.035), vec3(0.0), smoothstep(0.1, 0.95, r));
        bg += mix(ink.rgb, accent.rgb, 0.4) * 0.05 * exp(-r * r / 0.12) * (1.0 + env);
        outC = vec4(bg * (1.0 - alpha) + light, 1.0);
    }
    gl_FragColor = outC * vxPresence;
}
