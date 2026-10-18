/*{
    "DESCRIPTION": "Dispersion — a raymarched knot of molten glass ribbons (smooth-blended tori) shaded as semi-translucent dispersive glass: fresnel mix of reflection and refraction, per-channel chromatic dispersion for spectral rainbow edges, sharp specular hotspots from a procedural studio environment, all on black. Slowly turning and morphing. Heavy (raymarched): made for a GPU.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Glass"],
    "INPUTS": [
        { "NAME": "loops",        "TYPE": "float", "DEFAULT": 4.0,  "MIN": 2.0,   "MAX": 4.0,  "LABEL": "Ribbon Count" },
        { "NAME": "ringR",        "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.40,  "MAX": 1.5,  "LABEL": "Ring Radius" },
        { "NAME": "tubeR",        "TYPE": "float", "DEFAULT": 0.24, "MIN": 0.05,  "MAX": 0.50, "LABEL": "Tube Radius" },
        { "NAME": "smoothK",      "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.05,  "MAX": 1.0,  "LABEL": "Molten Blend" },
        { "NAME": "spin",         "TYPE": "float", "DEFAULT": 0.20, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Spin Speed" },
        { "NAME": "warp",         "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 0.50, "LABEL": "Warp Amount" },
        { "NAME": "warpFreq",     "TYPE": "float", "DEFAULT": 1.5,  "MIN": 0.50,  "MAX": 4.0,  "LABEL": "Warp Frequency" },
        { "NAME": "warpEvolve",   "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Warp Evolve" },
        { "NAME": "camDist",      "TYPE": "float", "DEFAULT": 4.0,  "MIN": 2.0,   "MAX": 8.0,  "LABEL": "Camera Distance" },
        { "NAME": "fov",          "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Field of View" },
        { "NAME": "orbitSpeed",   "TYPE": "float", "DEFAULT": 0.10, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Orbit Speed" },
        { "NAME": "camTilt",      "TYPE": "float", "DEFAULT": 0.20, "MIN": -1.5,  "MAX": 1.5,  "LABEL": "Camera Tilt" },
        { "NAME": "ior",          "TYPE": "float", "DEFAULT": 1.45, "MIN": 1.0,   "MAX": 2.0,  "LABEL": "Index of Refraction" },
        { "NAME": "dispersion",   "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0,   "MAX": 0.30, "LABEL": "Dispersion" },
        { "NAME": "absorb",       "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Glass Density" },
        { "NAME": "absorbHue",    "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Glass Tint" },
        { "NAME": "keyHue",       "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Key Light Hue" },
        { "NAME": "fillHue",      "TYPE": "float", "DEFAULT": 0.58, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Fill Light Hue" },
        { "NAME": "lightYaw",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": -3.14, "MAX": 3.14, "LABEL": "Light Rotate" },
        { "NAME": "envBase",      "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Ambient Softbox" },
        { "NAME": "envInt",       "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Light Intensity" },
        { "NAME": "envSharp",     "TYPE": "float", "DEFAULT": 4.0,  "MIN": 1.0,   "MAX": 40.0, "LABEL": "Light Sharpness" },
        { "NAME": "specular",     "TYPE": "float", "DEFAULT": 1.50, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Specular" },
        { "NAME": "specPower",    "TYPE": "float", "DEFAULT": 80.0, "MIN": 8.0,   "MAX": 200.0,"LABEL": "Gloss Sharpness" },
        { "NAME": "fresnelPower", "TYPE": "float", "DEFAULT": 3.5,  "MIN": 1.0,   "MAX": 6.0,  "LABEL": "Fresnel Power" },
        { "NAME": "rimGlow",      "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Spectral Rim" },
        { "NAME": "saturation",   "TYPE": "float", "DEFAULT": 1.15, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",     "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",        "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "grain",        "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define MARCH 96
#define FAR 14.0

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 hue2rgb(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdTorus(vec3 p, float R, float r) {
    vec2 q = vec2(length(p.xz) - R, p.y);
    return length(q) - r;
}

// Knot of smooth-blended tori = molten glass ribbons.
float map(vec3 p) {
    p += warp * sin(p.yzx * warpFreq + TIME * warpEvolve);
    float k = smoothK;
    float s = TIME * spin;

    vec3 a = p; a.xy *= rot(s * 0.5);        a.yz *= rot(0.7 + s * 0.3);
    float d = sdTorus(a, ringR, tubeR);

    vec3 b = p; b.xz *= rot(1.2 - s * 0.4);  b.xy *= rot(2.1);
    d = smin(d, sdTorus(b, ringR * 1.0, tubeR), k);

    vec3 c = p; c.yz *= rot(0.5 + s * 0.35); c.xz *= rot(-1.0);
    d = smin(d, sdTorus(c, ringR * 0.85, tubeR * 1.1), k);

    if (loops > 3.5) {
        vec3 e = p; e.xy *= rot(-0.8 - s * 0.25); e.yz *= rot(1.7);
        d = smin(d, sdTorus(e, ringR * 0.8, tubeR * 0.9), k);
    }
    return d;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0016, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// Procedural studio environment: a broad cool-over-warm gradient (so the
// glass body shows smooth silvery tonal reflection, not black) plus two
// sharp light lobes for the bright hotspots.
vec3 envLight(vec3 d) {
    vec2 ky = vec2(0.6, -0.6) * rot(lightYaw);
    vec3 keyDir  = normalize(vec3(ky.x, 0.5, ky.y));
    vec2 fy = vec2(-0.7, -0.4) * rot(lightYaw);
    vec3 fillDir = normalize(vec3(fy.x, 0.2, fy.y));

    vec3 keyCol  = mix(vec3(1.0), hue2rgb(keyHue), 0.6);
    vec3 fillCol = mix(vec3(1.0), hue2rgb(fillHue), 0.6);

    // Broad softbox gradient: warm low -> neutral mid -> cool high.
    float up = d.y * 0.5 + 0.5;
    vec3 lo = mix(hue2rgb(keyHue), vec3(1.0), 0.55) * 0.6;
    vec3 hi = mix(hue2rgb(fillHue), vec3(1.0), 0.45) * 0.9;
    vec3 c = mix(lo, hi, smoothstep(0.0, 1.0, up)) * envBase;

    // Sharp lobes for the hotspots.
    c += keyCol  * pow(max(dot(d, keyDir),  0.0), envSharp) * envInt;
    c += fillCol * pow(max(dot(d, fillDir), 0.0), envSharp) * envInt * 0.7;
    return c;
}

void main() {
    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    vec3 ro = vec3(0.0, 0.0, -camDist);
    vec3 rd = normalize(vec3(uv, fov));
    float yaw = TIME * orbitSpeed;
    ro.xz *= rot(yaw); rd.xz *= rot(yaw);
    ro.yz *= rot(camTilt); rd.yz *= rot(camTilt);

    float t = 0.0, d = 0.0;
    bool hit = false;
    vec3 pos = ro;
    for (int i = 0; i < MARCH; i++) {
        pos = ro + rd * t;
        d = map(pos);
        if (d < 0.0008 * (1.0 + t * 0.4)) { hit = true; break; }
        if (t > FAR) break;
        t += d * 0.9;
    }

    vec3 col = vec3(0.0);

    if (hit) {
        vec3 n = calcNormal(pos);
        vec3 v = -rd;
        float ndv = max(dot(n, v), 0.0);
        float fres = 0.04 + 0.96 * pow(1.0 - ndv, fresnelPower);

        // Reflection.
        vec3 reflDir = reflect(rd, n);
        vec3 reflCol = envLight(reflDir);

        // Refraction with per-channel dispersion (the spectral edges).
        float eta = 1.0 / ior;
        vec3 rR = refract(rd, n, eta * (1.0 + dispersion));
        vec3 rG = refract(rd, n, eta);
        vec3 rB = refract(rd, n, eta * (1.0 - dispersion));
        vec3 refrCol = vec3(envLight(rR).r, envLight(rG).g, envLight(rB).b);

        // Glass tint / density. Keep the body DARK (you see through it to
        // the black background) so it reads as clear glass, not solid
        // plastic — the brightness lives at the reflective edges + rim.
        vec3 tint = mix(vec3(1.0), hue2rgb(absorbHue), clamp(absorb * 0.3, 0.0, 1.0));
        refrCol *= tint * (0.18 + 0.32 * ndv);

        col = mix(refrCol, reflCol, fres);

        // Sharp specular hotspots straight off the environment lights.
        vec2 ky = vec2(0.6, -0.6) * rot(lightYaw);
        vec3 keyDir = normalize(vec3(ky.x, 0.5, ky.y));
        float sp = pow(max(dot(reflDir, keyDir), 0.0), specPower) * specular;
        col += sp * mix(vec3(1.0), hue2rgb(keyHue), 0.3);

        // Spectral fresnel rim — the rainbow caustic edge.
        float rb = fres * rimGlow;
        col += rb * (0.5 + 0.5 * cos(TAU * (ndv * 1.5 + vec3(0.0, 0.33, 0.67))));
    }

    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);

    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.7);
    col = pow(col, vec3(gamma));

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
