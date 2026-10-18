/*{
    "DESCRIPTION": "Soft cells, a family of shapes described in 2024: tiles that fill the plane with curved edges and as few corners as possible. Start from a grid of squares and bend every edge into an S until the four edges at each crossing run along the same line. Two corners of each tile close into needle-sharp cusps and the other two straighten out, leaving a tile with only two corners, shaped like a seed. The softness control runs the bend from brick to seed. Tiles are lit as inflated cushions. Bass inflates them, beats pulse the gaps, spectral centroid steers the drift.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["River Stone", "Seed Pod", "Abalone", "Terracotta", "Licorice", "Sherbet", "Jade and Rust"]},
        {"NAME": "softness",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "breathe",   "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "variation", "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "scale",     "TYPE": "float", "DEFAULT": 5.00, "MIN": 1.50, "MAX": 16.0},
        {"NAME": "puff",      "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "gap",       "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "gloss",     "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "tilePattern","TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3], "LABELS": ["Checker", "Rows", "Scattered", "One colour"]},
        {"NAME": "drift",     "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "turn",      "TYPE": "float", "DEFAULT": 0.10, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Two families of curves replace the grid lines of a square lattice:
 *
 *     y - f(x) = j        and        x - f(y) = i,      f(u) = s sin(2 pi u) / (2 pi)
 *
 * f is zero at every whole number, so the curves still pass through the
 * lattice points, and f'(whole number) = s. At a lattice point the first
 * family has slope s and the second 1/s. When s reaches 1 those agree: all
 * four edges leave the point along the diagonal. Two of a tile's corners then
 * have zero angle (cusps) and the other two have a straight angle (no corner
 * at all), which is the two-cornered tile the soft-cell paper describes.
 *
 * The pair (a, b) = (y - f(x), x - f(y)) is a coordinate system in which the
 * tiles are unit squares, so which tile a pixel is in, and where in it, is
 * two subtractions and a floor. The gradients of a and b are known exactly,
 * which gives true distances to the edges and true surface normals for the
 * cushion shading without sampling neighbours.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

/* Palettes for this shader alone. Columns: [tile A, grout, tile B]. */
mat3 paletteFor(int mode) {
    vec3 a, grout, b;
    if (mode == 1) {            /* Seed Pod - olive and cream */
        a     = vec3(0.56, 0.60, 0.26);
        grout = vec3(0.060, 0.050, 0.030);
        b     = vec3(0.94, 0.88, 0.70);
    } else if (mode == 2) {     /* Abalone - teal and pearl pink */
        a     = vec3(0.10, 0.62, 0.66);
        grout = vec3(0.020, 0.040, 0.060);
        b     = vec3(0.96, 0.70, 0.80);
    } else if (mode == 3) {     /* Terracotta - fired clay and slip */
        a     = vec3(0.80, 0.36, 0.20);
        grout = vec3(0.090, 0.050, 0.040);
        b     = vec3(0.92, 0.78, 0.62);
    } else if (mode == 4) {     /* Licorice - black gloss and one red */
        a     = vec3(0.07, 0.07, 0.08);
        grout = vec3(0.010, 0.010, 0.012);
        b     = vec3(0.86, 0.08, 0.14);
    } else if (mode == 5) {     /* Sherbet - lemon and raspberry */
        a     = vec3(1.00, 0.86, 0.36);
        grout = vec3(0.140, 0.050, 0.090);
        b     = vec3(1.00, 0.36, 0.56);
    } else if (mode == 6) {     /* Jade and Rust */
        a     = vec3(0.20, 0.62, 0.46);
        grout = vec3(0.030, 0.045, 0.040);
        b     = vec3(0.72, 0.30, 0.14);
    } else {                    /* River Stone - slate and warm grey */
        a     = vec3(0.34, 0.42, 0.50);
        grout = vec3(0.030, 0.034, 0.040);
        b     = vec3(0.78, 0.74, 0.68);
    }
    return mat3(a, grout, b);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    float rot = TIME * turn * 0.06;
    vec2 p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * uv * scale;
    p += TIME * drift * 0.25 * vec2(cos(0.6 + centroid * 0.8), sin(0.6 + centroid * 0.8));
    float pixel = scale / RENDERSIZE.y;

    /* How far the edges are bent, here. It can breathe, and vary from place
       to place so brick and seed sit side by side. */
    float s = softness;
    s *= 1.0 - breathe * (0.5 + 0.5 * sin(TIME * 0.35));
    s *= 1.0 - variation * smoothstep(0.35, 0.75, noise2(p * 0.22 + 4.0));
    s = clamp(s, 0.0, 1.0) * 0.999;

    /* The bent coordinates and their exact gradients. */
    float fx = s * sin(TAU * p.x) / TAU;
    float fy = s * sin(TAU * p.y) / TAU;
    float dfx = s * cos(TAU * p.x);
    float dfy = s * cos(TAU * p.y);
    float a = p.y - fx;
    float b = p.x - fy;
    vec2 gradA = vec2(-dfx, 1.0);
    vec2 gradB = vec2(1.0, -dfy);

    vec2 id = floor(vec2(b, a));
    float fa = fract(a);
    float fb = fract(b);

    /* True distance to the nearest edge of each family. */
    float dA = min(fa, 1.0 - fa) / length(gradA);
    float dB = min(fb, 1.0 - fb) / length(gradB);
    float dEdge = min(dA, dB);

    /* Cushion: height rises from every edge to the middle of the tile. */
    float ha = sin(PI * fa);
    float hb = sin(PI * fb);
    float h = pow(ha * hb, 0.55);
    float dhda = 0.55 * h * PI * cos(PI * fa) / max(ha, 1e-3);
    float dhdb = 0.55 * h * PI * cos(PI * fb) / max(hb, 1e-3);
    vec2 slope = dhda * gradA + dhdb * gradB;
    float lift = puff * (0.75 + 0.6 * bass);
    vec3 nrm = normalize(vec3(-slope * lift * 0.55, 1.0));

    vec3 lightDir = normalize(vec3(-0.45, 0.60, 0.66));
    float diff = clamp(dot(nrm, lightDir), 0.0, 1.0);
    vec3 halfV = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(clamp(dot(nrm, halfV), 0.0, 1.0), mix(18.0, 90.0, gloss)) * gloss;
    /* Light from below the horizon too, so the shadow side is not dead. */
    float fill = 0.5 + 0.5 * nrm.y;

    mat3 pal = paletteFor(int(colorMode));
    vec3 TILE_A = hueRotate(pal[0], hueShift);
    vec3 GROUT = pal[1];
    vec3 TILE_B = hueRotate(pal[2], hueShift);

    int pattern = int(tilePattern);
    float pick;
    if (pattern == 1)      pick = mod(id.y, 2.0);
    else if (pattern == 2) pick = step(0.5, hash21(id + 3.0));
    else if (pattern == 3) pick = 0.0;
    else                   pick = mod(id.x + id.y, 2.0);
    vec3 tile = mix(TILE_A, TILE_B, pick);
    /* A little variation tile to tile, as fired or grown things have. */
    tile *= 0.90 + 0.20 * hash21(id * 1.7 + 9.0);

    vec3 col = tile * (0.20 + 0.70 * diff + 0.16 * fill);
    col *= 0.55 + 0.45 * smoothstep(0.0, 0.5, h);                 /* occlusion toward the seams */
    col += mix(tile, vec3(1.0), 0.7) * spec * (0.8 + 0.6 * level);

    /* The seam between tiles. */
    float gw = 0.004 + 0.045 * gap * (1.0 + 0.25 * beat);
    float seam = 1.0 - smoothstep(gw - pixel, gw + pixel, dEdge);
    col = mix(col, GROUT, seam);

    col *= 1.0 + beat * 0.10;
    col *= 1.0 - 0.22 * dot(uv, uv);
    col *= exposure;
    col = col / (1.0 + 0.18 * col);
    col *= 1.18;

    gl_FragColor = vec4(col, 1.0);
}
