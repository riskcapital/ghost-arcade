/*{
    "DESCRIPTION": "The moving sofa problem. What is the largest shape that can be slid round a right-angled corner in a corridor one unit wide? The answer had been guessed since 1992, a shape with eighteen curved pieces, and in 2024 a proof was announced that nothing larger will fit. The sofa is not drawn from a formula here. It is carved: the corridor is swept past a block in sixty positions, and whatever survives every one of them is the sofa. Change the path the corner takes and a different sofa is carved. Ghost images show where it has been. Bass thickens the contours, beats flash the walls, spectral centroid changes the pace.",
    "CREDIT": "Ghost Arcade 2.0 pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Blueprint", "Velvet", "Plasterwork", "Removal Van", "Mint Condition", "Night Shift", "Marker Pen"]},
        {"NAME": "sofa",      "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2], "LABELS": ["Hammersley 1968", "Gerver-like 1992", "Custom path"]},
        {"NAME": "pathAcross","TYPE": "float", "DEFAULT": 0.60, "MIN": 0.10, "MAX": 0.90},
        {"NAME": "pathUp",    "TYPE": "float", "DEFAULT": 0.66, "MIN": 0.05, "MAX": 0.95},
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "ghosts",    "TYPE": "long",  "DEFAULT": 3,
         "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Off", "1", "2", "3", "4"]},
        {"NAME": "ghostGap",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "contours",  "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "contourCount","TYPE": "float", "DEFAULT": 7.00, "MIN": 1.00, "MAX": 20.0},
        {"NAME": "wallWeight","TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "floorGrid", "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "viewSize",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.50, "MAX": 2.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Think of it from the sofa's side. The sofa stays still and the corridor
 * moves past it, turning through a right angle as it goes. At every moment
 * the sofa must lie inside the corridor. So the largest sofa for a given
 * motion is simply the part of the plane that is inside the corridor at
 * every moment of that motion: an intersection of corridors.
 *
 * The motion is fixed by the path the corridor's inner corner follows,
 * as seen from the sofa. Hammersley (1968) sent it round a semicircle of
 * radius 2 / pi, which carves a sofa of area 2.2074. Gerver (1992) found a
 * better, flatter path and a sofa of area 2.2195, and the 2024 proof says
 * that is the best possible. An ellipse of the right proportions comes
 * within a hair of Gerver's path and is what "Gerver-like" uses.
 *
 * The intersection is taken over sixty corridor positions per pixel, each
 * a signed distance, so the result is itself a signed distance to the
 * sofa's edge. That gives the clean outline and the contour lines for free.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int STEPS = 60;
const int MAX_GHOSTS = 4;

/* Signed distance to the corridor: inner corner at the origin, one arm
   running off to the left, the other running off downward, width 1. */
float corridor(vec2 h) {
    float armAcross = max(abs(h.y - 0.5) - 0.5, h.x - 1.0);
    float armDown = max(abs(h.x - 0.5) - 0.5, h.y - 1.0);
    return min(armAcross, armDown);
}

/* Where the inner corner is, seen from the sofa, when the corridor has turned by `a`. */
vec2 cornerPath(float a, vec2 radii) {
    return vec2(radii.x * (cos(2.0 * a) - 1.0), radii.y * sin(2.0 * a));
}

/* Signed distance to the sofa carved by that path, at sofa-frame point s. */
float sofaShape(vec2 s, vec2 radii) {
    float d = abs(s.y - 0.5) - 0.5;                    /* it starts inside the first arm */
    for (int i = 0; i < STEPS; i++) {
        float a = 0.5 * PI * float(i) / float(STEPS - 1);
        vec2 rel = s - cornerPath(a, radii);
        float ca = cos(a), sa = sin(a);
        vec2 h = vec2(ca * rel.x + sa * rel.y, -sa * rel.x + ca * rel.y);
        d = max(d, corridor(h));
    }
    return d;
}

/* Sofa-frame point for world point q when the journey is at `u` (0 .. 1):
   slide in, turn the corner, slide out. */
vec2 toSofa(vec2 q, float u, vec2 radii) {
    float slideIn = 1.0 - smoothstep(0.0, 0.28, u);
    float turnAmount = smoothstep(0.24, 0.76, u);
    float slideOut = smoothstep(0.72, 1.0, u);
    float a = 0.5 * PI * turnAmount;
    vec2 w = q + vec2(0.0, slideOut * 2.2);            /* further down the second arm */
    float ca = cos(a), sa = sin(a);
    vec2 s = vec2(ca * w.x - sa * w.y, sa * w.x + ca * w.y) + cornerPath(a, radii);
    s.x += slideIn * 2.2;                              /* not yet arrived along the first arm */
    return s;
}

/* Palettes for this shader alone. Columns: [sofa, floor, line]. */
mat3 paletteFor(int mode) {
    vec3 a, ground, b;
    if (mode == 1) {            /* Velvet */
        a      = vec3(0.56, 0.08, 0.20);
        ground = vec3(0.060, 0.040, 0.050);
        b      = vec3(1.00, 0.80, 0.50);
    } else if (mode == 2) {     /* Plasterwork */
        a      = vec3(0.80, 0.54, 0.40);
        ground = vec3(0.90, 0.87, 0.80);
        b      = vec3(0.20, 0.18, 0.18);
    } else if (mode == 3) {     /* Removal Van */
        a      = vec3(1.00, 0.72, 0.10);
        ground = vec3(0.070, 0.070, 0.080);
        b      = vec3(1.00, 1.00, 1.00);
    } else if (mode == 4) {     /* Mint Condition */
        a      = vec3(0.40, 0.86, 0.70);
        ground = vec3(0.030, 0.060, 0.060);
        b      = vec3(1.00, 0.56, 0.60);
    } else if (mode == 5) {     /* Night Shift */
        a      = vec3(0.30, 0.20, 0.70);
        ground = vec3(0.012, 0.010, 0.030);
        b      = vec3(0.50, 1.00, 0.90);
    } else if (mode == 6) {     /* Marker Pen */
        a      = vec3(0.96, 0.26, 0.20);
        ground = vec3(0.96, 0.95, 0.92);
        b      = vec3(0.08, 0.10, 0.20);
    } else {                    /* Blueprint */
        a      = vec3(0.20, 0.50, 0.96);
        ground = vec3(0.016, 0.050, 0.130);
        b      = vec3(0.86, 0.94, 1.00);
    }
    return mat3(a, ground, b);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    /* The corner sits a little right of and above centre so both arms show. */
    float unit = 3.5 / viewSize;                       /* corridor widths per frame height */
    vec2 q = uv * unit + vec2(-0.75, -0.15);
    float pixel = unit / res.y;

    int which = int(sofa);
    vec2 radii = which == 0 ? vec2(2.0 / PI) : which == 1 ? vec2(0.605, 0.667) : vec2(pathAcross, pathUp);

    /* There and back again, so the loop has no jump. */
    float journey = TIME * speed * (0.10 + 0.05 * centroid);
    float u = abs(fract(journey) * 2.0 - 1.0);
    float heading = fract(journey) < 0.5 ? -1.0 : 1.0;  /* which way the ghosts trail */

    mat3 pal = paletteFor(int(colorMode));
    vec3 SOFA = hueRotate(pal[0], hueShift);
    vec3 FLOOR = pal[1];
    vec3 LINE = hueRotate(pal[2], hueShift);
    bool paper = dot(FLOOR, vec3(0.333)) > 0.5;

    /* The corridor itself. */
    float hall = corridor(q);
    float inHall = 1.0 - smoothstep(-pixel, pixel, hall);
    vec3 outside = paper ? FLOOR * 0.80 : FLOOR * 0.45;
    vec3 col = mix(outside, FLOOR, inHall);
    /* Floorboards, one corridor-width wide in each arm. */
    vec2 tiles = abs(fract(q * 4.0 + 0.5) - 0.5) / 4.0;
    float grid = (1.0 - smoothstep(0.0, pixel * 1.2, min(tiles.x, tiles.y))) * floorGrid * inHall;
    col = mix(col, LINE, grid * (paper ? 0.16 : 0.10));

    /* Ghosts: where the sofa was a moment ago. */
    int nGhosts = int(ghosts);
    for (int gI = 0; gI < MAX_GHOSTS; gI++) {
        if (gI >= nGhosts) break;
        float back = float(gI + 1) * ghostGap * 0.11;
        float ug = clamp(u + heading * back, 0.0, 1.0);
        float dg = sofaShape(toSofa(q, ug, radii), radii);
        float edge = 1.0 - smoothstep(0.0, pixel * 1.6, abs(dg));
        float fade = 1.0 - float(gI) / float(nGhosts + 1);
        col = mix(col, SOFA, (1.0 - smoothstep(-pixel, pixel, dg)) * 0.10 * fade);
        col = mix(col, mix(SOFA, LINE, 0.4), edge * 0.45 * fade);
    }

    /* The sofa. */
    float d = sofaShape(toSofa(q, u, radii), radii);
    float body = 1.0 - smoothstep(-pixel, pixel, d);
    /* Contours of depth inside it: how far each point is from being carved away. */
    float bands = contourCount * 3.0;
    float ring = abs(fract(-d * bands) - 0.5) / bands;
    float contour = (1.0 - smoothstep(0.0, pixel * (1.1 + 0.9 * bass), ring)) * contours;
    float depthShade = smoothstep(0.0, 0.5, -d);
    vec3 fabric = SOFA * (0.62 + 0.50 * depthShade);
    fabric = mix(fabric, mix(SOFA, LINE, 0.55), contour * 0.55);
    col = mix(col, fabric, body);
    float outline = 1.0 - smoothstep(0.0, pixel * 2.2, abs(d));
    col = mix(col, LINE, outline * 0.95);

    /* Walls on top, so the sofa is seen to clear them. */
    float wall = (1.0 - smoothstep(0.0, pixel * (1.0 + 3.0 * wallWeight), abs(hall))) * step(0.001, wallWeight);
    col = mix(col, LINE * (paper ? 1.0 : 1.0 + 0.5 * beat), wall * 0.9);

    col *= 1.0 + beat * 0.08 * (paper ? 0.0 : 1.0);
    col *= exposure;
    if (!paper) {
        col = col / (1.0 + 0.18 * col);
        col *= 1.18;
    }

    gl_FragColor = vec4(col, 1.0);
}
