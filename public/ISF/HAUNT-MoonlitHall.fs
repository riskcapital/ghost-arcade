/*{
    "DESCRIPTION": "A long room at night. Moonlight comes through tall windows and stands in the air as shafts, slanting down through dust that has not been disturbed for years. Motes turn in the light. A cloud crosses the moon and the shafts dim and return. And at intervals something walks between the windows and the room: one shaft after another goes dark, in order, and comes back. Nothing is shown. Set the windows, the angle of the light, how thick the air is and how often the room is crossed. Bass thickens the air, beats lift the motes, spectral centroid moves the clouds.",
    "CREDIT": "Ghost Arcade Halloween pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Moonlight", "Hunter's Moon", "Stained Glass", "Winter", "Sickroom", "Blood Moon", "Monochrome"]},
        {"NAME": "windows",   "TYPE": "float", "DEFAULT": 4.00, "MIN": 1.00, "MAX": 9.00},
        {"NAME": "panes",     "TYPE": "long",  "DEFAULT": 3, "VALUES": [1, 2, 3, 4, 6], "LABELS": ["1", "2", "3", "4", "6"]},
        {"NAME": "slant",     "TYPE": "float", "DEFAULT": 0.40, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "spreadOut", "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "windowWidth","TYPE": "float", "DEFAULT": 0.55, "MIN": 0.15, "MAX": 0.95},
        {"NAME": "softness",  "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "dustAir",   "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "airDrift",  "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "motes",     "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "clouds",    "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "crossings", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "crossWidth","TYPE": "float", "DEFAULT": 0.35, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "floorPool", "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Light through a window into dusty air is the window's shape extruded along
 * the direction of the light. Seen from the side that is a set of slanted
 * bars, one per pane, with the glazing bars as dark gaps between them.
 *
 * So every pixel is traced back along the light to the wall the windows are
 * in. Where it lands, across the wall, says which pane it came through, or
 * that it came through none. That is one line of arithmetic, and it makes
 * the thing that crosses the room cheap as well: an object between window
 * and room is just a moving stretch of that wall that passes no light.
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

float fbm(vec2 p) {
    float v = 0.0;
    float w = 0.5;
    for (int i = 0; i < 4; i++) {
        v += w * noise2(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 7.7);
        w *= 0.5;
    }
    return v;
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

vec3 saturate3(vec3 c, float amount) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(g), c, amount), 0.0);
}


/* Columns: [light, room, second pane colour]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Hunter's Moon */
        a = vec3(1.00, 0.76, 0.46); b = vec3(0.016, 0.010, 0.012); c = vec3(1.00, 0.60, 0.30);
    } else if (mode == 2) {     /* Stained Glass */
        a = vec3(0.90, 0.16, 0.20); b = vec3(0.010, 0.008, 0.016); c = vec3(0.16, 0.36, 1.00);
    } else if (mode == 3) {     /* Winter */
        a = vec3(0.86, 0.94, 1.00); b = vec3(0.012, 0.016, 0.024); c = vec3(0.70, 0.84, 1.00);
    } else if (mode == 4) {     /* Sickroom */
        a = vec3(0.76, 0.90, 0.60); b = vec3(0.012, 0.016, 0.008); c = vec3(0.60, 0.80, 0.50);
    } else if (mode == 5) {     /* Blood Moon */
        a = vec3(1.00, 0.30, 0.20); b = vec3(0.020, 0.004, 0.006); c = vec3(0.90, 0.16, 0.12);
    } else if (mode == 6) {     /* Monochrome */
        a = vec3(0.92, 0.92, 0.92); b = vec3(0.012, 0.012, 0.012); c = vec3(0.80, 0.80, 0.80);
    } else {                    /* Moonlight */
        a = vec3(0.62, 0.76, 1.00); b = vec3(0.006, 0.010, 0.022); c = vec3(0.54, 0.68, 1.00);
    }
    return mat3(a, b, c);
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float level = max(audioLevel, 0.20 + 0.08 * sin(TIME * 0.17));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    mat3 pal = paletteFor(int(colorMode));
    vec3 LIGHT = hueRotate(pal[0], hueShift);
    vec3 ROOM = pal[1];
    vec3 SECOND = hueRotate(pal[2], hueShift);

    /* Back along the light to the window wall, which is the top of the frame. */
    float drop = 0.5 - uv.y;                                   /* 0 at the wall, 1 at the floor */
    float lean = slant * 0.9;
    float widen = 1.0 + spreadOut * 0.8 * drop;                /* shafts spread as they fall */
    float wallX = (uv.x - lean * drop) / widen;

    float count = floor(windows);
    float pitch = aspect * 1.1 / count;
    float cell = wallX / pitch + count * 0.5;
    float win = floor(cell);
    float across = fract(cell);                                /* 0 .. 1 across one window bay */
    float inRange = step(-1.0, win) * step(win, count);

    /* The window: an opening in the middle of its bay, cut by glazing bars. */
    float halfW = windowWidth * 0.5;
    float blur = (0.006 + 0.10 * softness * drop) / widen;     /* penumbra grows with distance */
    float opening = smoothstep(0.5 - halfW - blur, 0.5 - halfW + blur, across)
                  * (1.0 - smoothstep(0.5 + halfW - blur, 0.5 + halfW + blur, across));
    float nPanes = float(panes);
    float paneCoord = (across - (0.5 - halfW)) / (2.0 * halfW) * nPanes;
    float barDist = abs(fract(paneCoord + 0.5) - 0.5) / nPanes * 2.0 * halfW;
    float barW = 0.010;
    float bars = smoothstep(barW - blur * 0.6, barW + blur * 0.6, barDist);
    float shaft = opening * mix(1.0, bars, step(1.5, nPanes)) * inRange;
    float paneId = floor(paneCoord);

    /* Cloud over the moon: the whole room dims and comes back, unevenly. */
    float cloud = 1.0 - clouds * 0.75 * smoothstep(0.35, 0.75, fbm(vec2(TIME * 0.05 * (0.6 + 0.8 * centroid) + wallX * 0.25, 2.0)));

    /* The crossing: a dark stretch of the wall that moves along it. */
    float trip = TIME * crossings * 0.06;
    float tripId = floor(trip);
    float tripPhase = fract(trip);
    float way = hash21(vec2(tripId, 9.0)) < 0.5 ? 1.0 : -1.0;
    float walker = way * (tripPhase * 2.6 - 1.3) * aspect * 0.5 * (1.0 / 0.5);
    float body = crossWidth * 0.22;
    /* Uneven edges and a gait: it is not a sliding board. */
    float gait = 0.02 * sin(tripPhase * 60.0) + 0.03 * (noise2(vec2(drop * 4.0, tripId)) - 0.5);
    float blocked = (1.0 - smoothstep(body * 0.6, body, abs(wallX - walker + gait))) * step(0.001, crossings);
    /* It is tall, but not as tall as the windows: light still passes over it. */
    blocked *= smoothstep(0.10, 0.32, drop + 0.2 * noise2(vec2(wallX * 6.0, tripId)));

    /* Dust in the air: slow, uneven, drifting across the shafts. */
    vec2 ap = vec2(uv.x * 2.4 + TIME * airDrift * 0.06, uv.y * 3.0 - TIME * airDrift * 0.03);
    float air = fbm(ap + 0.7 * vec2(fbm(ap * 0.6 + 4.0), 0.0));
    float haze = dustAir * (0.55 + 0.6 * bass) * (0.35 + 1.2 * air);
    /* Light thins a little as it travels down. */
    float reach = 1.0 - 0.45 * drop;

    bool stained = int(colorMode) == 2;
    vec3 tint = stained ? (mod(paneId + win, 2.0) < 0.5 ? LIGHT : SECOND) : mix(LIGHT, SECOND, 0.3 * mod(win, 2.0));
    vec3 col = ROOM;
    col += tint * shaft * haze * cloud * reach * (1.0 - blocked) * 0.75;

    /* Motes: single specks that catch the light only inside a shaft. */
    vec2 mg = vec2(uv.x * 36.0, uv.y * 36.0 + TIME * 0.25) + air * 2.0;
    vec2 mid = floor(mg);
    vec2 mf = fract(mg) - 0.5;
    float mh = hash21(mid);
    vec2 mo = (vec2(hash21(mid + 3.0), hash21(mid + 7.0)) - 0.5) * 0.7
            + 0.12 * vec2(sin(TIME * (0.6 + mh) + mh * 30.0), cos(TIME * (0.5 + mh) + mh * 20.0));
    float speck = step(1.0 - motes * 0.35, mh) * exp(-dot(mf - mo, mf - mo) * 520.0);
    float turn = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(TIME * (1.0 + 3.0 * mh) + mh * 50.0), 3.0);
    col += tint * speck * turn * shaft * cloud * (1.0 - blocked) * (1.4 + 1.5 * beat);

    /* Where the shafts meet the floor. */
    float floorBand = smoothstep(0.80, 0.98, drop);
    col += tint * shaft * cloud * (1.0 - blocked) * floorBand * floorPool * 0.55;

    /* The windows themselves, a strip of cold sky along the top. */
    float glass = smoothstep(0.035, 0.0, drop) * opening * mix(1.0, bars, step(1.5, nPanes)) * inRange;
    col += tint * glass * cloud * 0.9;

    col *= 1.0 - 0.25 * dot(uv * vec2(0.6, 1.0), uv * vec2(0.6, 1.0));
    col += (hash21(gl_FragCoord.xy + floor(TIME * 24.0) * 7.0) - 0.5) * 0.012;
    col *= exposure * 1.2;
    col = col / (1.0 + 0.20 * col);
    col *= 1.20;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
