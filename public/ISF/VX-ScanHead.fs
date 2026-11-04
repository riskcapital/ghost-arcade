/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A 3D scan of a human head turning slowly on a turntable, drawn only as thousands of fine points laid in horizontal scan rings. A laser ring sweeps down the face once a bar, lighting the points it passes. Each hit knocks a band of rings loose: they spin out of line and spring outward, smearing the face, then lock back into place. The sound's level brightens and swells the points, and the note's pitch turns the head to look left or right.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "scatter", "LABEL": "Scatter", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "density", "LABEL": "Scan rings", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "turn", "LABEL": "Turn", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "laser", "LABEL": "Laser", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Scan", "TYPE": "color", "DEFAULT": [0.8, 0.9, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Laser", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.6, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBar", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float PI = 3.14159265;
const float TAU = 6.2831853;
const float CAMD = 3.4;
const float FOC = 2.6;
// Bottom of the neck, below the head's centre.
const float NECK_L = 0.68;
const float BOUND = 0.82;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float feat(float yaw, float pit, float y0, float p0, float sy, float sp, float h) {
    float a = (yaw - y0) / sy;
    float b = (pit - p0) / sp;
    return h * exp(-a * a - b * b);
}

// Distance from the head's centre to its surface along the unit direction u
// (face toward +z, up +y).
float headR(vec3 u) {
    float yaw = atan(u.x, u.z);
    float ay = abs(yaw);
    float pit = asin(clamp(u.y, -1.0, 1.0));
    float jaw = smoothstep(-0.1, -0.8, pit) * (1.0 - smoothstep(1.6, 2.6, ay));
    float a = 0.33 * (1.0 - 0.28 * jaw);
    float b = 0.46;
    float c = (u.z > 0.0 ? 0.39 : 0.46) * (1.0 - 0.12 * jaw);
    vec3 e = u / vec3(a, b, c);
    float R = inversesqrt(dot(e, e));
    // Features, as bumps over the angles round the head.
    R += feat(yaw, pit, 0.0, -0.06, 0.07, 0.2, 0.06);
    R += feat(yaw, pit, 0.0, -0.21, 0.12, 0.07, 0.075);
    R += feat(ay, pit, 0.16, -0.27, 0.07, 0.05, 0.02);
    R += feat(ay, pit, 0.34, 0.1, 0.13, 0.09, -0.06);
    R += feat(ay, pit, 0.3, 0.25, 0.26, 0.06, 0.03);
    R += feat(ay, pit, 0.62, -0.1, 0.18, 0.13, 0.03);
    R += feat(yaw, pit, 0.0, -0.4, 0.17, 0.05, 0.035);
    R += feat(yaw, pit, 0.0, -0.5, 0.15, 0.045, 0.03);
    R += feat(yaw, pit, 0.0, -0.455, 0.26, 0.018, -0.02);
    R += feat(yaw, pit, 0.0, -0.74, 0.2, 0.1, 0.045);
    R += feat(ay, pit, 1.62, 0.0, 0.09, 0.2, 0.07);
    // The neck: a short column, cut flat at the bottom.
    if (u.y < -0.2) {
        float cp = sqrt(max(1.0 - u.y * u.y, 0.0));
        float Rn = min(0.17 / max(cp, 0.02), NECK_L / max(-u.y, 0.02));
        float k = 0.08;
        float hh = clamp(0.5 + 0.5 * (Rn - R) / k, 0.0, 1.0);
        R = mix(R, Rn, hh) + k * hh * (1.0 - hh);
    }
    return R;
}

void main() {
    float n = floor(vxCount + 0.5);

    // clock (1x1): last count seen, seconds since the last hit.
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 0.0);
        float age = abs(n - c.r) > 0.5 ? 0.0 : min(c.g + dt, 30.0);
        gl_FragColor = vec4(n, age, 0.0, 0.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = FRAMEINDEX < 2 ? 30.0 : clk.g;
    if (vxHit > 0.01) age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
    if (n < 0.5 && vxHit < 0.01) age = 30.0;

    vec2 res = RENDERSIZE;
    float px = 1.0 / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) * px;
    float env = clamp(vxEnv, 0.0, 1.0);

    // The head sits a little high so the neck runs off toward the bottom.
    vec3 off = vec3(0.0, 0.08, 0.0);
    float tclk = TIME * 0.05 + vxPhase * 0.012;
    float yaw = tclk * mix(0.0, 3.0, turn) + (clamp(vxGlide, 0.0, 1.0) - 0.5) * 1.4 + 0.5 * sin(tclk * 0.9);
    float nod = 0.12 + 0.06 * sin(tclk * 1.3);
    float cy = cos(yaw);
    float sy = sin(yaw);
    float cn = cos(nod);
    float sn = sin(nod);
    // obj -> view: yaw about y, then nod about x.
    mat3 rot = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
    rot = mat3(1.0, 0.0, 0.0, 0.0, cn, sn, 0.0, -sn, cn) * rot;
    mat3 inv = transpose(rot);

    vec3 ro = inv * (vec3(0.0, 0.0, CAMD) - off);
    vec3 rd = inv * normalize(vec3(p, -FOC));

    float nRows = floor(mix(60.0, 130.0, density));
    // A hit knocks loose a band of rings around a random height.
    float hitA = scatter * exp(-age * 2.6) * (1.0 - exp(-age * 30.0 - 0.25));
    float bandC = 0.2 + 0.55 * hash11(n * 3.7 + 0.3);
    float sizePx = mix(0.9, 2.5, pointSize) * res.y / 1080.0 * (1.0 + 0.3 * env);
    // The laser ring sweeps down once a bar.
    float laserLat = mix(0.1, 0.78, fract(vxBar + 0.0001));

    float alpha = 0.0;
    float shadow = 0.0;
    vec3 light = vec3(0.0);
    float body = 0.0;

    float b = dot(ro, rd);
    float cc = dot(ro, ro) - BOUND * BOUND;
    float hq = b * b - cc;
    if (hq > 0.0) {
        float t = -b - sqrt(hq);
        float tEnd = -b + sqrt(hq);
        float hitT = -1.0;
        for (int i = 0; i < 40; i++) {
            vec3 q = ro + rd * t;
            float lq = length(q);
            vec3 u = q / max(lq, 1e-4);
            float lat = acos(clamp(u.y, -1.0, 1.0)) / PI;
            float jj = floor(lat * nRows);
            float bw = exp(-pow((lat - bandC) / 0.12, 2.0));
            float kRow = 1.0 + hitA * bw * 0.35 * hash11(jj * 1.7 + n);
            float f = lq - headR(u) * kRow;
            if (f < 0.0015) {
                hitT = t;
                break;
            }
            t += max(f * 0.6, 0.002);
            if (t > tEnd) break;
        }
        if (hitT > 0.0) {
            body = 1.0;
            vec3 q = ro + rd * hitT;
            vec3 u = normalize(q);
            float lat = acos(clamp(u.y, -1.0, 1.0));
            float lon = atan(u.z, u.x);
            float jr = floor(lat / PI * nRows);
            // Surface normal from two nearby directions, for a key light and a rim.
            float e = 0.01;
            vec3 u1 = normalize(u + vec3(0.0, e, 0.0));
            vec3 tg = normalize(cross(u, vec3(0.0, 1.0, 0.0)) + 1e-4);
            vec3 u2 = normalize(u + tg * e);
            float R0h = length(q);
            vec3 P1 = u1 * headR(u1);
            vec3 P2 = u2 * headR(u2);
            vec3 nrm = normalize(cross(P2 - q, P1 - q));
            if (dot(nrm, u) < 0.0) nrm = -nrm;
            vec3 nv = rot * nrm;
            float key = clamp(dot(nv, normalize(vec3(-0.5, 0.55, 0.65))), 0.0, 1.0);
            float rimL = pow(1.0 - clamp(nv.z, 0.0, 1.0), 3.0);
            float shade = 0.2 + 0.85 * key + 0.5 * rimL;
            for (int dj = -1; dj <= 1; dj++) {
                float j = jr + float(dj);
                if (j < 0.0 || j > nRows - 1.0) continue;
                float latj = (j + 0.5) * PI / nRows;
                float nIn = max(4.0, floor(2.0 * nRows * sin(latj) + 0.5));
                float bw = exp(-pow((latj / PI - bandC) / 0.12, 2.0));
                float hj = hash11(j * 1.7 + n);
                // Loose rings slide round and push out.
                float slide = hitA * bw * (hash11(j * 2.9 + n * 1.3) - 0.5) * 2.4;
                float kRow = 1.0 + hitA * bw * 0.35 * hj;
                float fi = fract((lon - slide) / TAU + 1.0) * nIn - 0.5 * mod(j, 2.0);
                float i0 = floor(fi);
                for (int di = 0; di < 2; di++) {
                    float i = i0 + float(di);
                    float lonp = (i + 0.5 * mod(j, 2.0)) * TAU / nIn + slide;
                    float sl = sin(latj);
                    vec3 ul = vec3(sl * cos(lonp), cos(latj), sl * sin(lonp));
                    float Rl = headR(ul) * kRow;
                    vec3 w = rot * (ul * Rl) + off;
                    vec2 sp = w.xy * FOC / (CAMD - w.z);
                    float d = length(sp - p) / px;
                    // Nearer points a touch larger.
                    float nearF = clamp(0.5 + 1.5 * w.z, 0.6, 1.3);
                    float dsz = sizePx * (vxClear ? 1.85 * nearF : 1.0);
                    float cov = clamp((dsz - d) / 0.7 + 0.5, 0.0, 1.0);
                    shadow = max(shadow, clamp((dsz + 1.3 - d) / 0.9, 0.0, 1.0));
                    if (cov <= 0.0) continue;
                    // Points facing away from the camera are fainter.
                    float facing = 1.0;
                    // The neck fades away below the jaw instead of ending in a cut.
                    float cut = 1.0 - smoothstep(0.4, NECK_L * 0.9, -ul.y * Rl);
                    cut *= cut;
                    float lz = exp(-pow((latj / PI - laserLat) / 0.018, 2.0)) * laser;
                    float trail = laser * step(latj / PI, laserLat) * exp(-(laserLat - latj / PI) * 9.0) * 0.5;
                    vec3 col = mix(ink.rgb, accent.rgb, clamp(lz + trail * 0.6 + hitA * bw * 0.5, 0.0, 1.0));
                    float op = cov * cut * clamp((vxClear ? 0.7 : 0.3) + shade, 0.0, 1.0);
                    float lum = op * (shade + 2.2 * lz + trail) * (vxClear ? 1.7 : 1.2);
                    alpha = alpha + op * (1.0 - alpha);
                    light += col * lum;
                }
            }
        }
    }

    light *= 0.85 + 0.45 * env + 0.2 * clamp(vxEnergy, 0.0, 1.0);
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
        float r = length(p - vec2(0.0, 0.05));
        vec3 bg = mix(vec3(0.03, 0.033, 0.045), vec3(0.0), smoothstep(0.1, 0.9, r));
        bg += accent.rgb * 0.03 * exp(-r * r / 0.15);
        bg *= 1.0 - 0.6 * body;
        outC = vec4(bg * (1.0 - alpha) + light, 1.0);
    }
    gl_FragColor = outC * vxPresence;
}
