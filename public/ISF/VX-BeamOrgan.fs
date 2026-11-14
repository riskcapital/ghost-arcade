/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Four beams of light fanned down through haze from a lamp above the frame, each landing in its own pool on a dark floor. Every note of the chord takes a beam: the note's place in the octave aims it and the beam glides there when the chord changes, so harmony reads as beams crossing. Louder playing thickens the haze, each hit sends a soft surge through it, and with no sound the fan rests dim and sways slowly. With a transparent background only the light is drawn.",
    "PASSES": [
        {
            "TARGET": "beams",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 32,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "haze", "LABEL": "Haze", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "sway", "LABEL": "Sway", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "pool", "LABEL": "Floor", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "First beam", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.38, 1.0] },
        { "NAME": "accent", "LABEL": "Second beam", "TYPE": "color", "DEFAULT": [1.0, 0.42, 0.2, 1.0] },
        { "NAME": "palLight", "LABEL": "Third beam", "TYPE": "color", "DEFAULT": [1.0, 0.9, 0.74, 1.0] },
        { "NAME": "palBody", "LABEL": "Fourth beam", "TYPE": "color", "DEFAULT": [0.95, 0.55, 0.5, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The lamp hangs above the frame; the floor's far edge is this far below centre.
const vec2 LAMP = vec2(0.0, 0.74);
const float FLOOR_Y = -0.3;
// How dim a beam with no note rests.
const float REST = 0.22;

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

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm3(vec2 x) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        v += amp * noise2(x);
        x = mat2(1.6, 1.2, -1.2, 1.6) * x + 1.7;
        amp *= 0.5;
    }
    return v;
}

float noteAt(float i) {
    if (i < 0.5) return vxNote0;
    if (i < 1.5) return vxNote1;
    if (i < 2.5) return vxNote2;
    return vxNote3;
}

float energyAt(float i) {
    if (i < 0.5) return vxNoteE0;
    if (i < 1.5) return vxNoteE1;
    if (i < 2.5) return vxNoteE2;
    return vxNoteE3;
}

vec3 beamColor(float i) {
    if (i < 0.5) return ink.rgb;
    if (i < 1.5) return accent.rgb;
    if (i < 2.5) return palLight.rgb;
    return palBody.rgb;
}

void main() {
    if (PASSINDEX == 0) {
        // One slot (eight texels wide) per beam: where it aims (0-1 across the floor) and how
        // bright it is. Both ease, so a chord change is beams gliding and fading, never a cut.
        float i = clamp(floor(gl_FragCoord.x / 8.0), 0.0, 3.0);
        vec4 prev = IMG_NORM_PIXEL(beams, vec2((i + 0.5) / 4.0, 0.5));
        float anyNote = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
        float e = energyAt(i);
        // A sounding note aims its beam by its place in the octave; without one the fan rests evenly.
        float restAim = 0.5 + (i - 1.5) * 0.21;
        float aim = e > 0.02 ? 0.1 + 0.8 * fract(noteAt(i) * 127.0 / 12.0 + 0.5) : restAim;
        // A sound with no pitches (drums) lights the whole fan with its level.
        float bright = anyNote > 0.02 ? max(e, REST * 0.6) : REST + 0.6 * clamp(vxEnv, 0.0, 1.0);
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        float a = mix(prev.x, aim, 1.0 - exp(-dt / 0.3));
        float b = prev.y + (bright - prev.y) * (1.0 - exp(-dt / (bright > prev.y ? 0.06 : 0.7)));
        // The first frame (nothing stored yet) starts on target.
        if (FRAMEINDEX < 2 || prev.a < 0.5) {
            a = aim;
            b = bright;
        }
        gl_FragColor = vec4(a, b, 0.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);

    // Haze: slow drifting density the beams light up; a hit sends a surge through it.
    float drift = vxFlow;
    float cloud = fbm3(vec2(p.x * 1.5 + drift * 0.05, p.y * 2.1 - drift * 0.035));
    float dens = (0.3 + 0.7 * clamp(haze, 0.0, 1.0)) * (0.55 + 0.9 * cloud) * (1.0 + 0.6 * clamp(vxPulse, 0.0, 1.0));
    float onFloor = smoothstep(FLOOR_Y + 0.012, FLOOR_Y - 0.02, p.y);

    vec3 col = vec3(0.0);
    vec3 lampCol = vec3(0.0);
    for (int k = 0; k < 4; k++) {
        float fi = float(k);
        vec4 st = IMG_NORM_PIXEL(beams, vec2((fi + 0.5) / 4.0, 0.5));
        float aim = st.x * 2.0 - 1.0 + sway * 0.07 * sin(TIME * (0.17 + 0.05 * fi) + fi * 1.9);
        float e = st.y;
        // Nearer beams land lower on the floor.
        float near = hash11(fi * 3.7 + 1.0);
        vec2 land = vec2(aim * 0.44 * asp, FLOOR_Y - 0.03 - 0.1 * near);
        vec2 dir = normalize(land - LAMP);
        float reach = length(land - LAMP);
        vec2 v = p - LAMP;
        float along = dot(v, dir);
        float off = length(v - dir * along);
        // A cone: it widens as it falls, a soft body round a hot core.
        float w = 0.01 + max(along, 0.0) * (0.022 + 0.06 * spread);
        float body = exp(-off * off / (w * w));
        float core = exp(-off * off / (w * w * 0.07));
        float fall = 1.0 / (0.32 + max(along, 0.0) * 1.4);
        float inAir = smoothstep(0.0, 0.1, along) * (1.0 - smoothstep(reach - 0.03, reach + 0.02, along));
        vec3 c = beamColor(fi);
        vec3 hot = mix(c, vec3(1.0), 0.55);
        col += (c * body * 0.5 + hot * core * 0.45) * fall * dens * inAir * e;

        // Its pool on the floor: a wide soft ellipse with a brighter centre.
        float wl = 0.01 + reach * (0.022 + 0.06 * spread);
        vec2 q = (p - land) / vec2(wl * 3.0, wl * 0.85);
        float d2 = dot(q, q);
        col += (c * exp(-d2) * 0.55 + hot * exp(-d2 * 3.5) * 0.5) * onFloor * pool * e;
        lampCol += hot * e;
    }
    // The lamp itself is out of frame; its glow spills in at the top.
    vec2 lv = p - LAMP;
    col += lampCol * exp(-dot(lv, lv) / 0.045) * 0.3 * dens;

    // Tone map on luminance so bright haze keeps its colour, then a little dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.5));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Light is only as solid as it is bright, so over a picture it adds rather than covers.
        outa = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
