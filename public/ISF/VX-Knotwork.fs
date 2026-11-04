/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A knot tied from a single tube of streaming points, tumbling slowly in space. The points flow along the knot like particles in a loop; those nearest you are large and soft, the far side small and dim. The sound's level fills the tube in, from a sparse ghost at rest to a dense glowing rope when loud, and every hit sends a bright pulse racing round the knot that bulges the tube as it passes. Knot picks the shape.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "fill", "LABEL": "Fill", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "pulse", "LABEL": "Pulse", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "thickness", "LABEL": "Thickness", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "knot", "LABEL": "Knot", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Trefoil", "Star", "Coil"] },
        { "NAME": "ink", "LABEL": "Rope", "TYPE": "color", "DEFAULT": [1.0, 0.78, 0.45, 1.0] },
        { "NAME": "accent", "LABEL": "Pulses", "TYPE": "color", "DEFAULT": [0.35, 0.6, 1.0, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float PI = 3.14159265;
const float TAU = 6.2831853;
const float CAMD = 3.2;
const float FOC = 1.95;
// Curve samples used to find which part of the knot is near a pixel.
const int NS = 96;
// Point rings along the knot, and points per ring.
const float NRINGS = 960.0;
const int PER = 8;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// Knot point and its torus frame at parameter ph (0..TAU).
// pq: windings; RR, rr: torus radii.
vec3 knotPos(float ph, vec2 pq, float RR, float rr) {
    float a = pq.x * ph;
    float b = pq.y * ph;
    float k = RR + rr * cos(b);
    return vec3(k * cos(a), k * sin(a), -rr * sin(b));
}

void main() {
    float n = floor(vxCount + 0.5);

    // clock (1x1): last count seen, seconds since each of the last two hits.
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 30.0, 0.0);
        vec2 ages = min(c.gb + dt, vec2(30.0));
        if (abs(n - c.r) > 0.5) ages = vec2(0.0, ages.x);
        gl_FragColor = vec4(n, ages, 0.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    vec2 ages = FRAMEINDEX < 2 ? vec2(30.0) : clk.gb;
    if (vxHit > 0.01) ages.x = min(ages.x, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
    if (n < 0.5 && vxHit < 0.01) ages = vec2(30.0);

    vec2 res = RENDERSIZE;
    float px = 1.0 / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) * px;
    float env = clamp(vxEnv, 0.0, 1.0);

    vec2 pq = knot == 1 ? vec2(2.0, 5.0) : (knot == 2 ? vec2(3.0, 7.0) : vec2(2.0, 3.0));
    float RR = knot == 2 ? 0.52 : 0.55;
    float rr = knot == 1 ? 0.24 : (knot == 2 ? 0.2 : 0.27);
    float tube = mix(0.025, 0.075, thickness);

    float tclk = TIME * 0.05 + vxPhase * 0.012;
    // Tumble.
    float ya = tclk * 1.1;
    float pa = 0.9 + 0.35 * sin(tclk * 0.7);
    float cy = cos(ya);
    float sy = sin(ya);
    float cpa = cos(pa);
    float spa = sin(pa);
    mat3 rot = mat3(1.0, 0.0, 0.0, 0.0, cpa, spa, 0.0, -spa, cpa) * mat3(cy, sy, 0.0, -sy, cy, 0.0, 0.0, 0.0, 1.0);

    float swell = 1.0 + 0.06 * env + 0.05 * exp(-ages.x * 4.0) * pulse;
    // Points stream along the knot.
    float flowOff = mod((TIME * 0.4 + vxPhase * 0.1) * mix(0.0, 6.0, flow), NRINGS);
    // Each hit's pulse starts somewhere new and runs round the knot.
    float pulseA = mod(hash11(n * 3.1) * TAU + ages.x * 3.2, TAU);
    float pulseB = mod(hash11((n - 1.0) * 3.1) * TAU + ages.y * 3.2, TAU);
    float fadeA = pulse * exp(-ages.x * 1.2);
    float fadeB = pulse * exp(-ages.y * 1.2);
    // How many of each ring's points are showing.
    float showFrac = clamp(mix(0.35, 0.85, fill) + (vxClear ? 0.1 : 0.0) + mix(0.15, 0.3, fill) * env + 0.25 * fadeA, 0.0, 1.0);
    float sizePx = mix(0.9, 2.6, pointSize) * res.y / 1080.0;

    float alpha = 0.0;
    float shadow = 0.0;
    vec3 light = vec3(0.0);
    float halo = 0.0;

    float rMax = (RR + rr + tube * 2.5) * swell * FOC / (CAMD - RR - rr);
    if (length(p) < rMax) {
        float dph = TAU / float(NS);
        float ringStep = TAU / NRINGS;
        float scl = FOC / (CAMD - 0.5);
        // Pixel distance within which a stretch of the knot can put a point here.
        float reach = tube * (1.0 + 0.9 * max(fadeA, fadeB)) * swell * scl * 1.15 + 6.0 * px;
        // Walk the knot by rotating the two winding angles a step at a time.
        float ca = 1.0;
        float sa = 0.0;
        float cb = 1.0;
        float sb = 0.0;
        float cda = cos(pq.x * dph);
        float sda = sin(pq.x * dph);
        float cdb = cos(pq.y * dph);
        float sdb = sin(pq.y * dph);
        vec3 w0 = rot * vec3(RR + rr, 0.0, 0.0) * swell;
        vec2 s0 = w0.xy * FOC / (CAMD - w0.z);
        int done = 0;
        for (int k = 1; k <= NS; k++) {
            float na = ca * cda - sa * sda;
            sa = sa * cda + ca * sda;
            ca = na;
            float nb = cb * cdb - sb * sdb;
            sb = sb * cdb + cb * sdb;
            cb = nb;
            float kk = RR + rr * cb;
            vec3 w1 = rot * vec3(kk * ca, kk * sa, -rr * sb) * swell;
            vec2 s1 = w1.xy * FOC / (CAMD - w1.z);
            vec2 sd = s1 - s0;
            float tt = clamp(dot(p - s0, sd) / max(dot(sd, sd), 1e-8), 0.0, 1.0);
            float ds = length(p - s0 - sd * tt);
            float zMid = mix(w0.z, w1.z, tt);
            float hz = clamp(0.5 + 0.5 * zMid / (RR + rr), 0.0, 1.0);
            // A faint glow along the rope.
            halo = max(halo, exp(-pow(ds / (tube * scl), 2.0)) * mix(0.3, 1.0, hz));
            if (ds < reach && done < 10) {
                done++;
                float ph1 = float(k) * dph;
                float ph0 = ph1 - dph;
                float phs = ph0 + tt * dph;
                float iStar = floor(phs / ringStep - flowOff + 0.5);
                float iLo = ceil(ph0 / ringStep - flowOff);
                float iHi = ceil(ph1 / ringStep - flowOff) - 1.0;
                for (int di = -1; di <= 1; di++) {
                    float i = iStar + float(di);
                    if (i < iLo || i > iHi) continue;
                    float phr = (i + flowOff) * ringStep;
                    vec3 c = knotPos(phr, pq, RR, rr);
                    vec3 core = vec3(RR * cos(pq.x * phr), RR * sin(pq.x * phr), 0.0);
                    vec3 c2 = knotPos(phr + 0.002, pq, RR, rr);
                    vec3 tg = normalize(c2 - c);
                    vec3 n1 = normalize(c - core);
                    vec3 n2 = normalize(cross(tg, n1));
                    n1 = cross(n2, tg);
                    // Bulge and glow where a pulse is passing.
                    float dA = abs(mod(phr - pulseA + PI, TAU) - PI);
                    float dB = abs(mod(phr - pulseB + PI, TAU) - PI);
                    float pz = fadeA * exp(-dA * dA / 0.02) + fadeB * exp(-dB * dB / 0.02);
                    float ri = mod(i + NRINGS, NRINGS);
                    for (int m = 0; m < PER; m++) {
                        float id = ri * 7.0 + float(m);
                        float h1 = hash11(id * 1.731 + 0.3);
                        if (h1 > showFrac) continue;
                        float ang = float(m) * 2.39996 + ri * 1.3 + hash11(id * 3.3) * 0.8;
                        float rad = tube * (0.6 + 0.4 * hash11(id * 5.1)) * (1.0 + 0.9 * pz);
                        vec3 P = (c + rad * (cos(ang) * n1 + sin(ang) * n2)) * swell;
                        vec3 w = rot * P;
                        vec2 sp = w.xy * FOC / (CAMD - w.z);
                        float d = length(sp - p) / px;
                        float zf = clamp(0.5 + 0.5 * w.z / (RR + rr), 0.0, 1.0);
                        // Depth of field: the near side swells into soft dots, the far side shrinks.
                        float blur = clamp((zf - 0.75) / 0.25, 0.0, 1.0);
                        float dr = sizePx * mix(0.75, 1.0, zf) * (1.0 + 1.4 * blur * blur) * (vxClear ? mix(1.4, 2.3, zf) : 1.0);
                        float soft = 0.6 + 1.8 * blur;
                        float cov = clamp((dr - d) / soft + 0.5, 0.0, 1.0);
                        shadow = max(shadow, clamp((dr + 1.3 - d) / 0.9, 0.0, 1.0) * mix(0.4, 1.0, zf));
                        if (cov <= 0.0) continue;
                        float op = cov * mix(vxClear ? 0.8 : 0.4, 1.0, zf) * mix(1.0, 0.6, blur);
                        vec3 col = mix(ink.rgb, mix(accent.rgb, vec3(1.0), 0.3), clamp(pz * 1.3, 0.0, 1.0));
                        alpha = alpha + op * (1.0 - alpha);
                        light += col * op * (1.4 + 1.2 * pz) * (vxClear ? mix(1.0, 1.8, zf) : 1.0);
                    }
                }
            }
            w0 = w1;
            s0 = s1;
        }
    }

    float gain = 0.85 + 0.4 * env + 0.2 * clamp(vxEnergy, 0.0, 1.0);
    light *= gain;
    float hA = vxClear ? 0.0 : halo * (0.07 + 0.1 * env);
    alpha = alpha + hA * (1.0 - alpha);
    light += mix(ink.rgb, accent.rgb, 0.3) * hA;
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
        vec3 bg = mix(vec3(0.03, 0.028, 0.035), vec3(0.0), smoothstep(0.1, 0.95, r));
        bg += mix(ink.rgb, accent.rgb, 0.5) * 0.035 * exp(-r * r / 0.2) * (1.0 + env);
        outC = vec4(bg * (1.0 - alpha) + light, 1.0);
    }
    gl_FragColor = outC * vxPresence;
}
