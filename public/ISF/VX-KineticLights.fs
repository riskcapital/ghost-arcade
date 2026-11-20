/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A grid of small glowing glass spheres hanging on hairline cables in a dark hall, seen from a little below. Each sphere rides up and down on a wave that travels across the grid, so together they draw a moving surface; they light the cables above them and show as soft streaks in a dark glossy floor. Each hit re-rolls the wave: a plane wave, a ripple from a point or a saddle, and the spheres on its crest flash in the accent color; the sound's level lifts the light. With no sound the spheres hang still and dim.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "density", "LABEL": "Grid density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "wave", "LABEL": "Wave height", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "gloss", "LABEL": "Floor gloss", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Spheres", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Crest of the wave", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Rows of spheres going back into the hall (at most). Across, each ray only ever needs the three nearest columns.
const int MAX_ROWS = 6;
const float FOCAL = 1.3;
// The grid's half width and its depth, in world units; the spheres hang round MID_Y.
const float HALF_W = 4.2;
const float DEPTH = 5.0;
const float MID_Y = 1.95;

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

// The wave at a place on the grid (X and Z run -1 to 1): -1 to 1. Each hit re-rolls its shape.
float waveAt(float X, float Z, float n, float phase) {
    float kind = floor(hash11(n * 5.71 + 0.9) * 3.0);
    float h1 = hash11(n * 2.37 + 3.1);
    float h2 = hash11(n * 7.93 + 1.3);
    vec2 P = vec2(X, Z * 0.6);
    if (kind < 0.5) {
        // A plane wave crossing the grid at an angle.
        float a = h1 * 6.2832;
        return sin(dot(P, vec2(cos(a), sin(a))) * (2.6 + 1.8 * h2) - phase);
    }
    if (kind < 1.5) {
        // A ripple spreading from a point.
        vec2 c = vec2(h1 * 1.6 - 0.8, (h2 - 0.5) * 0.8);
        return sin(length(P - c) * 4.6 - phase);
    }
    // A saddle: up along one diagonal, down along the other.
    return sin((P.x * P.x - P.y * P.y * 2.4) * 2.6 - phase + h1 * 6.2832);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    // Camera: low on the hall's center line, looking up into the grid.
    vec3 ro = vec3(0.0, 0.45, -7.0);
    vec3 ta = vec3(0.0, 1.5, 2.0);
    vec3 fwd = normalize(ta - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(p.x * rgt + p.y * upv + FOCAL * fwd);

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float phase = vxFlow * 1.3 + TIME * 0.02;

    float cols = 7.0 + 2.0 * floor(density * 2.0 + 0.5);
    float rows = floor(mix(4.0, float(MAX_ROWS), density) + 0.5);
    float dx = 2.0 * HALF_W / (cols - 1.0);
    float dz = DEPTH / (rows - 1.0);
    float rad = 0.135 * dx;
    float ampY = mix(0.12, 0.95, wave);
    float lit = n > 0.5 ? 1.0 : 0.0;

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;

    // The floor under this pixel, and the same view mirrored in it.
    float tFloor = rd.y < -1e-4 ? -ro.y / rd.y : 1e5;
    bool onFloor = tFloor < 1e4;
    vec3 roM = vec3(ro.x, -ro.y, ro.z);
    vec3 rdM = vec3(rd.x, -rd.y, rd.z);

    vec3 col = vec3(0.0);
    vec3 refl = vec3(0.0);
    // How much of this pixel nearer spheres leave uncovered.
    float open = 1.0;

    for (int j = 0; j < MAX_ROWS; j++) {
        float fj = float(j);
        if (fj >= rows) break;
        float zc = fj * dz;
        float Z = fj / (rows - 1.0) * 2.0 - 1.0;
        // Where the view ray, and its mirror image, cross this row's plane.
        float tp = (zc - ro.z) / rd.z;
        float xp = ro.x + rd.x * tp;
        float i0 = floor((xp + HALF_W) / dx + 0.5);

        for (int c = 0; c < 3; c++) {
            float fi = i0 + float(c) - 1.0;
            if (fi < 0.0 || fi > cols - 1.0) continue;
            float X = fi / (cols - 1.0) * 2.0 - 1.0;
            float hgt = waveAt(X, Z, n, phase);
            vec3 C = vec3(fi * dx - HALF_W, MID_Y + ampY * hgt, zc);

            // Spheres on the crest take the accent color after a hit, and flash with it.
            float crest = lit * smoothstep(0.82, 0.98, hgt);
            vec3 tint = mix(inkC, accC, crest);
            // Higher spheres burn a little brighter, so the surface reads in light as well as in place.
            float lvl = (0.42 + 0.58 * sw) * (0.7 + 0.3 * hgt) * (1.0 - 0.3 * fj / (rows - 1.0)) + crest * pu * 0.9;

            vec3 oc = C - ro;
            float t = dot(oc, rd);
            vec3 bv = oc - rd * t;
            float b = length(bv);

            // The cable above the sphere: a hairline, lit near the sphere and lost in the dark higher up.
            vec2 a = C.xz - ro.xz;
            float l2 = dot(rd.xz, rd.xz);
            float tc = dot(a, rd.xz) / l2;
            float yc = ro.y + rd.y * tc;
            float up = yc - C.y;
            if (up > rad * 0.8) {
                float dl = abs(a.x * rd.z - a.y * rd.x) / sqrt(l2);
                float ds = dl / tc * FOCAL;
                float wc = max(0.65 * px, 0.004 / tc * FOCAL);
                float cab = exp(-ds * ds / (wc * wc));
                float cabLight = 0.045 * exp(-max(yc - 4.0, 0.0) * 0.8) + lvl * (0.25 + 0.5 * glow) * exp(-up / 0.55);
                col += open * tint * cab * cabLight;
            }

            // The sphere: frosted glass lit from inside, brightest at its heart.
            float fw = 0.75 * px * t / FOCAL;
            float cov = smoothstep(rad + fw, rad - fw, b);
            float inner = sqrt(max(1.0 - b * b / (rad * rad), 0.0));
            vec3 glass = tint * lvl * (0.5 + 0.5 * inner) * 1.5 + vec3(1.0) * lvl * lvl * exp(-b * b / (rad * rad * 0.22)) * 0.9;
            // Its glow in the air, fading out before the next column.
            float out1 = max(b - rad, 0.0);
            float halo = (0.5 * exp(-out1 / (rad * 0.9)) + 0.22 * rad * rad / (b * b + rad * rad)) * smoothstep(1.45 * dx, 0.6 * dx, b);
            col += open * (glass * cov + tint * lvl * halo * (0.25 + 0.9 * glow) * (1.0 - cov));
            open *= 1.0 - cov;

            if (onFloor) {
                // Its reflection in the floor: a soft dot, drawn out toward the viewer as polished floors do.
                vec3 om = C - roM;
                float tm = dot(om, rdM);
                vec3 bm = om - rdM * tm;
                float rb = rad * mix(2.6, 1.15, gloss);
                float e2 = bm.x * bm.x + bm.z * bm.z + bm.y * bm.y * mix(0.16, 0.42, gloss);
                refl += tint * lvl * (exp(-e2 / (rb * rb)) * rad * rad / (rb * rb) * 5.0 + 0.05 * exp(-sqrt(e2) / (rad * 5.0)));
            }
        }
    }

    // The hall behind: nearly black, with a low band of spilled light where the floor meets the far wall.
    vec3 fl = normalize(vec3(fwd.x, 0.0, fwd.z));
    float horizon = -FOCAL * fwd.y / dot(fwd, fl);
    float lift = 0.4 + 0.6 * sw;
    vec3 back = vec3(0.004, 0.0045, 0.006) + inkC * 0.02 * lift * exp(-abs(p.y - horizon) / 0.16);
    if (onFloor) {
        // The dark glossy floor: mostly mirror, more so at a glancing angle.
        float fres = 0.08 + 0.7 * pow(1.0 - max(-rd.y, 0.0), 5.0);
        float gk = mix(0.35, 1.0, gloss);
        back = vec3(0.004, 0.0045, 0.006) + inkC * 0.012 * lift * exp(-abs(p.y - horizon) / 0.1);
        // A broad pool of the spheres' light on the floor under the grid.
        vec3 P = ro + rd * tFloor;
        vec2 pool = vec2(P.x / (HALF_W * 1.1), (P.z - DEPTH * 0.5) / (DEPTH * 0.75));
        back += inkC * 0.022 * lift * exp(-dot(pool, pool));
        back += refl * fres * gk;
        back *= exp(-max(tFloor - 14.0, 0.0) * 0.08);
    }
    col += open * back;

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the spheres keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark hall lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
