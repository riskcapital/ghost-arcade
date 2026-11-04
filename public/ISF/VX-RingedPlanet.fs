/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A banded gas giant inside a wide, finely grooved ring system, with small moons circling it and slipping behind the planet. The sun swings round as the note rises and falls, sweeping the line between day and night across the planet and turning its shadow across the rings. The music turns the planet and moves the moons faster or slower; the sound's swell brightens the rings and auroras, and each hit makes the polar auroras flare and lights waves of light rolling out across the rings. With a transparent background the planet, rings and moons are a solid cut-out, the ring gaps letting the picture behind show through.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "aurora", "LABEL": "Aurora", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "sunSwing", "LABEL": "Sun follows note", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ringTilt", "LABEL": "Ring tilt", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.05, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.3, "MAX": 1 },
        { "NAME": "moons", "LABEL": "Moons", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3], "LABELS": ["None", "One", "Two", "Three"] },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Planet", "TYPE": "color", "DEFAULT": [0.95, 0.72, 0.45, 1.0] },
        { "NAME": "accent", "LABEL": "Aurora and bands", "TYPE": "color", "DEFAULT": [0.35, 0.85, 1.0, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
// Ring inner and outer radius, in planet radii.
const float RING_IN = 1.3;
const float RING_OUT = 2.35;

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

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm3(vec2 x) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        v += amp * noise2(x);
        x = mat2(1.6, 1.2, -1.2, 1.6) * x + 1.7;
        amp *= 0.5;
    }
    return v;
}

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// Ring optical density at a radius in planet radii: many ringlets and a few clean gaps.
// aa: pixel footprint in radius units, so ringlets finer than a pixel fade to their
// average instead of flickering as the rings rock.
float ringDensity(float rr, float aa) {
    float inside = smoothstep(RING_IN, RING_IN + 0.04, rr) * smoothstep(RING_OUT, RING_OUT - 0.04, rr);
    float x = (rr - RING_IN) / (RING_OUT - RING_IN);
    float fine = 0.55 + 0.45 * mix(noise1(rr * 160.0), 0.5, smoothstep(0.25, 0.8, aa * 160.0));
    float mid = 0.5 + 0.5 * mix(noise1(rr * 34.0 + 3.0), 0.5, smoothstep(0.25, 0.8, aa * 34.0));
    // Broad structure: faint inner ring, bright middle ring, gap, outer ring.
    float broad = mix(0.35, 1.0, smoothstep(0.08, 0.3, x));
    broad *= 1.0 - 0.92 * (smoothstep(0.6, 0.62, x) - smoothstep(0.68, 0.7, x));
    broad *= 1.0 - 0.75 * (smoothstep(0.9, 0.905, x) - smoothstep(0.92, 0.925, x));
    broad *= mix(1.0, 0.7, smoothstep(0.7, 1.0, x));
    return inside * broad * fine * (0.65 + 0.35 * mid);
}

float stars(vec2 p, float cells) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    vec2 o = vec2(hash21(id + 7.1), hash21(id + 3.7)) - 0.5;
    float d = length(f - o * 0.7);
    return step(0.86, h) * smoothstep(0.09, 0.0, d) * (0.3 + 0.7 * hash21(id + 1.3));
}

void main() {
    vec2 res = RENDERSIZE;
    float R = 0.3 * size;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y / R;
    float t = vxFlow * 0.12;
    float pls = clamp(vxPulse, 0.0, 1.0);
    float hitK = pls * pls * (3.0 - 2.0 * pls);
    float swell = clamp(vxSwell * 0.8 + vxEnergy * 0.2, 0.0, 1.0);

    // Planet axis = ring normal: tipped toward us, then rolled a little.
    // The whole system rocks slowly as it turns, faster when the music drives it.
    float tl = mix(0.06, 0.62, ringTilt) + 0.07 * sin(t * 0.9);
    float roll = -0.32 + 0.05 * sin(t * 0.63 + 1.0);
    vec3 N = normalize(vec3(sin(roll) * cos(tl), cos(roll) * cos(tl), sin(tl)));
    vec3 E1 = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
    vec3 E2 = cross(N, E1);

    // Sun direction: swings round with the note.
    float sa = mix(0.9, -0.9, vxGlide) * sunSwing * 1.6 + 0.85 + sin(t * 0.21) * 0.15;
    vec3 L = normalize(vec3(sin(sa), 0.22, cos(sa) * 0.9 - 0.15));

    vec3 hotC = mix(vec3(1.0), accent.rgb, 0.4);

    // --- Opaque bodies: planet and moons. Nearest wins. ---
    float zO = -1e5;
    vec3 colO = vec3(0.0);
    float aO = 0.0;

    float pr2 = dot(p, p);
    float edgeAA = 1.5 / (R * res.y);
    if (pr2 < 1.0 + 4.0 * edgeAA) {
        float zs = sqrt(max(1.0 - pr2, 0.0));
        vec3 n = vec3(p, zs);
        float lat = dot(n, N);
        float spinA = t * (0.4 + 2.0 * spin);
        vec3 E1r = E1 * cos(spinA) + E2 * sin(spinA);
        vec3 E2r = E2 * cos(spinA) - E1 * sin(spinA);
        vec2 eq = vec2(dot(n, E1r), dot(n, E2r));
        float warp = fbm3(eq * 2.2 + lat * 5.0) - 0.5;
        float b1 = 0.5 + 0.5 * sin(lat * 15.0 + warp * 2.6);
        float b2 = 0.5 + 0.5 * sin(lat * 37.0 + warp * 5.0 + 1.3);
        vec3 pale = mix(ink.rgb, vec3(1.0, 0.97, 0.9), 0.55);
        vec3 deep = ink.rgb * 0.55;
        vec3 surf = mix(deep, pale, b1);
        surf = mix(surf, mix(surf, accent.rgb * 0.7 + ink.rgb * 0.3, 0.55), smoothstep(0.55, 0.95, b2) * 0.6);
        // Storm spot.
        vec2 so = eq - vec2(0.55, 0.0);
        float spot = smoothstep(0.2, 0.05, length(vec2(so.x, (lat + 0.35) * 2.2))) * step(0.0, dot(n, E1r));
        surf = mix(surf, accent.rgb * 0.5 + vec3(0.25, 0.1, 0.05), spot * 0.7);
        // Polar darkening.
        surf *= mix(1.0, 0.55, smoothstep(0.6, 0.95, abs(lat)));

        float ndl = dot(n, L);
        float day = smoothstep(-0.06, 0.18, ndl);
        // Ring shadow on the planet.
        float ldn = dot(L, N);
        float rsh = 0.0;
        if (abs(ldn) > 0.01) {
            float tt = -dot(n, N) / ldn;
            if (tt > 0.0) {
                vec3 h = n + L * tt;
                rsh = ringDensity(length(h), 0.02) * 0.85;
            }
        }
        float lit = day * (0.35 + 0.75 * max(ndl, 0.0)) * (1.0 - rsh);
        // Limb darkening and a thin atmosphere on the lit limb.
        float mu = zs;
        vec3 c = surf * lit * (0.55 + 0.45 * mu);
        float rim = pow(1.0 - mu, 3.0) * smoothstep(-0.2, 0.4, ndl);
        c += mix(ink.rgb, vec3(0.7, 0.85, 1.0), 0.5) * rim * (0.7 + 1.2 * hitK);
        // The pulse also lights the upper atmosphere all round the limb.
        c += mix(accent.rgb, vec3(0.8, 0.9, 1.0), 0.3) * pow(1.0 - mu, 4.0) * hitK * aurora * 0.9;
        // Night side: faint ringshine so the dark disk still has form.
        c += surf * 0.035 * (1.0 - day) * (0.5 + 0.5 * mu);
        // Auroras: rings round both poles, lit by hits and the sound.
        float aurLat = abs(lat);
        float aur = exp(-pow((aurLat - 0.88) / 0.035, 2.0)) * (0.6 + 0.4 * sin(atan(eq.y, eq.x) * 7.0 + t * 6.0));
        aur += exp(-pow((aurLat - 0.9) / 0.06, 2.0)) * 0.3;
        aur *= aurora * (hitK * 4.0 + swell * 1.4 + 0.08);
        c += (accent.rgb * 1.3 + 0.05) * aur * (0.6 + 0.6 * (1.0 - day));
        zO = zs;
        colO = c;
        aO = smoothstep(1.0 + edgeAA, 1.0 - edgeAA, sqrt(pr2));
    }

    // Moons orbit in the ring plane (slightly inclined), beyond the rings.
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        if (fi >= float(moons)) {
            break;
        }
        float orb = 2.75 + fi * 0.62;
        float w = 0.55 / pow(orb, 1.5) * 3.0;
        float ma = t * w * (0.6 + spin) + fi * 2.4 + 0.7;
        float incl = 0.05 * (fi - 1.0);
        vec3 M = orb * (cos(ma) * E1 + sin(ma) * E2) + N * incl * orb;
        float mr = 0.085 - fi * 0.017;
        vec2 dm = (p - M.xy) / mr;
        float d2 = dot(dm, dm);
        if (d2 < 1.2) {
            float mz = sqrt(max(1.0 - d2, 0.0));
            float zz = M.z + mz * mr;
            if (zz > zO) {
                vec3 mn = vec3(dm, mz);
                float ml = max(dot(mn, L), 0.0);
                // Planet shadow on the moon.
                float along = dot(M, L);
                float perp = length(M - L * along);
                float psh = (along < 0.0) ? smoothstep(0.92, 1.08, perp) : 1.0;
                vec3 mcol = mix(vec3(0.8, 0.78, 0.75), ink.rgb, 0.25 + 0.1 * fi);
                float crater = 0.85 + 0.15 * noise2(dm * 3.0 + fi * 7.0);
                vec3 c = mcol * crater * (ml * psh * 1.1 + 0.03);
                float ma2 = smoothstep(1.0 + 3.0 * edgeAA / mr, 1.0 - 3.0 * edgeAA / mr, sqrt(d2));
                colO = mix(colO, c, ma2);
                aO = max(aO, ma2);
                zO = mix(zO, zz, step(0.5, ma2));
            }
        }
    }

    // --- Rings: semi-transparent sheet. ---
    vec3 colR = vec3(0.0);
    float aR = 0.0;
    float zR = -1e5;
    if (abs(N.z) > 0.001) {
        float zr = -(p.x * N.x + p.y * N.y) / N.z;
        vec3 P = vec3(p, zr);
        float rr = length(P);
        float dens = ringDensity(rr, fwidth(rr));
        if (dens > 0.0) {
            // Planet shadow across the rings.
            float along = dot(P, L);
            float perp = length(P - L * along);
            float sh = (along < 0.0) ? smoothstep(0.97, 1.03, perp) : 1.0;
            float ldn = abs(dot(L, N));
            float x = (rr - RING_IN) / (RING_OUT - RING_IN);
            vec3 rc = mix(ink.rgb * 0.8 + 0.15, vec3(0.95, 0.92, 0.86), 0.45 + 0.35 * x);
            rc = mix(rc, accent.rgb, 0.15 * smoothstep(0.7, 1.0, x));
            // Waves of light ride outward across the rings; the pulse lights them up.
            float band = 0.0;
            for (int k = 0; k < 2; k++) {
                float fk = fract(t * 1.1 + 0.5 * float(k));
                float bR = RING_IN - 0.1 + fk * (RING_OUT - RING_IN + 0.2);
                band += exp(-pow((rr - bR) / 0.12, 2.0)) * sin(PI * fk);
            }
            band *= aurora * (hitK * 5.5 + swell * 0.9);
            // Each hit launches a bright ripple from the inner edge that rolls out
            // across the rings as the pulse dies away.
            float hr = RING_IN - 0.05 + (1.0 - pls) * (RING_OUT - RING_IN + 0.3);
            band += exp(-pow((rr - hr) / 0.07, 2.0)) * pls * aurora * 4.5;
            // The swell brightens the sunlit sheen of the rings.
            float gl = swell * 0.5 * smoothstep(0.1, 1.0, x);
            float light = ((0.55 + 0.9 * ldn) * sh + 0.05) * (1.0 + 0.35 * hitK + 0.2 * swell);
            colR = rc * light * (0.6 + 0.6 * dens) * (1.0 - 0.35 * min(band, 1.0)) + (accent.rgb * 1.4 + 0.15) * band * dens * (0.35 + 0.65 * sh) + hotC * gl * dens * sh;
            aR = clamp(dens * (1.3 + 0.6 * (1.0 - abs(N.z))), 0.0, 0.97);
            colR *= aR;
            zR = zr;
        }
    }

    // Composite: ring in front of the body, or the body in front of the ring.
    vec3 col;
    float alpha;
    vec3 bodyP = colO * aO;
    if (zR > zO) {
        col = colR + bodyP * (1.0 - aR);
        alpha = aR + aO * (1.0 - aR);
    } else {
        // Behind the body: only shows where the body is not.
        col = bodyP + colR * (1.0 - aO);
        alpha = aO + aR * (1.0 - aO);
    }

    // A faint lit haze just outside the planet's day limb.
    float pr = sqrt(pr2);
    float haze = exp(-(pr - 1.0) * 18.0) * step(1.0, pr) * smoothstep(-0.3, 0.6, dot(normalize(vec3(p, 0.0)), L));
    vec3 hazeC = mix(ink.rgb, vec3(0.7, 0.85, 1.0), 0.5) * haze * 0.35;
    col += hazeC * (1.0 - alpha);
    alpha += haze * 0.35 * (1.0 - alpha);

    col = 1.0 - exp(-col * 1.4);

    vec3 outc;
    float outa;
    if (vxClear) {
        outa = clamp(alpha, 0.0, 1.0);
        outc = min(col, vec3(outa));
    } else {
        vec2 sp = p * R;
        vec3 bg = vec3(0.004, 0.005, 0.012);
        bg += vec3(0.85, 0.9, 1.0) * (stars(sp + 2.0, 60.0) + 0.6 * stars(sp * 1.7 + 5.0, 60.0)) * 0.7;
        outc = col + bg * (1.0 - clamp(alpha, 0.0, 1.0));
        outa = 1.0;
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
