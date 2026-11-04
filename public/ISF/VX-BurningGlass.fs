/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A glass ball hangs over a dark floor in a warm column of sunlight and gathers it into a blazing, shimmering pool beneath it, with the floor seen upside down inside the glass and glints of caught light moving within it. The music swells the light: each surge draws the pool into sharper focus and blooms a halo of light out across the floor that slowly settles back; a held sound burns everything brighter, and pitch swings the sun so the pool glides around.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "focus", "LABEL": "Focus", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "flare", "LABEL": "Hit flare", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "sunSwing", "LABEL": "Sun swing", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "dispersion", "LABEL": "Colour fringe", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ballSize", "LABEL": "Ball size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "shaftAmt", "LABEL": "Light shafts", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "shadow", "LABEL": "Shadow", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Sunlight", "TYPE": "color", "DEFAULT": [1.0, 0.86, 0.6, 1.0] },
        { "NAME": "accent", "LABEL": "Fringe", "TYPE": "color", "DEFAULT": [0.35, 0.75, 1.0, 1.0] },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const int RAYS = 20;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Light reaching the floor under a ball lens, as a radial profile: rays enter
// at heights h across the ball, bend toward a focus that sits closer for the
// outer rays, and land on the floor at radius |h (1 - d / f(h))|. Each ray is
// splatted as a soft ring, so the bright rim and core come out of the sum.
float lensProfile(float r, float d, float rad, float f0, float px) {
    float dh = rad / float(RAYS);
    float spread = abs(1.0 - d / f0);
    float w = max(px * 1.5, dh * spread * 0.9 + 0.006);
    float acc = 0.0;
    for (int i = 0; i < RAYS; i++) {
        float h = (float(i) + 0.5) * dh;
        float hn = h / rad;
        float fh = f0 * (1.0 - 0.5 * hn * hn);
        float ri = abs(h * (1.0 - d / fh));
        float x = (r - ri) / w;
        // Grazing rays mostly bounce off the glass.
        float tr = 1.0 - pow(hn, 6.0);
        acc += h * tr * exp(-0.5 * x * x);
    }
    return acc * dh / (w * 2.5066 * max(r, w));
}

struct Scene {
    vec3 c;
    float rad;
    vec3 L;
    float f0;
    float disp;
    float boom;
    float age;
    float pool;
    float tm;
};

// Floor lighting at a floor point: sun, the ball's shadow and its caustic
// pool, the hit ring. Returns colour and a coverage for the transparent mode.
vec4 floorLight(vec3 p, Scene s, float px, bool clearMode, bool cheap) {
    vec3 v = p - s.c;
    float d = dot(v, -s.L);
    vec3 rv = v + s.L * d;
    float r0 = length(rv);
    // The pool shimmers: its outline wavers and filaments of light crawl
    // across it, as if the air or the glass were alive.
    vec2 ca = vec2(rv.x, rv.z) / max(r0, 1e-4);
    float wob = noise2(ca * 2.5 + vec2(s.tm * 0.6, -s.tm * 0.45)) - 0.5;
    float r = r0 * (1.0 + 0.16 * wob);
    float behind = smoothstep(0.0, 0.3, d);
    float blocked = (1.0 - smoothstep(s.rad - px * 2.0 - 0.02, s.rad + px * 2.0 + 0.02, r)) * behind;
    float lit = 1.0 - blocked * shadow * 0.92;
    lit *= 1.0 + 1.6 * exp(-length(p.xz - (s.c - s.L * (s.c.y / s.L.y)).xz) * 0.9);
    float near = r < s.rad * 1.6 && d > 0.0 ? 1.0 : 0.0;
    float cIn = 0.0;
    float cOut = 0.0;
    if (near > 0.5) {
        cIn = lensProfile(r, d, s.rad, s.f0, px);
        cOut = cheap ? cIn : lensProfile(r, d, s.rad, s.f0 * (1.0 + s.disp), px);
    }
    float gain = s.pool;
    // Roll the pool off softly so the rim and core keep their shape.
    float cI = 2.2 * (1.0 - exp(-cIn * gain * 0.28));
    float cO = 2.2 * (1.0 - exp(-cOut * gain * 0.28));
    float fil = noise2(ca * 7.0 + vec2(r0 * 22.0 - s.tm * 1.7, s.tm * 0.3));
    float fil2 = noise2(ca * 13.0 + vec2(-r0 * 35.0 + s.tm * 2.3, 5.0));
    float shimmer = 0.6 + 0.9 * fil * fil + 0.5 * pow(fil2, 3.0);
    vec3 warm = mix(ink.rgb, vec3(1.0, 0.82, 0.55) * max(max(ink.r, ink.g), ink.b), 0.3);
    vec3 hot = warm * cI * shimmer + accent.rgb * max(cO - cI * 0.8, 0.0) * 1.8;
    // A warm glow spills across the floor around the pool.
    vec2 pc = (s.c - s.L * (s.c.y / s.L.y)).xz;
    hot += warm * 0.22 * exp(-length(p.xz - pc) / (s.rad * 0.9)) * gain * (1.0 - blocked * 0.6);
    // A ring of light rolls out from the pool on each hit.
    vec2 centre = (s.c - s.L * (s.c.y / s.L.y)).xz;
    float rr = length(p.xz - centre);
    // A halo of light that blooms out across the floor as the music surges.
    float spreadR = s.rad * (0.5 + 1.6 * s.age);
    float ring = exp(-rr * rr / (spreadR * spreadR)) * s.age * s.boom;
    hot += mix(ink.rgb, accent.rgb, 0.35) * ring * 0.55;
    // Faint tiled stone, only where the background is drawn.
    float stone = 0.0;
    if (!clearMode) {
        vec2 g = p.xz * 1.4;
        vec2 e = abs(fract(g) - 0.5);
        float seam = smoothstep(0.47, 0.5, max(e.x, e.y));
        stone = 0.55 + 0.45 * noise2(g * 3.0) - seam * 0.35 + 0.15 * hash21(floor(g));
    }
    vec3 base = mix(vec3(0.05, 0.05, 0.06), ink.rgb * 0.22, 0.6) * stone * lit;
    vec3 col = base + hot;
    // Coverage for the cut-out: the pool and ring by their brightness, the
    // shadow as a translucent dark disc.
    float glowA = 1.0 - exp(-1.3 * dot(hot, vec3(0.3333)));
    float shadowA = blocked * shadow * 0.55 * smoothstep(-0.2, 0.5, d);
    return vec4(col, max(glowA, shadowA));
}

vec3 sky(vec3 dir, Scene s) {
    float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(vec3(0.02, 0.02, 0.03), ink.rgb * 0.35 + accent.rgb * 0.08, pow(up, 1.6));
    float sun = max(dot(dir, s.L), 0.0);
    col += ink.rgb * (pow(sun, 900.0) * 30.0 + pow(sun, 40.0) * 0.6);
    // A pale window frame in the distance gives the glass something to mirror.
    float band = smoothstep(0.25, 0.3, dir.y) * smoothstep(0.75, 0.7, dir.y);
    float bars = smoothstep(0.92, 0.96, abs(sin(atan(dir.x, dir.z) * 3.0)));
    col += accent.rgb * band * bars * 0.35;
    return col;
}

void main() {
    // The music's surge, straight from the studio: a fast attack with a
    // smooth, eased release.
    float sprX = vxPulse;
    float sprLagA = vxPulse;
    float sprLagB = vxPulse;
    float sprLagC = vxPulse;
    float swellE = vxSwell;
    // Surges of the music, eased once more so the light swells rather than
    // flashes; the halo trails a little behind.
    float kick = clamp(sprX, 0.0, 1.2);
    float haloK = clamp(sprLagB, 0.0, 1.2);
    float boom = flare;
    float age = 0.0;

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 sp = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    sp *= max(1.0, 1.5 / aspect);
    float px = 2.0 / RENDERSIZE.y;
    bool clearMode = vxClear;

    float t = vxFlow * 0.5;
    Scene s;
    s.rad = mix(0.55, 0.95, ballSize) * (1.0 + 0.04 * kick);
    float bob = 0.06 * sin(t * 1.3) - 0.05 * kick;
    s.c = vec3(0.0, s.rad + 0.75 + bob, 0.0);
    float swing = (vxGlide - 0.5) * 1.1 * sunSwing + 0.35 * sin(t * 0.4) * sunSwing;
    s.L = normalize(vec3(sin(swing) * 0.75, 1.0, -0.35 + 0.25 * cos(t * 0.31)));
    // Distance from the ball's centre to the floor along the light.
    float dFloor = s.c.y / s.L.y;
    // Focus: the paraxial focal length relative to the floor; hits pull it in.
    float sharp = clamp(focus + 0.35 * kick * flare, 0.0, 1.0);
    s.f0 = dFloor * mix(3.6, 1.12, sharp);
    s.disp = mix(0.0, 0.12, dispersion);
    s.boom = boom;
    s.age = haloK;
    s.pool = (0.95 + 0.7 * swellE + 1.5 * kick * flare);
    s.tm = t * 3.0;

    // Camera looking down on the floor at a slant.
    vec3 ro = vec3(0.0, 2.2, -4.3);
    vec3 ta = vec3(0.0, 1.05, 0.25);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 upv = cross(fw, rt);
    vec3 rd = normalize(fw * 1.55 + rt * sp.x + upv * sp.y);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // Floor.
    float tf = rd.y < -1e-4 ? -ro.y / rd.y : 1e6;
    vec3 pf = ro + rd * tf;
    float fade = exp(-max(tf - 4.0, 0.0) * 0.18);
    if (tf < 1e5) {
        vec4 fl = floorLight(pf, s, px * tf * 0.6, clearMode, false);
        float rim = clearMode ? 1.0 : fade;
        col = fl.rgb * rim;
        alpha = fl.a * fade;
    } else if (!clearMode) {
        col = sky(rd, s) * 0.3;
    }
    if (!clearMode) {
        col = mix(sky(rd, s) * 0.25, col, fade);
    }

    // The light itself, made visible by dust: a column of sun falling onto
    // the ball and a cone squeezed out under it down to the pool.
    {
        vec3 ax = -s.L;
        vec3 w0 = ro - s.c;
        float bb = dot(rd, ax);
        float dd = dot(rd, w0);
        float ee = dot(ax, w0);
        float den = max(1.0 - bb * bb, 1e-4);
        float tv = (bb * ee - dd) / den;
        float ta2 = (ee - bb * dd) / den;
        vec3 q1 = ro + rd * tv;
        vec3 q2 = s.c + ax * ta2;
        float dist = length(q1 - q2);
        float sinT = sqrt(den);
        float limit = tf < 1e5 ? tf : 1e6;
        // The column above the ball is always above the floor, so only the
        // cone below it can be hidden by the floor.
        float vis = smoothstep(0.0, 0.2, tv) * (ta2 < 0.0 ? 1.0 : smoothstep(limit + 0.6, limit - 0.2, tv));
        float dust = 0.6 + 0.8 * noise2(vec2(ta2 * 6.0 - t * 2.0, dist * 9.0 + t));
        float beam = 0.0;
        if (ta2 > 0.0 && ta2 < dFloor) {
            // Soft gaussian cone: it narrows toward the focus and its light
            // is packed tighter the narrower it gets.
            float k = clamp(ta2 / s.f0, 0.0, 1.0);
            float e = s.rad * max(abs(1.0 - ta2 / s.f0), 0.06) * 0.8;
            beam = exp(-dist * dist / (e * e)) * s.rad / e * 0.22;
            beam *= smoothstep(s.rad * 0.6, s.rad * 1.1, ta2) * (1.0 + 0.5 * k);
        } else if (ta2 < 0.0) {
            beam = exp(-dist * dist / (s.rad * s.rad * 0.6)) * 0.7 * exp(ta2 * 0.15) / (0.6 + 0.4 * s.pool);
        }
        beam *= vis * dust * s.pool / sinT * mix(0.4, 1.0, shaftAmt);
        vec3 warmB = mix(ink.rgb, vec3(1.0, 0.8, 0.5) * max(max(ink.r, ink.g), ink.b), 0.35);
        vec3 bc = mix(warmB, accent.rgb, 0.25 * smoothstep(0.3, 1.0, ta2 / dFloor)) * beam;
        col += bc;
        alpha = max(alpha, 1.0 - exp(-1.4 * beam));
    }

    // The ball.
    vec3 oc = ro - s.c;
    float b = dot(oc, rd);
    float cc = dot(oc, oc) - s.rad * s.rad;
    float h = b * b - cc;
    float edgeW = px * 3.0;
    float cover = smoothstep(-edgeW * s.rad, edgeW * s.rad, h);
    if (h > -edgeW * s.rad) {
        float ts = -b - sqrt(max(h, 0.0));
        vec3 ps = ro + rd * ts;
        vec3 nn = normalize(ps - s.c);
        float cosi = clamp(dot(-rd, nn), 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
        vec3 refl = reflect(rd, nn);
        vec3 refrCol = vec3(0.0);
        float refrA = 0.0;
        float eta = 1.0 / 1.5;
        vec3 r1 = refract(rd, nn, eta);
        if (dot(r1, r1) > 0.0) {
            // Through the ball and out the far side.
            float t2 = -2.0 * dot(ps - s.c, r1);
            vec3 pe = ps + r1 * t2;
            vec3 ne = normalize(s.c - pe);
            vec3 r2 = refract(r1, ne, 1.5);
            if (dot(r2, r2) < 1e-4) r2 = reflect(r1, ne);
            if (r2.y < -1e-3) {
                float tq = -pe.y / r2.y;
                vec4 fq = floorLight(pe + r2 * tq, s, px * 4.0, clearMode, true);
                refrCol = fq.rgb;
                refrA = fq.a;
            }
            if (!clearMode) refrCol += sky(r2, s) * (r2.y < 0.0 ? 0.0 : 0.8);
            // Sunlight caught and scattered inside the glass.
            refrCol += ink.rgb * 0.12 * (0.6 + 0.8 * kick) * smoothstep(-0.2, 1.0, dot(r1, -s.L));
            // Where the gathered light leaves the glass it burns a bright crescent.
            float exitHot = pow(max(dot(-ne, -s.L), 0.0), 18.0);
            refrCol += mix(ink.rgb, vec3(1.0), 0.4) * exitHot * (1.4 + 1.6 * kick);
            // Glints of gathered light caught inside the glass.
            vec3 gq = normalize(pe - s.c) * 11.0 + vec3(0.0, t * 1.5, t * 0.7);
            float gl1 = noise2(gq.xy + gq.z) * noise2(gq.zy * 1.3 - gq.x);
            float glints = pow(gl1 * 1.75, 10.0) * smoothstep(-0.2, 0.8, dot(-ne, -s.L));
            refrCol += mix(ink.rgb, accent.rgb, 0.4) * glints * (1.2 + 1.8 * kick);
            refrA = max(refrA, min(glints, 1.0));
            refrA = max(refrA, exitHot);
        }
        vec3 tint = mix(vec3(1.0), ink.rgb, 0.25);
        vec3 glassCol = refrCol * tint * (1.0 - fres) + sky(refl, s) * fres * 1.4;
        // Thin bright rim and a hot sun glint.
        float rimL = pow(1.0 - cosi, 3.0);
        glassCol += mix(accent.rgb, ink.rgb, 0.4) * rimL * 0.9;
        // Warm sun-side rim.
        float sunRim = pow(1.0 - cosi, 2.0) * pow(max(dot(nn, s.L), 0.0), 2.0);
        glassCol += ink.rgb * sunRim * (1.2 + 1.0 * kick);
        float glint = pow(max(dot(refl, s.L), 0.0), 600.0) * 6.0;
        glassCol += vec3(1.0) * glint;
        // In the cut-out the glass is a clear body with a solid rim.
        float glassA = clamp(0.32 + 0.9 * rimL + sunRim + fres + refrA * 0.6 + glint, 0.0, 1.0);
        if (clearMode) {
            col = mix(col, glassCol, cover);
            alpha = mix(alpha, glassA, cover);
        } else {
            col = mix(col, glassCol, cover);
        }
    }

    // Gentle tone curve so the pool burns without clipping the colour away.
    col = col / (1.0 + 0.18 * max(max(col.r, col.g), col.b));
    col = pow(max(col, 0.0), vec3(0.9));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col = max(col, 0.0);

    if (clearMode) {
        alpha = clamp(alpha, 0.0, 1.0);
        col = min(col, vec3(1.0));
        // The colour is light over darkness, so it already reads as
        // premultiplied; keep it within the coverage.
        col = min(col, vec3(alpha));
        gl_FragColor = vec4(col, alpha) * vxPresence;
    } else {
        gl_FragColor = vec4(min(col, vec3(1.0)) * vxPresence, 1.0);
    }
}
