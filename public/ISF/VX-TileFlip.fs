/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A picture mounted on a wall of tiles. The voice draws a turning wireframe globe over slanting bands of light; every hit sends a wave across the wall and the tiles flip over in 3D, in perspective and lit as they turn, showing a corrupted copy of the picture on their backs (shifted, crushed into blocks, inverted or split into ink and accent) before they come round again. A few tiles stick half-turned or come back swapped with a tile from somewhere else until the next hit. Tiles sets the grid, Wave speed how fast the wave crosses, Reach how far it spreads, Stick how many tiles stick or swap, and Back face which corruption they show. Seed re-rolls the picture.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "tiles", "LABEL": "Tiles", "TYPE": "float", "DEFAULT": 7, "MIN": 3, "MAX": 16 },
        { "NAME": "waveSpeed", "LABEL": "Wave speed", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "reach", "LABEL": "Reach", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "stick", "LABEL": "Stick", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "backFace", "LABEL": "Back face", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Changes with each hit", "Shifted", "Crushed", "Inverted", "Split"] },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Back face", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, seconds between
// the last two hits, the clock last frame.

const float PI = 3.1415927;
const float TAU = 6.2831853;

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

// The picture: a turning wireframe globe over slanting bands of light.
// p in frame-height units, origin in the middle; w one pixel.
float picture(vec2 p, float t, float ps, float w) {
    float v = 0.0;
    // A halftone field behind: dots on a turned grid, sized by a soft light
    // that pools round the globe and falls off across the frame.
    vec2 gc = vec2((hash11(ps + 3.0) - 0.5) * 0.5, (hash11(ps + 4.0) - 0.5) * 0.12);
    float R = mix(0.33, 0.4, hash11(ps + 5.0));
    float ang = mix(0.3, 0.6, hash11(ps + 1.0));
    float pitch = 0.021;
    vec2 hq = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * (p + vec2(t * 0.004, 0.0)) / pitch;
    vec2 hc = fract(hq) - 0.5;
    float dl = length(p - gc);
    float ring = exp(-pow((dl - R * 1.2) / 0.13, 2.0));
    float sweep = 0.5 + 0.5 * sin(dot(p, vec2(0.8, -0.6)) * 3.0 + t * 0.15);
    float lvl = clamp(ring * 0.9 + sweep * 0.3 * smoothstep(1.0, 0.3, dl), 0.0, 1.0) * smoothstep(0.02, 0.2, ring + sweep * smoothstep(1.0, 0.3, dl) * 0.5);
    float rad = sqrt(lvl) * 0.36;
    float dot1 = clamp((rad - length(hc)) * pitch / w + 0.5, 0.0, 1.0);
    v = dot1 * mix(0.08, 0.32, lvl);
    // The globe.
    vec2 q = (p - gc) / R;
    float rr = dot(q, q);
    if (rr < 1.0) {
        float z = sqrt(1.0 - rr);
        vec3 nrm = vec3(q, z);
        // Tilt it a little, then turn it.
        float tl = 0.35;
        nrm = vec3(nrm.x, nrm.y * cos(tl) - nrm.z * sin(tl), nrm.y * sin(tl) + nrm.z * cos(tl));
        float spin = t * 0.12;
        float lon = atan(nrm.x, nrm.z) + spin;
        float lat = asin(clamp(nrm.y, -1.0, 1.0));
        float gl = lon / TAU * 24.0;
        float gt = lat / PI * 12.0;
        float fl = max(fwidth(gl), 1e-4);
        float ft = max(fwidth(gt), 1e-4);
        float ll = clamp(1.2 - (0.5 - abs(fract(gl) - 0.5)) / fl, 0.0, 1.0);
        float lt = clamp(1.2 - (0.5 - abs(fract(gt) - 0.5)) / ft, 0.0, 1.0);
        float light = 0.35 + 0.65 * clamp(dot(vec3(q, z), normalize(vec3(-0.5, 0.6, 0.7))), 0.0, 1.0);
        float grid = max(ll * 0.8, lt) * light;
        // The globe hides the bands behind it, and glows faintly inside.
        v = v * 0.1 + grid + light * light * 0.16;
        // A bright limb.
        v = max(v, smoothstep(1.0 - w / R * 2.5, 1.0, sqrt(rr)) * 0.9);
    }
    // An orbit ring round the globe.
    vec2 oq = (p - gc) / R;
    float orb = length(oq * vec2(1.0, 4.0)) - 1.45;
    float onFront = step(0.0, oq.y) + step(1.0, dot(oq, oq));
    v = max(v, clamp(1.0 - abs(orb) * R / 4.0 / w * 0.9, 0.0, 1.0) * 0.7 * min(onFront, 1.0));
    return v;
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, TIME);
        float dtT = TIME - c.a;
        float dt = (dtT > 0.0 && dtT < 0.25) ? dtT : clamp(TIMEDELTA, 0.0, 0.1);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float gap = newHit ? c.g : c.b;
        gl_FragColor = vec4(n, age, gap, TIME);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);
    float ps = rs * 2.414;

    vec2 fwp = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    float w = max(fwp.x, fwp.y) / RENDERSIZE.y;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy / RENDERSIZE - 0.5) * vec2(aspect, 1.0);
    float t = vxPhase;

    // The tile grid, centred.
    float nt = clamp(floor(tiles + 0.5), 3.0, 16.0);
    float ts = 1.0 / nt;
    vec2 cell = floor(p / ts + 0.5);
    vec2 local = p / ts - cell;            // -0.5..0.5
    vec2 tc = cell * ts;

    // This hit's wave: where it starts and which way the tiles turn.
    float hs = rs * 1.37 + n * 7.13;
    float hp = rs * 1.37 + (n - 1.0) * 7.13;
    vec2 org = (vec2(hash11(hs + 1.0), hash11(hs + 2.0)) - 0.5) * vec2(aspect, 1.0) * 0.6;
    float dist = length(tc - org);
    float spd = mix(1.4, 0.35, waveSpeed);       // seconds per frame height
    float dur = mix(0.55, 0.22, waveSpeed);
    float delay = dist * spd * 0.6;
    float reachR = mix(0.25, 1.6, reach);
    float inWave = n > 0.5 ? smoothstep(reachR, reachR * 0.8, dist) : 0.0;
    float axisY = step(0.5, hash11(hs + 3.0));
    float dirS = hash11(hs + 4.0) < 0.5 ? -1.0 : 1.0;

    // Sticking: some tiles stop part way round (or face down) until the next
    // hit; they start the next flip from where they stuck.
    float hst = hash21(cell + hs * 0.37);
    float stuck = (inWave > 0.5 && hst < stick * 0.35) ? 1.0 : 0.0;
    float stuckAng = (hash21(cell + hs * 0.71) < 0.5 ? 0.5 : 0.28 + hash21(cell + hs) * 0.2) * PI * 2.0;
    float hpst = hash21(cell + hp * 0.37);
    float prevDist = length(tc - (vec2(hash11(hp + 1.0), hash11(hp + 2.0)) - 0.5) * vec2(aspect, 1.0) * 0.6);
    float prevIn = n > 1.5 ? smoothstep(reachR, reachR * 0.8, prevDist) : 0.0;
    float prevStuck = (prevIn > 0.5 && hpst < stick * 0.35) ? 1.0 : 0.0;
    float prevEnd = prevStuck > 0.5 ? (hash21(cell + hp * 0.71) < 0.5 ? 0.5 : 0.28 + hash21(cell + hp) * 0.2) * PI * 2.0 : TAU;
    // Where the last hit's flip had got to when this one came: carry on from there.
    float pk = clamp((clk.b - prevDist * spd * 0.6) / dur, 0.0, 1.0);
    float startAng = prevIn > 0.0 ? prevEnd * pk * pk * (3.0 - 2.0 * pk) : 0.0;
    if (startAng > TAU - 0.01) startAng = 0.0;
    float endAng = stuck > 0.5 ? stuckAng : TAU;
    if (endAng < startAng) endAng += TAU;
    float kf = clamp((age - delay) / dur, 0.0, 1.0);
    // Ease with a little overshoot as it lands.
    float e = kf * kf * (3.0 - 2.0 * kf);
    e += sin(kf * PI) * 0.06 * (1.0 - kf);
    float theta = inWave > 0.0 ? mix(startAng, endAng, e) : startAng;
    if (n < 0.5) theta = 0.0;
    // Between hits a few tiles rock gently on their hinges, catching the light.
    float hi = hash21(cell + rs * 0.53);
    theta += step(0.6, hi) * sin(t * (0.5 + hi) + hi * 40.0) * 0.32;
    // A full turn lands face up again.
    theta = mod(theta + TAU, TAU);

    // Swaps: a tile comes round showing another tile's piece of the picture.
    float swapped = (inWave > 0.5 && hash21(cell + hs * 1.91) < stick * 0.3 && kf > 0.5) ? 1.0 : 0.0;
    vec2 srcCell = cell;
    if (swapped > 0.5) srcCell = cell + floor((vec2(hash21(cell + hs), hash21(cell + hs + 5.0)) - 0.5) * 6.0 + 0.5);

    // Ray-trace the tile as a plane turning about its middle, seen in
    // perspective from straight in front.
    float D = 2.6;
    vec2 lc = axisY > 0.5 ? local : local.yx;
    float th = theta * dirS;
    vec3 nrm = vec3(sin(th), 0.0, cos(th));
    vec3 ro = vec3(0.0, 0.0, D);
    vec3 rd = vec3(lc, -D);
    float den = dot(rd, nrm);
    vec3 col = vec3(0.0);
    float hit = 0.0;
    if (abs(den) > 1e-4) {
        float tt = -dot(ro, nrm) / den;
        vec3 P = ro + rd * tt;
        float u = dot(P, vec3(cos(th), 0.0, -sin(th)));
        float vv = P.y;
        float m = 0.485;
        if (tt > 0.0 && abs(u) < m && abs(vv) < m) {
            bool front = dot(nrm, ro - P) > 0.0;
            vec2 uvT = vec2(u, vv);                     // tile units from its middle
            if (!front) uvT.x = -uvT.x;
            if (axisY < 0.5) uvT = uvT.yx;
            vec2 sp = (srcCell + uvT) * ts;
            vec3 face;
            if (front) {
                face = ink.rgb * picture(sp, t, ps, w);
                if (swapped > 0.5) face = mix(face, accent.rgb * dot(face, vec3(0.4)), 0.25);
            } else {
                // The back: a corrupted copy.
                float style = backFace > 0 ? float(backFace - 1) : floor(hash11(hs + 9.0) * 4.0);
                if (style < 0.5) {
                    vec2 sh = (vec2(hash11(hs + 10.0), hash11(hs + 11.0)) - 0.5) * vec2(0.8, 0.4);
                    face = accent.rgb * picture(sp + sh, t, ps, w) * 1.1;
                } else if (style < 1.5) {
                    float bl = ts / 6.0;
                    vec2 bq = (floor(sp / bl) + 0.5) * bl;
                    float pv = picture(bq, t, ps, w * 6.0);
                    face = accent.rgb * step(0.12, pv) * mix(0.35, 0.9, step(0.4, pv));
                } else if (style < 2.5) {
                    float pv = picture(sp, t, ps, w);
                    face = accent.rgb * (1.0 - clamp(pv * 1.5, 0.0, 1.0)) * 0.42;
                } else {
                    float a = picture(sp + vec2(0.012, 0.0), t, ps, w);
                    float b = picture(sp - vec2(0.012, 0.0), t, ps, w);
                    face = max(accent.rgb * a, ink.rgb * b * 0.8);
                }
            }
            // The back is a lit card, not a hole.
            if (!front) face += accent.rgb * 0.07 + face * 0.0;
            // Light: the tile darkens as it turns away and catches a glint near
            // edge-on.
            vec3 L = normalize(vec3(-0.45, 0.35, 1.0));
            vec3 nf = front ? nrm : -nrm;
            float lam = clamp(dot(nf, L), 0.0, 1.0);
            float turning = abs(sin(theta * 0.5));
            float shade = mix(1.0, 0.25 + 0.85 * lam, clamp(turning * 3.0, 0.0, 1.0));
            float spec = pow(clamp(dot(reflect(-L, nf), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0) * turning;
            col = face * shade + mix(ink.rgb, vec3(1.0), 0.4) * spec * 0.35;
            // The tile's edge shows as it turns.
            float ed = (m - max(abs(u), abs(vv))) / (m * 2.0) * ts / w;
            float edgeLine = exp(-ed / 1.1) * clamp(abs(sin(th)) * 1.6, 0.0, 1.0);
            col += mix(ink.rgb, accent.rgb, front ? 0.2 : 0.8) * edgeLine * 0.5;
            hit = 1.0;
        }
    }
    // At rest the joints between the tiles are dark hairlines.
    vec2 jd = (0.5 - abs(local)) * ts / w;
    col *= mix(1.0, smoothstep(0.3, 1.4, min(jd.x, jd.y)), 0.8);

    // The hit: the wave front lights the joints briefly as it passes.
    float front2 = exp(-pow((age / spd / 0.6 - length(p - org)) / 0.05, 2.0)) * step(0.5, n) * smoothstep(reachR, reachR * 0.6, length(p - org));
    float joint = exp(-min(jd.x, jd.y) / 1.2);
    col += mix(ink.rgb, accent.rgb, 0.5) * joint * front2 * 0.8 * exp(-age * 1.5);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
