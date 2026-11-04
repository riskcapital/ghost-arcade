/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "An op-art disc in the style of a sixties gallery print: crisp concentric bands, or a checkerboard of rings and spokes, swelling into a sphere that slides around inside the disc so the flat pattern seems to bulge out of the wall. Every hit sends a shock wave racing out through the bands and off the rim as a thin ring; the louder the sound, the tighter the bands breathe. The note's pitch steers where the bulge sits.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "shock", "LABEL": "Shock", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "bulge", "LABEL": "Bulge", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "rings", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 18, "MIN": 8, "MAX": 40 },
        { "NAME": "pattern", "LABEL": "Pattern", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Rings", "Checker", "Petal rings"] },
        { "NAME": "rim", "LABEL": "Rim ripple", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "gaps", "LABEL": "See-through gaps", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Bands", "TYPE": "color", "DEFAULT": [0.96, 0.94, 0.88, 1.0] },
        { "NAME": "accent", "LABEL": "Sphere and shock", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.2, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen (plus 1000), clock time of the last hit, its strength,
// clock time of the hit before it.

const float TAU = 6.2831853;

void main() {
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        // The count is stored offset by 1000, so an all-zero texel (a voice
        // added mid-session) reads as fresh and starts with no hit pending.
        if (c.r < 500.0) c = vec4(vxCount + 1000.0, TIME - 30.0, 0.0, TIME - 31.0);
        if (abs(vxCount + 1000.0 - c.r) > 0.5) {
            c.a = c.g;
            c.g = TIME;
            c.b = mix(0.55, 1.0, clamp(vxVel, 0.0, 1.0));
        }
        c.r = vxCount + 1000.0;
        gl_FragColor = c;
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = TIME - clk.g;
    if (age < 0.0) age = 30.0;
    float age2 = TIME - clk.a;
    if (age2 < 0.0) age2 = 30.0;
    float amt = clk.b * shock;

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float t = vxPhase * 0.03 + TIME * 0.05;

    float r = length(p);
    float th = atan(p.y, p.x);

    // The disc's outline: a slow wobble plus a ripple kicked by each hit.
    float kick = amt * exp(-age * 3.0);
    float R0 = 0.44 * (1.0 + 0.04 * vxEnv + 0.06 * kick);
    float wob = rim * (0.012 * sin(3.0 * th + t * 1.3) + 0.008 * sin(5.0 * th - t * 0.9));
    wob += (0.3 + rim) * kick * 0.045 * sin(14.0 * th - age * 14.0);
    float R = R0 * (1.0 + wob);
    float dEdge = (R - r) / px;
    float cover = clamp(dEdge + 0.5, 0.0, 1.0);

    // The bulge: a sphere sliding about inside the disc, steered by pitch.
    float ba = TAU * vxGlide + t * 0.7;
    vec2 bc = vec2(cos(ba), sin(ba)) * R0 * (0.22 + 0.12 * sin(t * 0.9));
    float B = R0 * (0.55 + 0.1 * vxEnv);
    vec2 q = p - bc;
    float lq = length(q);
    float k = clamp(lq / B, 0.0, 1.0);
    float inS = step(lq, B);
    // Seen from the front, the pattern wraps over a ball: arc length along the
    // surface, so the bands crowd together towards the sphere's edge.
    float arc = B * asin(k) / 1.5707963;
    float lens = bulge * inS;
    float sl = mix(lq, arc * 0.75 + lq * 0.25 * k, lens);
    vec2 pw = bc + (lq > 1e-5 ? q / lq : vec2(0.0)) * sl;
    // The sphere's surface normal, for shading.
    vec3 sn = vec3(q / B, sqrt(max(1.0 - k * k, 0.0)));
    float rw = length(pw);
    float tw = atan(pw.y, pw.x);

    // Band coordinate: bands breathe tighter with the sound and drift outwards.
    float n = clamp(rings, 8.0, 40.0) * (1.0 + 0.18 * vxEnv);
    float u = rw / R0 * n - t * 2.0;
    // Shock waves: a crest racing outward that shoves the bands as it passes.
    float sr = age * 1.1;
    float sh = amt * exp(-age * 1.6) * exp(-pow((r - sr) / 0.07, 2.0));
    float sr2 = age2 * 1.1;
    float sh2 = clk.b * shock * 0.6 * exp(-age2 * 1.6) * exp(-pow((r - sr2) / 0.07, 2.0));
    u += (sh + sh2) * 1.6;
    u += vxHit * shock * 0.6 * exp(-r * 4.0);

    float v = 0.0;
    if (pattern == 1) {
        float sp = floor(clamp(rings, 8.0, 40.0) * 0.4 + 0.5) * 2.0;
        v = tw / TAU * sp + t * 0.6 + rw * 2.0 * sin(t * 0.4);
    } else if (pattern == 2) {
        // Bands scalloped into petals.
        u += 0.35 * sin(tw * 8.0 + t) * smoothstep(0.0, R0 * 0.5, rw);
    }

    float wu = max(fwidth(u), 1e-4);
    float bandU = clamp((0.25 - abs(fract(u) - 0.5)) / wu + 0.5, 0.0, 1.0);
    float band = bandU;
    if (pattern == 1) {
        float wv = max(fwidth(v), 1e-4);
        float bandV = clamp((0.25 - abs(fract(v) - 0.5)) / wv + 0.5, 0.0, 1.0);
        band = bandU + bandV - 2.0 * bandU * bandV;
    }

    // Light bands shade from ink to accent across the sphere, lit from the upper left.
    float shade = lens * (0.35 + 0.65 * (1.0 - k * k));
    vec3 light = mix(ink.rgb, accent.rgb, shade * 0.3);
    vec3 Ld = normalize(vec3(-0.5, 0.55, 0.75));
    float ndl = mix(1.0, 0.35 + 0.75 * max(dot(sn, Ld), 0.0), lens);
    light *= ndl;
    float spec = pow(max(dot(reflect(-Ld, sn), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
    light += vec3(0.9) * spec * lens;
    // The shock wave paints the bands it passes in the accent colour.
    float wave = clamp((sh + sh2) * 1.6, 0.0, 1.0);
    light = mix(light, accent.rgb * 1.15 + 0.15, wave);
    vec3 dark = mix(ink.rgb, accent.rgb, 0.5) * 0.05 + accent.rgb * shade * 0.12;
    dark = mix(dark, accent.rgb * 0.3, wave * 0.6);
    // Around the sphere a soft shadow makes it sit up off the disc.
    float shadow = smoothstep(B * 1.3, B, lq) * (1.0 - inS) * bulge;
    light *= 1.0 - 0.55 * shadow;
    vec3 col = mix(dark, light, band);
    // A crisp rim line.
    float rimLine = exp(-pow((dEdge - 3.0) / 1.6, 2.0));
    col = mix(col, accent.rgb * 1.1, rimLine * 0.9);

    // Shock rings that fly off the rim.
    float out1 = exp(-pow((r - sr) / (0.006 + 0.025 * age), 2.0)) * amt * exp(-age * 1.8) * smoothstep(R0 * 0.9, R0 * 1.1, sr) * 1.4;
    float out2 = exp(-pow((r - sr2) / (0.006 + 0.025 * age2), 2.0)) * clk.b * shock * exp(-age2 * 1.8) * smoothstep(R0 * 0.9, R0 * 1.1, sr2) * 0.8;
    float ring = clamp((out1 + out2) * 1.5 * (1.0 - cover), 0.0, 1.0);
    vec3 ringCol = mix(accent.rgb, vec3(1.0), 0.25) * 1.2;
    float halo = exp(-max(-dEdge, 0.0) * px / 0.03) * (1.0 - cover);

    float pres = vxPresence;
    vec4 outc;
    if (vxClear) {
        float aIn = mix(1.0, band, gaps);
        vec3 rgbIn = col * aIn;
        float aOut = clamp(ring + halo * 0.35, 0.0, 1.0);
        vec3 rgbOut = ringCol * ring + accent.rgb * halo * 0.3;
        float a = cover * aIn + aOut * (1.0 - cover);
        vec3 rgb = min(rgbIn * cover + rgbOut, vec3(a));
        outc = vec4(rgb, a) * pres;
    } else {
        float vig = 1.0 - smoothstep(0.4, 1.2, r);
        vec3 bg = mix(ink.rgb, accent.rgb, 0.3) * 0.035 * vig;
        // Faint echo bands on the wall around the disc.
        bg += ink.rgb * 0.025 * smoothstep(0.3, 0.7, sin(r * n / R0 * TAU * 0.5 - t * 6.0)) * vig;
        bg += ringCol * ring + accent.rgb * halo * 0.3;
        vec3 rgb = mix(bg, col, cover);
        outc = vec4(rgb * pres, 1.0);
    }
    gl_FragColor = outc;
}
