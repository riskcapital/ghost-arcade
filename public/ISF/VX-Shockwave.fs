/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A slowly turning globe drawn in thousands of fine points, laid out in rings like a scan, with a smaller counter-turning core inside. Each hit blasts a shell of points off the surface that races outward and fades, while the globe flinches and springs back; fast hits stack several shells at once. The sound's level swells the globe, and the note's pitch moves a bright ring of points up and down it.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "burst", "LABEL": "Burst", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "swell", "LABEL": "Swell", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "density", "LABEL": "Points", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "pointSize", "LABEL": "Point size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "core", "LABEL": "Core", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Globe", "TYPE": "color", "DEFAULT": [0.85, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Shockwaves", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.15, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float PI = 3.14159265;
const float TAU = 6.2831853;
// Camera distance and focal length: a radius of 1 frame height at the centre fills the frame.
const float CAMD = 3.2;
const float FOC = 3.2;
const float R0 = 0.33;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

mat3 rotXY(float ax, float ay) {
    float cx = cos(ax);
    float sx = sin(ax);
    float cy = cos(ay);
    float sy = sin(ay);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
    mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
    return ry * rx;
}

vec2 project(vec3 w) {
    return w.xy * FOC / (CAMD - w.z);
}

// Point i of row j on the unit sphere: rows of latitude, each with points spread evenly round it.
vec3 latticePoint(float j, float i, float nRows, float nInRow, float seed, float jit) {
    float lat = (j + 0.5) * PI / nRows;
    float h1 = hash11(j * 7.31 + i * 1.97 + seed);
    float h2 = hash11(j * 3.17 + i * 5.13 + seed * 1.7);
    lat += (h1 - 0.5) * jit * PI / nRows;
    float lon = (i + hash11(j * 1.37 + seed) + (h2 - 0.5) * jit) * TAU / nInRow;
    float sl = sin(lat);
    return vec3(sl * cos(lon), cos(lat), sl * sin(lon));
}

// Dots of one point shell, both where the ray enters it and where it leaves.
// rot turns object space into view space; band is a latitude (0 top, 1 bottom) that glows.
void shellDots(vec2 p, vec3 rd, float R, mat3 rot, float nRows, float seed, float jit, vec3 col, float glow,
               float sizePx, float px, float band, vec3 bandCol, inout float alpha, inout vec3 light, inout float shadow) {
    vec3 ro = vec3(0.0, 0.0, CAMD);
    // A slightly fatter sphere, so dots on the rim are not clipped.
    float Rm = R + 6.0 * px * CAMD / FOC;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - Rm * Rm;
    float h = b * b - c;
    if (h < 0.0) return;
    h = sqrt(h);
    mat3 inv = transpose(rot);
    for (int side = 0; side < 2; side++) {
        float t = side == 0 ? -b - h : -b + h;
        vec3 q = normalize(inv * (ro + rd * t));
        float lat = acos(clamp(q.y, -1.0, 1.0));
        float lon = atan(q.z, q.x);
        float jr = floor(lat / PI * nRows);
        for (int dj = -1; dj <= 1; dj++) {
            float j = jr + float(dj);
            if (j < 0.0 || j > nRows - 1.0) continue;
            float latj = (j + 0.5) * PI / nRows;
            float nIn = max(3.0, floor(2.0 * nRows * sin(latj) + 0.5));
            float fi = fract(lon / TAU + 1.0) * nIn - hash11(j * 1.37 + seed);
            float i0 = floor(fi);
            for (int di = 0; di < 2; di++) {
                float i = mod(i0 + float(di), nIn);
                vec3 u = latticePoint(j, i, nRows, nIn, seed, jit);
                vec3 w = rot * (u * R);
                vec2 sp = project(w);
                float d = length(sp - p) / px;
                // Depth of field: the far side is out of focus, larger and dimmer.
                float blur = clamp((-w.z) / R, 0.0, 1.0);
                float near = clamp(0.5 + 0.5 * w.z / R, 0.0, 1.0);
                float rad = sizePx * (1.0 + 0.9 * blur) * (FOC / (CAMD - w.z)) / (FOC / CAMD) * (vxClear ? mix(1.3, 2.1, near) : 1.0);
                float soft = 0.55 + 1.4 * blur;
                float cov = clamp((rad - d) / soft + 0.5, 0.0, 1.0);
                shadow = max(shadow, clamp((rad + 1.3 - d) / 0.9, 0.0, 1.0) * glow * mix(0.3, 1.0, near));
                if (cov > 0.0) {
                    float op = cov * mix(vxClear ? 0.35 : 0.22, 1.0, near);
                    float bnd = 0.0;
                    float tw = 1.0;
                    if (band >= 0.0) {
                        float lt = j / nRows;
                        // The pitch ring, plus slow bands of light turning down the globe.
                        float sweep = pow(0.5 + 0.5 * sin(lt * TAU * 2.5 - TIME * 0.9), 10.0);
                        bnd = max(exp(-pow((lt - band) / 0.035, 2.0)), 0.55 * sweep);
                        // Shimmer.
                        tw = 0.8 + 0.4 * sin(TIME * 2.3 + hash11(j * 3.7 + i * 11.3) * 40.0);
                    }
                    float lum = op * glow * tw * (1.0 + 1.3 * bnd) * (vxClear ? 1.6 : 1.35);
                    // Dim points are see-through as well as dark.
                    alpha = alpha + min(vxClear ? max(lum, op) : lum, op) * (1.0 - alpha);
                    light += mix(col, bandCol, bnd) * lum;
                }
            }
        }
    }
}

void main() {
    float n = floor(vxCount + 0.5);

    // clock (1x1): last count seen, then seconds since each of the last three hits.
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 30.0, 30.0);
        vec3 ages = min(c.gba + dt, vec3(30.0));
        if (abs(n - c.r) > 0.5) ages = vec3(0.0, ages.x, ages.y);
        gl_FragColor = vec4(n, ages);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    vec3 ages = FRAMEINDEX < 2 ? vec3(30.0) : clk.gba;
    if (vxHit > 0.01) ages.x = min(ages.x, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
    if (n < 0.5 && vxHit < 0.01) ages = vec3(30.0);

    vec2 res = RENDERSIZE;
    float px = 1.0 / res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) * px;
    vec3 rd = normalize(vec3(p, -FOC));

    float env = clamp(vxEnv, 0.0, 1.0);
    float tclk = TIME * 0.06 + vxPhase * 0.015;
    float spinA = tclk * mix(0.5, 4.0, spin);
    float nRows = floor(mix(46.0, 110.0, density));
    float sizePx = mix(0.9, 2.6, pointSize) * res.y / 1080.0;
    float band = 0.15 + 0.7 * (1.0 - clamp(vxGlide, 0.0, 1.0));

    // The globe flinches on a hit and springs back.
    float a0 = ages.x;
    float flinch = burst * exp(-a0 * 5.0) * cos(a0 * 16.0) * 0.12;
    float R = R0 * (1.0 + swell * 0.22 * env - flinch);

    float alpha = 0.0;
    float shadow = 0.0;
    vec3 light = vec3(0.0);

    mat3 rot = rotXY(0.42 + 0.1 * sin(tclk * 0.7), spinA);
    float gain = 1.35 + 0.5 * env + 0.25 * clamp(vxEnergy, 0.0, 1.0);
    // Shockwave shells: each one a fresh scatter of points racing outward.
    for (int s = 0; s < 3; s++) {
        float age = s == 0 ? ages.x : (s == 1 ? ages.y : ages.z);
        float fade = exp(-age * 1.5) * (1.0 - exp(-age * 40.0 - 0.2));
        if (fade < 0.02 || burst < 0.01) continue;
        float hid = n - float(s);
        float Rs = R * (1.0 + (1.0 - exp(-age * 2.4)) * mix(0.6, 2.6, burst));
        mat3 srot = rotXY(hash11(hid * 3.1) * PI, hash11(hid * 5.7) * TAU + spinA * 0.5);
        vec3 sc = mix(accent.rgb, vec3(1.0), 0.5 * exp(-age * 6.0));
        float sRows = floor(nRows * 0.8);
        shellDots(p, rd, Rs, srot, sRows, hid * 1.31 + 7.0, min(0.35 + age * 0.6, 0.85), sc, fade * 1.5,
                  sizePx * (1.0 + 0.4 * fade), px, -1.0, sc, alpha, light, shadow);
        // The shell's edge: points pile up where it is seen side-on.
        float rs = Rs * FOC / sqrt(CAMD * CAMD - Rs * Rs);
        float e = (length(p) - rs) / (0.006 + 0.02 * age);
        float ringA = exp(-e * e) * fade * 0.5;
        alpha = alpha + ringA * (1.0 - alpha);
        light += sc * ringA;
    }
    shellDots(p, rd, R, rot, nRows, 1.0, 0.08, ink.rgb, gain * (1.0 - 0.5 * exp(-a0 * 6.0) * burst), sizePx, px, band, accent.rgb, alpha, light, shadow);
    if (core > 0.01) {
        mat3 crot = rotXY(-0.9, -spinA * 1.6 + 1.0);
        // The core breathes slowly, and jumps on a hit.
        float breath = 0.5 + 0.5 * sin(TIME * 1.1 + vxPhase * 0.05);
        float Rc = R * mix(0.3, 0.6, core) * (1.0 + 0.1 * breath + 0.25 * exp(-a0 * 4.0) * burst);
        vec3 cc = mix(ink.rgb, accent.rgb, 0.55);
        shellDots(p, rd, Rc, crot, floor(nRows * 0.5), 3.0, 0.3, cc, gain * (0.7 + 0.5 * breath), sizePx * 0.9, px, -1.0, cc, alpha, light, shadow);
    }

    if (!vxClear) light = min(light, vec3(1.0));
    alpha = clamp(alpha, 0.0, 1.0);
    vec4 outC;
    if (vxClear) {
        // Keep the hue at full strength: scale over-bright light down rather than clipping it to white,
        // and let a thin dark rim round each point lift it off a bright picture.
        float mx = max(max(light.r, light.g), max(light.b, 1e-4));
        // Points stay bright: dimmer ones fade out rather than going dark.
        float lev = clamp(mx / max(alpha, 1e-4), 0.0, 1.0);
        float aPt = alpha * smoothstep(0.0, 0.45, lev);
        vec3 rgb = light / mx * aPt * mix(0.8, 1.0, lev);
        float aOut = aPt + shadow * 0.32 * (1.0 - aPt);
        outC = vec4(rgb, aOut);
    } else {
        float r = length(p);
        vec3 bg = mix(vec3(0.025, 0.027, 0.035), vec3(0.0), smoothstep(0.1, 0.95, r));
        bg += mix(ink.rgb, accent.rgb, 0.4) * 0.05 * exp(-r * r / 0.12) * (1.0 + env);
        outC = vec4(bg * (1.0 - alpha) + light, 1.0);
    }
    gl_FragColor = outC * vxPresence;
}
