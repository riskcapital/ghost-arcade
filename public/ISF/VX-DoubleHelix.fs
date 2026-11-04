/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A DNA double helix built from thousands of fine points, slowly turning as it leans across the frame. Two strands of dots spiral round each other, joined by dotted rungs; points in front of and behind the centre blur into larger, softer dots. Each hit unzips the helix from a spot along its length, throwing the strands apart and spraying their points before they wind back together, and the note's pitch winds the helix tighter or looser. A bright scan band runs along it once a bar.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "unzip", "LABEL": "Unzip", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "twist", "LABEL": "Twist", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "scatter", "LABEL": "Scatter", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "lean", "LABEL": "Lean", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Strands", "TYPE": "color", "DEFAULT": [0.55, 0.85, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Rungs", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.55, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxBar", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// Spacing of the point rings along the axis (frame heights).
const float DS = 0.0042;
// Helix radius and the camera distance used for the sideways perspective.
const float HR = 0.2;
const float CAMD = 1.7;
// Points per ring on each strand, and points across one rung.
const int PER = 6;
const float RUNG_PTS = 24.0;
const float RUNG_EVERY = 5.0;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// One dot: adds its coverage and light.
void addDot(vec2 q, vec2 c, float z, float sizePx, float px, vec3 col, float glow, inout float alpha, inout vec3 light) {
    // Out of focus in front of or behind the axis: bigger, softer, dimmer.
    float blur = clamp(abs(z) / HR, 0.0, 1.6);
    float rad = min(sizePx * (1.0 + 0.8 * blur * blur), 6.0);
    float d = length(q - c) / px;
    float soft = 0.6 + 1.2 * blur;
    float cov = clamp((rad - d) / soft + 0.5, 0.0, 1.0);
    if (cov <= 0.0) return;
    float op = cov * clamp(1.2 / (0.6 + 0.5 * blur * blur), 0.0, 1.0);
    // Points nearer the camera are a touch brighter.
    float b = op * (0.7 + 0.6 * clamp(0.5 + z / (2.0 * HR), 0.0, 1.0)) * glow;
    alpha = alpha + op * (1.0 - alpha);
    light += col * b;
}

void main() {
    float n = floor(vxCount + 0.5);

    // clock (1x1): last count seen, seconds since the last hit, velocity of that hit.
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float vel = newHit ? clamp(max(vxVel, vxHit), 0.3, 1.0) : c.b;
        gl_FragColor = vec4(n, age, vel, 0.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = FRAMEINDEX < 2 ? 30.0 : clk.g;
    float hitVel = FRAMEINDEX < 2 ? 0.0 : clk.b;
    if (vxHit > 0.01) {
        age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
        hitVel = max(hitVel, max(vxVel, vxHit));
    }
    if (n < 0.5 && vxHit < 0.01) age = 30.0;

    vec2 res = RENDERSIZE;
    float px = 1.0 / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) * px;

    // The axis leans across the frame: 0 lies flat, 0.5 stands upright.
    float ang = lean * 3.14159 + 0.05 * sin(TIME * 0.11);
    vec2 ax = vec2(cos(ang), sin(ang));
    vec2 pe = vec2(-ax.y, ax.x);
    float s = dot(p, ax);
    float a = dot(p, pe);

    float env = clamp(vxEnv, 0.0, 1.0);
    float tclk = TIME * 0.08 + vxPhase * 0.02;
    float spinA = tclk * mix(0.6, 5.0, spin);
    // Turns per frame height: the pitch winds it tighter or looser.
    float turns = mix(0.45, 1.9, twist) * mix(1.35, 0.6, clamp(vxGlide, 0.0, 1.0));
    float twK = turns * TAU;
    // Where the unzip starts and how far it has run.
    float s0 = (hash11(n * 7.13 + 1.7) - 0.5) * 0.8;
    float front = 0.05 + age * 1.1;
    float hitAmt = unzip * mix(0.55, 1.0, hitVel) * exp(-age * 1.6) * (1.0 - exp(-age * 25.0 - 0.3));
    // A scan band once a bar.
    float band = (fract(vxBar + 0.0001) - 0.5) * 2.4;
    float sizePx = mix(0.9, 2.6, pointSize) * res.y / 1080.0;
    float sprayBase = scatter * (0.3 + 1.4 * env);

    float alpha = 0.0;
    vec3 light = vec3(0.0);
    // Soft body light along each strand, so it reads as a solid shape.
    float halo = 0.0;

    float k0 = floor(s / DS + 0.5);
    for (int kk = -1; kk <= 1; kk++) {
        float k = k0 + float(kk);
        float sk = k * DS;
        // A gentle bend in the axis.
        float bend = 0.045 * sin(sk * 2.3 + tclk * 1.7) + 0.025 * sin(sk * 5.1 - tclk * 1.1);
        float th = sk * twK + spinA;
        // Unzip: strands pull apart behind the running front, most near where it started.
        float ds0 = abs(sk - s0);
        float zone = smoothstep(front, front - 0.15, ds0) * exp(-ds0 * 1.1);
        float u = hitAmt * zone;
        float rr = HR * (1.0 + 1.1 * u);
        float spray = sprayBase + 3.5 * u;
        float lit = 1.0 + 1.4 * exp(-pow((sk - band) / 0.06, 2.0)) + 1.0 * u;
        vec2 cA = vec2(rr * cos(th), rr * sin(th));
        // The second strand trails by a little less than half a turn (major and minor grooves).
        vec2 cB = vec2(rr * cos(th + 2.45), rr * sin(th + 2.45));
        for (int sIdx = 0; sIdx < 2; sIdx++) {
            vec2 cc = sIdx == 0 ? cA : cB;
            float scc = CAMD / (CAMD - cc.y);
            float dh = abs(a - bend - cc.x * scc);
            if (kk == 0) {
                halo = max(halo, exp(-pow(dh / (0.016 * (1.0 + spray)), 2.0)) * (0.55 + 0.45 * clamp(0.5 + cc.y / (2.0 * HR), 0.0, 1.0)));
            }
            // Skip the strand's points when this pixel is well clear of its tube.
            if (dh > 0.026 * (1.0 + spray) * 1.25 + 8.0 * px) continue;
            for (int m = 0; m < PER; m++) {
                float id = k * 13.0 + float(sIdx) * 7.0 + float(m) * 1.618;
                float h1 = hash11(id * 1.37 + 0.11);
                float h2 = hash11(id * 2.11 + 0.53);
                float h3 = hash11(id * 3.07 + 0.97);
                float rj = 0.02 * sqrt(h1) * (1.0 + spray);
                vec2 o = rj * vec2(cos(h2 * TAU), sin(h2 * TAU));
                vec2 xz = cc + o;
                float sc = CAMD / (CAMD - xz.y);
                vec2 c = vec2(bend + xz.x * sc, sk + (h3 - 0.5) * DS * 0.6);
                addDot(vec2(a, s), c, xz.y, sizePx, px, ink.rgb, lit, alpha, light);
            }
        }
        // Rungs every few rings: a dotted bar between the strands, split by the unzip.
        if (abs(mod(k, RUNG_EVERY)) < 0.5) {
            float pairType = hash11(k * 0.71 + 3.1);
            vec3 rungCol = pairType < 0.5 ? accent.rgb : mix(accent.rgb, ink.rgb, 0.4);
            float gap = clamp(u * 1.6, 0.0, 0.5);
            vec2 dAB = cB - cA;
            // Invert the perspective to find the rung point under this pixel.
            float aa = a - bend;
            float fz = (aa * (CAMD - cA.y) - CAMD * cA.x) / (CAMD * dAB.x + aa * dAB.y);
            // A faint line joins the rung's dots.
            if (fz > 0.03 && fz < 0.97 && abs(fz - 0.5) > gap) {
                float lineCov = exp(-pow((s - sk) / (0.9 * px), 2.0)) * 0.3;
                alpha = alpha + lineCov * (1.0 - alpha);
                light += rungCol * lineCov * lit;
            }
            float j0 = floor(fz * (RUNG_PTS - 1.0) + 0.5);
            for (int jj = -1; jj <= 1; jj++) {
                float j = j0 + float(jj);
                if (j >= 1.0 && j <= RUNG_PTS - 2.0) {
                    float f = j / (RUNG_PTS - 1.0);
                    if (abs(f - 0.5) >= gap) {
                        vec2 xz = cA + dAB * f;
                        // Broken halves fling outward with the unzip.
                        float side = f < 0.5 ? -1.0 : 1.0;
                        xz += u * 0.08 * side * normalize(dAB + 1e-5) * (0.5 + hash11(k + j * 3.3));
                        float sc = CAMD / (CAMD - xz.y);
                        vec2 c = vec2(bend + xz.x * sc, sk);
                        addDot(vec2(a, s), c, xz.y, sizePx * 1.05, px, rungCol, lit * 1.2, alpha, light);
                    }
                }
            }
        }
    }

    // Brighter overall with the sound.
    float gain = 0.85 + 0.45 * env + 0.25 * clamp(vxEnergy, 0.0, 1.0);
    light *= gain;
    float hA = halo * (vxClear ? 0.3 : 0.22) * gain;
    vec3 hCol = mix(ink.rgb, accent.rgb, 0.25) * hA;
    alpha = alpha + hA * (1.0 - alpha);
    light = min(light + hCol, vec3(1.0));
    alpha = clamp(alpha, 0.0, 1.0);

    vec4 outC;
    if (vxClear) {
        // Premultiplied: the light never exceeds the coverage.
        outC = vec4(min(light, vec3(alpha)), alpha);
    } else {
        // A dark lab backdrop with a faint glow along the axis.
        float r = length(p * vec2(0.8, 1.0));
        vec3 bg = mix(vec3(0.02, 0.022, 0.03), vec3(0.0), smoothstep(0.2, 0.95, r));
        float axisGlow = exp(-pow(a / 0.35, 2.0));
        bg += mix(ink.rgb, accent.rgb, 0.3) * 0.045 * axisGlow * (1.0 + env);
        outC = vec4(bg * (1.0 - alpha) + light, 1.0);
    }
    gl_FragColor = outC * vxPresence;
}
