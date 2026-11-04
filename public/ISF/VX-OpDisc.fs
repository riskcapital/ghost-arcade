/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "An op-art disc in the style of a sixties gallery print: crisp concentric bands, or a checkerboard of rings and spokes, swelling into a sphere that slides around inside the disc so the flat pattern seems to bulge out of the wall. Every hit sends a coloured shock wave gliding out from the middle through the bands and off the rim as a fading ring, and ripples the outline; the louder the sound, the bigger the sphere swells and the faster the bands flow outward. The note's pitch steers where the bulge sits.",
    "PASSES": [
        {
            "TARGET": "ease",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 2,
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
        { "NAME": "rings", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 16, "MIN": 8, "MAX": 40 },
        { "NAME": "pattern", "LABEL": "Pattern", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Rings", "Checker", "Petal rings"] },
        { "NAME": "rim", "LABEL": "Rim ripple", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "gaps", "LABEL": "See-through gaps", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Bands", "TYPE": "color", "DEFAULT": [0.96, 0.94, 0.88, 1.0] },
        { "NAME": "accent", "LABEL": "Sphere and shock", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.2, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;

// ease (2x1): left texel, the pulse eased again (0.12 s) and the swell (0.2 s),
// so the geometry they move glides; right texel, the clock time of the last
// step (a redraw at the same time does not step).

void main() {
    if (PASSINDEX == 0) {
        vec4 tk = IMG_NORM_PIXEL(ease, vec2(0.75, 0.5));
        float dt = clamp(TIME - tk.x, 0.0, 0.1);
        if (gl_FragCoord.x > 1.0) {
            gl_FragColor = vec4(TIME, dt, 0.0, 0.0);
            return;
        }
        vec4 e = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
        e.x += (vxPulse - e.x) * (1.0 - exp(-dt / 0.16));
        e.y += (vxSwell - e.y) * (1.0 - exp(-dt / 0.2));
        gl_FragColor = clamp(e, 0.0, 1.0);
        return;
    }
    vec4 ez = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
    // Impact lands on the pulse itself; the eased copy carries the slower geometry.
    float pu = max(vxPulse, ez.x);
    float sw = ez.y;
    float amt = shock * pu;

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float t = vxFlow * 0.22;

    float r = length(p);
    float th = atan(p.y, p.x);

    // The disc's outline: a slow wobble plus a ripple the hits push round.
    float kick = shock * pu;
    float Rb = 0.44;
    float R0 = Rb * (1.0 + 0.03 * sw + 0.03 * kick);
    float wob = rim * (0.012 * sin(3.0 * th + t * 1.3) + 0.008 * sin(5.0 * th - t * 0.9));
    wob += (0.3 + rim) * kick * 0.03 * sin(9.0 * th - t * 4.0);
    float R = R0 * (1.0 + wob);
    float dEdge = (R - r) / px;
    float cover = clamp(dEdge + 0.5, 0.0, 1.0);

    // The bulge: a sphere sliding about inside the disc, steered by pitch.
    float ba = TAU * vxGlide + t * 0.7;
    vec2 bc = vec2(cos(ba), sin(ba)) * R0 * (0.22 + 0.12 * sin(t * 0.9));
    float B = Rb * (0.5 + 0.14 * sw + 0.12 * kick);
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

    // Band coordinate: fixed spacing (so fine bands never strobe), flowing outward
    // with the music's clock.
    float n = clamp(rings, 8.0, 40.0);
    float u = rw / Rb * n - t * 2.5;
    // Shock ripples: a train of soft waves always running outward through the
    // bands; hits swell them (and the clock races them outward), then they settle.
    float rph = r / Rb * 2.0 - t * 2.5;
    float sh = amt * pow(0.5 + 0.5 * sin(rph * TAU), 6.0) * smoothstep(0.0, 0.12, r);
    u += amt * 0.2 * sin(rph * TAU);

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
    float wave = clamp(sh * 1.1, 0.0, 1.0);
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

    // The same ripples leave the rim as thin rings that fade as they spread.
    float od = max(r - R, 0.0);
    float rq = fract(rph);
    float rw2 = max(fwidth(rph), 1e-4);
    float thin = clamp((0.09 - abs(rq - 0.5)) / rw2 + 0.5, 0.0, 1.0);
    float ring = clamp(thin * amt * 0.95 * exp(-od / 0.12) * smoothstep(0.0, 0.01, od), 0.0, 1.0);
    vec3 ringCol = mix(accent.rgb, vec3(1.0), 0.25) * 1.2;
    float halo = exp(-max(-dEdge, 0.0) * px / (0.03 + 0.03 * sw)) * (1.0 - cover) * (0.7 + 0.5 * sw + 0.3 * kick);

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
        bg += ink.rgb * 0.025 * smoothstep(0.3, 0.7, sin(r * n / Rb * TAU * 0.5 - t * 2.5 * TAU * 0.5)) * vig;
        bg += ringCol * ring + accent.rgb * halo * 0.3;
        vec3 rgb = mix(bg, col, cover);
        outc = vec4(rgb * pres, 1.0);
    }
    gl_FragColor = outc;
}
