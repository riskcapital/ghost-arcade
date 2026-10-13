/*{
    "DESCRIPTION": "A mirror ball. A turning sphere of small square mirrors, lit by up to four pinspots, throws a slow-wheeling field of light flecks round the room. The flecks are in the right places: each one is where a real mirror on the turning ball would send the pinspot's light, so they stream past in rows, bunch toward the ball's poles and stretch as they slide off toward the edges of the frame. The ball itself can be shown, glittering, or hidden so only the flecks reach the band. Bass swells the flecks, beats nudge the spin, spectral centroid tilts the axis.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Ballroom", "Disco", "Champagne", "Midnight", "Roller Rink", "Prom", "Silver"]},
        {"NAME": "pinspots",  "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [1, 2, 3, 4], "LABELS": ["1", "2", "3", "4"]},
        {"NAME": "mirrors",   "TYPE": "float", "DEFAULT": 26.0, "MIN": 8.0, "MAX": 60.0},
        {"NAME": "spin",      "TYPE": "float", "DEFAULT": 0.25, "MIN": -2.00, "MAX": 2.00},
        {"NAME": "tilt",      "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "fleckSize", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "fleckSoft", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "roomDepth", "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.15, "MAX": 2.00},
        {"NAME": "fill",      "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.20, "MAX": 1.00},
        {"NAME": "twinkle",   "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "ballX",     "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "ballY",     "TYPE": "float", "DEFAULT": 0.78, "MIN": 0.00, "MAX": 1.20},
        {"NAME": "ballSize",  "TYPE": "float", "DEFAULT": 0.11, "MIN": 0.03, "MAX": 0.35},
        {"NAME": "showBall",  "TYPE": "bool",  "DEFAULT": 1},
        {"NAME": "sparkle",   "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hazeRays",  "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "level",     "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Where the flecks go.
 *
 * A mirror facet with normal n sends a pinspot's light, arriving along L, off
 * in the direction of L reflected about n. Run that backwards: for a point
 * on the wall, the direction from the ball to it is known, so the one facet
 * normal that could have sent light there is the bisector of that direction
 * and the direction back to the pinspot. If the turning ball actually has a
 * mirror facing that way, the wall point is lit.
 *
 * So each pixel asks one question per pinspot: turn the bisector into the
 * ball's own frame, read off its latitude and longitude, and see whether it
 * falls on a mirror or on the gap between two. The rows of mirrors are rings
 * of latitude, with fewer mirrors in the rings near the poles, the way a
 * real ball is tiled. Nothing is marched and there is no loop over mirrors.
 *
 * The ball's face is the same lookup: its surface normal is rounded to the
 * nearest facet and shaded as a flat mirror, which is what makes it glitter
 * in steps as it turns instead of shining like a ball bearing.
 */

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int MAX_PINS = 4;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash21(vec2(i, 1.0)), hash21(vec2(i + 1.0, 1.0)), f);
}

/* Pinspot gels. Columns: three gels; a fourth pinspot is open white. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Disco */
        a = vec3(1.00, 0.20, 0.70);
        b = vec3(0.20, 0.80, 1.00);
        c = vec3(1.00, 0.86, 0.20);
    } else if (mode == 2) {     /* Champagne */
        a = vec3(1.00, 0.88, 0.66);
        b = vec3(1.00, 0.74, 0.60);
        c = vec3(1.00, 0.96, 0.86);
    } else if (mode == 3) {     /* Midnight */
        a = vec3(0.30, 0.46, 1.00);
        b = vec3(0.66, 0.40, 1.00);
        c = vec3(0.70, 0.90, 1.00);
    } else if (mode == 4) {     /* Roller Rink */
        a = vec3(1.00, 0.30, 0.20);
        b = vec3(0.30, 1.00, 0.50);
        c = vec3(0.30, 0.50, 1.00);
    } else if (mode == 5) {     /* Prom */
        a = vec3(1.00, 0.60, 0.80);
        b = vec3(0.70, 0.76, 1.00);
        c = vec3(1.00, 0.92, 0.72);
    } else if (mode == 6) {     /* Silver */
        a = vec3(1.00, 1.00, 1.00);
        b = vec3(0.80, 0.88, 1.00);
        c = vec3(1.00, 0.94, 0.88);
    } else {                    /* Ballroom - warm white and a pale blue */
        a = vec3(1.00, 0.94, 0.82);
        b = vec3(0.70, 0.84, 1.00);
        c = vec3(1.00, 0.80, 0.60);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/* World direction into the turning ball's own frame. */
vec3 toBall(vec3 v, float turnAngle, float lean) {
    /* Lean the axis, then turn about it. */
    float cl = cos(lean), sl = sin(lean);
    v = vec3(v.x * cl - v.y * sl, v.x * sl + v.y * cl, v.z);
    float ct = cos(turnAngle), st = sin(turnAngle);
    return vec3(v.x * ct + v.z * st, v.y, -v.x * st + v.z * ct);
}

/*
 * Which facet a direction lands on. Returns how far the direction is from
 * the facet's centre as (across, along) in units of half a facet, so 1 is
 * the facet's edge, and its id.
 */
vec2 facetOf(vec3 n, float rows, out vec2 id) {
    float lat = asin(clamp(n.y, -1.0, 1.0));              /* -pi/2 .. pi/2 */
    float lon = atan(n.z, n.x);                            /* -pi .. pi */
    float row = floor((lat / PI + 0.5) * rows);
    float rowLat = ((row + 0.5) / rows - 0.5) * PI;
    /* Fewer mirrors round a ring nearer the pole. */
    float count = max(floor(2.0 * rows * cos(rowLat) + 0.5), 3.0);
    float col = floor((lon / TAU + 0.5) * count);
    id = vec2(col, row);
    float u = ((lon / TAU + 0.5) * count - col - 0.5) * 2.0;
    float v = ((lat / PI + 0.5) * rows - row - 0.5) * 2.0;
    return vec2(u, v);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;
    float px = 1.0 / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int n = int(pinspots);
    float rows = floor(mirrors);
    mat3 pal = paletteFor(int(colorMode));
    vec2 ball = vec2((ballX - 0.5) * aspect, ballY - 0.5);
    float turnAngle = TIME * spin * 0.6 + beat * 0.05;
    float lean = tilt * 0.6 * (0.6 + 0.8 * (centroid - 0.3));

    vec3 col = vec3(0.0);

    /* --- Flecks on the room ------------------------------------------------ */
    /* The wall is a plane behind the ball; this is the direction out to it. */
    vec3 out3 = normalize(vec3(uv - ball, roomDepth));
    /* A flat mirror sends on a beam no wider than itself, while its
       neighbour's beam leaves at twice the angle between them. So a fleck is
       small against the spacing of the flecks: it fills only the middle of
       its facet's patch of wall. */
    float mirrorHalf = (0.07 + 0.42 * fleckSize) * fill * (0.90 + 0.25 * bass);
    float blur = mirrorHalf * (0.08 + 0.9 * fleckSoft);
    float sizeScale = 1.0;
    for (int j = 0; j < MAX_PINS; j++) {
        if (j >= n) break;
        float fj = float(j);
        /* Pinspots sit out front, spread left to right and a little above. */
        float pa = (fj - 0.5 * float(n - 1)) * 0.9;
        vec3 toPin = normalize(vec3(sin(pa) * 1.2, 0.35 + 0.15 * cos(fj * 2.0), -1.0));
        /* The facet normal that would send this pinspot's light to this pixel. */
        vec3 bis = normalize(out3 + toPin);
        vec3 local = toBall(bis, turnAngle, lean);
        vec2 id;
        vec2 f = facetOf(local, rows, id) * sizeScale;
        float d = max(abs(f.x), abs(f.y));
        float d2 = length(f);
        float fleck = 1.0 - smoothstep(mirrorHalf - blur, mirrorHalf + blur, mix(d, d2, 0.5));
        /* Mirrors are not all perfect: a few are dull, a few are missing. */
        float quality = hash21(id + fj * 31.0);
        fleck *= mix(1.0, 0.45 + 0.75 * quality, twinkle) * step(0.04 * twinkle, quality);
        /* Light spreads as it travels; flecks far from the ball are dimmer. */
        float spreadLoss = out3.z * out3.z;
        /* Only mirrors facing the pinspot catch its light. */
        float facing = smoothstep(0.0, 0.25, dot(bis, toPin));
        vec3 gel = j == 0 ? pal[0] : j == 1 ? pal[1] : j == 2 ? pal[2] : vec3(1.0);
        col += hueRotate(gel, hueShift) * fleck * (0.35 + 0.65 * spreadLoss) * facing * (1.1 + 0.6 * bass) * level;
    }

    /* --- Shafts in the haze, fanning out from the ball ----------------------- */
    vec2 fromBall = uv - ball;
    float rb = length(fromBall);
    float ab = atan(fromBall.y, fromBall.x);
    float shafts = pow(noise1(ab * 14.0 + turnAngle * 3.0) * noise1(ab * 37.0 - turnAngle * 5.0 + 9.0), 1.5);
    col += mix(pal[0], pal[1], 0.5) * shafts * hazeRays * 0.9 * exp(-rb * 2.6) * level;

    /* --- The ball ----------------------------------------------------------- */
    if (showBall) {
        float rho = rb / ballSize;
        float disc = 1.0 - smoothstep(1.0 - px / ballSize, 1.0 + px / ballSize, rho);
        if (disc > 0.0) {
            vec2 pn = fromBall / ballSize;
            vec3 nrm = vec3(pn, -sqrt(max(1.0 - dot(pn, pn), 0.0)));     /* facing the viewer (-z) */
            vec3 local = toBall(nrm, turnAngle, lean);
            vec2 id;
            vec2 f = facetOf(local, rows, id);
            /* Snap the normal to the facet's centre: every mirror is flat. */
            float rowLat = ((id.y + 0.5) / rows - 0.5) * PI;
            float count = max(floor(2.0 * rows * cos(rowLat) + 0.5), 3.0);
            float lon = ((id.x + 0.5) / count - 0.5) * TAU;
            vec3 flat3 = vec3(cos(rowLat) * cos(lon), sin(rowLat), cos(rowLat) * sin(lon));
            /* Back to the world: undo the turn, then the lean. */
            float ct = cos(turnAngle), st = sin(turnAngle);
            vec3 w = vec3(flat3.x * ct - flat3.z * st, flat3.y, flat3.x * st + flat3.z * ct);
            float cl = cos(lean), sl = sin(lean);
            w = vec3(w.x * cl + w.y * sl, -w.x * sl + w.y * cl, w.z);

            vec3 view = vec3(0.0, 0.0, -1.0);
            vec3 glint = vec3(0.0);
            for (int j = 0; j < MAX_PINS; j++) {
                if (j >= n) break;
                float fj = float(j);
                float pa = (fj - 0.5 * float(n - 1)) * 0.9;
                vec3 toPin = normalize(vec3(sin(pa) * 1.2, 0.35 + 0.15 * cos(fj * 2.0), -1.0));
                vec3 h = normalize(toPin + view);
                float s = pow(max(dot(w, h), 0.0), 220.0);
                vec3 gel = j == 0 ? pal[0] : j == 1 ? pal[1] : j == 2 ? pal[2] : vec3(1.0);
                glint += hueRotate(gel, hueShift) * s;
            }
            /* The room, dimly, in every mirror. */
            float env = 0.035 + 0.11 * (0.5 + 0.5 * w.y) + 0.06 * hash21(id);
            float grout = smoothstep(1.0, 0.86, max(abs(f.x), abs(f.y)));
            float edgeDark = 0.35 + 0.65 * sqrt(max(1.0 - rho * rho, 0.0));
            vec3 face = (vec3(env) * mix(pal[0], vec3(1.0), 0.5) + glint * 5.0 * sparkle) * grout * edgeDark;
            col = mix(col, face * level, disc);
            /* Bloom round the brightest glints. */
        }
        col += mix(pal[0], vec3(1.0), 0.5) * 0.010 * sparkle / (abs(rho - 1.0) * 8.0 + 0.25) * step(rho, 2.2) * level * 0.4;
        /* The chain it hangs from. */
        float chain = (1.0 - smoothstep(0.0, px * 1.5, abs(fromBall.x))) * step(ballSize, fromBall.y);
        col += vec3(0.05) * chain;
    }

    col *= 1.0 + beat * 0.12;
    col *= exposure;
    col = col / (1.0 + 0.18 * col);
    col *= 1.18;

    gl_FragColor = vec4(col, 1.0);
}
