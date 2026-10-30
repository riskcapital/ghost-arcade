/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A big speaker driver seen from just off-axis, drawn as fine lines: frame, rolled surround, ribbed cone, dust cap and paper grain. Every hit of the sound it follows pumps the cone out and back with a springy overshoot, and the dust lying on the cone jumps and falls back.",
    "PASSES": [
        {
            "TARGET": "cone",
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
        { "NAME": "excursion", "LABEL": "Excursion", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "rings", "LABEL": "Cone rings", "TYPE": "float", "DEFAULT": 8, "MIN": 3, "MAX": 24 },
        { "NAME": "dust", "LABEL": "Dust", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "bounce", "LABEL": "Bounce decay", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "perspective", "LABEL": "Perspective", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "grain", "LABEL": "Paper grain", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "lightAngle", "LABEL": "Light angle", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Rim light", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// cone: (excursion, velocity / W0, seconds since the last hit, last count + 1).
// The driver, in its own units: axis +z toward the viewer, frame face at z = 0.
const float RC = 0.21;   // dust cap edge
const float RS = 0.68;   // cone rim, where the surround starts
const float RM = 0.765;  // crest of the surround roll
const float RF = 0.85;   // surround meets the frame
const float RO = 1.0;    // outer edge of the frame
const float DEPTH = 0.3;
const float CAP = 0.085;
const float ROLL = 0.055;
const float W0 = 26.0;   // cone resonance, radians per second
const float TAU = 6.2831853;
const int DUST = 44;

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

// Height of the moving surface at radius r for cone excursion x (object units).
float surfaceH(float r, float x) {
    if (r < RC) {
        float u = r / RC;
        return x - DEPTH + CAP * (1.0 - u * u);
    }
    if (r < RS) {
        float s = (r - RC) / (RS - RC);
        return x - DEPTH * pow(1.0 - s, 1.35);
    }
    if (r < RF) {
        float u = (r - RM) / (RF - RM);
        float roll = ROLL * sqrt(max(0.0, 1.0 - u * u));
        return roll + x * (RF - r) / (RF - RS);
    }
    if (r <= RO) return 0.0;
    return -9.0;
}

// Anti-aliased iso-line of q at every integer; w = line radius in rendered pixels
// (fwidth counts the pixels the core really renders). Lines that crowd closer
// than a few pixels fade instead of shimmering.
float isoLine(float q, float w) {
    float fw = max(fwidth(q), 1e-6);
    float d = abs(fract(q + 0.5) - 0.5) / fw;
    float l = exp(-d * d / (w * w));
    return l * (1.0 - smoothstep(0.2, 0.42, fw));
}

// A single circle r = r0, drawn the same way.
// Where the surface hit jumps (an occluding edge) fwidth explodes; cap it so no
// stray line appears along the jump.
float ringLine(float r, float r0, float w) {
    float fw = clamp(fwidth(r), 1e-6, 0.03);
    float d = abs(r - r0) / fw;
    return exp(-d * d / (w * w));
}

void main() {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 s = IMG_NORM_PIXEL(cone, vec2(0.5));
        float n = floor(vxCount + 0.5);
        bool ready = s.w > 0.5 && FRAMEINDEX >= 2;
        float x = ready ? s.x : 0.0;
        float v = ready ? s.y * W0 : 0.0;
        float age = ready ? s.z + dt : 30.0;
        if (ready && abs(s.w - (n + 1.0)) > 0.5) age = 0.0;
        // A damped spring pushed by the sound's level: it pumps out, overshoots back, rings down.
        float zeta = mix(0.42, 0.11, bounce);
        float h = dt / 8.0;
        for (int i = 0; i < 8; i++) {
            float acc = W0 * W0 * (vxEnv - x) - 2.0 * zeta * W0 * v;
            v += acc * h;
            x += v * h;
        }
        gl_FragColor = vec4(clamp(x, -2.0, 2.0), clamp(v / W0, -4.0, 4.0), min(age, 30.0), n + 1.0);
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float pxs = max(1.0, max(fwp.x, fwp.y));
    float pxH = pxs / RENDERSIZE.y;
    vec4 st = IMG_NORM_PIXEL(cone, vec2(0.5));
    // A resting cone still breathes a hair.
    float X = st.x * mix(0.0, 0.36, excursion) + 0.003 * sin(vxPhase * 2.3);
    float xNorm = clamp(st.x, -1.0, 1.0);

    // Camera: off-axis by `perspective`, a little to the side, looking at the cone.
    float tilt = mix(0.05, 0.72, perspective);
    float yaw = tilt * 0.3;
    float camDist = mix(6.5, 2.7, perspective);
    vec3 C = camDist * vec3(sin(yaw) * cos(tilt), -sin(tilt), cos(yaw) * cos(tilt));
    vec3 fwd = normalize(vec3(0.0, 0.0, -0.12) - C);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    float F = 0.43 * camDist;
    vec3 d = normalize(right * p.x + up * p.y + fwd * F);

    // March the surface of revolution from its front to its back.
    float zTop = 0.32;
    float zBot = -DEPTH - 0.25;
    float t0 = (zTop - C.z) / d.z;
    float t1 = (zBot - C.z) / d.z;
    float dtm = (t1 - t0) / 56.0;
    float ta = t0;
    float tb = t1;
    bool found = false;
    for (int i = 0; i < 56; i++) {
        float t = t0 + dtm * float(i + 1);
        vec3 q = C + d * t;
        if (!found && q.z <= surfaceH(length(q.xy), X)) {
            found = true;
            tb = t;
            ta = t - dtm;
        }
    }
    for (int i = 0; i < 7; i++) {
        float tm = 0.5 * (ta + tb);
        vec3 q = C + d * tm;
        if (q.z <= surfaceH(length(q.xy), X)) tb = tm; else ta = tm;
    }
    vec3 P = C + d * tb;
    float r = length(P.xy);
    float side = (found && r > RF && P.z < -0.01) ? 0.0 : 1.0;
    float hit = found ? side : 0.0;
    float phi = atan(P.y, P.x);

    // The frame face is flat, so its marks come from a plain plane hit (always smooth).
    vec3 Q = C + d * (-C.z / d.z);
    float r0 = length(Q.xy);
    float phi0 = atan(Q.y, Q.x);

    float w = mix(0.5, 1.5, lineWidth);

    // Shading: lines facing the light burn brighter, grazing ones sink.
    float e = 0.004;
    float dh = (surfaceH(r + e, X) - surfaceH(max(r - e, 0.0), X)) / (2.0 * e);
    vec3 nrm = normalize(vec3(-dh * P.xy / max(r, 1e-4), 1.0));
    float la = lightAngle * TAU + vxPhase * 0.035;
    vec3 L = normalize(vec3(cos(la), sin(la), 1.1));
    float diff = clamp(dot(nrm, L), 0.0, 1.0);
    float shade = 0.14 + 1.1 * diff * diff;

    // Region masks on the moving surface.
    float inCap = hit * step(r, RC);
    float inCone = hit * step(RC, r) * step(r, RS);
    float inRoll = hit * step(RS, r) * step(r, RF);
    float inFrame = step(RF, r0) * step(r0, RO + 0.03) * (1.0 - step(0.5, inCap + inCone + inRoll));

    float s = clamp((r - RC) / (RS - RC), 0.0, 1.0);
    // The paper flexes as it throws: the ribs crowd outward, then back on the overshoot.
    float sf = s + 0.07 * xNorm * excursion * sin(3.14159 * s);
    float coneRings = isoLine(sf * floor(rings + 0.5), w) * inCone * 0.9;
    // Paper grain: fine radial fibres, fading toward the neck where they crowd.
    float fib = isoLine(phi / TAU * 96.0, w * 0.7) * inCone * smoothstep(0.1, 0.5, s);
    fib *= 0.3 + 0.7 * hash11(floor(phi / TAU * 96.0 + 0.5) + 7.0);
    float rollU = clamp((r - RS) / (RF - RS), 0.0, 1.0);
    float rollLines = isoLine(rollU * 5.0, w * 0.8) * inRoll * 0.5;
    float capLines = isoLine(r / RC * 3.0, w * 0.8) * inCap * 0.5;
    float edges = max(ringLine(r, RC, w * 1.1) * hit, ringLine(r, RS, w * 1.1) * hit);
    float crest = ringLine(r, RM, w) * hit;

    float lines = max(max(coneRings, fib * grain * 0.5), max(rollLines, capLines));
    lines = max(lines, edges);
    float body = lines * shade;

    // The frame: outer rim, the gasket and eight bolt holes, lit flat.
    float frameW = w;
    float rim = ringLine(r0, RO, frameW * 1.1);
    float gasket = ringLine(r0, RF + 0.022, frameW * 0.8) * 0.55;
    float seam = ringLine(r0, RF, frameW) * 0.8;
    float boltA = (floor(phi0 / TAU * 8.0) + 0.5) / 8.0 * TAU;
    vec2 bolt = vec2(cos(boltA), sin(boltA)) * 0.925;
    float bd = length(Q.xy - bolt);
    float holes = ringLine(bd, 0.022, frameW * 0.8) * 0.8;
    float frameLines = max(max(rim, seam), max(gasket, holes)) * inFrame;
    body = max(body, frameLines * 0.7);

    // Brighter as the cone throws out.
    float drive = clamp(xNorm, 0.0, 1.0);
    vec3 col = ink.rgb * body * (0.8 + 0.5 * drive);

    // Rim light: the crest of the surround catches the accent at full throw.
    float facing = 0.5 + 0.5 * cos(phi - la);
    float peak = smoothstep(0.35, 0.85, xNorm * excursion / max(excursion, 0.05));
    col += accent.rgb * crest * facing * facing * peak * 0.9;
    col += ink.rgb * crest * shade * 0.35;

    // Dust lying on the cone: it jumps on each hit and falls back with bounces.
    float age = st.z;
    float g = 12.0;
    float rest = mix(0.18, 0.62, bounce);
    float spark = 0.0;
    for (int i = 0; i < DUST; i++) {
        float fi = float(i);
        if (fi < dust * float(DUST)) {
            float h1 = hash11(fi * 3.17 + 1.3);
            float h2 = hash11(fi * 7.31 + 4.1);
            float rr = mix(RC + 0.04, RS - 0.03, sqrt(h1));
            float aa = h2 * TAU;
            float hn = hash11(fi * 1.91 + floor(vxCount + 0.5) * 5.77);
            float v0 = vxVel * excursion * (0.3 + 0.7 * hn) * 2.4;
            float T0 = 2.0 * v0 / g;
            float z = 0.0;
            float air = 0.0;
            if (T0 > 0.005 && age < T0 / (1.0 - rest)) {
                float k = floor(log(max(1.0 - age * (1.0 - rest) / T0, 1e-4)) / log(rest));
                float tk = T0 * (1.0 - pow(rest, k)) / (1.0 - rest);
                float vk = v0 * pow(rest, k);
                float tau = age - tk;
                z = max(vk * tau - 0.5 * g * tau * tau, 0.0);
                air = clamp(z / 0.04, 0.0, 1.0);
            }
            vec3 D = vec3(cos(aa) * rr, sin(aa) * rr, surfaceH(rr, X) + 0.004 + z);
            vec3 vq = D - C;
            float Z = dot(vq, fwd);
            vec2 sp = vec2(dot(vq, right), dot(vq, up)) / Z * F;
            float dd = length(p - sp) / pxH;
            float rad = 0.9 + 0.6 * air;
            float b = exp(-dd * dd / (rad * rad)) * (0.4 + 0.6 * air);
            spark = max(spark, b);
        }
    }
    col += ink.rgb * spark * 0.95;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
