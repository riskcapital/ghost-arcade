/*{
    "DESCRIPTION": "Chrysalis — a floating orb of semi-translucent glass whose interior is an infinite gyroid labyrinth (a triply-periodic minimal surface). Rendered with the same see-through glass machinery as Dispersion: the ray marches THROUGH the glass, shading every shell crossing front-to-back with chromatic dispersion + spectral rims, so you gaze endlessly into the churning lattice inside. The lattice rotates and flows independently of the fixed orb. Outputs alpha (transparent background + translucent body) so it composites over the layers beneath. Heavy (transparent raymarch): made for a GPU.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Glass"],
    "INPUTS": [
        { "NAME": "gScale",       "TYPE": "float", "DEFAULT": 3.0,  "MIN": 1.0,   "MAX": 8.0,  "LABEL": "Lattice Density" },
        { "NAME": "thickness",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.05,  "MAX": 1.5,  "LABEL": "Shell Thickness" },
        { "NAME": "radius",       "TYPE": "float", "DEFAULT": 1.5,  "MIN": 0.60,  "MAX": 2.5,  "LABEL": "Orb Radius" },
        { "NAME": "flow",         "TYPE": "float", "DEFAULT": 0.25, "MIN": -2.0,  "MAX": 2.0,  "LABEL": "Lattice Flow" },
        { "NAME": "spinXZ",       "TYPE": "float", "DEFAULT": 0.10, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Lattice Spin XZ" },
        { "NAME": "spinXY",       "TYPE": "float", "DEFAULT": 0.07, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Lattice Spin XY" },
        { "NAME": "warp",         "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0,   "MAX": 0.50, "LABEL": "Warp Amount" },
        { "NAME": "camDist",      "TYPE": "float", "DEFAULT": 4.0,  "MIN": 2.0,   "MAX": 8.0,  "LABEL": "Camera Distance" },
        { "NAME": "fov",          "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Field of View" },
        { "NAME": "orbitSpeed",   "TYPE": "float", "DEFAULT": 0.08, "MIN": -1.0,  "MAX": 1.0,  "LABEL": "Orbit Speed" },
        { "NAME": "camTilt",      "TYPE": "float", "DEFAULT": 0.25, "MIN": -1.5,  "MAX": 1.5,  "LABEL": "Camera Tilt" },
        { "NAME": "ior",          "TYPE": "float", "DEFAULT": 1.45, "MIN": 1.0,   "MAX": 2.0,  "LABEL": "Index of Refraction" },
        { "NAME": "dispersion",   "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0,   "MAX": 0.30, "LABEL": "Dispersion" },
        { "NAME": "absorb",       "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Glass Density" },
        { "NAME": "absorbHue",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Glass Tint" },
        { "NAME": "keyHue",       "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Key Light Hue" },
        { "NAME": "fillHue",      "TYPE": "float", "DEFAULT": 0.58, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Fill Light Hue" },
        { "NAME": "lightYaw",     "TYPE": "float", "DEFAULT": 0.0,  "MIN": -3.14, "MAX": 3.14, "LABEL": "Light Rotate" },
        { "NAME": "envBase",      "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Ambient Softbox" },
        { "NAME": "envInt",       "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Light Intensity" },
        { "NAME": "envSharp",     "TYPE": "float", "DEFAULT": 4.0,  "MIN": 1.0,   "MAX": 40.0, "LABEL": "Light Sharpness" },
        { "NAME": "specular",     "TYPE": "float", "DEFAULT": 1.40, "MIN": 0.0,   "MAX": 3.0,  "LABEL": "Specular" },
        { "NAME": "specPower",    "TYPE": "float", "DEFAULT": 70.0, "MIN": 8.0,   "MAX": 200.0,"LABEL": "Gloss Sharpness" },
        { "NAME": "fresnelPower", "TYPE": "float", "DEFAULT": 3.5,  "MIN": 1.0,   "MAX": 6.0,  "LABEL": "Fresnel Power" },
        { "NAME": "rimGlow",      "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.0,   "MAX": 1.5,  "LABEL": "Spectral Rim" },
        { "NAME": "bodyOpacity",  "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Glass Body Opacity" },
        { "NAME": "opacity",      "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 1.0,  "LABEL": "Master Opacity" },
        { "NAME": "saturation",   "TYPE": "float", "DEFAULT": 1.15, "MIN": 0.0,   "MAX": 2.0,  "LABEL": "Saturation" },
        { "NAME": "contrast",     "TYPE": "float", "DEFAULT": 1.15, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Contrast" },
        { "NAME": "gamma",        "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.50,  "MAX": 2.0,  "LABEL": "Gamma" },
        { "NAME": "grain",        "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0,   "MAX": 0.30, "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define MARCH 150
#define MAXLAYERS 22
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

// A gyroid shell carved into a sphere: an orb full of infinite labyrinth.
// The lattice rotates / flows in its own frame; the orb (sphere bound)
// stays put, so the maze churns inside a fixed glass ball.
float map(vec3 p) {
    vec3 q = p;
    q.xz *= rot(TIME * spinXZ);
    q.xy *= rot(TIME * spinXY);
    q += warp * sin(q.yzx * 1.7 + TIME * 0.4);

    vec3 g3 = q * gScale + vec3(TIME * flow);
    float g = sin(g3.x) * cos(g3.y) + sin(g3.y) * cos(g3.z) + sin(g3.z) * cos(g3.x);
    float shell = abs(g) - thickness;
    float de = shell / (gScale * 2.2);          // conservative distance estimate

    float sphere = length(p) - radius;
    return max(de, sphere);
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.0018, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

vec3 envLight(vec3 d) {
    vec2 ky = vec2(0.6, -0.6) * rot(lightYaw);
    vec3 keyDir  = normalize(vec3(ky.x, 0.5, ky.y));
    vec2 fy = vec2(-0.7, -0.4) * rot(lightYaw);
    vec3 fillDir = normalize(vec3(fy.x, 0.2, fy.y));

    vec3 keyCol  = mix(vec3(1.0), hue2rgb(keyHue), 0.6);
    vec3 fillCol = mix(vec3(1.0), hue2rgb(fillHue), 0.6);

    float up = d.y * 0.5 + 0.5;
    vec3 lo = mix(hue2rgb(keyHue), vec3(1.0), 0.55) * 0.6;
    vec3 hi = mix(hue2rgb(fillHue), vec3(1.0), 0.45) * 0.9;
    vec3 c = mix(lo, hi, smoothstep(0.0, 1.0, up)) * envBase;

    c += keyCol  * pow(max(dot(d, keyDir),  0.0), envSharp) * envInt;
    c += fillCol * pow(max(dot(d, fillDir), 0.0), envSharp) * envInt * 0.7;
    return c;
}

vec3 shadeSurface(vec3 pos, vec3 n, vec3 rd, out float fresO) {
    vec3 v = -rd;
    float ndv = max(dot(n, v), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, fresnelPower);
    fresO = fres;

    vec3 reflDir = reflect(rd, n);
    vec3 reflCol = envLight(reflDir);

    float eta = 1.0 / ior;
    vec3 rR = refract(rd, n, eta * (1.0 + dispersion));
    vec3 rG = refract(rd, n, eta);
    vec3 rB = refract(rd, n, eta * (1.0 - dispersion));
    vec3 refrCol = vec3(envLight(rR).r, envLight(rG).g, envLight(rB).b);
    vec3 tint = mix(vec3(1.0), hue2rgb(absorbHue), clamp(absorb * 0.3, 0.0, 1.0));
    refrCol *= tint;

    vec3 c = mix(refrCol, reflCol, fres);

    vec2 ky = vec2(0.6, -0.6) * rot(lightYaw);
    vec3 keyDir = normalize(vec3(ky.x, 0.5, ky.y));
    c += pow(max(dot(reflDir, keyDir), 0.0), specPower) * specular * mix(vec3(1.0), hue2rgb(keyHue), 0.3);
    c += fres * rimGlow * (0.5 + 0.5 * cos(TAU * (ndv * 1.5 + vec3(0.0, 0.33, 0.67))));
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

    // Transparent sphere-trace through the labyrinth: composite every shell
    // crossing front-to-back so the depths of the maze read through the glass.
    vec4 acc = vec4(0.0);
    float t = 0.02;
    float pd = map(ro + rd * t);
    int layers = 0;

    for (int i = 0; i < MARCH; i++) {
        t += max(abs(pd) * 0.6, 0.010);
        if (t > FAR) break;
        vec3 pos = ro + rd * t;
        float d = map(pos);

        if ((d < 0.0) != (pd < 0.0)) {
            vec3 n = calcNormal(pos);
            if (dot(n, rd) > 0.0) n = -n;
            float fres;
            vec3 sc = shadeSurface(pos, n, rd, fres);
            float a = clamp(mix(bodyOpacity, 1.0, fres), 0.0, 1.0);
            acc.rgb += (1.0 - acc.a) * a * sc;
            acc.a   += (1.0 - acc.a) * a;
            layers++;
            if (acc.a > 0.985 || layers >= MAXLAYERS) break;
        }
        pd = d;
    }

    vec3 col = acc.rgb / max(acc.a, 1e-3);

    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);

    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.7);
    col = pow(col, vec3(gamma));

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;
    col = clamp(col, 0.0, 1.0);

    gl_FragColor = vec4(col, clamp(acc.a * opacity, 0.0, 1.0));
}
