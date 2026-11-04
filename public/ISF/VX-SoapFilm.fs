/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A large soap bubble hangs in the dark with two small ones drifting near it. Its skin shimmers with real thin-film colour: almost invisible black film at the crown, then bands of gold, magenta and blue draining downward, stirred into slow swirls, with crisp window reflections on its surface. A held sound stirs the swirls faster; each hit sends a wobble through the bubble and a burst of turbulent colour across its skin.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "swirl", "LABEL": "Swirl", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "wobble", "LABEL": "Hit wobble", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "thickness", "LABEL": "Film thickness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "bubbleSize", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "satellites", "LABEL": "Small bubbles", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "exposure", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Studio light", "TYPE": "color", "DEFAULT": [1.0, 0.96, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Fill light", "TYPE": "color", "DEFAULT": [0.55, 0.75, 1.0, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float PI = 3.14159265;
const int WAVES = 7;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash31(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

float gauss(float x, float m, float s) {
    float d = (x - m) / s;
    return exp(-0.5 * d * d);
}

// Rough eye response for a wavelength in nm, as linear RGB.
vec3 eyeRGB(float lam) {
    return vec3(gauss(lam, 605.0, 38.0) + 0.3 * gauss(lam, 440.0, 18.0),
                gauss(lam, 545.0, 40.0),
                gauss(lam, 455.0, 28.0));
}

// Reflectance of a soap film (index 1.33) of thickness d nm, seen at cosI,
// summed over the visible spectrum: two reflections that interfere.
vec3 filmReflect(float d, float cosI) {
    float sin2 = 1.0 - cosI * cosI;
    float cosT = sqrt(max(1.0 - sin2 / 1.769, 0.0));
    float m = 1.0 - cosI;
    float m2 = m * m;
    float F = 0.02 + 0.98 * m2 * m2 * m;
    vec3 acc = vec3(0.0);
    vec3 wsum = vec3(0.0);
    for (int k = 0; k < WAVES; k++) {
        float lam = 400.0 + float(k) * 50.0;
        float ph = 4.0 * PI * 1.33 * d * cosT / lam;
        float cd = cos(ph);
        float R = 2.0 * F * (1.0 - cd) / (1.0 + F * F - 2.0 * F * cd);
        vec3 w = eyeRGB(lam);
        acc += R * w;
        wsum += w;
    }
    return acc / wsum;
}

// The studio the bubble reflects: an overhead softbox, a crisp window with
// bars on the camera side, a tall strip light, a dark floor.
vec3 studio(vec3 d, float glow) {
    vec3 keyC = ink.rgb;
    vec3 fillC = accent.rgb;
    float up = d.y;
    vec3 c = mix(vec3(0.015), fillC * 0.18, smoothstep(-0.4, 0.2, up));
    c += keyC * 0.9 * smoothstep(0.1, 0.85, up);
    c *= smoothstep(-0.35, -0.05, up) * 0.85 + 0.15;
    // Window up and to the left, facing the bubble from the camera side.
    vec3 W = normalize(vec3(-0.55, 0.5, -0.67));
    vec3 Wu = normalize(cross(vec3(0.0, 1.0, 0.0), W));
    vec3 Wv = cross(W, Wu);
    float dw = dot(d, W);
    if (dw > 0.2) {
        vec2 q = vec2(dot(d, Wu), dot(d, Wv)) / dw;
        float e = 0.012;
        float win = smoothstep(0.3 + e, 0.3 - e, abs(q.x)) * smoothstep(0.38 + e, 0.38 - e, abs(q.y));
        float bars = smoothstep(0.012, 0.022, abs(q.x)) * smoothstep(0.012, 0.022, abs(q.y - 0.05));
        c += keyC * win * bars * 7.0 * glow;
    }
    // Tall strip light on the right.
    float az = atan(d.x, -d.z);
    float strip = smoothstep(0.1, 0.07, abs(az - 1.25)) * smoothstep(-0.3, -0.1, up) * smoothstep(0.7, 0.5, up);
    c += mix(keyC, fillC, 0.6) * strip * 3.0 * glow;
    return c;
}

// Film thickness (nm) over the bubble: drained thin at the crown, thick
// below, stirred into swirling cells.
float filmThickness(vec3 nrm, float seed, float t, float stir, float burst, vec3 hitAt, float hitAge, float hitAmp) {
    float h = (1.0 - nrm.y) * 0.5;
    float tk = mix(0.4, 1.3, thickness);
    float base = 6.0 + 1000.0 * tk * pow(h, 1.8);
    vec3 q = nrm * 1.9 + seed * 7.0;
    float a = t * 0.12 * stir;
    float ca = cos(a);
    float sa = sin(a);
    q.xz = mat2(ca, -sa, sa, ca) * q.xz;
    vec3 w = vec3(noise3(q * 1.2 + vec3(0.0, t * 0.08, 0.0)), noise3(q * 1.2 + vec3(5.2, -t * 0.07, 1.3)), noise3(q * 1.2 + vec3(2.1, 3.7, t * 0.06))) - 0.5;
    q += w * (1.2 + 0.8 * stir);
    float m = noise3(q * 1.6);
    float m2 = noise3(q * 2.8 + 9.0);
    float cells = (m - 0.5) * 2.0 * (0.4 + 0.35 * stir) + (m2 - 0.5) * (0.25 + 0.9 * burst);
    // Bands sliding down as the film drains.
    float bands = sin(h * 14.0 - t * 0.25 * stir + m * 5.0) * 0.12;
    float th = base * (1.0 + cells + bands);
    // A ring of thickness rolling out from where the hit landed.
    float dd = acos(clamp(dot(nrm, hitAt), -1.0, 1.0));
    float ring = sin((dd - hitAge * 1.8) * 18.0) * exp(-pow((dd - hitAge * 1.8) / 0.35, 2.0)) * exp(-hitAge * 1.2) * hitAmp;
    th += 260.0 * ring;
    // Keep the crown's black film clean.
    return max(th, 5.0 + 10.0 * h);
}

void main() {
    float n = floor(vxCount + 0.5);
    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        // An all-zero texel means a fresh buffer (the voice was just added):
        // start from "no hit for a long time" rather than a fake hit.
        if (c.a < 0.5) c = vec4(n, 30.0, 0.0, 1.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float vel = newHit ? clamp(vxVel, 0.4, 1.0) : c.b;
        gl_FragColor = vec4(n, age, vel, 1.0);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    bool fresh = clk.a < 0.5;
    float age = fresh ? 30.0 : clk.g;
    float hv = fresh ? 0.0 : clk.b;
    if (vxHit > 0.01) {
        age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.4 + 0.04);
        hv = max(hv, max(vxVel, 0.5));
    }
    float hitAmp = hv * wobble;
    float burst = exp(-age * 2.0) * hitAmp;

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float sc = max(1.0, 1.3 / aspect);
    p *= sc;
    float px = sc / RENDERSIZE.y;
    bool clearMode = vxClear;
    float t = vxPhase * 0.1 + TIME * 0.2;
    float energy = clamp(vxEnv, 0.0, 1.0);
    float stir = mix(0.3, 1.6, swirl) * (0.6 + 1.2 * energy);
    float glow = 0.9 + 0.3 * energy;

    // Where the hit lands on the bubble's skin.
    float ha = hash11(n * 3.1) * 6.2832;
    vec3 hitAt = normalize(vec3(cos(ha) * 0.8, 0.3 + 0.5 * hash11(n * 7.7), -0.6));

    // Background, seen through the bubbles almost unbent.
    vec3 refl = vec3(0.0);
    float trans = 1.0;
    vec2 bend = vec2(0.0);

    // Three bubbles, back to front: a small one behind, the big one, a small
    // one in front.
    for (int b = 0; b < 3; b++) {
        float fb = float(b);
        vec2 C;
        float R;
        float seed = fb * 3.7;
        if (b == 1) {
            R = mix(0.26, 0.4, bubbleSize);
            C = vec2(0.04 + 0.05 * sin(t * 0.13) + (vxGlide - 0.5) * 0.1, 0.02 + 0.03 * sin(t * 0.21));
        } else {
            float side = b == 0 ? -1.0 : 1.0;
            R = mix(0.26, 0.4, bubbleSize) * (b == 0 ? 0.24 : 0.17) * step(0.02, satellites);
            float ang = t * 0.09 * side + (b == 0 ? 2.4 : -0.6);
            C = vec2(0.04, 0.0) + vec2(cos(ang), sin(ang) * 0.6) * mix(0.42, 0.62, satellites) * (b == 0 ? 1.0 : 0.85);
            C.y += 0.03 * sin(t * 0.5 + fb);
        }
        if (R < 1e-3) continue;
        vec2 dv = p - C;
        float r = length(dv);
        if (r > R * 1.2 + 4.0 * px) continue;
        // The skin wobbles after a hit and breathes gently.
        float phi = atan(dv.y, dv.x);
        float wob = 0.006 * sin(phi * 2.0 + t * 0.7 + seed) + 0.004 * sin(phi * 3.0 - t * 0.5);
        wob += 0.03 * hitAmp * exp(-age * 2.6) * sin(age * 22.0 + fb) * sin(phi * 3.0 + ha);
        wob += 0.018 * hitAmp * exp(-age * 2.6) * cos(age * 17.0) * sin(phi * 2.0 - ha);
        float Rw = R * (1.0 + wob);
        float cov = smoothstep(Rw + px, Rw - px, r);
        if (cov <= 0.0) continue;
        vec2 xy = dv / Rw;
        float rr = min(dot(xy, xy), 1.0);
        float z = sqrt(1.0 - rr);
        float cosI = max(z, 0.02);
        vec3 nF = normalize(vec3(xy, -z));
        vec3 nB = vec3(xy, z);
        vec3 v = vec3(0.0, 0.0, 1.0);
        // Front surface.
        float thF = filmThickness(nF, seed, t, stir, burst, hitAt, age, hitAmp);
        vec3 RF = filmReflect(thF, cosI);
        vec3 eF = studio(reflect(v, nF), glow);
        // Back surface, seen through the front: the reflection is flipped.
        float thB = filmThickness(vec3(nB.x, nB.y, nB.z), seed + 1.3, t, stir, burst, hitAt, age, hitAmp);
        vec3 RB = filmReflect(thB, cosI);
        vec3 eB = studio(reflect(v, -nB), glow);
        vec3 bubbleRefl = RF * eF + RB * eB * (1.0 - RF);
        float Rav = dot(RF + RB, vec3(0.3333));
        refl = refl * (1.0 - cov * Rav) + bubbleRefl * cov;
        trans *= 1.0 - cov * Rav;
        bend += xy * z * 0.004 * cov;
    }

    float expo = mix(1.6, 5.0, exposure);
    vec3 lit = refl * expo;
    vec3 tm = lit / (1.0 + lit);
    tm = pow(tm, vec3(0.9));

    if (clearMode) {
        float a = clamp(max(max(tm.r, tm.g), tm.b), 0.0, 1.0);
        a = max(a, 1.0 - trans);
        vec3 c2 = min(tm, vec3(a));
        c2 += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * a;
        c2 = clamp(c2, 0.0, a);
        gl_FragColor = vec4(c2, a) * vxPresence;
    } else {
        // Dark backdrop with a few soft out-of-focus lights.
        vec2 q = p + bend;
        vec3 bg = mix(vec3(0.006, 0.007, 0.01), accent.rgb * 0.035 + vec3(0.004), smoothstep(-0.7, 0.6, q.y));
        bg += ink.rgb * 0.05 * exp(-length(q - vec2(-0.55, 0.32)) * 5.0);
        bg += accent.rgb * 0.035 * exp(-length(q - vec2(0.6, -0.25)) * 6.0);
        bg *= 1.0 - 0.35 * smoothstep(0.4, 1.0, length(q));
        vec3 o = bg * trans + tm;
        o += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(o, 0.0, 1.0) * vxPresence, 1.0);
    }
}
