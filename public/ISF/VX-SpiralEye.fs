/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A hypnotic eye in a crown of rays. Its iris is a turning spiral of coloured bands that winds faster as the sound swells, and the eye glances left and right with the pitch. Each hit snaps the pupil small, shoots the rays outward and sends a jolt round the spiral; now and then the eye blinks.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "swirl", "LABEL": "Swirl", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "rays", "LABEL": "Rays", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "gaze", "LABEL": "Glances", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "blinks", "LABEL": "Blinks", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "arms", "LABEL": "Spiral arms", "TYPE": "long", "DEFAULT": 3, "VALUES": [1, 2, 3, 4, 6], "LABELS": ["1", "2", "3", "4", "6"] },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Iris", "TYPE": "color", "DEFAULT": [0.1, 0.85, 0.75, 1.0] },
        { "NAME": "accent", "LABEL": "Rays", "TYPE": "color", "DEFAULT": [1.0, 0.25, 0.6, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;

vec3 hueShift(vec3 c, float a) {
    vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

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

// Signed distance to an almond: the overlap of two circles, lid heights
// hu (upper) and hl (lower) over a half width W.
float almond(vec2 p, float W, float hu, float hl) {
    hu = max(hu, 0.002);
    hl = max(hl, 0.002);
    float ru = (W * W + hu * hu) / (2.0 * hu);
    float rl = (W * W + hl * hl) / (2.0 * hl);
    float du = length(p - vec2(0.0, hu - ru)) - ru;
    float dl = length(p - vec2(0.0, rl - hl)) - rl;
    float d = max(du, dl);
    // Keep the corners pointed and the outside distance sane.
    return max(d, abs(p.x) - W);
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float hit = clamp(vxHit, 0.0, 1.0);
    float env = clamp(vxEnv, 0.0, 1.0);
    float kick = hit * (0.5 + 0.5 * vxVel);
    float t = vxPhase + TIME * 0.1;

    float S = mix(0.9, 1.6, size) * (1.0 + 0.04 * kick);
    p /= S;
    px /= S;

    // ---- Blink: a quick close and open now and then.
    float period = mix(14.0, 3.5, blinks);
    float bt = TIME / period;
    float bph = fract(bt) * period;           // seconds into the cycle
    float skip = step(blinks, hash11(floor(bt) + 3.0) * 0.6);
    float closeAmt = blinks > 0.01 ? (1.0 - smoothstep(0.0, 0.09, abs(bph - 0.12))) * (1.0 - skip) : 0.0;
    float W = 0.36;
    float H = 0.19;
    float hu = H * (1.0 - closeAmt) + 0.0025;
    float hl = H * 0.82 * (1.0 - 0.6 * closeAmt) + 0.0025;
    // Eye opens wider with the sound.
    hu *= 1.0 + 0.12 * env + 0.1 * kick;

    float dEye = almond(p, W, hu, hl);
    float aa = 1.5 * px;

    // ---- Iris and pupil.
    float look = (vxGlide - 0.5) * 2.0 * gaze;
    vec2 ic = vec2(look * 0.12 + 0.03 * sin(t * 0.7) * gaze, 0.012 * sin(t * 0.53) * gaze);
    float ri = 0.165;
    vec2 q = p - ic;
    float r = length(q);
    float a = atan(q.y, q.x);
    float nArms = float(arms);
    float wind = mix(1.5, 7.0, swirl);
    float spinT = t * (0.9 + 2.2 * swirl) + 0.6 * kick;
    float sp = a * nArms / TAU + log(max(r, 1e-4)) * wind - spinT;
    float band = fract(sp);
    float bandId = floor(sp);
    // Two-tone bands with dark seams; a third hue weaves through.
    vec3 c1 = ink.rgb;
    vec3 c2 = accent.rgb;
    vec3 c3 = hueShift(mix(c1, c2, 0.5), 2.2 + vxGlide);
    float which = mod(bandId, 3.0);
    vec3 bc = which < 0.5 ? c1 : (which < 1.5 ? c2 : mix(c3, c1, 0.3));
    float seam = smoothstep(0.0, 0.08, band) * smoothstep(1.0, 0.86, band);
    vec3 iris = bc * (0.3 + 0.8 * seam) * (0.75 + 0.35 * sin(band * PI));
    // A jolt travels out along the spiral on a hit.
    float jolt = exp(-pow((r / ri - (1.0 - hit) * 1.1) * 7.0, 2.0)) * kick;
    iris += mix(c2, vec3(1.0), 0.5) * jolt * 1.4;
    // Darker limbal ring and inner sunburst.
    iris *= mix(0.35, 1.0, smoothstep(ri, ri * 0.8, r));
    iris += c1 * 0.25 * smoothstep(ri * 0.55, ri * 0.25, r);

    float rp = ri * clamp(0.3 + 0.22 * env - 0.18 * kick + 0.03 * sin(TIME * 0.9), 0.12, 0.62);
    float pupil = 1.0 - smoothstep(rp - aa, rp + aa, r);
    vec3 pupilC = vec3(0.01) + c2 * 0.15 * smoothstep(rp * 0.4, rp, r);
    // Pupil rim glow.
    float prim = exp(-abs(r - rp) / (0.006 + 0.01 * kick));

    float irisMask = 1.0 - smoothstep(ri - aa, ri + aa, r);
    // Sclera: pale, tinted, shadowed under the lids.
    vec3 sclera = mix(vec3(1.0, 0.98, 0.97), c1, 0.08);
    float lidShade = smoothstep(-0.07, 0.0, dEye);
    sclera *= 1.0 - 0.35 * lidShade;
    sclera *= 0.85 + 0.15 * smoothstep(0.0, 0.3, -p.y + 0.1);

    vec3 eyeC = mix(sclera, iris, irisMask);
    eyeC = mix(eyeC, pupilC, pupil);
    eyeC += c2 * prim * 0.5 * (1.0 - pupil) * irisMask;
    // Catchlight.
    vec2 cl = q - vec2(-0.35, 0.4) * ri;
    eyeC += vec3(1.0) * (1.0 - smoothstep(0.016 - aa, 0.016 + aa, length(cl))) * 0.9;
    eyeC *= 1.0 - 0.45 * lidShade;

    float inEye = 1.0 - smoothstep(-aa, aa, dEye);

    // ---- Lid line: a thick ink stroke round the almond, flicked at the corners.
    float lidW = 0.012 + 0.004 * env;
    float lid = 1.0 - smoothstep(lidW - aa, lidW + aa, abs(dEye));
    // Upper lid sweeps out into a flick at the outer corners.
    vec2 fp = vec2(abs(p.x) - W, p.y);
    float flick = length(fp - vec2(clamp(fp.x, 0.0, 0.07), 0.035 * clamp(fp.x / 0.07, 0.0, 1.0)))
                - lidW * (1.0 - clamp(fp.x / 0.08, 0.0, 1.0));
    lid = max(lid, 1.0 - smoothstep(-aa, aa, flick));
    vec3 lidC = mix(c1 * 0.25, vec3(0.02), 0.5);

    // ---- Crown of rays around the eye.
    vec2 e = vec2(p.x / (W * 1.05), p.y / 0.3);
    float ea = atan(e.y, e.x);
    float N = floor(mix(16.0, 40.0, rays) * 0.5) * 2.0;
    float cell = ea * N / TAU + 0.5;
    float rid = floor(cell);
    float rf = fract(cell) - 0.5;
    float alt = mod(rid, 2.0);
    float gap = 0.035;
    float baseL = mix(0.06, 0.2, rays) * (alt > 0.5 ? 0.6 : 1.0);
    float wob = 0.5 + 0.5 * sin(rid * 1.7 + t * 2.0);
    float L = baseL * (0.75 + 0.35 * wob + 0.25 * env) * (1.0 + 1.1 * kick * (0.6 + 0.4 * hash11(rid + floor(vxCount))));
    float u = (dEye - gap) / L;                    // 0 at ray root, 1 at tip
    float rWidth = (1.0 - u) * 0.36;               // angular half width in cells
    float rayDist = (abs(rf) - rWidth) * TAU / N * length(p);
    float ray = (1.0 - smoothstep(-aa, aa, rayDist)) * step(0.0, u) * step(u, 1.0);
    ray *= smoothstep(0.0, 0.02, u * L);
    vec3 rayC = alt > 0.5 ? c1 : c2;
    rayC = mix(rayC, vec3(1.0), 0.25 * (1.0 - u) + 0.4 * kick * (1.0 - u));
    rayC *= 0.7 + 0.5 * (1.0 - u);

    // Halo glow round the whole figure.
    float glow = exp(-max(dEye, 0.0) / (0.05 + 0.05 * env + 0.06 * kick)) * (1.0 - inEye);
    vec3 glowC = mix(c2, c1, 0.5);

    // ---- Compose (premultiplied subject).
    vec4 Sb = vec4(glowC * glow * 0.4, glow * 0.4);
    Sb = vec4(rayC, 1.0) * ray + Sb * (1.0 - ray);
    Sb = vec4(eyeC, 1.0) * inEye + Sb * (1.0 - inEye);
    Sb = vec4(lidC, 1.0) * lid + Sb * (1.0 - lid);
    Sb.a = clamp(max(Sb.a, max(Sb.r, max(Sb.g, Sb.b))), 0.0, 1.0);
    Sb.rgb = min(Sb.rgb, vec3(Sb.a));

    // Opaque background: a faint spiral continuing out from the eye.
    vec2 bq = p;
    float br = length(bq);
    float bsp = fract(atan(bq.y, bq.x) * nArms / TAU + log(max(br, 1e-3)) * wind * 0.5 - spinT * 0.5);
    vec3 bg = mix(c1 * 0.025, c2 * 0.05, smoothstep(0.3, 0.7, bsp) * smoothstep(0.7, 0.4, bsp));
    bg *= 1.0 - smoothstep(0.3, 1.2, br);
    bg += c1 * 0.02;
    bg += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;

    vec4 outc = vxClear ? Sb : vec4(Sb.rgb + max(bg, 0.0) * (1.0 - Sb.a), 1.0);
    gl_FragColor = outc * vxPresence;
}
