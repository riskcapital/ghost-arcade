/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A liquid light show: glossy blobs of coloured oil drifting between two glass plates, merging and parting as they slide past each other. Each blob has a dark meniscus rim, rainbow film fringes near its edge and a bright lens of light in its middle, and where blobs meet their dyes mix. Every hit splits the blobs in two and lets them flow back together; the louder the sound, the fatter they swell and the faster they drift.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "split", "LABEL": "Split", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "swell", "LABEL": "Swell", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "blobs", "LABEL": "Blobs", "TYPE": "float", "DEFAULT": 6, "MIN": 3, "MAX": 8 },
        { "NAME": "film", "LABEL": "Film fringes", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Oil", "TYPE": "color", "DEFAULT": [1.0, 0.32, 0.55, 1.0] },
        { "NAME": "accent", "LABEL": "Second dye", "TYPE": "color", "DEFAULT": [1.0, 0.78, 0.18, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen (plus 1000), clock time of the last hit, its strength,
// hits so far.

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

void main() {
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        // The count is stored offset by 1000, so an all-zero texel (a voice
        // added mid-session) reads as fresh and starts with no hit pending.
        if (c.r < 500.0) c = vec4(vxCount + 1000.0, TIME - 30.0, 0.0, 0.0);
        if (abs(vxCount + 1000.0 - c.r) > 0.5) {
            c.g = TIME;
            c.b = mix(0.55, 1.0, clamp(vxVel, 0.0, 1.0));
            c.a = mod(c.a + 1.0, 64.0);
        }
        c.r = vxCount + 1000.0;
        gl_FragColor = c;
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = TIME - clk.g;
    if (age < 0.0) age = 30.0;
    // The split snaps open and the halves flow back together with a little overshoot.
    float sp = clk.b * exp(-age * 2.2) * (1.0 + 0.35 * sin(age * 7.0)) ;
    sp = max(sp, vxHit * 0.6) * split;
    float flash = max(clk.b * exp(-age * 9.0), vxHit);

    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;

    float t = vxPhase * 0.05 * (0.4 + flow * 1.6) + TIME * (0.02 + flow * 0.08);
    float n = floor(clamp(blobs, 3.0, 8.0) + 0.5);
    float grow = (0.75 + 0.5 * size) * (1.0 + swell * (0.35 * vxEnv + 0.12 * vxEnergy));
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
        float ang = TAU * h1 + clk.a * 1.9 + t * 0.2;
        vec2 ax = vec2(cos(ang), sin(ang));
        float s = sp * r * 1.25;
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
    float dd = fract(dye + 0.08 * sin(f * 6.0 - t * 2.0));
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
    col += sat3(oil, 0.7) * flash * 0.5 * th;
    // Soft shoulder so bright dyes keep their hue instead of clipping to white.
    col = 1.0 - exp(-col * 1.25);

    // Outside: a thin bright refraction line on the water side and a soft halo.
    float outd = max(-dpx, 0.0);
    float glint = exp(-pow((outd - 1.5) / 1.3, 2.0)) * (1.0 - cover);
    float halo = exp(-outd * px / 0.05) * (1.0 - cover);

    float pres = vxPresence;
    vec4 outc;
    if (vxClear) {
        vec3 gcol = sat3(oil, 1.2);
        float aG = clamp(glint * 0.85 + halo * 0.28, 0.0, 1.0);
        vec3 rgbOut = gcol * (glint * 0.9 + halo * 0.35);
        float a = cover + aG * (1.0 - cover);
        vec3 rgb = col * cover + rgbOut;
        rgb = min(rgb, vec3(a));
        outc = vec4(rgb, a) * pres;
    } else {
        // Water: dark tinted glass, lit from behind, with the oil's colour bleeding in.
        float vig = 1.0 - smoothstep(0.3, 1.1, length(p * vec2(0.8, 1.0)));
        vec3 water = mix(c1, c0, 0.5 + 0.5 * sin(p.x * 2.0 + t * 0.4)) * (0.05 + 0.07 * vig);
        water += sat3(oil, 1.2) * (halo * 0.35 + glint * 0.8);
        vec3 rgb = mix(water, col, cover);
        outc = vec4(rgb * pres, 1.0);
    }
    gl_FragColor = outc;
}
