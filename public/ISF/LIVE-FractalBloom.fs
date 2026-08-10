/*{
    "DESCRIPTION": "Kaleidoscopic fractal flower that blooms on the beat. Kali-fold iteration inside a polar mirror — psychedelic mandala for peak moments.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "petals",   "TYPE": "float", "DEFAULT": 7.0,  "MIN": 3.0, "MAX": 16.0},
        {"NAME": "zoom",     "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.4, "MAX": 2.5},
        {"NAME": "twist",    "TYPE": "float", "DEFAULT": 0.3,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "hueSpeed", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "bloomAmt", "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float bass = max(audioBass, 0.3 + 0.15 * sin(TIME * 0.41));
    float beat = audioBeat;
    float beatPhase = audioBeatPhase;
    float centroid = max(audioSpectralCentroid, 0.5);

    // Beat bloom: a fast-attack, slow-release pulse from the beat phase.
    float pulse = exp(-beatPhase * 4.0) * bloomAmt + beat * 0.3 * bloomAmt;

    // Polar kaleidoscope fold.
    float k = floor(petals + 0.5);
    float ang = atan(uv.y, uv.x);
    float rad = length(uv);
    float sector = 6.2831853 / k;
    ang = mod(ang, sector);
    ang = abs(ang - sector * 0.5);
    ang += TIME * twist * 0.15;

    vec2 p = vec2(cos(ang), sin(ang)) * rad;
    p *= (1.55 - pulse * 0.35) / zoom;
    p += vec2(0.12 * sin(TIME * 0.21), 0.1 * cos(TIME * 0.17));

    // Kali fold: iterate abs/r2 inversion, harvest orbit traps.
    float trapCircle = 1e5;
    float trapLine = 1e5;
    float mag = 0.0;
    vec2 c = vec2(0.78 + 0.1 * sin(TIME * 0.11), 0.62 + 0.08 * cos(TIME * 0.13));
    for (int i = 0; i < 9; i++) {
        p = abs(p) / max(dot(p, p), 0.001) - c;
        float r = length(p);
        trapCircle = min(trapCircle, abs(r - 0.35 - bass * 0.12));
        trapLine = min(trapLine, abs(p.y));
        mag += r;
    }
    mag /= 9.0;

    // Palette rides the traps; hue orbits slowly and leans on the centroid.
    float hue = TIME * hueSpeed + centroid * 0.15;
    vec3 c1 = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
    vec3 c2 = 0.5 + 0.5 * cos(6.2831 * (hue + 0.42 + vec3(0.0, 0.33, 0.67)));

    // Jewel lines on black: tight traps, high saturation, most of the
    // frame stays dark so the mandala's filaments burn.
    vec3 col = vec3(0.0);
    col += c1 * exp(-trapCircle * 22.0) * (1.5 + pulse * 2.2);
    col += c2 * exp(-trapLine * 30.0) * 1.2;
    col += (c1 * 0.6 + c2 * 0.4) * exp(-mag * 2.6) * 0.5;
    // Saturate: pull toward the pure hue, away from pastel washout.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, 1.45);
    col = max(col, 0.0);

    // Center bloom on the beat; edge vignette keeps the mandala framed.
    col += c1 * exp(-rad * 5.0) * pulse * 1.8;
    col *= 1.0 - smoothstep(0.62, 1.15, rad) * 0.92;

    col = col / (col + 0.8);
    col = pow(col, vec3(0.85));
    col += (fract(sin(dot(gl_FragCoord.xy + fract(TIME), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
}
