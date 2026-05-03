/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Tree ring growth pattern",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "ringCount", "TYPE": "float", "MIN": 5.0, "MAX": 50.0, "DEFAULT": 20.0},
        {"NAME": "growthSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "irregularity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "woodTone", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "contrast", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n = i.x + i.y * 57.0;
    return mix(mix(hash(n), hash(n + 1.0), f.x),
               mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * growthSpeed;

    // Distance from center with irregularity
    float angle = atan(uv.y, uv.x);
    float r = length(uv);

    // Add organic irregularity
    float wobble = noise(vec2(angle * 3.0 / PI + t, r * 5.0)) * irregularity * 0.1;
    wobble += noise(vec2(angle * 7.0 / PI, r * 10.0 + t)) * irregularity * 0.05;
    r += wobble;

    // Create rings
    float rings = r * ringCount;
    float ringPattern = sin(rings * PI * 2.0 - t * 10.0);

    // Vary ring thickness
    float thickness = 0.3 + noise(vec2(rings, angle * 2.0)) * 0.4;
    float ring = smoothstep(-thickness, 0.0, ringPattern) * smoothstep(thickness, 0.0, ringPattern);

    // Wood colors
    vec3 lightWood = mix(vec3(0.9, 0.75, 0.55), vec3(0.85, 0.65, 0.45), woodTone);
    vec3 darkWood = mix(vec3(0.6, 0.45, 0.3), vec3(0.5, 0.35, 0.2), woodTone);

    // Vary colors slightly per ring
    float ringId = floor(rings);
    float colorVar = hash(ringId) * 0.2;
    lightWood *= 1.0 - colorVar;
    darkWood *= 1.0 + colorVar * 0.5;

    vec3 col = mix(lightWood, darkWood, ring * contrast);

    // Add grain
    float grain = noise(uv * 100.0) * 0.1;
    col *= 1.0 - grain;

    // Radial grain lines
    float grainLines = sin(angle * 50.0 + noise(uv * 20.0) * 5.0);
    grainLines = smoothstep(0.8, 1.0, grainLines) * 0.1;
    col *= 1.0 - grainLines;

    // Center darkening (heartwood)
    col *= 0.7 + smoothstep(0.0, 0.3, r) * 0.3;

    // Edge darkening
    col *= 1.0 - smoothstep(0.4, 0.5, r) * 0.3;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
