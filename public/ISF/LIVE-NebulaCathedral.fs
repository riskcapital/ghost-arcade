/*{
    "DESCRIPTION": "Volumetric raymarched nebula with god rays and starfield. Bass surges the cloud density, spectral centroid steers the palette, beats flare the stars.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "density",     "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.2, "MAX": 2.0},
        {"NAME": "drift",       "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "hueShift",    "TYPE": "float", "DEFAULT": 0.0,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "starDensity", "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "rayStrength", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.02 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return v;
}

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    // Audio with idle fallbacks — the sky breathes on its own without input.
    float bass = max(audioBass, 0.25 + 0.12 * sin(TIME * 0.31));
    float centroid = max(audioSpectralCentroid, 0.45 + 0.2 * sin(TIME * 0.11));
    float beat = audioBeat;

    float t = TIME * drift;

    // Camera: slow forward drift with a gentle sway.
    vec3 ro = vec3(sin(t * 0.24) * 0.6, cos(t * 0.17) * 0.35, t);
    vec3 rd = normalize(vec3(uv, 1.1));
    float sway = sin(t * 0.13) * 0.18;
    rd.xz = mat2(cos(sway), -sin(sway), sin(sway), cos(sway)) * rd.xz;

    // Palette: deep space blues to magenta cathedral light, centroid-steered.
    float hue = hueShift + centroid * 0.22;
    // Deep indigo shadow body and a warm rose-gold key light. The hue knob
    // and centroid rotate both together so they always stay in harmony.
    vec3 deepCol = mix(vec3(0.04, 0.07, 0.22), vec3(0.15, 0.05, 0.28), fract(hue));
    vec3 coreCol = mix(vec3(1.0, 0.55, 0.35), vec3(0.9, 0.4, 0.85), fract(hue + 0.15));
    vec3 lightDir = normalize(vec3(0.35, 0.75, -0.2));

    // Volumetric march.
    vec3 acc = vec3(0.0);
    float trans = 1.0;
    float dstep = 0.22;
    float boost = density * (0.8 + bass * 0.7);
    for (int i = 0; i < 26; i++) {
        float z = 0.4 + float(i) * dstep;
        vec3 p = ro + rd * z;
        float d = fbm(p * 0.6);
        // Carve cathedral vaults: hollow out a winding corridor. The sharper
        // remap gives billowing edges instead of uniform haze.
        float corridor = length(p.xy - vec2(sin(p.z * 0.4) * 0.5, cos(p.z * 0.3) * 0.3));
        float patch = noise(p * 0.18 + 7.3);
        d = smoothstep(0.58, 0.88, d + corridor * 0.04 + patch * 0.18) * 0.85;
        d *= boost;
        if (d > 0.001) {
            // Cheap directional shading: sample density toward the light.
            float dl = fbm((p + lightDir * 0.35) * 0.6);
            float shade = clamp((0.52 - dl) * 2.6, 0.0, 1.0);
            shade = shade * shade;
            vec3 col = mix(deepCol * 1.4, coreCol, shade);
            float aStep = clamp(d * dstep * 1.3, 0.0, 1.0);
            acc += col * aStep * trans * (0.35 + shade);
            trans *= 1.0 - aStep * 0.85;
            if (trans < 0.02) break;
        }
    }

    // God rays: radial streaks from the light's screen position.
    vec2 lightScreen = vec2(0.28, 0.34);
    vec2 toLight = uv - lightScreen;
    float ray = 0.0;
    float ang = atan(toLight.y, toLight.x);
    ray += pow(0.5 + 0.5 * sin(ang * 7.0 + t * 0.5), 14.0) * 0.5;
    ray += pow(0.5 + 0.5 * sin(ang * 3.0 - t * 0.3), 10.0) * 0.35;
    ray *= exp(-length(toLight) * 2.1) * rayStrength * (0.6 + bass * 0.6);
    // The light source itself: a soft burning core behind the clouds.
    ray += exp(-length(toLight) * 5.5) * (0.9 + bass * 0.8) * rayStrength;
    acc += coreCol * ray * trans;

    // Starfield behind everything — beats flare the brightest stars.
    vec2 sp = uv * 22.0;
    vec2 cell = floor(sp);
    float star = hash21(cell);
    if (star > 1.0 - starDensity * 0.12) {
        vec2 o = vec2(hash21(cell + 3.1), hash21(cell + 7.7));
        float d = length(fract(sp) - o);
        float tw = 0.5 + 0.5 * sin(TIME * (2.0 + star * 6.0) + star * 40.0);
        float flare = 1.0 + beat * 2.5 * step(0.995, star);
        acc += vec3(0.9, 0.95, 1.0) * smoothstep(0.08, 0.0, d) * tw * trans * 0.7 * flare;
    }

    // Filmic-ish tone map + gamma + dither against banding.
    vec3 col = acc;
    col = col / (col + 0.85);
    col = pow(col, vec3(0.8));
    col += (hash21(gl_FragCoord.xy + fract(TIME)) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
}
