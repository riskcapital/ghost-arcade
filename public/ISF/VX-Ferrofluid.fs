/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A shallow dish of glossy black ferrofluid under a magnet. Where the field is strong the liquid rises into a crown of sharp spikes, each one a black mirror catching coloured studio lights along its sides and a pin of light at its tip. A held sound strengthens the field so the spikes grow taller and pack tighter; each hit surges them upward and sends waves rolling out across the pool, and they settle back with a liquid wobble. The pitch moves the magnet, so the crown drifts across the dish.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "field", "LABEL": "Field", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "wave", "LABEL": "Wave", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "orbit", "LABEL": "Camera", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Left light", "TYPE": "color", "DEFAULT": [0.2, 0.6, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Right light", "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.2, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float POOL_R = 1.15;
const float RIM_R = 0.055;
const int STEPS = 100;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Shared per-frame state (set once in main, read by the height field).
struct Field {
    vec2 fc;       // magnet centre on the pool
    float str;     // overall field strength
    float width;   // radius of the field's influence
    float sp;      // spike spacing
    float kick;    // hit surge (fast rise, eased release)
    float waveK;   // how strongly hits ripple
    float t;
};

float fieldAt(vec2 c, Field F) {
    vec2 q = c - F.fc;
    return F.str * exp(-dot(q, q) / (F.width * F.width));
}

// Liquid height and its gradient at a point of the pool.
// Returns (height, dH/dx, dH/dz).
vec3 liquid(vec2 p, Field F) {
    float r = length(p);
    // Meniscus and the mound the magnet pulls up.
    float u = clamp(r / POOL_R, 0.0, 1.0);
    float men = 0.035 * (1.0 - u * u);
    vec2 gq = p - F.fc;
    float fw = F.width * 1.25;
    float mound = 0.11 * F.str * exp(-dot(gq, gq) / (fw * fw));
    float h = men + mound;
    vec2 g = -0.07 * p / (POOL_R * POOL_R) + mound * (-2.0 * gq / (fw * fw));

    // Hexagonal spike lattice, scaled about the magnet so it packs tighter
    // as the field rises.
    vec2 s = vec2(1.0, 1.7320508) * F.sp;
    vec2 lp = p - F.fc;
    vec4 hC = floor(vec4(lp, lp - vec2(0.5, 1.0) * F.sp) / s.xyxy) + 0.5;
    vec2 h1 = lp - hC.xy * s;
    vec2 h2 = lp - (hC.zw + 0.5) * s;
    vec2 off = dot(h1, h1) < dot(h2, h2) ? h1 : h2;
    vec2 cell = lp - off + F.fc;                  // spike centre on the pool
    float fl = fieldAt(cell, F);
    // Spikes only stand where the field beats the surface tension.
    float A = 0.30 * max(fl - 0.16, 0.0);
    // Liquid runs out at the dish edge.
    A *= 1.0 - smoothstep(POOL_R - 0.28, POOL_R - 0.08, length(cell));
    // Hits: the spikes surge up and settle with a damped wobble, while
    // waves roll outward from the magnet through the crown. The waves travel
    // continuously; the hit surge sets how tall they stand.
    float dc = length(cell - F.fc);
    float surge = 1.0 + 0.9 * F.kick;
    float wob = 1.0 + 0.22 * F.kick * sin(F.t * 7.0 - dc * 9.0);
    float ring = F.waveK * (0.5 + 0.5 * sin(dc * 11.0 - F.t * 5.0)) * F.kick;
    float idle = 1.0 + 0.07 * sin(F.t * 1.7 + hash21(floor(cell * 40.0)) * 6.283);
    A *= surge * wob * idle;
    // Real spikes keep their proportions: they get taller only by getting
    // more needle-like up to a limit.
    float cap = 2.6 * 0.5 * F.sp;
    A = cap * tanh(A / cap);
    A += 0.1 * ring * smoothstep(0.0, 0.08, fl) * (1.0 - smoothstep(POOL_R - 0.25, POOL_R - 0.08, length(cell)));
    float rad = mix(0.44, 0.5, clamp(A / cap, 0.0, 1.0)) * F.sp;
    float dd = length(off);
    float v = max(1.0 - dd / rad, 0.0);
    // Concave flanks and a needle tip on tall spikes; small ones stay soft.
    float pe = mix(2.2, 1.5, clamp(A / cap, 0.0, 1.0));
    float vp = pow(max(v, 1e-6), pe - 1.0);
    h += A * vp * v;
    if (dd > 1e-5 && v > 0.0) {
        float dv = -pe * A * vp / rad;
        g += dv * off / dd;
    }
    return vec3(h, g);
}

float sdTorus(vec3 p, float R, float r) {
    vec2 q = vec2(length(p.xz) - R, p.y);
    return length(q) - r;
}

// Soft studio: coloured strip lights left and right, a broad top box, a
// small hard light for the tip glints. HDR.
// 1 between lo and hi, with soft edges of width w.
float band(float x, float lo, float hi, float w) {
    return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x));
}

vec3 studio(vec3 d, vec3 c1, vec3 c2, float flash, float bw) {
    vec3 col = mix(vec3(0.004), vec3(0.025, 0.025, 0.03), smoothstep(-0.2, 0.8, d.y));
    float f = 1.0 + flash;
    float az = atan(d.x, d.z);              // 0 = away from the camera
    float el = d.y;
    float baz = bw / max(sqrt(1.0 - el * el), 0.2);
    // Lights narrower than the pixel footprint spread out and dim, keeping
    // their energy.
    // Broad soft box behind the camera: a gentle band across the pool.
    float fb = band(abs(az), 2.6, 3.8, 0.4 + baz) * band(el, 0.37, 0.55, 0.05 + bw);
    // Tall coloured strips behind left and right: streaks down the flanks.
    float sw = 0.26;
    float sDim = sw / (sw + baz);
    float sL = band(az, -2.2 - sw, -2.2 + sw, 0.12 + baz) * band(el, -0.02, 0.88, 0.07 + bw) * sDim;
    float sR = band(az, 2.2 - sw, 2.2 + sw, 0.12 + baz) * band(el, -0.02, 0.88, 0.07 + bw) * sDim;
    // Low rim lights beyond the dish: edges of the far spikes.
    float rw = 0.16;
    float rDim = rw / (rw + baz);
    float rL = band(az, -0.7 - rw, -0.7 + rw, 0.08 + baz) * band(el, 0.0, 0.27, 0.05 + bw) * rDim;
    float rR = band(az, 0.7 - rw, 0.7 + rw, 0.08 + baz) * band(el, 0.0, 0.27, 0.05 + bw) * rDim;
    // Top box.
    float tb = smoothstep(0.6, 1.0, el) * (0.6 + 0.4 * sin(az * 3.0) * sin(az * 3.0));
    // Small hard key behind the camera: pin glints on the tips.
    float ka = acos(clamp(dot(d, normalize(vec3(-0.3, 0.72, -0.62))), -1.0, 1.0));
    float kr = 0.09;
    float key = (1.0 - smoothstep(kr - 0.01 - bw, kr + 0.01 + bw, ka)) * (kr * kr) / ((kr + bw) * (kr + bw));
    col += vec3(0.8, 0.82, 0.86) * 0.7 * fb * f;
    col += c1 * 3.2 * sL * f;
    col += c2 * 3.2 * sR * f;
    col += mix(c1, vec3(1.0), 0.3) * 2.2 * rL * f + mix(c2, vec3(1.0), 0.3) * 2.2 * rR * f;
    col += vec3(0.9, 0.92, 0.95) * 0.9 * tb * f;
    col += vec3(1.0) * 40.0 * key * f;
    return col;
}

vec3 aces(vec3 x) {
    x = max(x, vec3(0.0));
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Scene distance: liquid (height field, made conservative) and dish rim.
// Returns (distance, which: 0 liquid, 1 rim).
vec2 scene(vec3 p, Field F) {
    float r = length(p.xz);
    float dl = 1e3;
    if (r < POOL_R + 0.02) {
        vec3 lq = liquid(p.xz, F);
        // First-order distance to the surface, using its slope.
        dl = (p.y - lq.x) * 0.85 / sqrt(1.0 + dot(lq.yz, lq.yz));
    }
    dl = max(dl, r - POOL_R);
    float dr = sdTorus(p - vec3(0.0, 0.035, 0.0), POOL_R + RIM_R * 0.6, RIM_R);
    return dl < dr ? vec2(dl, 0.0) : vec2(dr, 1.0);
}

// March one ray into the dish and shade what it finds.
// Returns HDR colour and coverage (soft on the outside of silhouettes).
vec4 renderRay(vec3 ro, vec3 rd, float tMin, float tMax, Field F, vec3 c1, vec3 c2, float flash, float pxAng) {
    float hitT = -1.0;
    float which = 0.0;
    float tt = tMin;
    float best = 1e3;
    float bestT = tt;
    for (int i = 0; i < STEPS; i++) {
        vec3 q = ro + rd * tt;
        vec2 sd = scene(q, F);
        float ratio = sd.x / max(tt, 1e-3);
        if (ratio < best) { best = ratio; bestT = tt; }
        if (sd.x < 0.0004 * tt) {
            for (int j = 0; j < 3; j++) {
                tt += scene(ro + rd * tt, F).x * 0.9;
            }
            hitT = tt;
            which = sd.y;
            break;
        }
        tt += max(sd.x, 0.0015);
        if (tt > tMax) break;
    }
    float cov = 1.0;
    vec3 sp = ro + rd * hitT;
    if (hitT < 0.0) {
        cov = 1.0 - smoothstep(0.0, 1.2 * pxAng, best);
        if (cov < 0.001) return vec4(0.0);
        sp = ro + rd * bestT;
        which = scene(sp, F).y;
    }
    vec3 nrm;
    if (which < 0.5) {
        vec3 lq = liquid(sp.xz, F);
        nrm = normalize(vec3(-lq.y, 1.0, -lq.z));
    } else {
        vec3 q = sp - vec3(0.0, 0.035, 0.0);
        vec2 rq = vec2(length(q.xz) - (POOL_R + RIM_R * 0.6), q.y);
        vec2 rn = normalize(rq);
        float lx = max(length(q.xz), 1e-4);
        nrm = normalize(vec3(q.x / lx * rn.x, rn.y, q.z / lx * rn.x));
    }
    float ci = clamp(-dot(rd, nrm), 0.0, 1.0);
    vec3 envC = studio(reflect(rd, nrm), c1, c2, flash, 0.02);
    vec3 col;
    if (which < 0.5) {
        // Black oil mirror.
        float fr = 0.05 + 0.95 * pow(1.0 - ci, 5.0);
        col = envC * fr * 1.6 + vec3(0.002, 0.002, 0.003);
    } else {
        // Dark polished steel rim.
        float fr = 0.55 + 0.45 * pow(1.0 - ci, 5.0);
        col = envC * fr * vec3(0.6, 0.62, 0.66) + vec3(0.004);
    }
    return vec4(col, cov);
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float env = clamp(vxSwell, 0.0, 1.0);
    float kick = clamp(vxPulse, 0.0, 1.0);
    // Drift, sway and ripples all run on the flow clock.
    float t = vxFlow * 0.8;
    vec3 c1 = ink.rgb;
    vec3 c2 = accent.rgb;

    Field F;
    F.t = vxFlow * 2.0;
    F.str = mix(0.5, 1.05, field) * (0.62 + 0.38 * env) + 0.08 * sin(t * 0.7);
    // Spacing follows the field knob and the held sound only, so the crown
    // packs tighter as the sound swells without the lattice sliding on hits.
    float strS = mix(0.5, 1.05, field) * (0.62 + 0.38 * env);
    F.width = mix(0.45, 0.95, spread) * (0.85 + 0.35 * env + 0.15 * kick);
    F.sp = mix(0.25, 0.165, clamp(strS, 0.0, 1.0));
    F.fc = vec2((vxGlide - 0.5) * 0.9 * drift + 0.18 * drift * sin(t * 0.31),
                0.15 * drift * sin(t * 0.23 + 1.0));
    F.kick = kick * mix(0.5, 1.2, wave);
    F.waveK = mix(0.0, 1.0, wave);

    // Camera: three-quarter view from above, swaying gently.
    float ca = 0.35 * orbit * sin(t * 0.17) + 0.15;
    float zoom = mix(1.25, 0.85, size);
    vec3 ro = vec3(sin(ca) * 3.6, 1.95, -cos(ca) * 3.6) * zoom;
    vec3 ta = vec3(0.0, 0.08, 0.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(p.x * rt + p.y * up + 2.3 * fw);
    float pxAng = px / 2.3;

    // Bounding cylinder around the dish.
    float tMin = 0.0;
    float tMax = -1.0;
    {
        float R = POOL_R + RIM_R * 2.0;
        float a = dot(rd.xz, rd.xz);
        float b = dot(ro.xz, rd.xz);
        float cc = dot(ro.xz, ro.xz) - R * R;
        float disc = b * b - a * cc;
        if (disc > 0.0) {
            float sq = sqrt(disc);
            float t0 = (-b - sq) / a;
            float t1 = (-b + sq) / a;
            // Clip to the slab the liquid can reach.
            float yTop = 0.75;
            float yBot = -0.05;
            float s0 = (yTop - ro.y) / rd.y;
            float s1 = (yBot - ro.y) / rd.y;
            tMin = max(t0, min(s0, s1));
            tMax = min(t1, max(s0, s1));
        }
    }

    float flash = 0.8 * kick;
    // Two rays per pixel on a rotated grid: smooth silhouettes and smooth
    // streaks down the spike flanks.
    vec4 rA = vec4(0.0);
    vec4 rB = vec4(0.0);
    if (tMax > tMin) {
        vec3 dA = normalize(rd + (rt * 0.25 + up * 0.35) * pxAng);
        vec3 dB = normalize(rd - (rt * 0.25 + up * 0.35) * pxAng);
        rA = renderRay(ro, dA, max(tMin - 0.05, 0.0), tMax + 0.05, F, c1, c2, flash, pxAng);
        rB = renderRay(ro, dB, max(tMin - 0.05, 0.0), tMax + 0.05, F, c1, c2, flash, pxAng);
    }
    // Where the two disagree (an edge, a streak), two more rays.
    vec4 rC = rA;
    vec4 rD = rB;
    vec3 dif = abs(rA.rgb * rA.a - rB.rgb * rB.a);
    if (max(dif.r, max(dif.g, dif.b)) > 0.06 || abs(rA.a - rB.a) > 0.1) {
        vec3 dC = normalize(rd + (-rt * 0.35 + up * 0.25) * pxAng);
        vec3 dD = normalize(rd + (rt * 0.35 - up * 0.25) * pxAng);
        rC = renderRay(ro, dC, max(tMin - 0.05, 0.0), tMax + 0.05, F, c1, c2, flash, pxAng);
        rD = renderRay(ro, dD, max(tMin - 0.05, 0.0), tMax + 0.05, F, c1, c2, flash, pxAng);
    }
    float cov = 0.25 * (rA.a + rB.a + rC.a + rD.a);
    vec3 col = (rA.rgb * rA.a + rB.rgb * rB.a + rC.rgb * rC.a + rD.rgb * rD.a) / max(rA.a + rB.a + rC.a + rD.a, 1e-4);

    // Opaque backdrop: a dark sweep with a soft pool of light under the dish.
    vec3 bg = mix(vec3(0.006, 0.006, 0.008), vec3(0.03, 0.03, 0.036) + (c1 + c2) * 0.008, smoothstep(-0.5, 0.5, p.y));
    float floorT = (-0.06 - ro.y) / rd.y;
    if (floorT > 0.0 && rd.y < 0.0) {
        vec3 fp = ro + rd * floorT;
        float fr = length(fp.xz);
        float contact = smoothstep(POOL_R + 0.5, POOL_R - 0.2, fr);
        vec3 fcol = vec3(0.012, 0.012, 0.015) + (c1 * 0.5 + c2 * 0.5) * 0.02 * smoothstep(3.0, 0.5, fr);
        fcol *= 1.0 - 0.8 * contact;
        // Glossy floor: a blurred hint of the studio.
        float hor = smoothstep(0.0, 0.25, -rd.y);
        bg = mix(bg, fcol, hor);
    }

    vec3 colT = aces(col * 1.6);
    vec3 bgT = aces(bg);
    vec4 outc;
    if (vxClear) {
        outc = vec4(colT * cov, cov);
    } else {
        outc = vec4(mix(bgT, colT, cov), 1.0);
        outc.rgb += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    }
    gl_FragColor = outc * vxPresence;
}
