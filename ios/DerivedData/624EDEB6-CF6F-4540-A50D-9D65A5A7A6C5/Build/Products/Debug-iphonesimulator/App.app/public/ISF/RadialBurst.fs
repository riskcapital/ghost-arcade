/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Radial light burst with rays",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "rayCount", "TYPE": "float", "MIN": 4.0, "MAX": 64.0, "DEFAULT": 16.0},
        {"NAME": "rotSpeed", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.3},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "rayWidth", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.5},
        {"NAME": "centerGlow", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define TAU 6.28318530718

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float t = iTime * rotSpeed;
    float pulse = sin(iTime * pulseSpeed * TAU) * 0.5 + 0.5;

    float rays = rayCount;
    float rayAngle = mod(a + t, TAU / rays) / (TAU / rays);
    float ray = smoothstep(0.5 - rayWidth * 0.5, 0.5, rayAngle) *
                (1.0 - smoothstep(0.5, 0.5 + rayWidth * 0.5, rayAngle));

    float falloff = 1.0 / (1.0 + r * 3.0);
    float intensity = ray * falloff;

    float hue = fract(a / TAU + iTime * 0.1);
    vec3 col = hsv2rgb(vec3(hue, 0.7, intensity));

    // Center glow
    float glow = exp(-r * 5.0) * centerGlow * (0.5 + pulse * 0.5);
    col += vec3(1.0, 0.9, 0.8) * glow;

    // Outer ring pulse
    float ring = smoothstep(0.02, 0.0, abs(r - 0.3 - pulse * 0.2));
    col += hsv2rgb(vec3(hue + 0.3, 0.8, ring * 0.5));

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
