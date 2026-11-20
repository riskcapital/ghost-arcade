/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A clear, thick liquid poured over a softly lit backdrop of light fields and fine dots. Two pourers wander across the frame and lay the liquid down along their paths; it flows, swirls and slowly thins away. Seen through it the backdrop bends, with a thin spectral fringe and sharp glints on the liquid's surface, and the picture under it is dragged along with the flow and eases back. Each hit drops a splash that pushes the liquid outward; the sound's level pours more of it. With no sound the last of the liquid settles and a thin trickle keeps moving.",
    "PASSES": [
        { "TARGET": "fluid", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        { "TARGET": "drag", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/4", "HEIGHT": "$HEIGHT/4" },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "pour", "LABEL": "Pour", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "thickness", "LABEL": "Thickness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "refraction", "LABEL": "Refraction", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "fringe", "LABEL": "Spectral fringe", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "pattern", "LABEL": "Backdrop dots", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Splash light", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The liquid is a small simulation kept in two buffers.
//   fluid: its velocity (xy, in frame widths per second) and how much liquid lies here (z).
//   drag:  how far the picture under the liquid has been pulled from its place (xy).
// The last pass draws the backdrop as seen through the liquid.

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

// Where pourer k is at time t: a slow wandering loop that covers the frame.
vec2 pourer(float k, float t) {
    float a = t * (0.9 + 0.23 * k) + k * 2.4;
    float b = t * (1.31 - 0.17 * k) + k * 4.1;
    return vec2(0.5 + 0.36 * sin(a) + 0.07 * sin(b * 2.3), 0.5 + 0.3 * sin(b) + 0.08 * cos(a * 1.9));
}

// How close a point is to the stroke from a to b, as a soft falloff (1 on the stroke). Distances are in frame heights.
float stroke(vec2 uv, vec2 a, vec2 b, float radius, float asp) {
    vec2 p = vec2(uv.x * asp, uv.y);
    vec2 pa = p - vec2(a.x * asp, a.y);
    vec2 ba = vec2((b.x - a.x) * asp, b.y - a.y);
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    float d = length(pa - ba * h);
    return exp(-d * d / (radius * radius));
}

// The backdrop the liquid lies on: soft fields of light on a dark wall, with a fine grid of dots.
vec3 backdrop(vec2 uv, float asp) {
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float t = vxFlow * 0.05 + TIME * 0.01;
    vec3 col = vec3(0.006, 0.007, 0.009);
    // Two large soft lights drift slowly; a third, in the accent, glows with each hit.
    vec2 c1 = vec2(-0.45 + 0.12 * sin(t * 1.3), 0.12 + 0.1 * cos(t));
    vec2 c2 = vec2(0.5 + 0.1 * cos(t * 0.9), -0.15 + 0.12 * sin(t * 1.1));
    float sw = clamp(vxSwell, 0.0, 1.0);
    col += ink.rgb * (0.3 + 0.3 * sw) * exp(-dot(p - c1, p - c1) / 0.12);
    col += ink.rgb * (0.16 + 0.25 * sw) * exp(-dot(p - c2, p - c2) / 0.16);
    float n = floor(vxCount + 0.5);
    vec2 c3 = (vec2(hash11(n * 3.17 + 1.0), hash11(n * 5.71 + 2.0)) - 0.5) * vec2(asp * 0.7, 0.6);
    col += accent.rgb * clamp(vxPulse, 0.0, 1.0) * 0.55 * exp(-dot(p - c3, p - c3) / 0.05) * step(0.5, n);
    // Dots: small, evenly spaced, brighter where the light falls. Refraction pulls them into streaks.
    vec2 g = p * 46.0;
    vec2 f = fract(g) - 0.5;
    float px = 46.0 / RENDERSIZE.y;
    float dot1 = smoothstep(0.16 + px, 0.16 - px, length(f));
    float lit = max(max(col.r, col.g), col.b);
    col += ink.rgb * dot1 * pattern * (0.09 + 0.7 * lit);
    return col;
}

// Weights that split six samples into red, green and blue, for the fringe.
vec3 spectralWeight(float t) {
    return max(1.0 - abs(t * 2.0 - vec3(0.0, 1.0, 2.0)), 0.0);
}

// The liquid's surface height at a point, from how much lies there and how fast it moves.
float surfaceHeight(vec2 uv) {
    vec4 s = IMG_NORM_PIXEL(fluid, uv);
    return s.z * 0.6 + length(s.xy) * 0.35 * smoothstep(0.0, 0.3, s.z);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    float dt = clamp(TIMEDELTA, 0.004, 0.05);
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);

    if (PASSINDEX == 0) {
        // ── The liquid moves ──
        vec2 tx = vec2(1.0 / RENDERSIZE.x, 0.0);
        vec2 ty = vec2(0.0, 1.0 / RENDERSIZE.y);
        vec4 here = IMG_NORM_PIXEL(fluid, uv);
        // Carried along by its own velocity (velocity is in frame widths per second; y is scaled to match).
        // A slow turning current underneath keeps pooled liquid curling.
        float ct = vxFlow * 0.11 + TIME * 0.015;
        vec2 current = 0.035 * vec2(sin(uv.y * 7.0 + ct) + 0.6 * sin(uv.y * 13.0 - ct * 1.7), -sin(uv.x * 6.0 - ct * 1.2) - 0.6 * sin(uv.x * 11.0 + ct * 0.8));
        vec2 back = uv - dt * vec2(here.x + current.x, (here.y + current.y) * asp);
        vec4 s = IMG_NORM_PIXEL(fluid, back);
        vec4 L = IMG_NORM_PIXEL(fluid, uv - tx);
        vec4 R = IMG_NORM_PIXEL(fluid, uv + tx);
        vec4 B = IMG_NORM_PIXEL(fluid, uv - ty);
        vec4 T = IMG_NORM_PIXEL(fluid, uv + ty);
        vec4 around = (L + R + B + T) * 0.25;
        // Thick: its motion spreads to the liquid beside it and dies away; the liquid itself thins slowly.
        vec2 vel = mix(s.xy, around.xy, 0.25 + 0.35 * thickness) / (1.0 + (0.8 + 1.6 * (1.0 - thickness)) * dt);
        float dye = mix(s.z, around.z, 0.06) / (1.0 + mix(0.55, 0.1, thickness) * dt);
        // It runs downhill off its own heaps, so a pour spreads into a rounded pool.
        vel -= vec2(R.z - L.z, T.z - B.z) * 0.035;

        // The pourers lay liquid along the stretch they have just travelled, and push it the way they go.
        float t = vxFlow * 0.33 + TIME * 0.03;
        float amount = (0.25 + 0.75 * pour) * (0.35 + 0.9 * sw);
        for (int k = 0; k < 2; k++) {
            float fk = float(k);
            vec2 a = pourer(fk, t - 0.07);
            vec2 b = pourer(fk, t);
            float fall = stroke(uv, a, b, 0.055 + 0.035 * sw, asp);
            vel += (b - a) / 0.07 * fall * (0.2 + 0.4 * sw) * dt * 5.0;
            dye += fall * amount * dt * 4.0;
        }
        // A hit splashes: liquid lands at a new spot and is thrown outward from it.
        float n = floor(vxCount + 0.5);
        float gate = smoothstep(0.7, 1.0, pu) * step(0.5, n);
        vec2 c = vec2(0.5) + (vec2(hash11(n * 3.17 + 1.0), hash11(n * 5.71 + 2.0)) - 0.5) * vec2(0.7, 0.6);
        vec2 d = vec2((uv.x - c.x) * asp, uv.y - c.y);
        float splash = exp(-dot(d, d) / 0.004) * gate;
        vel += normalize(d + vec2(1e-5)) * splash * 0.5;
        dye += splash * 0.1;

        // Still at the frame's edge, and never more than the buffer can hold.
        float edge = smoothstep(0.0, 0.02, uv.x) * smoothstep(1.0, 0.98, uv.x) * smoothstep(0.0, 0.03, uv.y) * smoothstep(1.0, 0.97, uv.y);
        vel = clamp(vel * edge, vec2(-1.5), vec2(1.5));
        dye = clamp(dye, 0.0, 1.0);
        if (FRAMEINDEX < 2) {
            vel = vec2(0.0);
            dye = 0.0;
        }
        gl_FragColor = vec4(vel, dye, 1.0);
        return;
    }

    if (PASSINDEX == 1) {
        // ── The picture under the liquid is dragged with it, and eases back ──
        vec4 s = IMG_NORM_PIXEL(fluid, uv);
        float wet = smoothstep(0.0, 0.2, s.z);
        vec2 st = dt * wet * vec2(s.x, s.y * asp) * 0.9;
        vec2 d = IMG_NORM_PIXEL(drag, uv - st).xy - st;
        float back = 1.0 / (1.0 + 1.1 * dt);
        d *= mix(back * back * back, back, wet);
        d = clamp(d, vec2(-0.2), vec2(0.2));
        if (FRAMEINDEX < 2) d = vec2(0.0);
        gl_FragColor = vec4(d, 0.0, 1.0);
        return;
    }

    // ── What you see: the backdrop through the liquid ──
    // One step of the simulation's grid, in this pass's coordinates.
    vec2 simTexel = 4.0 / RENDERSIZE.xy;
    vec2 tx = vec2(simTexel.x, 0.0);
    vec2 ty = vec2(0.0, simTexel.y);
    vec2 grad = vec2(surfaceHeight(uv + tx) - surfaceHeight(uv - tx), surfaceHeight(uv + ty) - surfaceHeight(uv - ty)) * 0.5;
    vec3 nrm = normalize(vec3(-grad * 9.0, 1.0));
    vec4 s = IMG_NORM_PIXEL(fluid, uv);
    vec2 disp = IMG_NORM_PIXEL(drag, uv).xy;
    float mask = smoothstep(0.05, 0.4, s.z);

    vec2 baseUv = uv + disp - nrm.xy * (0.03 + 0.13 * refraction);
    vec2 spread = (nrm.xy * 0.035 + disp * 0.04) * fringe * 1.4;
    vec3 col = vec3(0.0);
    vec3 wsum = vec3(0.0);
    for (int i = 0; i < 6; i++) {
        float t = float(i) / 5.0;
        vec3 w = spectralWeight(t);
        col += backdrop(baseUv + spread * (t - 0.5), asp) * w;
        wsum += w;
    }
    col /= wsum;

    // Lit from the upper left: the liquid's slopes shade a little, and its surface throws sharp glints.
    vec3 lightDir = normalize(vec3(-0.57, 0.82, 1.2));
    vec3 halfDir = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    col *= max(1.0 + dot(nrm.xy, normalize(lightDir.xy)) * 0.25 * mask, 0.0);
    float spec = pow(max(dot(nrm, halfDir), 0.0), 120.0) * mask;
    float soft = pow(max(dot(nrm, halfDir), 0.0), 14.0) * mask;
    col += vec3(1.0) * spec * 1.6 + ink.rgb * soft * 0.14;
    // The liquid's edge stands up from the backdrop: dark on its outer lip, a thin bright line just inside.
    float lip = s.z;
    col *= 1.0 - 0.45 * smoothstep(0.02, 0.1, lip) * smoothstep(0.26, 0.1, lip);
    col += ink.rgb * 0.16 * smoothstep(0.1, 0.17, lip) * smoothstep(0.3, 0.17, lip);
    // A body this thick tints what is under it a little.
    col = mix(col, col * (0.82 + 0.3 * ink.rgb), mask * 0.5);

    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.7));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the liquid is solid, and only as much as it catches the light.
        outa = clamp(mask * (0.25 + max(max(col.r, col.g), col.b) * 1.6), 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
