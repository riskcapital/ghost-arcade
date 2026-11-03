/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A glowing wireframe sculpture turning in space: a twisted knot of square tubing, a nest of linked rings or a twisted cage. Near edges burn bright and far ones fade. Every hit of the sound it follows corrupts the mesh: points fly off, edges tear, double up and re-link to the wrong corners, then the model heals itself back into shape. Form picks the sculpture, Spin sets how fast it turns, Jitter how much the points shiver at rest, Corruption how hard a hit breaks it, Healing how long it takes to mend, and Glow how much light the wires throw. Seed re-rolls the details.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "edges",
            "FLOAT": true,
            "WIDTH": 1536,
            "HEIGHT": 12
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "form", "LABEL": "Form", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Set by seed", "Knot", "Linked rings", "Twisted cage"] },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "jitter", "LABEL": "Jitter", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "corruption", "LABEL": "Corruption", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "healing", "LABEL": "Healing time", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.37, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Wire", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Corruption", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit.
// edges: 384 columns by 3 rows of cells, one column per edge, worked out
// once a frame. Each cell is a 4x4 block, because the core may render the
// pass coarser than declared; reads land on block centres.
//   row 0: first end x, y and second end x (frame-height units, centred).
//   row 1: second end y, depth light at each end.
//   row 2: corruption 0-1, doubled-copy offset.

const float TAU = 6.2831853;
const float PI = 3.14159265;
const int MAX_EDGES = 384;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hash31(float x) {
    return vec3(hash11(x * 1.17 + 3.1), hash11(x * 2.31 + 7.7), hash11(x * 3.73 + 1.9)) * 2.0 - 1.0;
}

float recipe() {
    return floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);
}

float formKind() {
    float rs = recipe();
    return form == 0 ? mod(rs, 3.0) : float(form - 1);
}

float edgeCount(float kind) {
    if (kind < 0.5) return 384.0;
    if (kind < 1.5) return 360.0;
    return 300.0;
}

float vertCount(float kind) {
    if (kind < 0.5) return 192.0;
    if (kind < 1.5) return 360.0;
    return 125.0;
}

// --- The three sculptures -------------------------------------------------

vec3 knotPoint(float a, float fs) {
    float p = 2.0;
    float q = hash11(fs + 2.0) < 0.5 ? 3.0 : 5.0;
    float r = 0.55 + 0.35 * cos(q * a);
    return vec3(r * cos(p * a), r * sin(p * a), 0.42 * sin(q * a)) * 1.05;
}

// A twisted triangular truss following the knot: three rails and braces.
vec3 knotVertex(float i, float fs) {
    float s = floor(i / 3.0);
    float k = mod(i, 3.0);
    float a = s / 64.0 * TAU;
    vec3 c = knotPoint(a, fs);
    vec3 t = normalize(knotPoint(a + 0.01, fs) - knotPoint(a - 0.01, fs));
    vec3 b = normalize(cross(t, c + vec3(0.0, 0.0, 0.3)));
    vec3 nn = cross(b, t);
    float turns = hash11(fs + 3.0) < 0.5 ? 2.0 : 3.0;
    float ang = k * TAU / 3.0 + a * turns;
    float rad = 0.14;
    return c + rad * (nn * cos(ang) + b * sin(ang));
}

vec3 hopfVertex(float i, float fs, float t) {
    float fiber = floor(i / 20.0);
    float sg = mod(i, 20.0);
    float fam = floor(fiber / 6.0);
    float m = mod(fiber, 6.0);
    float eta = fam < 0.5 ? mix(0.3, 0.42, hash11(fs + 4.0)) : (fam < 1.5 ? mix(0.72, 0.84, hash11(fs + 5.0)) : mix(1.12, 1.24, hash11(fs + 8.0)));
    float del = m / 6.0 * TAU + fam * PI / 9.0 + t * 0.15;
    float a = sg / 20.0 * TAU;
    vec4 x = vec4(cos(eta) * cos(a + del), cos(eta) * sin(a + del), sin(eta) * cos(a), sin(eta) * sin(a));
    // A slow turn in four dimensions keeps the rings sliding through each other.
    float w = t * 0.11;
    x = vec4(x.x * cos(w) - x.w * sin(w), x.y, x.z, x.x * sin(w) + x.w * cos(w));
    return x.xyz / (1.75 - x.w) * 1.25;
}

vec3 cageVertex(float i, float fs, float t) {
    vec3 c = vec3(mod(i, 5.0), mod(floor(i / 5.0), 5.0), floor(i / 25.0));
    vec3 p = (c / 2.0 - 1.0) * 0.75;
    float tw = mix(0.6, 1.3, hash11(fs + 6.0)) * sin(t * 0.13 + fs);
    float ang = p.y * tw;
    p.xz = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * p.xz;
    p.xz *= 1.0 + 0.28 * cos(p.y * 2.2);
    return p;
}

vec3 baseVertex(float kind, float i, float fs, float t) {
    if (kind < 0.5) return knotVertex(i, fs);
    if (kind < 1.5) return hopfVertex(i, fs, t);
    return cageVertex(i, fs, t);
}

vec2 edgeEnds(float kind, float j, float fs) {
    if (kind < 0.5) {
        if (j < 192.0) return vec2(j, mod(j + 3.0, 192.0));
        float e = j - 192.0;
        float s = floor(e / 3.0);
        float k = mod(e, 3.0);
        float diag = hash11(fs + 7.0) < 0.6 ? 1.0 : 0.0;
        return vec2(e, mod(s + diag, 64.0) * 3.0 + mod(k + 1.0, 3.0));
    }
    if (kind < 1.5) {
        float fiber = floor(j / 20.0);
        return vec2(j, fiber * 20.0 + mod(j + 1.0, 20.0));
    }
    float axis = floor(j / 100.0);
    float r = mod(j, 100.0);
    float a = mod(r, 4.0);
    float b = mod(floor(r / 4.0), 5.0);
    float c = floor(r / 20.0);
    vec3 v0 = axis < 0.5 ? vec3(a, b, c) : (axis < 1.5 ? vec3(b, a, c) : vec3(b, c, a));
    vec3 step3 = axis < 0.5 ? vec3(1.0, 0.0, 0.0) : (axis < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
    vec3 v1 = v0 + step3;
    return vec2(v0.x + v0.y * 5.0 + v0.z * 25.0, v1.x + v1.y * 5.0 + v1.z * 25.0);
}

// Seconds the mesh takes to mend after a hit.
float healSeconds() {
    return mix(0.25, 1.6, healing);
}

// How far a broken point still is from home: full at the hit, a springy
// settle afterwards.
float flyHold(float age, float i, float n) {
    float h = healSeconds() * mix(0.6, 1.2, hash21(vec2(i, n + 0.5)));
    if (age > h) return 0.0;
    float k = age / h;
    return exp(-k * 4.0) * cos(k * 9.0) * (1.0 - k);
}

vec3 vertexAt(float kind, float i, float fs, float t, float n, float age, float vel) {
    vec3 p = baseVertex(kind, i, fs, t);
    // Resting shiver, stepped so it reads as signal noise, not wobble.
    float tick = floor(t * 9.0);
    vec3 jv = hash31(i * 7.13 + tick * 1.37 + fs);
    float big = step(0.93, hash21(vec2(i, tick + fs)));
    p += jv * jitter * (0.004 + 0.03 * big);
    if (n > 0.5) {
        // A hit tears a slab off the model: everything past a cut plane
        // jumps as one piece, and a few points inside it scatter.
        vec3 cutDir = normalize(hash31(n * 7.31 + fs));
        float side = dot(p, cutDir) - mix(0.1, -0.35, corruption);
        float inSlab = smoothstep(-0.02, 0.02, side);
        float hold = flyHold(age, floor(n * 0.37), n);
        vec3 shove = normalize(hash31(n * 3.7 + 1.0) - cutDir * 0.5);
        float amt = mix(0.12, 0.75, corruption) * mix(0.6, 1.0, vel);
        p += shove * inSlab * hold * amt;
        // The whole model shivers apart for an instant.
        p += hash31(i * 5.3 + n * 2.1) * hold * 0.07 * corruption;
        float share = mix(0.02, 0.22, corruption) * mix(0.6, 1.0, vel);
        if (hash21(vec2(i * 1.37 + fs, n)) < share * (0.3 + inSlab)) {
            float h2 = flyHold(age, i, n);
            vec3 dir = normalize(hash31(i * 3.1 + n * 17.7) + p * 0.6);
            p += dir * h2 * mix(0.05, 0.5, corruption) * mix(0.4, 1.0, hash21(vec2(n, i)));
        }
    }
    return p;
}

mat3 viewTurn(float t, float fs) {
    float sp = mix(0.03, 0.45, spin);
    float ay = t * sp + fs;
    float ax = 0.45 * sin(t * sp * 0.61 + fs * 2.0) + 0.35;
    float az = 0.25 * sin(t * sp * 0.37 + fs);
    mat3 ry = mat3(cos(ay), 0.0, -sin(ay), 0.0, 1.0, 0.0, sin(ay), 0.0, cos(ay));
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(ax), sin(ax), 0.0, -sin(ax), cos(ax));
    mat3 rz = mat3(cos(az), sin(az), 0.0, -sin(az), cos(az), 0.0, 0.0, 0.0, 1.0);
    return rz * rx * ry;
}

// Screen position (xy) and depth light (z).
vec3 project(vec3 p, mat3 m) {
    vec3 q = m * p;
    float dist = 3.4;
    float f = 1.45;
    float z = q.z + dist;
    vec2 s = q.xy * f / z;
    float light = mix(1.0, 0.16, smoothstep(-1.1, 1.1, q.z));
    return vec3(s, light);
}

// One edge, ready to draw: e0 = both ends on screen, e1 = depth light at
// each end, corruption 0-1 and the doubled copy's offset.
void edgeData(float j, float kind, float fs, float t, float n, float age, out vec4 e0, out vec4 e1) {
        float vel = clamp(vxVel, 0.0, 1.0);
        vec2 ends = edgeEnds(kind, j, fs);
        float ia = ends.x;
        float ib = ends.y;
        // A hit re-links some edges to the wrong corner until they heal, one by one.
        float share = mix(0.02, 0.14, corruption) * mix(0.6, 1.0, vel);
        float heal = healSeconds() * mix(0.25, 1.0, hash21(vec2(j + 0.3, n + fs)));
        bool live = n > 0.5 && age < heal;
        float bad = 0.0;
        if (live && hash21(vec2(j * 0.917 + fs, n * 1.31)) < share) {
            ib = floor(hash21(vec2(j + 11.0, n + 3.0)) * vertCount(kind));
            bad = 1.0;
        }
        mat3 m = viewTurn(t, fs);
        vec3 a = project(vertexAt(kind, ia, fs, t, n, age, vel), m);
        vec3 b = project(vertexAt(kind, ib, fs, t, n, age, vel), m);
        // Tears: a broken edge loses a ragged piece and may be doubled off to one side.
        float dup = 0.0;
        float tearShare = share * 1.3;
        if (live && hash21(vec2(j * 1.71 + 5.0, n + fs)) < tearShare) {
            float k = clamp(age / heal, 0.0, 1.0);
            float cut = mix(0.15, 0.7, hash21(vec2(j, n + 9.0))) * (1.0 - k);
            if (hash21(vec2(j + 4.0, n)) < 0.5) a.xy = mix(a.xy, b.xy, cut);
            else b.xy = mix(b.xy, a.xy, cut);
            dup = (hash21(vec2(j + 8.0, n + 1.0)) - 0.5) * 0.2 * (1.0 - k * k) * corruption;
            bad = max(bad, 0.6 * (1.0 - k));
        }
        // Resting tears: a few edges flicker out with the jitter.
        float tick = floor(t * 7.0);
        if (hash21(vec2(j + fs, tick)) < jitter * 0.04) {
            a.xy = mix(a.xy, b.xy, 0.5);
        }
        e0 = vec4(a.xy, b.xy);
        e1 = vec4(a.z, b.z, bad, dup);
}

void main() {
    float n = floor(vxCount + 0.5);
    float rs = recipe();
    float fs = rs * 3.17 + 0.5;

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        gl_FragColor = vec4(n, age, 0.0, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    if (FRAMEINDEX < 2) age = 30.0;
    // The hit flash pins the age while it lasts, so a held hit shows its break.
    if (vxHit > 0.01) age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
    float kind = formKind();
    float count = edgeCount(kind);
    float t = vxPhase;

    if (PASSINDEX == 1) {
        vec2 cellUv = gl_FragCoord.xy / RENDERSIZE;
        float j = floor(cellUv.x * 384.0);
        float row = floor(cellUv.y * 3.0);
        vec4 e0 = vec4(0.0);
        vec4 e1 = vec4(0.0);
        if (row < 1.5) {
            if (j < count) edgeData(j, kind, fs, t, n, age, e0, e1);
            gl_FragColor = row < 0.5 ? e0 : e1;
            return;
        }
        // Row 2: the screen box round each run of 16 edges, so the draw can skip whole runs.
        vec4 box = vec4(9.0, 9.0, -9.0, -9.0);
        if (j < 24.0) {
            for (int k = 0; k < 16; k++) {
                float jj = j * 16.0 + float(k);
                if (jj >= count) break;
                edgeData(jj, kind, fs, t, n, age, e0, e1);
                float pad = abs(e1.w);
                box.xy = min(box.xy, min(e0.xy, e0.zw) - pad);
                box.zw = max(box.zw, max(e0.xy, e0.zw) + pad);
            }
        }
        gl_FragColor = box;
        return;
    }

    // Draw: every edge as a glowing line, depth-lit, corrupt ones in the accent.
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    // One pixel the core really renders (it can be coarser than RENDERSIZE).
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float px = max(1.0, max(fwp.x, fwp.y)) / RENDERSIZE.y;
    // Right on the hit the picture slips in a few horizontal bands.
    {
        float slip = n > 0.5 ? clamp(1.0 - age / 0.12, 0.0, 1.0) : 0.0;
        float band = floor(uv.y * mix(6.0, 22.0, hash11(n + fs)));
        float hb = hash21(vec2(band, n + 2.0));
        if (hb < 0.35 * corruption + 0.1) p.x += (hash21(vec2(band, n + 5.0)) - 0.5) * 0.25 * slip * corruption;
    }
    float w = px * 1.1;
    float gr = mix(0.002, 0.009, glow);
    float reach = gr * 9.0;
    vec3 wire = vec3(0.0);
    vec3 bent = vec3(0.0);
    float nodes = 0.0;
    for (int gi = 0; gi < 24; gi++) {
        float g = float(gi);
        if (g * 16.0 >= count) break;
        vec4 box = IMG_NORM_PIXEL(edges, vec2((g + 0.5) / 384.0, 2.5 / 3.0));
        if (p.x < box.x - reach || p.y < box.y - reach || p.x > box.z + reach || p.y > box.w + reach) continue;
    for (int kk = 0; kk < 16; kk++) {
        float j = g * 16.0 + float(kk);
        if (j >= count) break;
        vec4 e = IMG_NORM_PIXEL(edges, vec2((j + 0.5) / 384.0, 0.5 / 3.0));
        vec2 lo = min(e.xy, e.zw) - reach;
        vec2 hi = max(e.xy, e.zw) + reach;
        if (p.x < lo.x || p.y < lo.y || p.x > hi.x || p.y > hi.y) continue;
        vec4 f = IMG_NORM_PIXEL(edges, vec2((j + 0.5) / 384.0, 1.5 / 3.0));
        vec2 ab = e.zw - e.xy;
        float l2 = max(dot(ab, ab), 1e-8);
        vec2 ap = p - e.xy;
        float h = clamp(dot(ap, ab) / l2, 0.0, 1.0);
        float d = length(ap - ab * h);
        float light = mix(f.x, f.y, h);
        // Near wire is thick and sharp; far wire thin, with a soft out-of-focus glow.
        float width = w * mix(0.8, 2.8, light * light);
        float core = clamp(1.0 - d / width, 0.0, 1.0);
        float gq = gr * mix(1.9, 1.0, light);
        float halo = exp(-d / gq) * mix(0.12, 0.26, light);
        float v = (core * 0.85 + halo) * light;
        float va = length(ap);
        float cn = (exp(-va / (px * mix(1.4, 4.0, light))) + exp(-va / (px * 14.0)) * 0.12) * light;
        if (f.z > 0.05) {
            bent += vec3(v * f.z, v * (1.0 - f.z), cn);
        } else {
            wire += vec3(v * light, cn, v * (1.0 - light));
        }
        if (abs(f.w) > 0.0005) {
            vec2 off = vec2(-ab.y, ab.x) * inversesqrt(l2) * f.w;
            vec2 aq = ap - off;
            float h2 = clamp(dot(aq, ab) / l2, 0.0, 1.0);
            float d2 = length(aq - ab * h2);
            float v2 = (clamp(1.0 - d2 / width, 0.0, 1.0) * 0.7 + exp(-d2 / gr) * 0.15) * light;
            bent.x += v2 * 0.8;
        }
    }
    }

    // Depth-cued palette: near wire in ink, a faint accent haze where it piles up.
    vec3 hot = mix(ink.rgb, vec3(1.0), 0.35);
    // Far wire sinks into a dim mix of both colours.
    vec3 col = ink.rgb * wire.x + mix(ink.rgb, accent.rgb, 0.45) * wire.z * 0.8;
    col += hot * min(wire.y, 1.0) * 0.6;
    col += accent.rgb * (bent.x * 1.25 + bent.z * 0.6);
    col += ink.rgb * bent.y;
    // Where many wires cross the glow piles up; ease it so it never clips to white.
    // A faint wash of light behind the sculpture gives it a room to sit in.
    col += mix(ink.rgb, accent.rgb, 0.3) * 0.03 * exp(-dot(p, p) / 0.18);
    col = col / (1.0 + max(max(col.r, col.g), col.b) * 0.35);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
