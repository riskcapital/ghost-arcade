/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A single iris of light near the middle of the frame: a bladed opening glowing through a dark lens, with bloom spreading from it, faint star rays from its blade edges and a few lens ghosts of the same shape mirrored across the center. Swelling sound opens the iris slowly and its blades turn as they open; silence closes it again to a dim pinpoint. Each note eases a little more light through the haze. With a transparent background only the light is drawn.",
    "PASSES": [
        {
            "TARGET": "iris",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 8,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "blades", "LABEL": "Blades", "TYPE": "float", "DEFAULT": 7, "MIN": 5, "MAX": 12 },
        { "NAME": "curve", "LABEL": "Blade curve", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ghosts", "LABEL": "Ghosts", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "rays", "LABEL": "Star rays", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.5, 0.78, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Ghosts", "TYPE": "color", "DEFAULT": [1.0, 0.58, 0.24, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
// The opening's radius closed (a pinpoint) and fully open.
const float R_MIN = 0.011;
const float R_MAX = 0.17;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Signed distance to an iris opening of n blades and radius rad, turned by rot. Straight blade
// edges make a polygon; curved ones bow it toward a circle.
float irisDist(vec2 q, float n, float rad, float rot, float bow) {
    float a = atan(q.y, q.x) - rot;
    float sector = TAU / n;
    float phi = mod(a + sector * 0.5, sector) - sector * 0.5;
    float apo = rad * cos(PI / n);
    float poly = length(q) * cos(phi) - apo;
    float circ = length(q) - mix(apo, rad, 0.6);
    return mix(poly, circ, bow);
}

void main() {
    if (PASSINDEX == 0) {
        // One slot: how far open the iris is (x). It opens over about a second and closes over
        // about two, whatever the sound does, so it always breathes rather than jumps.
        vec4 prev = IMG_NORM_PIXEL(iris, vec2(0.5, 0.5));
        float target = clamp(vxSwell, 0.0, 1.0);
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        float o = prev.x + (target - prev.x) * (1.0 - exp(-dt / (target > prev.x ? 0.7 : 1.5)));
        if (FRAMEINDEX < 2 || prev.a < 0.5) o = target;
        gl_FragColor = vec4(o, 0.0, 0.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float px = 1.0 / RENDERSIZE.y;

    float open = IMG_NORM_PIXEL(iris, vec2(0.5, 0.5)).x;
    float oe = open * open * (3.0 - 2.0 * open);
    float pulse = clamp(vxPulse, 0.0, 1.0);
    float n = floor(clamp(blades, 5.0, 12.0) + 0.5);
    float rad = mix(R_MIN, R_MAX, oe);
    // Blades turn as the iris opens, plus a very slow drift.
    float rot = 0.35 + oe * 0.9 + vxFlow * 0.01;
    float bow = clamp(curve, 0.0, 1.0) * (0.6 + 0.4 * (1.0 - oe));
    // The iris sits a little off centre and wanders slowly, so its ghosts fan across the middle.
    vec2 c = vec2(-0.13 + 0.05 * sin(vxFlow * 0.031), 0.055 + 0.03 * cos(vxFlow * 0.023));
    // How much light gets through: area, with a floor so the pinpoint still reads.
    float power = 0.18 + 0.82 * oe;

    vec2 q = p - c;
    float r = length(q);
    float ang = atan(q.y, q.x) - rot;
    vec3 col = vec3(0.0);
    vec3 lightC = ink.rgb;

    // The opening. A lens slightly out of focus: its edge is soft, never a line.
    float soft = max(fwidth(r), px) + 0.002 + 0.006 * oe;
    float dG = irisDist(q, n, rad, rot, bow);
    vec3 cover = vec3(smoothstep(soft, -soft, dG));
    // What shows through it is the light behind: a white-hot source and its own glow, clipped by
    // the blades, so the opening is bright at the heart and deeper in colour toward its edge.
    float src = exp(-r * r / max(rad * rad * 0.12, 2e-5));
    float glowIn = exp(-r / max(rad * 0.5, 0.004));
    vec3 face = lightC * (0.7 + 2.2 * glowIn) + vec3(1.0) * (2.0 * src + 0.3 * glowIn * glowIn);
    // Closed to a pinpoint it burns small and white-hot.
    face *= 1.0 + 2.0 * (1.0 - oe);
    col += face * cover;

    // Bloom: hugs the opening's shape close in, rounds out further away.
    float dOut = max(dG, 0.0);
    float bNear = 1.0 / (1.0 + pow(dOut / (0.006 + 0.022 * oe), 2.0));
    float mid = exp(-dOut / (0.03 + 0.05 * oe));
    float bFar = exp(-r / (0.16 + 0.2 * oe));
    float veil = exp(-r / 0.55);
    float restGlow = 1.0 - oe;
    col += lightC * (bNear * 0.4 + mid * 0.22 + bFar * (0.08 + 0.16 * restGlow) + veil * (0.025 + 0.05 * restGlow)) * (0.35 + 0.65 * power) * (1.0 + 0.3 * pulse) * (1.0 - cover.g);

    // Star rays: short soft streaks from the blade edges, twice as many as blades when the count is odd.
    float m = mod(n, 2.0) > 0.5 ? n * 2.0 : n;
    float sec = TAU / m;
    float dev = (mod(ang, sec) - sec * 0.5) * r;
    float rayLen = 0.03 + 0.1 * oe;
    float rayW = 0.002 + 0.02 * r;
    float ray = exp(-dev * dev / (rayW * rayW)) * exp(-(r - rad) / rayLen) * smoothstep(rad * 0.8, rad * 1.3 + 0.01, r);
    col += mix(lightC, vec3(1.0), 0.3) * ray * rays * 0.35 * (0.4 + 0.6 * power);

    // Lens ghosts: the opening's shape again, mirrored through the centre at a few scales, a
    // soft body with a brighter rim whose colours split slightly, as real ghosts do.
    vec3 gcol = vec3(0.0);
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float along = k == 0 ? -1.2 : (k == 1 ? -2.6 : 2.1);
        float sz = k == 0 ? 0.8 : (k == 1 ? 0.45 : 1.5);
        vec2 gq = (p - c * along) / sz;
        float gr = max(rad, 0.05) * (0.85 + 0.2 * fk);
        float gw = (0.004 + 0.01 * oe) / sz;
        float gdO = irisDist(gq, n, gr * 1.03, rot + PI * fk, bow);
        float gdI = irisDist(gq, n, gr * 0.97, rot + PI * fk, bow);
        float body = smoothstep(gw, -gw * 4.0, gdI);
        float rimO = exp(-gdO * gdO / (gw * gw));
        float rimI = exp(-gdI * gdI / (gw * gw));
        vec3 tint = k == 1 ? mix(accent.rgb, lightC, 0.4) : accent.rgb;
        // Brighter toward the side facing the light, as a real ghost's coating catches it.
        float lean = 0.8 + 0.4 * clamp(dot(gq, normalize(c * (1.0 - along) + 1e-5)) / gr, -1.0, 1.0);
        vec3 g = (tint * (body * 0.6 + rimO * 0.35) + lightC * rimI * 0.12) * lean;
        float strength = k == 0 ? 0.42 : (k == 1 ? 0.55 : 0.2);
        gcol += g * strength;
    }
    col += gcol * ghosts * (0.25 + 0.75 * oe) * (0.85 + 0.3 * pulse);

    // The blades round the light: dark metal leaves overlapping like a pinwheel. Each leaf is lit
    // by spill from the opening and brightens across its width toward the edge it tucks under,
    // where the next leaf throws a soft contact shadow. They read by shading alone.
    float housingR = 0.4;
    float u = (ang - r * 3.0) / (TAU / n);
    float uf = fract(u);
    float leafFw = max(fwidth(u), 1e-4) * 1.5;
    float leaf = smoothstep(0.0, 0.85, uf) * smoothstep(1.0, 1.0 - leafFw, uf);
    float shade = 0.25 + 0.75 * leaf;
    float housing = smoothstep(housingR, housingR * 0.6, r);
    float spill = exp(-dOut / (0.05 + 0.08 * oe)) + 0.3 * exp(-r / 0.25);
    vec3 metal = mix(lightC, accent.rgb, 0.25);
    col += metal * spill * shade * 0.16 * (0.4 + 0.6 * power) * housing * (1.0 - cover.g);

    // Tone map on luminance so the light keeps its colour, then a little dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.3));
    float burn = clamp(lum - 1.5, 0.0, 4.0) / 4.0;
    col = mix(col, vec3(1.0 - exp(-lum * 1.3)), burn * 0.8);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Light is only as solid as it is bright.
        outa = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
