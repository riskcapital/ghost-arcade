/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A quiet room with a large rectangle of glowing color let into its far wall, seen straight on. The rectangle's light floods the wall around it, the floor, the ceiling and the side walls, and shows as a soft reflection in the floor. Its color is a slow two-tone field that breathes with the sound's level. Each hit sends a slow band of the accent color across the rectangle, and the band's light follows through the room. With no sound the room rests in a dim glow.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "apertureSize", "LABEL": "Aperture size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "softness", "LABEL": "Softness", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "roomDepth", "LABEL": "Depth of the room", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "spill", "LABEL": "Spill", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.5, 1.0] },
        { "NAME": "accent", "LABEL": "Passing band", "TYPE": "color", "DEFAULT": [0.25, 0.4, 1.0, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The room is a straight tube two units high, its far wall at z = 0. The eye stands a little
// below the middle of it, looking straight at the far wall.
const float FOCAL = 1.0;
const float EYE = -0.3;
// Where the walls, floor and ceiling meet they are coved (rounded) to this radius, so no hard corner shows.
const float COVE = 0.2;
// The aperture's light reaches the room as a grid of smaller rectangles, each with its own color,
// so a band of color crossing the aperture is followed by its light on the floor and walls.
const int COLS = 6;
const int ROWS = 2;
const float INV_TAU = 0.15915494;

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

// The light the aperture gives off at a point of its face; q runs -1..1 across and up it.
vec3 fieldAt(vec2 q) {
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    // Two tones of the one color, a deep one and a pale one, their boundary leaning and wandering very slowly.
    float drift = vxFlow * 0.17 + TIME * 0.02;
    float lean = 0.7 * sin(drift * 0.6 + 0.4);
    float g = q.y * cos(lean) + q.x * sin(lean) * 0.6 + 0.4 * sin(drift);
    float t = smoothstep(-1.2, 1.2, g + 0.35 * sw);
    vec3 deep = ink.rgb * ink.rgb * 0.8;
    vec3 pale = mix(ink.rgb, vec3(1.0), 0.12 + 0.2 * sw);
    vec3 c = mix(deep, pale, t) * (0.58 + 0.62 * sw);
    // The latest hit: a soft leaning band of the accent color crossing from one side to the other.
    // It comes to rest just past the far edge, where a faint blush of it stays until the next hit.
    float n = floor(vxCount + 0.5);
    float dir = hash11(n * 3.7 + 1.3) < 0.5 ? 1.0 : -1.0;
    float at = dir * mix(-1.5, 1.4, pow(1.0 - pu, 0.8));
    float rest = n > 0.5 ? 0.5 : 0.0;
    float band = exp(-pow((q.x + 0.18 * q.y - at) / 0.42, 2.0)) * max(smoothstep(0.02, 0.3, pu), rest);
    return mix(c, accent.rgb * (0.7 + 0.5 * sw), band * 0.9);
}

// One edge of a glowing rectangle as a surface facing N sees it.
float edgeTerm(vec3 a, vec3 b, vec3 N) {
    vec3 c = cross(a, b);
    float l = length(c);
    float th = acos(clamp(dot(a, b), -1.0, 1.0));
    return l > 1e-5 ? th * dot(N, c) / l : 0.0;
}

// How much of its light an evenly glowing rectangle on the far wall (corners lo and hi) gives to
// a surface at P facing N: 0 for none, 1 if it filled the whole sky. This is the exact answer for
// a matte light, so the pool of light on the floor falls off as a real one does.
float rectLight(vec3 P, vec3 N, vec2 lo, vec2 hi) {
    vec3 a0 = normalize(vec3(lo.x, lo.y, 0.0) - P);
    vec3 a1 = normalize(vec3(hi.x, lo.y, 0.0) - P);
    vec3 a2 = normalize(vec3(hi.x, hi.y, 0.0) - P);
    vec3 a3 = normalize(vec3(lo.x, hi.y, 0.0) - P);
    float s = edgeTerm(a0, a1, N) + edgeTerm(a1, a2, N) + edgeTerm(a2, a3, N) + edgeTerm(a3, a0, N);
    return abs(s) * INV_TAU;
}

float boxDist(vec2 q, vec2 h) {
    vec2 d = abs(q) - h;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    // A deeper room shows its far wall smaller and more of the floor, ceiling and side walls.
    float backSize = mix(0.44, 0.25, roomDepth);
    float dist = FOCAL / backSize;
    float hw = asp;
    vec3 ro = vec3(0.0, EYE, -dist);
    vec3 rd = vec3(p.x, p.y - 0.02 - EYE * backSize, FOCAL);

    // The aperture, on the far wall.
    vec2 apC = vec2(0.0, 0.06);
    float ah = mix(0.3, 0.8, apertureSize);
    vec2 apH = vec2(min(ah * 1.8, hw - 0.3), ah);

    // Where the ray meets the room: the far wall, or the floor, ceiling or a side wall before it.
    float tBack = dist / rd.z;
    vec3 onBack = ro + rd * tBack;
    float tx = ((rd.x < 0.0 ? -hw : hw) - ro.x) / (abs(rd.x) < 1e-6 ? 1e-6 : rd.x);
    float ty = ((rd.y < 0.0 ? -1.0 : 1.0) - ro.y) / (abs(rd.y) < 1e-6 ? 1e-6 : rd.y);
    float t = min(tBack, min(tx, ty));
    vec3 P = ro + rd * t;
    P.z = min(P.z, -1e-3);

    // Which way the surface faces there, turning smoothly through the coves.
    vec3 cq = vec3(abs(P.x) - (hw - COVE), abs(P.y) - (1.0 - COVE), P.z + COVE);
    vec3 co = max(cq, 0.0);
    vec3 N = -normalize(co + 1e-6) * vec3(P.x < 0.0 ? -1.0 : 1.0, P.y < 0.0 ? -1.0 : 1.0, 1.0);
    float floorness = smoothstep(0.35, 0.95, N.y);

    // Light arriving straight from the aperture, patch by patch, and the aperture's average color.
    vec3 direct = vec3(0.0);
    vec3 avg = vec3(0.0);
    for (int j = 0; j < ROWS; j++) {
        for (int i = 0; i < COLS; i++) {
            vec2 f0 = vec2(float(i) / float(COLS), float(j) / float(ROWS));
            vec2 f1 = vec2(float(i + 1) / float(COLS), float(j + 1) / float(ROWS));
            vec3 c = fieldAt((f0 + f1) - 1.0);
            vec2 lo = apC + apH * (f0 * 2.0 - 1.0);
            vec2 hi = apC + apH * (f1 * 2.0 - 1.0);
            direct += c * rectLight(P, N, lo, hi);
            avg += c;
        }
    }
    avg /= float(COLS * ROWS);

    float soft = clamp(softness, 0.0, 1.0);
    float spillK = mix(0.35, 1.5, spill);

    // Light that has bounced once or hangs in the air: a glow round the aperture that every surface
    // near it shares, taking the color of the nearest part of the aperture.
    vec2 rel = P.xy - apC;
    vec2 nearest = clamp(rel, -apH, apH);
    float away = length(vec3(rel - nearest, P.z));
    float halo = 0.34 * exp(-away / (0.14 + 0.5 * soft)) + 0.2 / (1.0 + away * away * 1.2);
    vec3 haloC = mix(fieldAt(nearest / apH), avg, 1.0 - exp(-away / 0.6));

    // Pale walls and ceiling, a darker polished floor.
    float albedo = mix(0.78, 0.5, floorness);
    vec3 room = albedo * (direct * 4.5 + haloC * halo + avg * 0.08) * spillK;
    // A little shade gathers in the coves.
    float flat_ = max(abs(N.x), max(abs(N.y), abs(N.z)));
    room *= mix(0.93, 1.0, smoothstep(0.72, 1.0, flat_));

    // The floor's polish shows the aperture upside down, blurred more the farther the light has run.
    vec3 rr = vec3(rd.x, -rd.y, rd.z);
    float t2 = -P.z / rr.z;
    vec2 Q = P.xy + rr.xy * t2 - apC;
    float bw = 0.18 + 0.16 * t2;
    float seenX = smoothstep(bw, -bw, abs(Q.x) - apH.x);
    float seenY = smoothstep(bw * 2.5, -bw * 2.5, abs(Q.y) - apH.y);
    float graze = 1.0 - abs(rd.y) / length(rd);
    float mirror = (0.1 + 0.7 * graze * graze * graze) * floorness;
    vec3 seen = fieldAt(clamp(Q / apH, -1.0, 1.0)) * seenX * seenY;
    room += seen * mirror * 1.6 * (0.5 + 0.5 * spillK);

    // The aperture itself: a crisp frame holding a field that is fuller toward its middle.
    vec2 bq = onBack.xy - apC;
    float sd = boxDist(bq, apH);
    float wpx = px * dist / FOCAL;
    float inside = smoothstep(0.75 * wpx, -0.75 * wpx, sd);
    float feather = mix(0.03, 1.0, soft) * apH.y;
    vec2 inFrom = 1.0 - exp(-3.0 * max(apH - abs(bq), 0.0) / feather);
    float fill = inFrom.x * inFrom.y;
    float level = mix(1.0 - 0.5 * soft, 1.0, fill);
    vec3 field = fieldAt(clamp(bq / apH, -1.0, 1.0)) * level * 1.45;
    // The cut edge of the wall catches the light as a hairline just inside the frame.
    float lip = smoothstep(2.6 * wpx, 1.2 * wpx, abs(sd + 1.6 * wpx));
    field += avg * lip * 0.3;

    vec3 col = mix(room, field, inside * step(tBack, t + 1e-4));

    // Bloom in the air in front of the aperture.
    float bloomD = max(sd, 0.0);
    col += avg * (0.05 + 0.05 * soft) * exp(-bloomD / (0.12 + 0.3 * soft)) * (1.0 - inside) * spillK;

    // The lens darkens a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the light keeps its color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark of the room lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
