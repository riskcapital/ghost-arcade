/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A slow flight down the canyon between two faces of an endless concrete megastructure: stacked slabs and parapets, fins, deep galleries with rows of small lit windows, a heavier frame of piers and transfer bands over them, square shafts standing free in the void and bridges crossing it at every height, all receding into haze. A hard light rakes one face and leaves the other in shadow. The sound's motion carries the camera forward and slowly turns it; its level raises the strip lights; each hit lights a whole floor or a whole frame of the structure in the accent color, which then runs away down the canyon, and re-rolls some of the windows. With no sound the flight all but stops and the lights burn low.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "density", "LABEL": "Density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "detail", "LABEL": "Detail", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "haze", "LABEL": "Haze", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "light", "LABEL": "Light", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lights", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Floor the hit lit", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The structure, in meters: floor to floor, column to column, half the width of the void
// between the two faces, how deep the galleries run behind the column line, and the spacing
// of the free-standing shafts down the middle of the void.
const float PY = 4.2;
const float PZ = 5.6;
const float HW = 11.0;
const float GAL = 3.2;
const float SP = 44.8;
const float FOCAL = 1.5;
const float FAR = 420.0;
const int STEPS = 72;
const int SHADOW_STEPS = 24;

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

float noise2(vec2 q) {
    vec2 i = floor(q);
    vec2 f = fract(q);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Which side of the void the shaft in this stretch stands on.
float shaftSide(float ks) {
    return mod(ks, 2.0) < 0.5 ? 1.0 : -1.0;
}

// The void is cut into cells one floor high and four bays long. A cell may hold one bridge:
// where its middle is along the canyon, or a negative number for no bridge.
float bridgeIn(float ky, float kc) {
    // The two floors the camera flies between are left clear.
    if (ky > -0.5 && ky < 1.5) return -1.0;
    float h = hash21(vec2(ky * 3.17 + 11.0, kc * 1.37 + 5.0));
    if (h > mix(0.06, 0.62, density)) return -1.0;
    return (kc * 4.0 + floor(fract(h * 61.0) * 4.0) + 0.5) * PZ;
}

// Distance to the structure. Bridges are only looked for in the cell of the void the point is in;
// the marchers stop at every cell wall, so none is stepped over.
float map(vec3 p) {
    float ax = abs(p.x);
    float ky = floor(p.y / PY + 0.5);
    float fy = p.y - ky * PY;
    float bz = p.z - floor(p.z / PZ + 0.5) * PZ;

    // The two faces: a slab at every floor with a solid parapet at its edge, a fin at every bay,
    // and the back wall of the gallery behind them.
    float slab = max(abs(fy) - 0.25, HW - 0.9 - ax);
    vec2 pq = abs(vec2(ax - (HW - 0.8), fy - 0.4)) - vec2(0.1, 0.65);
    float parapet = max(pq.x, pq.y);
    float fin = max(abs(bz) - 0.3, HW - 0.25 - ax);
    float d = min(min(slab, parapet), min(fin, HW + GAL - ax));

    // The great frame: every fourth bay a heavy pier, every third floor a deep transfer band.
    float pz = p.z - floor(p.z / (PZ * 4.0) + 0.5) * PZ * 4.0;
    float my = p.y + PY - floor((p.y + PY) / (PY * 3.0) + 0.5) * PY * 3.0;
    d = min(d, max(min(abs(pz) - 1.1, abs(my) - 0.95), HW - 1.9 - ax));

    // Shafts: square towers standing free in the void, on alternate sides.
    float ks = floor(p.z / SP);
    float zc = p.z - (ks + 0.5) * SP;
    d = min(d, max(abs(p.x - 4.2 * shaftSide(ks)), abs(zc)) - 1.5);

    // Bridges: a trough of concrete across the void in the middle of a bay.
    float bm = bridgeIn(ky, floor(p.z / (PZ * 4.0)));
    if (bm > -0.5) {
        float bc = abs(p.z - bm);
        float deck = max(bc - 1.0, abs(fy + 0.25) - 0.3);
        vec2 bq = abs(vec2(bc - 0.92, fy - 0.25)) - vec2(0.08, 0.8);
        d = min(d, max(min(deck, max(bq.x, bq.y)), ax - (HW - 0.8)));
    }
    return d;
}

// How far along a ray the next wall between cells of the void is.
float cellExit(vec3 p, vec3 rd) {
    float ty = 1e3;
    float tz = 1e3;
    if (abs(rd.y) > 1e-4) ty = ((floor(p.y / PY + 0.5) + (rd.y > 0.0 ? 0.5 : -0.5)) * PY - p.y) / rd.y;
    if (abs(rd.z) > 1e-4) tz = ((floor(p.z / (PZ * 4.0)) + (rd.z > 0.0 ? 1.0 : 0.0)) * PZ * 4.0 - p.z) / rd.z;
    return min(ty, tz) + 0.03;
}

vec3 mapNormal(vec3 p, float e) {
    vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e)
                   + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

// How much of the hard light reaches a point: a ray toward the light, its edge kept nearly sharp.
float shadow(vec3 p, vec3 L) {
    float res = 1.0;
    float t = 0.06;
    for (int i = 0; i < SHADOW_STEPS; i++) {
        vec3 q = p + L * t;
        float d = map(q);
        res = min(res, 26.0 * d / t);
        if (res < 0.005) break;
        t += min(clamp(d, 0.04, 6.0), cellExit(q, L));
        if (t > 34.0) break;
    }
    return clamp(res, 0.0, 1.0);
}

float occlusion(vec3 p, vec3 n) {
    float o = 0.0;
    float w = 1.0;
    for (int i = 1; i <= 4; i++) {
        float h = 0.1 * float(i) * float(i);
        o += w * (h - map(p + n * h));
        w *= 0.62;
    }
    return clamp(1.0 - 0.8 * o, 0.0, 1.0);
}

// The hard light reaches the canyon through a roof of great beams far overhead, so it comes down in
// slabs with dark between them, each slab combed into narrower blades: how much reaches a point (slab, blades).
vec2 roofLight(vec3 p, vec3 L) {
    vec3 q = p + L * ((70.0 - p.y) / L.y);
    float gz = abs(fract(q.z / 39.2) - 0.5) * 39.2;
    float slab = smoothstep(9.6, 8.2, gz);
    float gx = abs(fract(q.x / 5.2) - 0.5) * 5.2;
    return vec2(slab, smoothstep(1.5, 1.1, gx));
}

// A line of half-width w whose center is d away, seen through a pixel that covers fp of the surface.
float lineCov(float d, float w, float fp) {
    return min(clamp((w - abs(d)) / fp + 0.5, 0.0, 1.0), 2.0 * w / fp + 0.02);
}

// A row of small lights that reads as data: cells along s, some lit, in runs and gaps.
float dataRow(float s, float pitch, float seed, float fp) {
    float c = floor(s / pitch);
    float f = (s - c * pitch) / pitch - 0.5;
    float grp = hash21(vec2(floor(c / 9.0), seed + 3.0));
    float on = step(hash21(vec2(c, seed)), grp < 0.22 ? 0.0 : (grp > 0.8 ? 0.95 : 0.45));
    // Far off, the cells are smaller than a pixel: the row settles to its average.
    float far = smoothstep(0.35, 1.2, fp / pitch);
    return mix(on * lineCov(f * pitch, 0.34 * pitch, fp), 0.3 * (grp < 0.22 ? 0.0 : 1.0), far);
}

// A sheet of tiny windows, a few lit, some re-rolled by every hit.
float dataWindows(vec2 q, vec2 pitch, float seed, float chance, float n, float fp) {
    vec2 c = floor(q / pitch);
    vec2 f = (q - c * pitch) - 0.5 * pitch;
    float id = c.x * 7.0 + c.y * 131.0 + seed;
    // Each window answers to every eighth hit, so a hit re-rolls one in eight.
    float turn = floor((n + floor(hash11(id * 0.37) * 8.0)) / 8.0);
    float h = hash21(vec2(id, turn * 17.0 + 1.0));
    // Windows come in lit runs along a row, like words.
    float run = hash21(vec2(floor(c.x / 5.0) + turn, c.y + seed));
    float on = step(h, chance * (run < 0.35 ? 0.15 : 1.6));
    float far = smoothstep(0.4, 1.3, fp / min(pitch.x, pitch.y));
    float cell = lineCov(f.x, 0.3 * pitch.x, fp) * lineCov(f.y, 0.33 * pitch.y, fp);
    return mix(on * cell * (0.3 + 0.7 * fract(h * 37.0)), chance * 0.25, far);
}

// How far the camera has flown.
float travel() {
    return vxFlow * 5.0 + TIME * 0.2;
}

// What the latest hit lit: (1 for a floor or 0 for a frame, the floor, how far down the canyon its light has run).
vec3 hitLight(float n) {
    float pu = clamp(vxPulse, 0.0, 1.0);
    float kind = hash11(n * 5.71 + 0.9) < 0.62 ? 1.0 : 0.0;
    float flr = floor(hash11(n * 3.31 + 2.2) * 7.0) - 3.0;
    float run = travel() + 4.0 + (1.0 - pu * pu) * 200.0;
    return vec3(kind, flr, run);
}

// How strongly a light at this floor and place along the canyon is taken by the latest hit: (accent, extra brightness).
vec2 hitTint(float flr, float z, float n) {
    if (n < 0.5) return vec2(0.0);
    vec3 h = hitLight(n);
    float pu = clamp(vxPulse, 0.0, 1.0);
    if (h.x > 0.5) {
        if (flr != h.y) return vec2(0.0);
        // A streak of light running away along the floor, its head brightest; the floor keeps a low glow behind it.
        float head = smoothstep(h.z + 2.0, h.z, z) * exp(-max(h.z - z, 0.0) / 40.0);
        return vec2(clamp(0.4 + head, 0.0, 1.0), head * (0.6 + 2.4 * pu));
    }
    // A whole frame of the structure, one bay long, stepping away bay by bay.
    float a = floor(z / PZ) == floor(h.z / PZ) ? 1.0 : 0.0;
    return vec2(a, a * (0.5 + 2.2 * pu));
}

// The light leaving a point of the structure.
vec3 shade(vec3 p, vec3 rd, float t, float px, vec3 L, float n) {
    vec3 nor = mapNormal(p, max(0.003, 0.0008 * t));
    float fp = max(t * px / FOCAL, 1e-4) * 1.25;
    float sw = clamp(vxSwell, 0.0, 1.0);
    float ax = abs(p.x);
    float sgn = p.x < 0.0 ? -1.0 : 1.0;
    float ky = floor(p.y / PY + 0.5);
    float fy = p.y - ky * PY;
    // The gallery this point belongs to, and its height above that gallery's floor.
    float kf = fy < 0.22 ? ky - 1.0 : ky;
    float hh = p.y - kf * PY;
    float kb = floor(p.z / PZ);
    float pk = floor(p.z / (PZ * 4.0) + 0.5);
    float pz = p.z - pk * PZ * 4.0;
    float my = p.y + PY - floor((p.y + PY) / (PY * 3.0) + 0.5) * PY * 3.0;
    float ks = floor(p.z / SP);
    float zc = p.z - (ks + 0.5) * SP;
    float xs = p.x - 4.2 * shaftSide(ks);
    bool onShaft = max(abs(xs), abs(zc)) < 1.56;
    bool onFrame = !onShaft && ax > HW - 1.95 && ax < HW - 0.95 && (abs(pz) < 1.14 || abs(my) < 0.99);
    bool inGallery = ax > HW - 0.65;
    bool backWall = ax > HW + GAL - 0.06;
    float sideSeed = sgn * 7.0 + 20.0;
    vec3 an = abs(nor);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    float strip = 0.2 + 1.0 * sw;
    float dt = clamp(detail, 0.0, 1.0);

    // Concrete: board marks, panel joints, tie holes, and stains running down the faces.
    float along = an.z > 0.6 ? p.x : p.z;
    float alb = 0.34;
    if (an.y < 0.6) {
        alb *= 0.8 + 0.2 * noise2(vec2(along * 1.1 + sgn * 3.0, p.y * 0.09)) + 0.12 * noise2(vec2(along * 7.0, p.y * 0.8));
        float boards = abs(fract(p.y / 0.15) - 0.5) * 0.15;
        alb *= 1.0 - 0.3 * dt * lineCov(boards, 0.011, fp) * smoothstep(0.09, 0.025, fp);
        float joint = abs(fract(along / 1.4) - 0.5) * 1.4;
        alb *= 1.0 - 0.6 * dt * lineCov(joint, 0.013, fp);
        vec2 tie = abs(fract(vec2(along / 0.7, p.y / 1.05) + 0.5) - 0.5) * vec2(0.7, 1.05);
        alb *= 1.0 - 0.55 * dt * smoothstep(0.035 + fp, 0.035 - fp, length(tie)) * smoothstep(0.06, 0.02, fp);
    } else {
        alb *= 0.8 + 0.3 * noise2(p.xz * 0.6);
        vec2 jq = abs(fract(p.xz / 1.4) - 0.5) * 1.4;
        alb *= 1.0 - 0.5 * dt * max(lineCov(jq.x, 0.013, fp), lineCov(jq.y, 0.013, fp));
    }

    // The hard light, its shadow, and what the haze and the lit face give back into the shade.
    float ndl = max(dot(nor, L), 0.0);
    vec2 roof = roofLight(p, L);
    float sun = roof.x * mix(0.12, 1.0, roof.y);
    float sh = ndl * sun > 0.001 ? shadow(p + nor * 0.03, L) * sun : 0.0;
    float ao = occlusion(p, nor);
    float key = mix(1.2, 7.0, light);
    vec3 sunC = vec3(1.0, 0.97, 0.93);
    vec3 lit = sunC * key * ndl * sh;
    lit += inkC * (0.016 + 0.03 * light) * (0.55 + 0.45 * nor.y) * ao;
    // The lit face throws a little light back across the void onto the shaded one.
    lit += sunC * 0.02 * key * roof.x * max(-nor.x * sign(L.x), 0.0) * ao * (inGallery ? 0.3 : 1.0);
    vec3 col = vec3(alb) * lit;

    vec3 glow = vec3(0.0);
    vec3 wash = vec3(0.0);

    if (onShaft) {
        // The shafts: every face a sheet of tiny windows, with a lit seam up each one.
        float u = an.x > 0.6 ? zc : xs;
        float fseed = ks * 57.0 + (an.x > 0.6 ? 0.0 : 300.0) + (dot(nor, vec3(1.0, 0.0, 1.0)) > 0.0 ? 0.0 : 600.0);
        vec2 st = hitTint(-99.0, p.z, n);
        vec3 sc = mix(inkC, accC, st.x);
        if (an.y < 0.6) {
            float w = abs(u) < 1.15 ? dataWindows(vec2(u + 1.2, p.y), vec2(0.12, 0.17), fseed, 0.1 + 0.16 * dt, n, fp) : 0.0;
            glow += sc * w * (0.5 + 0.7 * sw + st.y);
            glow += sc * lineCov(abs(u) - 1.33, 0.022, fp) * (0.5 * strip + st.y);
        }
    } else if (inGallery) {
        // A strip light runs along the top of every gallery's back wall and washes the wall, the ceiling and the floor.
        vec2 ht = hitTint(kf, p.z, n);
        vec3 sc = mix(inkC, accC, ht.x) * (strip + ht.y);
        float toWall = HW + GAL - ax;
        if (backWall && an.x > 0.5) {
            glow += sc * 2.4 * lineCov(hh - 3.62, 0.045, fp);
            wash += sc * 1.5 * exp(-max(3.62 - hh, 0.0) / 0.9);
            // Rows of small windows in the wall, a few lit.
            if (hh > 0.7 && hh < 3.1) {
                float w = dataWindows(vec2(p.z, hh - 0.7), vec2(0.35, 0.6), kf * 71.0 + sideSeed * 13.0, 0.12 + 0.2 * dt, n, fp);
                glow += inkC * w * (0.4 + 0.6 * sw);
            }
        } else if (nor.y < -0.5) {
            wash += sc * 1.1 * exp(-toWall / 1.7);
        } else if (nor.y > 0.5) {
            wash += sc * 0.4 * exp(-toWall / 2.2);
        } else if (an.z > 0.5) {
            wash += sc * 0.6 * exp(-toWall / 2.0) * exp(-max(3.62 - hh, 0.0) / 1.7);
        }
    } else if (an.y < 0.6) {
        float s = an.z > 0.6 ? p.x : p.z;
        if (onFrame && an.x > 0.6 && abs(pz) < 1.14 && abs(my) > 0.99) {
            // The piers of the great frame: two lit seams up the face.
            vec2 ht = hitTint(-99.0, p.z, n);
            glow += mix(inkC, accC, ht.x) * lineCov(abs(pz) - 0.55, 0.02, fp) * (0.55 * strip + ht.y);
        } else if (onFrame && an.x > 0.6) {
            // The transfer bands: three lines of data lights.
            vec2 ht = hitTint(ky, p.z, n);
            vec3 dc = mix(inkC, accC, ht.x);
            float row = floor((my + 0.75) / 0.5);
            float band = lineCov(my + 0.75 - (row + 0.5) * 0.5, 0.045, fp) * step(abs(row - 1.0), 1.0);
            if (band > 0.0) glow += dc * band * dataRow(s, 0.2, ky * 9.0 + row * 31.0 + sideSeed, fp) * (0.3 + 0.7 * sw + ht.y) * 1.4;
        } else {
            // Parapets and bridge sides carry a line of data lights near the top, and a plain hairline of light below.
            vec2 ht = hitTint(ky, p.z, n);
            vec3 dc = mix(inkC, accC, ht.x);
            float band = lineCov(fy - 0.78, 0.035, fp);
            if (band > 0.0) glow += dc * band * dataRow(s, 0.22, ky * 9.0 + sideSeed + (an.z > 0.6 ? kb * 3.0 : 0.0), fp) * (0.35 + 0.65 * sw + ht.y) * 1.5;
            glow += dc * lineCov(fy + 0.14, 0.016, fp) * (0.45 * strip + ht.y * 0.7);
        }
    }

    col += glow + wash * alb * 2.4 * ao;
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 sp = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The picture may be stored coarser than its nominal size: a pixel is never taken as finer than a stored one.
    vec2 fw = fwidth(gl_FragCoord.xy);
    float px = max(1.0, max(fw.x, fw.y)) / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);

    // The camera flies down the void between two floors, weaving past the shafts and slowly turning its head.
    float cz = travel();
    float turnT = vxFlow * 0.13 + TIME * 0.008;
    float weave = 3.14159 * cz / SP;
    vec3 ro = vec3(-3.6 * sin(weave), PY * 0.5 + 0.15 + 0.3 * sin(cz * 0.013), cz);
    float yaw = -0.04 * ro.x - 0.08 * cos(weave) + 0.08 * sin(turnT + 0.6);
    float pitch = 0.04 + 0.08 * sin(turnT * 0.71 + 2.0);
    float roll = 0.06 * sin(turnT * 0.53);
    vec3 fwd = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
    vec3 rgt = normalize(cross(vec3(sin(roll), cos(roll), 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(sp.x * rgt + sp.y * upv + FOCAL * fwd);

    // The hard light comes down the canyon from ahead, always from the camera's side of it, so it rakes the far face
    // and swings across as the camera weaves.
    float sideS = sin(weave);
    vec3 L = normalize(vec3(-0.6 * sideS / sqrt(sideS * sideS + 0.12) + 0.05 * sin(turnT * 0.37), 0.66, 0.6));

    // March to the structure, keeping the first edge the ray grazed so that edge can be softened.
    float t = 0.06;
    float hitT = -1.0;
    float edgeT = -1.0;
    float edgeCov = 0.0;
    float cand = 1e3;
    float candT = 0.0;
    float lastD = 1e3;
    for (int i = 0; i < STEPS; i++) {
        vec3 q = ro + rd * t;
        float d = map(q);
        lastD = d;
        float r = d * FOCAL / (px * t);
        if (r < 0.3) { hitT = t; break; }
        if (r < cand) {
            cand = r;
            candT = t;
        } else if (r > cand * 1.5 + 0.5) {
            if (cand < 1.0 && edgeT < 0.0) {
                edgeT = candT;
                edgeCov = clamp((1.0 - cand) / 0.7, 0.0, 1.0);
            }
            cand = 1e3;
        }
        t += min(d, cellExit(q, rd));
        if (t > FAR) break;
    }
    // A ray still skimming a face when its steps run out is taken to have met it.
    if (hitT < 0.0 && t < FAR && lastD < 0.012 * t) hitT = t;

    // Haze: thicker with distance. It holds a little light of its own, and the slabs of hard light show in it.
    float dens = mix(0.003, 0.016, haze);
    float sun = max(dot(rd, L), 0.0);
    float reachT = hitT > 0.0 ? hitT : FAR;
    vec3 fogC = ink.rgb * (0.02 + 0.05 * light) * (0.55 + 0.6 * sw);
    // The slabs of light are evenly spaced along any ray, so the light the haze holds along it is summed slab by slab.
    float tEnd = min(reachT, 220.0);
    float bq = (rd.z - L.z / L.y * rd.y) / 39.2;
    float u0 = (ro.z + L.z / L.y * (70.0 - ro.y)) / 39.2;
    if (bq < 0.0) {
        bq = -bq;
        u0 = -u0;
    }
    float shafts = 0.0;
    if (bq < 1e-4) {
        shafts = (abs(fract(u0) - 0.5) < 0.227 ? 1.0 : 0.0) * (1.0 - exp(-tEnd * dens));
    } else {
        float k0 = floor(u0) - 1.0;
        for (int i = 0; i < 14; i++) {
            float c = k0 + float(i) + 0.5 - u0;
            float ta = max((c - 0.227) / bq, 0.0);
            float tb = min((c + 0.227) / bq, tEnd);
            if (ta >= tEnd) break;
            if (tb > ta) shafts += exp(-ta * dens) - exp(-tb * dens);
        }
    }
    // The blades each slab is combed into show where the eye looks along them.
    float bx = (rd.x - L.x / L.y * rd.y) / 5.2 * min(tEnd, 0.7 / dens);
    float x0 = (ro.x + L.x / L.y * (70.0 - ro.y)) / 5.2 - 0.25;
    float x1 = x0 + bx;
    float blades = abs(bx) < 0.02 ? (fract(x0) < 0.5 ? 1.0 : 0.0)
                 : (floor(x1) * 0.5 + min(fract(x1), 0.5) - floor(x0) * 0.5 - min(fract(x0), 0.5)) / bx;
    shafts *= 0.3 + 0.9 * clamp(blades, 0.0, 1.0);
    vec3 shaftC = vec3(1.0, 0.97, 0.93) * shafts * mix(0.4, 2.6, light) * (0.3 + 1.7 * pow(sun, 3.0)) * (0.7 + 0.4 * sw);
    vec3 hl = hitLight(n);

    vec3 col = fogC * (1.0 - exp(-reachT * dens));
    float solid = 0.0;
    if (hitT > 0.0) {
        vec3 c = shade(ro + rd * hitT, rd, hitT, px, L, n);
        float f = exp(-hitT * dens);
        col += c * f;
        solid = f;
    }
    if (edgeT > 0.0 && (hitT < 0.0 || hitT - edgeT > 0.4 + 0.02 * edgeT)) {
        vec3 c = shade(ro + rd * edgeT, rd, edgeT, px, L, n);
        float f = exp(-edgeT * dens);
        col = mix(col, fogC * (1.0 - f) + c * f, edgeCov);
        solid = mix(solid, f, edgeCov);
    }
    col += shaftC;
    // The accent light running down the canyon colors the haze round it a little.
    if (n > 0.5) {
        float tz = rd.z > 0.02 ? (hl.z - ro.z) / rd.z : 1e4;
        if (tz < reachT) {
            vec3 q = ro + rd * tz;
            col += accent.rgb * pu * 0.04 * exp(-abs(abs(q.x) - HW + 1.0) / 2.5) * exp(-tz * dens);
        }
    }

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the lights keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The structure is solid where the haze has not swallowed it; the haze itself is only as solid as it is bright.
        float lt = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outa = clamp(solid + (1.0 - solid) * lt, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
