/*{
    "DESCRIPTION": "Aurora — a still-lake panorama with rippling volumetric aurora curtains drifting overhead and mirrored in the water. No surfaces at all: pure volumetric emission marching through a sparse atmospheric medium, sheets of light shaped by undulating curves in space, breathing and twisting with time. Multiple curtain bands in dispersive colours, a starfield through the gaps, soft horizon glow, and the whole sky reflected in the rippling lake. A world with no walls.",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Volumetric", "Landscape"],
    "INPUTS": [
        { "NAME": "curtainCount",  "TYPE": "float", "DEFAULT": 3.0,  "MIN": 1.0,   "MAX": 4.0,   "LABEL": "Curtain Count" },
        { "NAME": "amp1",          "TYPE": "float", "DEFAULT": 3.5,  "MIN": 0.0,   "MAX": 8.0,   "LABEL": "Wave A Amplitude" },
        { "NAME": "freq1",         "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.05,  "MAX": 1.0,   "LABEL": "Wave A Frequency" },
        { "NAME": "amp2",          "TYPE": "float", "DEFAULT": 1.8,  "MIN": 0.0,   "MAX": 5.0,   "LABEL": "Wave B Amplitude" },
        { "NAME": "freq2",         "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.05,  "MAX": 2.0,   "LABEL": "Wave B Frequency" },
        { "NAME": "curtainSharp",  "TYPE": "float", "DEFAULT": 1.2,  "MIN": 0.2,   "MAX": 6.0,   "LABEL": "Curtain Crispness" },
        { "NAME": "curtainHeight", "TYPE": "float", "DEFAULT": 7.0,  "MIN": 2.0,   "MAX": 18.0,  "LABEL": "Curtain Height" },
        { "NAME": "curtainBase",   "TYPE": "float", "DEFAULT": 1.5,  "MIN": 0.2,   "MAX": 6.0,   "LABEL": "Curtain Base" },
        { "NAME": "driftSpeed",    "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.0,   "MAX": 2.5,   "LABEL": "Drift Speed" },
        { "NAME": "pulseAmt",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Pulse Amount" },
        { "NAME": "pulseSpeed",    "TYPE": "float", "DEFAULT": 0.80, "MIN": 0.0,   "MAX": 3.0,   "LABEL": "Pulse Speed" },
        { "NAME": "lookUp",        "TYPE": "float", "DEFAULT": 0.30, "MIN": -0.20, "MAX": 1.0,   "LABEL": "Camera Up Tilt" },
        { "NAME": "fov",           "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.50,  "MAX": 2.5,   "LABEL": "Field of View" },
        { "NAME": "yaw",           "TYPE": "float", "DEFAULT": 0.0,  "MIN": -3.14, "MAX": 3.14,  "LABEL": "Camera Yaw" },
        { "NAME": "swayAmt",       "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Camera Sway" },
        { "NAME": "lowHue",        "TYPE": "float", "DEFAULT": 0.36, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Low Band Hue" },
        { "NAME": "midHue",        "TYPE": "float", "DEFAULT": 0.52, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Mid Band Hue" },
        { "NAME": "highHue",       "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "High Band Hue" },
        { "NAME": "intensity",     "TYPE": "float", "DEFAULT": 1.30, "MIN": 0.1,   "MAX": 3.0,   "LABEL": "Aurora Brightness" },
        { "NAME": "edgeChroma",    "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Spectral Edges" },
        { "NAME": "zenithHue",     "TYPE": "float", "DEFAULT": 0.66, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Zenith Hue" },
        { "NAME": "horizonHue",    "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Horizon Hue" },
        { "NAME": "skyDim",        "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.0,   "MAX": 0.40,  "LABEL": "Sky Brightness" },
        { "NAME": "starsDensity",  "TYPE": "float", "DEFAULT": 0.995,"MIN": 0.95,  "MAX": 0.9995,"LABEL": "Stars Density" },
        { "NAME": "starsBright",   "TYPE": "float", "DEFAULT": 1.20, "MIN": 0.0,   "MAX": 3.0,   "LABEL": "Stars Brightness" },
        { "NAME": "lakeRefl",      "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.0,   "MAX": 1.0,   "LABEL": "Lake Reflectivity" },
        { "NAME": "rippleAmt",     "TYPE": "float", "DEFAULT": 0.020,"MIN": 0.0,   "MAX": 0.20,  "LABEL": "Lake Ripple" },
        { "NAME": "rippleFreq",    "TYPE": "float", "DEFAULT": 3.0,  "MIN": 0.5,   "MAX": 12.0,  "LABEL": "Ripple Frequency" },
        { "NAME": "shoreFade",     "TYPE": "float", "DEFAULT": 1.5,  "MIN": 0.3,   "MAX": 4.0,   "LABEL": "Lake Falloff" },
        { "NAME": "saturation",    "TYPE": "float", "DEFAULT": 1.25, "MIN": 0.0,   "MAX": 2.0,   "LABEL": "Saturation" },
        { "NAME": "contrast",      "TYPE": "float", "DEFAULT": 1.10, "MIN": 0.50,  "MAX": 2.0,   "LABEL": "Contrast" },
        { "NAME": "gamma",         "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.50,  "MAX": 2.0,   "LABEL": "Gamma" },
        { "NAME": "grain",         "TYPE": "float", "DEFAULT": 0.025,"MIN": 0.0,   "MAX": 0.30,  "LABEL": "Film Grain" }
    ]
}*/

precision highp float;

#define PI  3.14159265359
#define TAU 6.28318530718
#define STEPS 96
#define FAR 40.0

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 hue2rgb(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

// The curve a curtain follows in the (z) plane at a given time + index offset.
float curveX(float z, float t, float idx) {
    return amp1 * sin(z * freq1 + t * 0.5 + idx * 1.9)
         + amp2 * sin(z * freq2 + t * 0.3 + idx * 0.7);
}

// Emission contribution at point p from all curtains. Volumetric "density"
// shaped like vertical sheets that follow the wandering curve in xz.
vec3 emission(vec3 p) {
    vec3 e = vec3(0.0);
    float t = TIME * driftSpeed;

    float h = clamp((p.y - curtainBase) / max(curtainHeight, 0.01), 0.0, 1.0);
    // vertical profile — soft bottom, longer top decay (classic aurora shape)
    float vert = smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.55, 1.0, h));
    if (vert < 0.001) return e;

    // colour gradient along altitude: low -> mid -> high
    vec3 col = mix(hue2rgb(lowHue), hue2rgb(midHue), smoothstep(0.0, 0.5, h));
    col      = mix(col, hue2rgb(highHue),                 smoothstep(0.55, 1.0, h));

    // pulse multiplier
    float pulse = 1.0 + pulseAmt * sin(p.z * 0.15 + TIME * pulseSpeed);

    for (int i = 0; i < 4; i++) {
        if (float(i) >= curtainCount) break;
        float idx = float(i);
        float zOff = idx * 3.7;
        float xOff = (idx - (curtainCount - 1.0) * 0.5) * 1.8;
        float cx = curveX(p.z + zOff, t, idx) + xOff;
        float d  = p.x - cx;

        // core curtain density — a soft Gaussian band
        float band = exp(-d * d * curtainSharp);
        if (band < 0.005) continue;

        // a slight chromatic split on the band edges -> spectral fringes
        float dr = d + edgeChroma * 0.4;
        float dg = d;
        float db = d - edgeChroma * 0.4;
        vec3 chroma = vec3(exp(-dr * dr * curtainSharp),
                           exp(-dg * dg * curtainSharp),
                           exp(-db * db * curtainSharp));

        e += col * chroma * vert * pulse * intensity * 0.7;
    }
    return e;
}

vec3 sky(vec3 rd) {
    float up = clamp(rd.y, 0.0, 1.0);
    vec3 hor = mix(vec3(0.02), hue2rgb(horizonHue), 0.6) * skyDim * 0.8;
    vec3 zen = mix(vec3(0.005), hue2rgb(zenithHue), 0.6) * skyDim;
    return mix(hor, zen, smoothstep(0.0, 0.5, up));
}

vec3 stars(vec3 rd) {
    if (rd.y < 0.0) return vec3(0.0);
    // crude projected starfield: hash on a stretched direction
    vec2 sc = rd.xz * 60.0 / max(rd.y * 0.6 + 0.4, 0.1);
    vec2 id = floor(sc);
    float h = hash21(id);
    float bright = smoothstep(starsDensity, starsDensity + 0.004, h);
    // a hint of twinkle
    float tw = 0.6 + 0.4 * sin(TIME * 2.0 + h * 30.0);
    return vec3(bright) * starsBright * tw;
}

// March a ray through the medium and return accumulated emission + the
// stars/sky bleeding through whatever transmittance is left.
vec3 marchSky(vec3 ro, vec3 rd) {
    vec3 acc = vec3(0.0);
    vec3 trans = vec3(1.0);
    float stepSize = 0.40;
    float t = 0.1;

    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * t;
        // only march where the curtains live (between base and base+height)
        if (p.y > curtainBase - 0.5 && p.y < curtainBase + curtainHeight + 0.5) {
            vec3 e = emission(p);
            float dens = max(max(e.r, e.g), e.b) * 0.5;
            vec3 stepT = exp(-vec3(dens) * stepSize);
            acc += trans * e * stepSize;
            trans *= stepT;
        }
        t += stepSize;
        if (t > FAR) break;
        if (trans.r + trans.g + trans.b < 0.05) break;
    }

    // background through whatever's left
    acc += trans * (sky(rd) + stars(rd));
    return acc;
}

void main() {
    vec2 R = RENDERSIZE;
    vec2 uv = (gl_FragCoord.xy - 0.5 * R) / min(R.x, R.y);

    // camera at water level, looking up + forward
    vec3 ro = vec3(0.0, 0.05, 0.0);
    vec2 sway = vec2(sin(TIME * 0.13), cos(TIME * 0.17)) * swayAmt * 0.05;
    vec3 rd = normalize(vec3(uv.x + sway.x, uv.y + lookUp + sway.y, 1.0 / max(fov, 0.05)));
    rd.xz *= rot(yaw);

    vec3 col;

    if (rd.y >= 0.0) {
        // sky pass
        col = marchSky(ro, rd);
    } else {
        // lake reflection: flip the ray about the water plane, add ripple,
        // march the same sky from below, dim by reflectivity + shore fade.
        vec3 rrd = vec3(rd.x, -rd.y, rd.z);
        // ripple perturbation — a couple of detuned sines fake wind chop
        float rp = rippleAmt * (
              sin(rd.z * rippleFreq        + TIME * 1.3)
            + sin(rd.x * rippleFreq * 0.7  + TIME * 0.9) * 0.7);
        rrd.x += rp;
        rrd.y += rp * 0.4;
        rrd = normalize(rrd);
        vec3 refl = marchSky(ro, rrd);
        // Fresnel-ish: water reflects strongly at the horizon (grazing) and
        // less the more steeply you look down toward your feet (where you'd
        // see the dark zenith reflected through deeper water).
        float fres = pow(clamp(1.0 + rd.y, 0.0, 1.0), shoreFade);
        col = refl * lakeRefl * fres;
    }

    // post
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);
    col = (col - 0.5) * contrast + 0.5;
    col = max(col, 0.0);
    col = 1.0 - exp(-col * 1.4);
    col = pow(col, vec3(gamma));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 131.0) - 0.5) * grain;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
