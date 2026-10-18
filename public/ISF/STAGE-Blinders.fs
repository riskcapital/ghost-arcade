/*{
    "DESCRIPTION": "A wall of blinders. A grid of lamps with real filament behaviour: they take a moment to come up, glow on after the power is cut, and run orange when dim and white when driven hard. Run chases across the wall (sweep, rows, centre burst, sparkle, checker, a level meter or a full hit), set how fast the filaments respond, and pick tungsten or LED. Behind a band it is the back wall of an arena show; pointed at them it is a row of audience blinders. Bass drives the level meter and lifts the wall, beats fire the hits, spectral centroid shifts the colour.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Tungsten", "Daylight LED", "Red Alert", "Electric Blue", "Sodium and Mercury", "Magenta Heat", "Jade"]},
        {"NAME": "colorPattern", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["One colour", "Alternate rows", "Checker", "Edge to centre", "Rainbow"]},
        {"NAME": "columns",   "TYPE": "float", "DEFAULT": 12.0, "MIN": 1.0, "MAX": 40.0},
        {"NAME": "rows",      "TYPE": "float", "DEFAULT": 5.0,  "MIN": 1.0, "MAX": 24.0},
        {"NAME": "lampSize",  "TYPE": "float", "DEFAULT": 0.72, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "lampShape", "TYPE": "long",  "DEFAULT": 0,
         "VALUES": [0, 1, 2], "LABELS": ["Round", "Square", "Bar"]},
        {"NAME": "glow",      "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "chase",     "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2, 3, 4, 5, 6, 7],
         "LABELS": ["All on", "Sweep", "Rows", "Centre burst", "Sparkle", "Checker flip", "Level meter", "Hit on beat"]},
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 6.00},
        {"NAME": "filament",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "depth",     "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "density",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.02, "MAX": 1.00},
        {"NAME": "warmDim",   "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "level",     "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "margin",    "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.00, "MAX": 0.40},
        {"NAME": "housing",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * What makes a lamp look like a lamp is its lag. A filament is a hot wire
 * with mass: power arrives as a step, light follows as a curve, and when the
 * power goes the wire keeps glowing while it cools. Every chase here is
 * written as "how long ago did this lamp last get power", and that age is
 * turned into brightness by one decay curve, so a sweep leaves a tail and a
 * sparkle leaves embers without any stored state.
 *
 * Colour follows temperature. A dim filament is cool and orange; at full it
 * is near white. `warmDim` is how far the colour slides as the lamp fades.
 */

const float TAU = 6.28318530718;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

/* Lamp colours. Columns: [full, second colour, dimmed]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Daylight LED */
        a = vec3(0.90, 0.95, 1.00);
        b = vec3(0.60, 0.80, 1.00);
        c = vec3(0.70, 0.82, 1.00);
    } else if (mode == 2) {     /* Red Alert */
        a = vec3(1.00, 0.10, 0.06);
        b = vec3(1.00, 0.50, 0.30);
        c = vec3(0.70, 0.02, 0.02);
    } else if (mode == 3) {     /* Electric Blue */
        a = vec3(0.20, 0.46, 1.00);
        b = vec3(0.70, 0.90, 1.00);
        c = vec3(0.06, 0.14, 0.86);
    } else if (mode == 4) {     /* Sodium and Mercury */
        a = vec3(1.00, 0.62, 0.14);
        b = vec3(0.60, 1.00, 0.90);
        c = vec3(1.00, 0.36, 0.06);
    } else if (mode == 5) {     /* Magenta Heat */
        a = vec3(1.00, 0.16, 0.70);
        b = vec3(1.00, 0.60, 0.30);
        c = vec3(0.70, 0.04, 0.50);
    } else if (mode == 6) {     /* Jade */
        a = vec3(0.30, 1.00, 0.62);
        b = vec3(0.86, 1.00, 0.70);
        c = vec3(0.04, 0.60, 0.40);
    } else {                    /* Tungsten */
        a = vec3(1.00, 0.90, 0.72);
        b = vec3(1.00, 0.97, 0.90);
        c = vec3(1.00, 0.40, 0.10);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = gl_FragCoord.xy / res;                     /* 0 .. 1 */
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float levelIn = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    float nx = floor(columns);
    float ny = floor(rows);

    /* The wall sits inside a margin. */
    vec2 wall = (uv - 0.5) / (1.0 - margin * 2.0) + 0.5;
    float inWall = step(0.0, wall.x) * step(wall.x, 1.0) * step(0.0, wall.y) * step(wall.y, 1.0);
    vec2 g = wall * vec2(nx, ny);
    vec2 id = clamp(floor(g), vec2(0.0), vec2(nx - 1.0, ny - 1.0));
    vec2 f = fract(g) - 0.5;
    /* Keep lamps round whatever the grid's proportions. */
    float cellAspect = (aspect * ny) / nx;
    vec2 q = f * vec2(max(cellAspect, 1.0), max(1.0 / cellAspect, 1.0));

    /* Position of this lamp for the chases. */
    float u = nx > 1.0 ? id.x / (nx - 1.0) : 0.5;
    float v = ny > 1.0 ? id.y / (ny - 1.0) : 0.5;

    /* `age` = how long since this lamp last had power, in chase periods.
       0 is "being driven right now". */
    float ct = TIME * speed + beat * 0.15;
    int mode = int(chase);
    float age = 0.0;
    if (mode == 1) age = fract(ct * 0.5 - u);
    else if (mode == 2) age = fract(ct * 0.6 - v);
    else if (mode == 3) age = fract(ct * 0.5 - length(vec2(u - 0.5, (v - 0.5) / max(cellAspect * nx / ny, 0.3)) ) * 1.4);
    else if (mode == 4) {
        float slot = floor(ct * 2.5 + hash21(id) * 7.0);
        float frac = fract(ct * 2.5 + hash21(id) * 7.0);
        age = hash21(id * 1.7 + slot) < density ? frac : 1.0;
    } else if (mode == 5) {
        float flip = mod(floor(ct * 1.5), 2.0);
        float on = mod(id.x + id.y + flip, 2.0);
        age = on > 0.5 ? fract(ct * 1.5) * 0.25 : 0.25 + fract(ct * 1.5) * 0.75;
    } else if (mode == 6) {
        /* Level meter: columns light from the bottom up to the level. */
        float h = clamp(bass * 1.35 * (0.55 + 0.45 * sin(u * 9.0 + TIME * 2.0) * 0.5 + 0.25), 0.0, 1.0);
        age = v <= h ? 0.0 : clamp((v - h) * 3.0, 0.0, 1.0);
    } else if (mode == 7) {
        age = 1.0 - clamp(beat, 0.0, 1.0);
    }

    /* Filament: brightness as a decay from the last time it was driven. */
    float rate = mix(16.0, 1.4, filament);
    float heat = mode == 0 ? 1.0 : exp(-age * rate);
    heat = mix(1.0, heat, mode == 0 ? 0.0 : depth);
    heat *= level * (0.80 + 0.40 * bass);

    /* The lamp face. */
    int shape = int(lampShape);
    float r = lampSize * 0.46;
    float d;
    if (shape == 1)      d = max(abs(q.x), abs(q.y)) - r * 0.88;
    else if (shape == 2) d = max(abs(q.x) - r * 1.02, abs(q.y) - r * 0.36);
    else                 d = length(q) - r;
    float px = max(nx, ny) / res.y * 1.2;
    float face = 1.0 - smoothstep(-px, px, d);
    /* Hot spot at the filament, cooler toward the reflector's rim. */
    float hot = exp(-dot(q, q) / (r * r * 0.35));
    /* Bloom past the housing into the neighbours. */
    float bloom = exp(-max(d, 0.0) * (9.0 - 4.0 * min(glow, 1.0))) * glow;

    mat3 pal = paletteFor(int(colorMode));
    int pattern = int(colorPattern);
    vec3 full = pal[0];
    if (pattern == 1) full = mod(id.y, 2.0) < 0.5 ? pal[0] : pal[1];
    else if (pattern == 2) full = mod(id.x + id.y, 2.0) < 0.5 ? pal[0] : pal[1];
    else if (pattern == 3) full = mix(pal[1], pal[0], smoothstep(0.0, 1.0, abs(u - 0.5) * 2.0));
    else if (pattern == 4) full = hueRotate(vec3(1.0, 0.14, 0.10), u * 0.8 + v * 0.2 + TIME * 0.02);
    full = hueRotate(full, hueShift + (centroid - 0.5) * 0.03);
    vec3 dimmed = hueRotate(pal[2], hueShift);

    /* Colour slides toward the dim tone as the filament cools. */
    float cool = clamp(1.0 - heat, 0.0, 1.0);
    vec3 lamp = mix(full, dimmed, warmDim * cool * cool);

    vec3 col = lamp * heat * (face * (0.90 + 1.30 * hot) + bloom * 0.62 * (1.0 - face));
    /* The unlit fixture: a dull reflector you can just make out. */
    col += vec3(0.020, 0.019, 0.018) * housing * face * (1.0 - clamp(heat, 0.0, 1.0));
    col *= inWall;

    col *= 1.0 + beat * 0.15;
    col *= exposure;
    col = col / (1.0 + 0.22 * col);
    col *= 1.22;

    gl_FragColor = vec4(col, 1.0);
}
