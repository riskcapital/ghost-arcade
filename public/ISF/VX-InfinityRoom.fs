/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Inside a room whose walls and ceiling are mirrors. A grid of tiny lights hangs on hairline cables, and the mirrors repeat it without end in every direction, each reflection a little dimmer and greener than the last, over a dark glossy floor. Rows of lights switch on and off in sequence and runs of light chase along them and on through the mirrors. The sound's motion drifts the viewpoint and drives the chases; its level lights more rows; each hit sends a sheet of light in the accent color sweeping through the whole lattice, to come to rest on one plane of it. With no sound a few rows glow, still.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "lights", "LABEL": "Lights", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "loss", "LABEL": "Mirror loss", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "chase", "LABEL": "Chase", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lights", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Sweeping sheet", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The room is a cube N cells on a side; one light hangs in the middle of each cell.
// A view ray is followed cell by cell through the room and on through its mirror images.
const int STEPS = 92;
const float FOCAL = 1.15;
// A light's glass bead, its cable and the arms of its glint, in cell units.
const float BEAD = 0.009;
const float CABLE = 0.0022;
const float GLINT = 0.0028;

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

float hash31(vec3 q) {
    vec3 p3 = fract(q * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

// How far x is from the nearest multiple of m.
float toMultiple(float x, float m) {
    return abs(x - m * floor(x / m + 0.5));
}

// A hairline: d is the distance from its middle, w its real half width, f the size of a pixel there.
// Close by it is a solid thread with a clean edge; far off it is never thinner than a pixel, it dims instead.
float hair(float d, float w, float f) {
    float wf = max(w, 0.5 * f);
    return clamp((wf - abs(d)) / f + 0.5, 0.0, 1.0) * (w / wf);
}

// The lowest light on the cable at column c: cables hang to different lengths.
float lowest(vec2 c) {
    return floor(hash21(c + 3.7) * 2.4);
}

// One light of the room, by its place (0 to N-1 on each axis): (how bright 0-1.3, how much accent).
vec2 bulb(vec3 id, float N, float n, float flow, float sw, float pu) {
    // Lights are wired in rows: along the room on even levels, across it on odd ones.
    float turned = mod(id.y, 2.0);
    float across = mix(id.z, id.x, turned);
    float along = mix(id.x, id.z, turned);
    float row = across * 7.0 + id.y * 13.0 + turned * 31.0;

    // Rows switch on and off in a sequence that steps with the sound; its level lights more of them.
    float stepN = floor(flow * 1.3);
    float ph = mod(stepN + across * 3.0 + id.y * 5.0, 8.0);
    float on = clamp(1.3 + 2.7 * sw - ph, 0.0, 1.0);
    float lvl = on * (0.55 + 0.25 * hash31(id + 11.0));

    // A run of light chases along some rows, back and forth between the mirrors,
    // so in the reflections it carries straight on through room after room.
    float runs = step(hash11(row + 9.0), 0.25 + 0.6 * chase);
    float sp = (0.7 + 1.1 * hash11(row + 2.0)) * mix(0.4, 2.2, chase);
    float x = mod(flow * sp + hash11(row) * 2.0 * N, 2.0 * N);
    float head = abs(x - N);
    float dch = abs(along + 0.5 - head);
    lvl = max(lvl, runs * exp(-dch * dch * 1.6) * (0.75 + 0.35 * sw));

    // Each hit sends a sheet of accent light in from one wall of the room; it comes to rest on one plane of lights.
    // In the mirrors the same sheet leaves every wall at once, all the way out.
    float axis = floor(hash11(n * 3.7 + 1.3) * 3.0);
    float coord = axis < 0.5 ? id.x : (axis < 1.5 ? id.y : id.z);
    float rest = floor(hash11(n * 5.1 + 0.7) * N);
    float from = hash11(n * 9.3 + 4.1) < 0.5 ? -0.7 : N - 0.3;
    float at = mix(rest, from, pu * pu);
    float sheet = n > 0.5 ? exp(-pow((coord - at) / 0.55, 2.0)) : 0.0;
    lvl = max(lvl, sheet * (0.5 + 0.8 * pu));
    return vec2(lvl, sheet);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The size of one stored pixel: the core may keep this layer coarser than its render size.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float px = max(fw.x, fw.y) / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    // The room moves with the sound; a trace of drift keeps it from freezing.
    float flow = vxFlow + TIME * 0.02;

    float N = floor(mix(3.0, 7.0, lights) + 0.5);
    // What a mirror gives back: a little less of everything, and less red than green.
    vec3 mirror = (1.0 - mix(0.05, 0.4, loss)) * mix(vec3(1.0), vec3(0.84, 0.97, 0.93), 0.4 + 0.6 * loss);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;

    // The viewer stands between the cables, at a height between two levels of lights,
    // looking across the room at an angle so the rows run off to two vanishing points.
    float ct = flow * mix(0.02, 0.26, drift);
    vec3 ro = vec3(floor(N * 0.5) + 0.3 * sin(ct * 1.3 + 1.0),
                   floor(N * 0.4) + 0.06 + 0.16 * sin(ct * 0.9),
                   1.0 + 0.3 * cos(ct * 1.1));
    float yaw = 0.36 + mix(0.05, 0.3, drift) * sin(ct * 0.6);
    float pitch = 0.07 + 0.05 * sin(ct * 0.8 + 2.0);
    vec3 fwd = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 upv = cross(fwd, rgt);
    vec3 rd = normalize(p.x * rgt + p.y * upv + FOCAL * fwd);
    // No component of the ray is ever exactly zero, so every wall is reached in the end.
    vec3 rs = vec3(abs(rd.x) < 1e-5 ? 1e-5 : rd.x, abs(rd.y) < 1e-5 ? 1e-5 : rd.y, abs(rd.z) < 1e-5 ? 1e-5 : rd.z);

    vec3 cell = floor(ro);
    vec3 sg = sign(rs);
    vec3 inv = 1.0 / abs(rs);
    vec3 tM = (cell + max(sg, 0.0) - ro) / rs;
    vec2 a = rd.xz;
    float a2 = max(dot(a, a), 1e-5);

    // What is left of the light after the mirrors it has crossed so far.
    vec3 att = vec3(1.0);
    vec3 col = vec3(0.0);

    for (int s = 0; s < STEPS; s++) {
        // The last cells fade out, so the lattice has no visible end.
        float fade = 1.0 - smoothstep(0.72, 1.0, float(s) / float(STEPS));

        // Which light of the real room this cell holds: every other image of the room is flipped.
        vec3 room = floor(cell / N);
        vec3 odd = mod(room, 2.0);
        vec3 id = cell - room * N;
        id = mix(id, N - 1.0 - id, odd);
        float low = lowest(id.xz);

        if (id.y >= low) {
            vec3 L = cell + 0.5;
            // Closest the ray comes to the light, and to its cable.
            float tc = dot(L - ro, rd);
            vec3 dl = L - ro - rd * tc;
            float d2 = dot(dl, dl);
            float tl = dot(L.xz - ro.xz, a) / a2;
            vec2 dx = ro.xz + a * tl - L.xz;
            float dc2 = dot(dx, dx);
            float fl = max(tl, 0.05) * px / FOCAL;
            float wl = max(CABLE, 0.5 * fl) + fl;
            bool nearLight = tc > 0.05 && d2 < 0.09;
            bool nearCable = tl > 0.05 && dc2 < wl * wl;

            if (nearLight || nearCable) {
                vec2 st = bulb(id, N, n, flow, sw, pu);
                vec3 tint = mix(inkC, accC, st.y);
                float lvl = st.x * (0.55 + 0.45 * sw + 0.4 * st.y);
                vec3 e = vec3(0.0);

                if (nearLight) {
                    float f = tc * px / FOCAL;
                    float d = sqrt(d2);
                    // The bead: a hard bright point, a pixel wide at least.
                    float wb = max(BEAD, 0.75 * f);
                    float core = exp(-pow(d2 / (wb * wb), 1.5)) * (BEAD * BEAD) / (wb * wb);
                    // A tight bloom round it.
                    float halo = exp(-d / 0.03) * 0.5 + 0.0012 / (d2 + 0.0012) * exp(-d / 0.12) * 0.22;
                    // The glint: four hairline arms, as a lens throws round a point of light.
                    float du = dot(dl, rgt);
                    float dv = dot(dl, upv);
                    float arm = 0.04 + 0.11 * st.x;
                    float au = abs(du);
                    float av = abs(dv);
                    // Each arm tapers from the bead to a point.
                    float glint = hair(dv, GLINT * max(1.0 - au / (arm * 2.6), 0.0), f) * exp(-au / arm)
                                + hair(du, GLINT * max(1.0 - av / (arm * 2.6), 0.0), f) * exp(-av / arm);
                    e += tint * lvl * (core * 34.0 + halo * 0.6 + glint * 1.5);
                    e += vec3(1.0) * lvl * lvl * core * 40.0;
                    // A light that is off still shows as a faint bead of glass.
                    e += inkC * core * 0.14 * (1.0 - st.x);
                }

                if (nearCable) {
                    // The cable hangs from the ceiling down to the lowest light on it.
                    float yl = ro.y + rd.y * tl;
                    float lo = cell.y;
                    float hi = cell.y + 1.0;
                    if (id.y == low) {
                        if (odd.y < 0.5) lo = cell.y + 0.5; else hi = cell.y + 0.5;
                    }
                    if (yl >= lo && yl < hi) {
                        // It catches the light of its own lamp, brightest right beside it.
                        float lit = 0.05 + 0.06 * sw + lvl * (0.25 + 1.1 * exp(-abs(yl - L.y) / 0.16));
                        e += tint * hair(sqrt(dc2), CABLE, fl) * lit * 0.9;
                    }
                }
                col += att * e * fade;
            }
        }

        // On to the next cell. If the step crosses a wall, the floor or the ceiling of the room,
        // the ray carries on into the mirror image beyond it.
        vec3 ax;
        if (tM.x <= tM.y && tM.x <= tM.z) ax = vec3(1.0, 0.0, 0.0);
        else if (tM.y <= tM.z) ax = vec3(0.0, 1.0, 0.0);
        else ax = vec3(0.0, 0.0, 1.0);
        float tN = dot(tM, ax);
        float plane = dot(cell + max(sg, 0.0), ax);

        if (mod(plane, N) == 0.0) {
            vec3 P = ro + rd * tN;
            float f = tN * px / FOCAL;
            float slant = 1.0 / max(abs(dot(rd, ax)), 0.04);
            if (ax.y > 0.5) {
                // How far a pixel reaches over this surface, along x and along z.
                float fx = f * sqrt(1.0 + rd.x * rd.x * slant * slant);
                float fz = f * sqrt(1.0 + rd.z * rd.z * slant * slant);
                vec2 fr = fract(P.xz) - 0.5;
                if (mod(plane, 2.0 * N) == 0.0) {
                    // The floor: dark polished tiles a cell square, their joints hairlines.
                    float joint = hair(0.5 - abs(fr.x), 0.004, fx) * (1.0 - smoothstep(0.12, 0.4, fx))
                                + hair(0.5 - abs(fr.y), 0.004, fz) * (1.0 - smoothstep(0.12, 0.4, fz));
                    vec3 fc = inkC * joint * (0.07 + 0.07 * sw);
                    // A pool of light on the floor under the lowest lamp of each cable.
                    float hb = lowest(id.xz) + 0.5;
                    vec2 st = bulb(vec3(id.x, hb - 0.5, id.z), N, n, flow, sw, pu);
                    float dh2 = dot(fr, fr);
                    float pool = max(hb / pow(dh2 + hb * hb, 1.5) - hb / pow(0.25 + hb * hb, 1.5), 0.0);
                    fc += mix(inkC, accC, st.y) * st.x * (0.55 + 0.45 * sw) * pool * 0.02;
                    col += att * fc * fade;
                    // It mirrors the room too, weakly from above and strongly at a glancing angle.
                    float fres = pow(1.0 - abs(rd.y), 4.0);
                    att *= mirror * mix(0.2, 0.9, fres);
                } else {
                    // The ceiling, a mirror: each cable ends in a small anchor.
                    float da = length(fr);
                    float wa = max(0.008, 0.7 * max(fx, fz));
                    col += att * inkC * exp(-pow(da / wa, 4.0)) * (0.008 * 0.008) / (wa * wa) * 0.25 * fade;
                    att *= mirror;
                }
            } else {
                // A wall mirror. Its seams show: the corners of the room, and the joints between panels.
                float u = ax.x > 0.5 ? P.z : P.x;
                float ru = ax.x > 0.5 ? rd.z : rd.x;
                float fu = f * sqrt(1.0 + ru * ru * slant * slant);
                float fy = f * sqrt(1.0 + rd.y * rd.y * slant * slant);
                float corner = hair(toMultiple(u, N), 0.006, fu) * 0.5 + hair(toMultiple(P.y, N), 0.006, fy);
                float panel = hair(toMultiple(u, 1.0), 0.003, fu) * (1.0 - smoothstep(0.12, 0.4, fu));
                col += att * inkC * (corner * (0.3 + 0.25 * sw) + panel * 0.06) * fade;
                att *= mirror;
            }
        }

        tM += ax * inv;
        cell += ax * sg;
        if (max(max(att.r, att.g), att.b) < 0.004) break;
    }

    // The dark of the room itself.
    col += vec3(0.003, 0.0035, 0.0045);
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
        // Only the light is solid: the dark room lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
