/*{
    "DESCRIPTION": "Tendril — a raymarched 3D bundle of glossy chrome tendrils. Kaleidoscopically-folded coiling tubes, twisted by height and churned by a domain warp, bounded in a sphere so the form floats in black space. Iridescent thin-film material with specular + fresnel rim, orbiting camera. Real depth, real tubes — endlessly writhing. Heavy (raymarched ~90 steps): made for a GPU.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Psychedelic"],
    "INPUTS": [
        { "NAME": "symmetry",    "TYPE": "float", "DEFAULT": 6.0,  "MIN": 1.0,   "MAX": 16.0, "LABEL": "Mirror Symmetry" },
        { "NAME": "twist",       "TYPE": "float", "DEFAULT": 0.80, "MIN": -3.0,  "MAX": 3.0,  "LABEL": "Coil Twist" },
        { "NAME": "flow",        "TYPE": "float", "DEFAULT": 0.30, "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Flow Speed" },
        { "NAME": "warp",        "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0,   "MAX": 0.60, "LABEL": "Warp Amount" },
        { "NAME": "warpFreq",    "TYPE": "float", "DEFAULT": 1.5,  "MIN": 0.30,  "MAX": 4.0,  "LABEL": "Warp Frequency" },
        { "NAME": "warpEvolve",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Warp Evolve" },
        { "NAME": "coilRadius",  "TYPE": "float", "DEFAULT": 0.70, "MIN": 0.10,  "MAX": 1.5,  "LABEL": "Coil Radius" },
        { "NAME": "coilAmp",     "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0,   "MAX": 0.80, "LABEL": "Coil Bulge" },
        { "NAME": "coilFreq",    "TYPE": "float", "DEFAULT": 1.5,  "MIN": 0.0,   "MAX": 5.0,  "LABEL": "Coil Frequency" },
        { "NAME": "tubeRadius",  "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.02,  "MAX": 0.40, "LABEL": "Tube Radius" },
        { "NAME": "boundRadius", "TYPE": "float", "DEFAULT": 1.6,  "MIN": 0.50,  "MAX": 3.0,  "LABEL": "Bound Radius" },
        { "NAME": "camDist",     "TYPE": "float", "DEFAULT": 3.2,  "MIN": 1.5,   "MAX": 6.0,  "LABEL": "Camera Distance" },
        { "NAME": "fov",         "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Field of View" },
        { "NAME": "orbitSpeed",  "TYPE": "float", "DEFAULT": 0.15, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Orbit Speed" },
        { "NAME": "camTilt",     "TYPE": "float", "DEFAULT": 0.20, "MIN": -1.5,  "MAX": 1.5,  "LABEL": "Camera Tilt" },
        { "NAME": "iridescence", "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Iridescence" },
        { "NAME": "hueByHeight", "TYPE": "float", "DEFAULT": 0.40, "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Hue by Height" },
        { "NAME": "hueByRadius", "TYPE": "float", "DEFAULT": 0.30, "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Hue by Depth" },
        { "NAME": "hueSpread",   "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.30,  "MAX": 3.0,  "LABEL": "Hue Spread" },
        { "NAME": "hueShift",    "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Hue Shift" },
        { "NAME": "hueDrift",    "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0,   "MAX": 0.50, "LABEL": "Hue Drift" },
        { "NAME": "specular",    "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Specular" },
        { "NAME": "specPower",   "TYPE": "float", "DEFAULT": 32.0, "MIN": 2.0,   "MAX": 96.0, "LABEL": "Gloss Sharpness" },
        { "NAME": "fresnelStr",  "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Fresnel Rim" },
        { "NAME": "fog",         "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0,   "MAX": 0.60, "LABEL": "Depth Fade" },
        { "NAME": "saturation",  "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",    "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",       "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "grain",       "TYPE": "float", "DEFAULT": 0.025,"MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define MARCH 90
#define FAR 12.0

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 pal(float t) {
    vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(hueSpread);
    vec3 d = vec3(0.0, 0.33, 0.67) + hueShift;
    return a + b * cos(TAU * (c * t + d));
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// SDF: kaleidoscopically-folded bundle of coiling tubes, bounded by a sphere.
float map(vec3 p) {
    // Global coil: twist the cross-section by height + time.
    p.xz *= rot(p.y * twist + TIME * flow);

    // Organic domain warp (kept gentle; raymarch steps are under-relaxed).
    p += warp * sin(p.yzx * warpFreq + TIME * warpEvolve);

    // Kaleidoscope fold around the Y axis -> mirrored radial wedges.
    float r = length(p.xz);
    float a = atan(p.z, p.x);
    float seg = TAU / max(symmetry, 1.0);
    a = abs(mod(a, seg) - 0.5 * seg);
    vec2 fp = vec2(cos(a), sin(a)) * r;

    // Tube centreline radius bulges with height -> coiling tendrils.
    float cR = coilRadius + coilAmp * sin(p.y * coilFreq + TIME * flow * 0.7);

    // Distance to a tube running along Y at (cR, 0) in the folded frame.
    float dTube = length(fp - vec2(cR, 0.0)) - tubeRadius;

    // Bound everything inside a sphere so the form floats in black space.
    float dBound = length(p) - boundRadius;

    return max(dTube, dBound);
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0016, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

void main() {
    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    // Camera: orbit + tilt around the bundle.
    vec3 ro = vec3(0.0, 0.0, -camDist);
    vec3 rd = normalize(vec3(uv, fov));
    float yaw = TIME * orbitSpeed;
    ro.xz *= rot(yaw); rd.xz *= rot(yaw);
    ro.yz *= rot(camTilt); rd.yz *= rot(camTilt);

    // March.
    float t = 0.0;
    float d = 0.0;
    bool hit = false;
    vec3 pos = ro;
    for (int i = 0; i < MARCH; i++) {
        pos = ro + rd * t;
        d = map(pos);
        if (d < 0.0009 * (1.0 + t * 0.5)) { hit = true; break; }
        if (t > FAR) break;
        t += d * 0.85;                      // under-relax for warp stability
    }

    vec3 col = vec3(0.0);

    if (hit) {
        vec3 n = calcNormal(pos);
        vec3 v = -rd;
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);

        // Two lights.
        vec3 l1 = normalize(vec3(0.7, 0.85, -0.55));
        vec3 l2 = normalize(vec3(-0.5, 0.3, -0.8));
        float diff = max(dot(n, l1), 0.0) + 0.4 * max(dot(n, l2), 0.0);
        float spec = pow(max(dot(reflect(-l1, n), v), 0.0), specPower) * specular;

        // Iridescent thin-film: hue from fresnel + view angle + position.
        float irPhase = fres * iridescence * 3.0
                      + dot(n, v) * iridescence
                      + pos.y * hueByHeight
                      + length(pos) * hueByRadius
                      + TIME * hueDrift;
        vec3 base = pal(irPhase);

        col = base * (0.12 + 0.9 * diff);
        col += spec * mix(vec3(1.0), pal(irPhase + 0.25), 0.6);
        col += fres * fresnelStr * pal(irPhase + 0.4);

        // Fade into the black with depth.
        col *= exp(-t * fog);
    } else {
        // Faint central halo so the void isn't dead flat.
        float halo = exp(-length(uv) * 2.2) * 0.05;
        col += halo * pal(TIME * hueDrift + 0.5);
    }

    // Saturation.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);

    // Contrast / filmic rolloff / gamma.
    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.6);
    col = pow(col, vec3(gamma));

    // Grain.
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
