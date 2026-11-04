/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A liquid light show: glossy blobs of coloured oil drifting between two glass plates, merging and parting as they slide past each other. Each blob has a dark meniscus rim, rainbow film fringes near its edge and a bright lens of light in its middle, and where blobs meet their dyes mix. The music stirs the tank: the louder it gets, the fatter the blobs swell and the faster they drift and turn, and each hit stretches every blob into two lobes that flow back together while the oil leaves soft smeared trails as it moves.",
    "PASSES": [
        {
            "TARGET": "ease",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 2,
            "HEIGHT": 1
        },
        {
            "TARGET": "trail",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "split", "LABEL": "Split", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "swell", "LABEL": "Swell", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "blobs", "LABEL": "Blobs", "TYPE": "float", "DEFAULT": 6, "MIN": 3, "MAX": 8 },
        { "NAME": "film", "LABEL": "Film fringes", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "trails", "LABEL": "Trails", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Oil", "TYPE": "color", "DEFAULT": [1.0, 0.32, 0.55, 1.0] },
        { "NAME": "accent", "LABEL": "Second dye", "TYPE": "color", "DEFAULT": [1.0, 0.78, 0.18, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// ease (2x1): left texel, the pulse and swell eased once more (about 0.1 s and 0.2 s, and
// the pulse again over 0.28 s for the lobes), so
// shapes that move with them glide rather than jump; right texel, the clock
// time of the last step and the step itself (a redraw at the same time steps 0).
// trail (full size): the oil as drawn last frame (premultiplied colour and
// coverage), smeared a little by the current and fading. Pass 0 lays the new
// oil over it; the last pass puts the result over the water.

const float TAU = 6.2831853;
const int MAXB = 8;
// Field level that marks the oil's edge.
const float EDGE = 0.2;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

vec3 sat3(vec3 c, float s) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(l), c, s), 0.0);
}

// One ball of the field: adds its value, slope and dye weight.
void ball(vec2 p, vec2 c, float r, float dye, inout float f, inout vec2 g, inout float dw) {
    float R = r / 0.644;
    vec2 d = p - c;
    float q = dot(d, d) / (R * R);
    if (q < 1.0) {
        float k = 1.0 - q;
        float v = k * k * k;
        f += v;
        g += -6.0 * k * k * d / (R * R);
        dw += v * dye;
    }
}

// The oil at a point, premultiplied, with its glints and halo.
vec4 oilAt(vec2 p, float px, float aspect, float push, float sw, float slow) {
    // Motion runs on the music's clock: it drifts faster as the sound rises.
    float t = vxFlow * (0.15 + flow * 0.6);
    // Hits stretch each blob into two lobes that relax back together.
    float sp = split * (0.45 * vxPulse + 0.45 * slow + 0.15 * sw);
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;

    float n = floor(clamp(blobs, 3.0, 8.0) + 0.5);
    float grow = (0.75 + 0.5 * size) * (1.0 + swell * (0.5 * sw + 0.25 * vxPulse));
    float spreadX = min(0.36 * aspect, 0.56);

    float f = 0.0;
    vec2 g = vec2(0.0);
    float dw = 0.0;
    for (int i = 0; i < MAXB; i++) {
        float fi = float(i);
        if (fi >= n) break;
        float h1 = hash11(fi * 3.17 + 1.3);
        float h2 = hash11(fi * 7.91 + 2.1);
        float h3 = hash11(fi * 1.73 + 5.7);
        vec2 c = vec2(sin(t * (0.53 + 0.4 * h1) + TAU * h2) * spreadX,
                      sin(t * (0.41 + 0.35 * h2) + TAU * h3) * 0.2);
        // Slow drift of the whole raft so it never sits still.
        c += 0.05 * vec2(sin(t * 0.31 + fi), cos(t * 0.27 + fi * 1.7));
        float r = (0.11 + 0.08 * h3) * grow;
        // Each blob is a pair that the hits pull apart along a turning axis.
        // The axis turns a little with every hit, gliding (and wrapping cleanly at 64).
        float ang = TAU * h1 + vxMorph * (TAU * 5.0 / 64.0) + t * 0.2;
        vec2 ax = vec2(cos(ang), sin(ang));
        float s = sp * r * 0.85;
        float rr = r * mix(1.0, 0.8, clamp(sp * 1.5, 0.0, 1.0));
        float dye = fract(h2 + fi * 0.37);
        ball(p, c + ax * s, rr, dye, f, g, dw);
        ball(p, c - ax * s, rr, fract(dye + 0.18), f, g, dw);
    }

    float gl = max(length(g), 1e-4);
    // Signed distance to the oil's edge in pixels, inside positive.
    float dpx = (f - EDGE) / gl / px;
    float cover = clamp(dpx + 0.5, 0.0, 1.0);
    float dye = dw / max(f, 1e-4);

    // Thickness of the oil: zero at the edge, a dome in the middle.
    float th = clamp((f - EDGE) * 1.6, 0.0, 1.0);
    vec2 nrm2 = -g / gl * (1.0 - th);
    vec3 nrm = normalize(vec3(nrm2 * 1.4, 0.6 + th));

    // Dye: the two colours and a mix of them, swirled by the field.
    vec3 c0 = ink.rgb;
    vec3 c1 = accent.rgb;
    // A third, deeper dye: the two filtered through each other.
    vec3 c2 = sat3(ink.rgb * accent.rgb + 0.04, 1.5);
    c2 *= 0.85 / max(max(c2.r, c2.g), max(c2.b, 0.08));
    float dd = fract(dye + 0.06 * sin(dot(p, vec2(5.0, 3.0)) - t * 1.5));
    vec3 oil = dd < 0.333 ? mix(c0, c2, smoothstep(0.2, 0.333, dd))
             : dd < 0.666 ? mix(c2, c1, smoothstep(0.533, 0.666, dd))
             : mix(c1, c0, smoothstep(0.866, 1.0, dd));
    oil = sat3(oil, 1.25);

    // Marbling: slow ribbons of the two dyes folded through the oil.
    vec2 mq = p * 7.0;
    mq += 0.9 * vec2(sin(mq.y * 0.9 + t * 0.7), cos(mq.x * 0.8 - t * 0.6));
    mq += 0.6 * vec2(sin(mq.y * 1.7 - t * 0.5 + 2.0), cos(mq.x * 1.5 + t * 0.4));
    float rib = 0.5 + 0.5 * sin(mq.x + mq.y * 0.6 + dye * TAU);
    vec3 other = dd < 0.5 ? c1 : c0;
    oil = mix(oil, sat3(mix(oil, other, 0.75), 1.3), smoothstep(0.55, 0.95, rib) * smoothstep(0.05, 0.4, th) * 0.8);
    // Body: deep at the rim, glowing towards the middle like a lens.
    vec3 col = oil * (0.3 + 0.75 * smoothstep(0.0, 0.85, th));
    // Light passing through the lens collects in a soft hot core.
    col += sat3(oil, 0.8) * 0.3 * smoothstep(0.6, 1.0, th);
    // Rainbow film near the rim.
    float fr = smoothstep(0.0, 0.08, th) * (1.0 - smoothstep(0.12, 0.45, th));
    vec3 fringe = 0.5 + 0.5 * cos(TAU * (th * 7.0 - t * 0.3 + vec3(0.0, 0.33, 0.67)));
    fringe = mix(c1, c0, fringe.x) * 0.6 + fringe * 0.5;
    col = mix(col, fringe * 1.1, fr * film * 0.85);
    // Meniscus: a dark line just inside the edge.
    float men = exp(-pow((dpx - 4.0) / 2.2, 2.0));
    col *= 1.0 - 0.75 * men;
    // Specular glints on the dome.
    vec3 L = normalize(vec3(-0.45, 0.6, 0.9));
    float spec = pow(max(dot(reflect(-L, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
    col += vec3(1.0) * spec * 0.9 * smoothstep(0.02, 0.15, th);
    // A hit pours fresh light into the oil.
    col += sat3(oil, 0.7) * vxPulse * 0.6 * th;
    // Soft shoulder so bright dyes keep their hue instead of clipping to white.
    col = 1.0 - exp(-col * 1.25);

    // Outside: a thin bright refraction line on the water side and a soft halo.
    float outd = max(-dpx, 0.0);
    float glint = exp(-pow((outd - 1.5) / 1.3, 2.0)) * (1.0 - cover);
    float halo = exp(-outd * px / (0.05 + 0.05 * push)) * (1.0 - cover) * (0.8 + 0.6 * push);

    vec3 gcol = sat3(oil, 1.2);
    float aG = clamp(glint * 0.85 + halo * 0.28, 0.0, 1.0);
    vec3 rgbOut = gcol * (glint * 0.9 + halo * 0.35);
    float a = cover + aG * (1.0 - cover);
    vec3 rgb = min(col * cover + rgbOut, vec3(a));
    return vec4(rgb, a);
}

void main() {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;

    if (PASSINDEX == 0) {
        vec4 tk = IMG_NORM_PIXEL(ease, vec2(0.75, 0.5));
        float dt = clamp(TIME - tk.x, 0.0, 0.1);
        if (gl_FragCoord.x > 1.0) {
            gl_FragColor = vec4(TIME, dt, 0.0, 0.0);
            return;
        }
        vec4 e = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
        e.x += (vxPulse - e.x) * (1.0 - exp(-dt / 0.1));
        e.y += (vxSwell - e.y) * (1.0 - exp(-dt / 0.2));
        // A slower push for the lobes, so busy parts hold them apart instead of jiggling.
        e.z += (vxPulse - e.z) * (1.0 - exp(-dt / 0.28));
        gl_FragColor = clamp(e, 0.0, 1.0);
        return;
    }
    vec4 ez = IMG_NORM_PIXEL(ease, vec2(0.25, 0.5));
    float stepT = IMG_NORM_PIXEL(ease, vec2(0.75, 0.5)).y;

    if (PASSINDEX == 1) {
        vec4 now = oilAt(p, px, aspect, ez.x, ez.y, ez.z);
        // Last frame, carried by a slow swirl that the music pushes harder.
        float tt = vxFlow * 0.3;
        float push = 0.25 * ez.y + 0.75 * ez.x;
        // Scaled by the time step, so the smear is the same at any frame rate.
        float fr = stepT * 30.0;
        float ang = (0.0015 + 0.006 * push) * sin(tt * 0.7) * fr;
        float zoom = 1.0 + (0.0015 + 0.006 * push) * fr;
        vec2 q = p / zoom;
        q = vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y);
        q += (0.0008 + 0.002 * push) * fr * vec2(sin(p.y * 6.0 + tt), cos(p.x * 5.0 - tt * 0.8));
        vec2 quv = vec2(q.x / aspect, q.y) + 0.5;
        vec4 prev = IMG_NORM_PIXEL(trail, quv);
        float inside = step(0.0, quv.x) * step(quv.x, 1.0) * step(0.0, quv.y) * step(quv.y, 1.0);
        // Fade time in seconds, so the trail does not depend on frame rate.
        float tau = 0.02 + trails * (0.1 + 0.1 * ez.y);
        float keep = exp(-stepT / tau) * inside * step(0.5, float(FRAMEINDEX));
        prev = clamp(prev, 0.0, 1.0) * keep;
        gl_FragColor = now + prev * (1.0 - now.a);
        return;
    }

    vec4 o = IMG_NORM_PIXEL(trail, uv);
    o.a = clamp(o.a, 0.0, 1.0);
    o.rgb = min(max(o.rgb, 0.0), vec3(o.a));
    float pres = vxPresence;
    vec4 outc;
    if (vxClear) {
        outc = o * pres;
    } else {
        // Water: dark tinted glass, lit from behind.
        float t = vxFlow * (0.15 + flow * 0.6);
        float vig = 1.0 - smoothstep(0.3, 1.1, length(p * vec2(0.8, 1.0)));
        vec3 water = mix(accent.rgb, ink.rgb, 0.5 + 0.5 * sin(p.x * 2.0 + t * 0.4)) * (0.05 + 0.07 * vig);
        outc = vec4((water * (1.0 - o.a) + o.rgb) * pres, 1.0);
    }
    gl_FragColor = outc;
}
