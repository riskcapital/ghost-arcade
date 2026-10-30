/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of round LEDs used as a pixel display for the rhythm. Every hit of the sound it follows plays one light pattern across the grid: a chase along a row or down a column, a diagonal, a scatter of sparkles, or a diamond opening from a cell picked by the pitch. Lit dots snap on and fall away in real time; the dark dots stay just visible.",
    "PASSES": [
        {
            "TARGET": "launchA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "launchB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "infoA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "infoB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "lastHit",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "columns", "LABEL": "Columns", "TYPE": "float", "DEFAULT": 32, "MIN": 8, "MAX": 64 },
        { "NAME": "rows", "LABEL": "Rows", "TYPE": "float", "DEFAULT": 18, "MIN": 4, "MAX": 36 },
        { "NAME": "dotSize", "LABEL": "Dot size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "decay", "LABEL": "Decay", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "pattern", "LABEL": "Pattern", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["Changes each hit", "Row sweep", "Column sweep", "Diagonal", "Sparkle", "Diamond"] },
        { "NAME": "sweepTime", "LABEL": "Sweep time", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "sparkle", "LABEL": "Sparkle density", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "offLevel", "LABEL": "Off dots", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "accentCell", "LABEL": "Accent cell", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "LEDs", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Lead cell", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Grid margin, as a share of the frame height.
const float MARGIN = 0.07;

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

// Which pattern hit m plays: 0 row, 1 column, 2 diagonal, 3 sparkle, 4 diamond.
float kindOf(float m) {
    if (pattern > 0) return float(pattern - 1);
    if (mod(m, 8.0) == 0.0) return 4.0;
    float h = hash11(m * 4.37 + 1.3);
    if (h < 0.3) return 3.0;
    if (h < 0.55) return 0.0;
    if (h < 0.8) return 1.0;
    return 2.0;
}

// When cell c lights after hit m (seconds), or -1 when the pattern leaves it dark.
// y = how bright the pattern leaves it, z = 1 on the pattern's lead cell,
// w = the time between neighbouring cells of a chase (the head is the newest one).
vec4 cellDelay(vec2 c, vec2 grid, float m, float midi, float sweep) {
    float kind = kindOf(m);
    float h1 = hash11(m * 1.71 + 0.23);
    float h2 = hash11(m * 2.93 + 5.1);
    float flip = h2 < 0.5 ? 1.0 : 0.0;
    if (kind < 0.5) {
        // A chase along one row.
        float r = floor(mix(0.12, 0.88, h1) * grid.y);
        if (c.y != r) return vec4(-1.0);
        float i = flip > 0.5 ? grid.x - 1.0 - c.x : c.x;
        float st = sweep / (grid.x - 1.0);
        return vec4(i * st, 1.0, 0.0, st);
    }
    if (kind < 1.5) {
        // A chase down one column.
        float col = floor(mix(0.1, 0.9, h1) * grid.x);
        if (c.x != col) return vec4(-1.0);
        float j = flip > 0.5 ? c.y : grid.y - 1.0 - c.y;
        float st = sweep * 0.7 / (grid.y - 1.0);
        return vec4(j * st, 1.0, 0.0, st);
    }
    if (kind < 2.5) {
        // A 45 degree line of cells, run from end to end.
        float off = floor((h1 - 0.5) * grid.x * 0.7);
        float along = flip > 0.5 ? c.x + c.y : c.x - c.y;
        float target = flip > 0.5 ? floor(grid.x * 0.5 + grid.y * 0.5) + off : floor((grid.x - grid.y) * 0.5) + off;
        if (along != target) return vec4(-1.0);
        float st = sweep * 0.7 / (grid.y - 1.0);
        return vec4((grid.y - 1.0 - c.y) * st, 1.0, 0.0, st);
    }
    if (kind < 3.5) {
        // Sparkle: a scatter of cells, each a moment apart.
        float hs = hash21(c * vec2(1.13, 2.71) + m * 17.3 + 0.5);
        float dens = 0.02 + 0.2 * sparkle * sparkle;
        if (hs >= dens) return vec4(-1.0);
        return vec4(hs / dens * sweep * 0.5, 0.55 + 0.45 * hash21(c + m), 0.0, 0.0);
    }
    // Diamond: a ring of cells opening from a cell picked by the pitch.
    float pn = clamp((midi - 24.0) / 72.0, 0.0, 1.0);
    vec2 o = floor(vec2(mix(0.2, 0.8, pn) * grid.x, mix(0.3, 0.7, h1) * grid.y));
    float d = abs(c.x - o.x) + abs(c.y - o.y);
    float reach = floor(min(grid.x, grid.y) * 0.6);
    if (d > reach) return vec4(-1.0);
    return vec4(d * sweep * 0.1, 1.0 - 0.75 * d / reach, d < 0.5 ? 1.0 : 0.0, -1.0);
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float last = IMG_NORM_PIXEL(lastHit, vec2(0.5)).r;
    bool fresh = FRAMEINDEX >= 2 && abs(n - last) > 0.5;

    // State lives in 1x1 targets, one value per channel and slot (8 slots of hits).
    // launch: 1 + seconds since the hit, 0 when empty. info: MIDI note + velocity.
    if (PASSINDEX < 2) {
        vec4 v = PASSINDEX == 0 ? IMG_NORM_PIXEL(launchA, vec2(0.5)) : IMG_NORM_PIXEL(launchB, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        vec4 alive = step(0.5, v);
        v = (v + dt) * alive;
        v *= 1.0 - step(9.0, v);
        if (fresh) {
            float slot = mod(n, 8.0) - (PASSINDEX == 0 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            v = mix(v, vec4(1.0), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX < 4) {
        vec4 v = PASSINDEX == 2 ? IMG_NORM_PIXEL(infoA, vec2(0.5)) : IMG_NORM_PIXEL(infoB, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        if (fresh) {
            float slot = mod(n, 8.0) - (PASSINDEX == 2 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            float info = floor(clamp(vxPitch, 0.0, 1.0) * 127.0 + 0.5) + 0.9 * clamp(vxVel, 0.0, 1.0);
            v = mix(v, vec4(info), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 4) {
        gl_FragColor = vec4(n, 0.0, 0.0, 1.0);
        return;
    }

    // The grid: square cells, centred, with a margin all round.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float aa = max(fw.x, fw.y);
    vec2 grid = vec2(floor(clamp(columns, 8.0, 64.0) + 0.5), floor(clamp(rows, 4.0, 36.0) + 0.5));
    float m0 = RENDERSIZE.y * MARGIN;
    float pitchPx = min((RENDERSIZE.x - 2.0 * m0) / grid.x, (RENDERSIZE.y - 2.0 * m0) / grid.y);
    vec2 origin = 0.5 * (RENDERSIZE - grid * pitchPx);
    vec2 g = (gl_FragCoord.xy - origin) / pitchPx;
    vec2 c = floor(g);
    // Rows count from the top.
    vec2 cell = vec2(c.x, grid.y - 1.0 - c.y);
    vec3 col = vec3(0.0);

    if (c.x >= 0.0 && c.y >= 0.0 && c.x < grid.x && c.y < grid.y) {
        vec2 local = (g - c - 0.5) * pitchPx;
        float r = length(local);
        float rc = pitchPx * mix(0.12, 0.34, dotSize);
        rc = max(rc, 1.5 * aa);

        float dec = mix(0.1, 1.2, decay * decay);
        float sweep = mix(0.08, 0.6, sweepTime);
        vec4 ageA = IMG_NORM_PIXEL(launchA, vec2(0.5));
        vec4 ageB = IMG_NORM_PIXEL(launchB, vec2(0.5));
        vec4 infA = IMG_NORM_PIXEL(infoA, vec2(0.5));
        vec4 infB = IMG_NORM_PIXEL(infoB, vec2(0.5));
        float light = 0.0;
        float lead = 0.0;
        for (int k = 0; k < 8; k++) {
            float m = mod(n - float(k) + 64.0, 64.0);
            float slot = mod(m, 8.0);
            vec4 pickA = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            vec4 pickB = 1.0 - step(0.5, abs(vec4(4.0, 5.0, 6.0, 7.0) - slot));
            float stored = dot(ageA, pickA) + dot(ageB, pickB);
            float info = dot(infA, pickA) + dot(infB, pickB);
            if (stored > 0.5) {
                float age = stored - 1.0;
                float midi = floor(info);
                float vel = clamp(fract(info) / 0.9, 0.0, 1.0);
                vec4 dl = cellDelay(cell, grid, m, midi, sweep);
                float since = age - dl.x;
                if (dl.x >= 0.0 && since >= 0.0) {
                    // Snaps on at full, then falls away in real time; a diamond's
                    // cells fall faster so it reads as an opening ring.
                    float dk = dl.w < -0.5 ? min(dec, 0.09) : dec;
                    float e = exp(-since / dk);
                    float b = dl.y * mix(0.5, 1.0, vel) * e * e;
                    light = max(light, b);
                    // One lead cell for the newest hit: a diamond's centre,
                    // or the head of a chase while it runs.
                    if (k == 0) {
                        lead = max(lead, dl.z * exp(-since / 0.25));
                        if (dl.w > 0.0 && since < dl.w) lead = 1.0;
                    }
                }
            }
        }

        // At rest a faint cursor walks the grid in raster order.
        float steps = vxPhase * 5.0;
        float cur = mod(floor(steps), grid.x * grid.y);
        float idx = cell.y * grid.x + cell.x;
        float behind = mod(cur - idx + grid.x * grid.y, grid.x * grid.y);
        float cursor = behind < 4.0 ? (1.0 - behind / 4.0) * 0.16 : 0.0;
        light = max(light, cursor * (1.0 - min(light * 4.0, 1.0)));

        // Off dot: a dark grey disc. Lit: a crisp core, a faint ring, a tight halo.
        float core = clamp((rc - r) / aa + 0.5, 0.0, 1.0);
        float die = clamp((rc * 0.72 - r) / aa + 0.5, 0.0, 1.0);
        float offDot = die * offLevel * 0.08;
        float lens = 0.8 + 0.2 * (1.0 - r * r / (rc * rc));
        float ringR = rc + max(pitchPx * 0.1, 2.0 * aa);
        float ring = clamp(1.0 - abs(r - ringR) / aa, 0.0, 1.0);
        float halo = exp(-max(r - rc, 0.0) / max(pitchPx * 0.09, aa));
        float lit = core * lens + ring * 0.2 + halo * 0.1 * (1.0 - core);
        float lv = light * lit;
        float ac = clamp(lead * accentCell, 0.0, 1.0) * (core + ring * 0.35 + halo * 0.1 * (1.0 - core));
        col = ink.rgb * max(lv, offDot) * (1.0 - min(ac, 1.0)) + accent.rgb * ac;
    }

    float lum = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lum);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
