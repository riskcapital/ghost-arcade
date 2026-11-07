/*{
    "DESCRIPTION": "Pulse — a translucent glass bell organism floating in dark void, beating to your music. NATIVELY AUDIO-REACTIVE: bass contracts the bell, mids glow its internal radial organs through the see-through glass walls, treble sparkles the dispersion edges and triggers spectral flicker. Frequency bands are smoothed by averaging many FFT bins, on top of the host's temporal smoothing — so it pulses musically, not jerkily. With no audio plugged in it still renders beautifully as a static glass jellyfish — audio just brings it alive.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Audio Reactive", "Glass"],
    "INPUTS": [
        { "NAME": "audioGain",    "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Audio Sensitivity" },
        { "NAME": "bassReact",    "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass → Pulse" },
        { "NAME": "midReact",     "TYPE": "float", "DEFAULT": 1.6,  "MIN": 0.0,   "MAX": 4.0,  "LABEL": "Mid → Organ Glow" },
        { "NAME": "trebReact",    "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Treble → Sparkle" },
        { "NAME": "bassLo",       "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Lo" },
        { "NAME": "bassHi",       "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bass Band Hi" },
        { "NAME": "midLo",        "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Lo" },
        { "NAME": "midHi",        "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Mid Band Hi" },
        { "NAME": "trebLo",       "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Lo" },
        { "NAME": "trebHi",       "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Treble Band Hi" },
        { "NAME": "bellWidth",    "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.3,   "MAX": 2.0,  "LABEL": "Bell Width" },
        { "NAME": "bellHeight",   "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.3,   "MAX": 2.0,  "LABEL": "Bell Height" },
        { "NAME": "bellSquash",   "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Bottom Squash" },
        { "NAME": "organCount",   "TYPE": "float", "DEFAULT": 5.0,  "MIN": 2.0,   "MAX": 12.0, "LABEL": "Organ Veins" },
        { "NAME": "organSharp",   "TYPE": "float", "DEFAULT": 6.0,  "MIN": 1.0,   "MAX": 30.0, "LABEL": "Vein Sharpness" },
        { "NAME": "organHueA",    "TYPE": "float", "DEFAULT": 0.92, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Organ Hue A" },
        { "NAME": "organHueB",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Organ Hue B" },
        { "NAME": "organSpeed",   "TYPE": "float", "DEFAULT": 1.6,  "MIN": 0.0,   "MAX": 6.0,  "LABEL": "Organ Pulse Speed" },
        { "NAME": "camDist",      "TYPE": "float", "DEFAULT": 3.6,  "MIN": 1.5,   "MAX": 8.0,  "LABEL": "Camera Distance" },
        { "NAME": "fov",          "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Field of View" },
        { "NAME": "orbitSpeed",   "TYPE": "float", "DEFAULT": 0.12, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Orbit Speed" },
        { "NAME": "camTilt",      "TYPE": "float", "DEFAULT": 0.20, "MIN": -1.5,  "MAX": 1.5,  "LABEL": "Camera Tilt" },
        { "NAME": "ior",          "TYPE": "float", "DEFAULT": 1.45, "MIN": 1.0,   "MAX": 2.0,  "LABEL": "Index of Refraction" },
        { "NAME": "dispersion",   "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0,   "MAX": 0.40, "LABEL": "Dispersion" },
        { "NAME": "glassTint",    "TYPE": "float", "DEFAULT": 0.58, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Glass Tint" },
        { "NAME": "rimGlow",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Spectral Rim" },
        { "NAME": "specular",     "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Specular" },
        { "NAME": "bodyOpacity",  "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Glass Body Opacity" },
        { "NAME": "envBase",      "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Ambient" },
        { "NAME": "envKey",       "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Key Light Hue" },
        { "NAME": "envFill",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Fill Light Hue" },
        { "NAME": "saturation",   "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",     "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",        "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "grain",        "TYPE": "float", "DEFAULT": 0.025,"MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define MARCH 120
#define BAND_BINS 14
#define FAR 12.0

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 hue2rgb(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// ── audio band: spatially average many FFT bins so the response is smooth,
// not jagged. The host already temporally smooths the FFT; this layers
// extra freq-domain smoothing on top so it never feels jerky. Multiplied
// by a master gain so the user has one knob for sensitivity.
float audioBand(float lo, float hi) {
    float sum = 0.0;
    for (int i = 0; i < BAND_BINS; i++) {
        float u = mix(lo, hi, (float(i) + 0.5) / float(BAND_BINS));
        sum += sampleFFT(u);
    }
    return (sum / float(BAND_BINS)) * audioGain;
}

// ── Bell SDF: an ellipsoid squashed flat at the bottom. The whole thing
// pulses (radius modulates) with bass.
float bellSDF(vec3 p, float bass) {
    float scale = 1.0 + bassReact * bass;
    // squash bottom -> teardrop bell
    float yMod = p.y + bellSquash * 0.4 * (p.y * p.y - 0.3);
    vec3 q = vec3(p.x, yMod, p.z) / vec3(bellWidth, bellHeight, bellWidth);
    // approx ellipsoid SDF (under-relaxed factor for safe marching)
    return (length(q) - scale) * min(bellWidth, bellHeight) * 0.5;
}

vec3 calcNormal(vec3 p, float bass) {
    vec2 e = vec2(0.0018, 0.0);
    return normalize(vec3(
        bellSDF(p + e.xyy, bass) - bellSDF(p - e.xyy, bass),
        bellSDF(p + e.yxy, bass) - bellSDF(p - e.yxy, bass),
        bellSDF(p + e.yyx, bass) - bellSDF(p - e.yyx, bass)
    ));
}

// ── Internal organ emission: radial veins from the central axis, peaked
// near the centre, gently breathing on its own and BLOOMING with mids.
vec3 organEmission(vec3 p, float mid) {
    float r2D = length(p.xz);
    float ang = atan(p.z, p.x);
    float vein = pow(max(sin(ang * organCount + TIME * 0.3), 0.0), organSharp);
    float vert = clamp(1.0 - p.y * p.y * 2.0, 0.0, 1.0);
    float radial = exp(-r2D * r2D * 3.5);
    float pulse = 0.6 + 0.4 * sin(TIME * organSpeed);
    vec3 col = mix(hue2rgb(organHueA), hue2rgb(organHueB),
                   0.5 + 0.5 * sin(p.y * 4.0 + TIME * organSpeed * 0.7));
    float strength = radial * vein * vert * pulse;
    return col * strength * (0.4 + midReact * mid);
}

// ── Studio softbox env (re-used pattern).
vec3 envLight(vec3 d) {
    vec3 keyDir  = normalize(vec3(0.6, 0.5, -0.6));
    vec3 fillDir = normalize(vec3(-0.7, 0.2, -0.4));
    vec3 keyCol  = mix(vec3(1.0), hue2rgb(envKey),  0.6);
    vec3 fillCol = mix(vec3(1.0), hue2rgb(envFill), 0.6);
    float up = d.y * 0.5 + 0.5;
    vec3 lo = mix(hue2rgb(envKey),  vec3(1.0), 0.55) * 0.6;
    vec3 hi = mix(hue2rgb(envFill), vec3(1.0), 0.45) * 0.9;
    vec3 c = mix(lo, hi, smoothstep(0.0, 1.0, up)) * envBase;
    c += keyCol  * pow(max(dot(d, keyDir),  0.0), 6.0) * 1.0;
    c += fillCol * pow(max(dot(d, fillDir), 0.0), 6.0) * 0.7;
    return c;
}

// ── Glass shading on the bell wall, with treble boosting dispersion & rim.
vec3 shadeGlass(vec3 p, vec3 n, vec3 rd, float treb, out float fresO) {
    vec3 v = -rd;
    float ndv = max(dot(n, v), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 3.5);
    fresO = fres;

    float dispActual = dispersion * (1.0 + trebReact * treb * 0.7);
    float rimActual  = rimGlow    * (1.0 + trebReact * treb * 0.6);

    vec3 reflDir = reflect(rd, n);
    vec3 reflCol = envLight(reflDir);
    float eta = 1.0 / ior;
    vec3 rR = refract(rd, n, eta * (1.0 + dispActual));
    vec3 rG = refract(rd, n, eta);
    vec3 rB = refract(rd, n, eta * (1.0 - dispActual));
    vec3 refrCol = vec3(envLight(rR).r, envLight(rG).g, envLight(rB).b);
    vec3 tint = mix(vec3(1.0), hue2rgb(glassTint), 0.45);
    refrCol *= tint;

    vec3 c = mix(refrCol, reflCol, fres);
    vec3 keyDir = normalize(vec3(0.6, 0.5, -0.6));
    c += pow(max(dot(reflDir, keyDir), 0.0), 70.0) * specular
       * mix(vec3(1.0), hue2rgb(envKey), 0.3);
    c += fres * rimActual * (0.5 + 0.5 * cos(TAU * (ndv * 1.5 + vec3(0.0, 0.33, 0.67))));
    return c;
}

void main() {
    // Audio bands — sampled once per pixel; computed band averages so the
    // values are spatially smoothed. The host smooths in time.
    float bass = audioBand(bassLo, bassHi);
    float mid  = audioBand(midLo,  midHi);
    float treb = audioBand(trebLo, trebHi);

    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    // Camera orbits the bell. Pitch carries a tiny bass bob.
    vec3 ro = vec3(0.0, 0.0, -camDist);
    vec3 rd = normalize(vec3(uv, fov));
    float yaw = TIME * orbitSpeed;
    ro.xz *= rot(yaw); rd.xz *= rot(yaw);
    float pitch = camTilt + bass * bassReact * 0.04;
    ro.yz *= rot(pitch); rd.yz *= rot(pitch);

    // Transparent sphere-trace: at every step accumulate the interior organ
    // emission (only when inside the bell), and at every sign crossing shade
    // the glass wall front-to-back. Treble lifts dispersion & rim.
    vec4 acc = vec4(0.0);
    float t = 0.02;
    float pd = bellSDF(ro + rd * t, bass);
    float stepSize;

    for (int i = 0; i < MARCH; i++) {
        stepSize = max(abs(pd) * 0.7, 0.013);
        t += stepSize;
        if (t > FAR) break;
        vec3 p = ro + rd * t;
        float d = bellSDF(p, bass);

        // Inside the bell? Add organ emission (volumetric).
        if (d < 0.0) {
            vec3 e = organEmission(p, mid) * stepSize;
            acc.rgb += (1.0 - acc.a) * e;
            // emission gives a soft halo of opacity so distant background
            // doesn't bleed through bright spots
            float ea = clamp((e.r + e.g + e.b) * 0.12, 0.0, 1.0);
            acc.a += (1.0 - acc.a) * ea;
        }

        // Surface crossing -> shade glass.
        if ((d < 0.0) != (pd < 0.0)) {
            vec3 n = calcNormal(p, bass);
            if (dot(n, rd) > 0.0) n = -n;
            float fres;
            vec3 sc = shadeGlass(p, n, rd, treb, fres);
            float a = clamp(mix(bodyOpacity, 1.0, fres), 0.0, 1.0);
            acc.rgb += (1.0 - acc.a) * a * sc;
            acc.a   += (1.0 - acc.a) * a;
            if (acc.a > 0.985) break;
        }
        pd = d;
    }

    // Straight-alpha output (transparent void background).
    vec3 col = acc.rgb / max(acc.a, 1e-3);

    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);
    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.6);
    col = pow(col, vec3(gamma));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(col, clamp(acc.a, 0.0, 1.0));
}
