/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Flowing volumetric clouds",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "cloudSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "cloudDensity", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "cloudScale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 3.0},
        {"NAME": "turbulence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, int octaves) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));

    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        v += a * noise(p);
        p = rot * p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime * cloudSpeed;
    vec2 p = uv * cloudScale;

    // Layered cloud noise
    float q = fbm(p + t, 4);
    float r = fbm(p + q * turbulence + t * 0.5, 4);
    float f = fbm(p + r * turbulence * 2.0, 6);

    // Cloud density
    f = smoothstep(1.0 - cloudDensity, 1.0, f + 0.3);

    // Lighting - simulate sun from above
    float light = smoothstep(0.2, 0.8, f + uv.y * 0.3);

    // Cloud color
    vec3 skyColor = vec3(0.1, 0.15, 0.3);
    vec3 cloudColor = vec3(0.9, 0.92, 0.95) * brightness;
    vec3 shadowColor = vec3(0.4, 0.45, 0.6);

    vec3 col = mix(skyColor, mix(shadowColor, cloudColor, light), f);

    // Add subtle pink/orange tint for sunset feel
    col += vec3(0.1, 0.05, 0.0) * (1.0 - uv.y) * f * 0.5;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
