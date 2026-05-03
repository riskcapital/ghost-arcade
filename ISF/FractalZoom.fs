/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Infinite fractal zoom effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "zoomSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "complexity", "TYPE": "float", "MIN": 2.0, "MAX": 8.0, "DEFAULT": 4.0},
        {"NAME": "rotationSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "colorSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * zoomSpeed;

    // Continuous zoom
    float zoom = exp(fract(t) * log(complexity));

    // Rotation
    float angle = iTime * rotationSpeed;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    uv = rot * uv;

    uv *= zoom;

    // Fractal layers
    vec3 col = vec3(0.0);
    float totalWeight = 0.0;

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float layerZoom = pow(complexity, fi - floor(t));

        if (layerZoom < 0.1 || layerZoom > complexity * 2.0) continue;

        vec2 p = uv / layerZoom;

        // Fractal pattern
        float pattern = 0.0;
        vec2 z = p * 2.0;
        for (int j = 0; j < 5; j++) {
            z = abs(z) / dot(z, z) - 1.0;
            pattern += exp(-length(z) * 3.0);
        }

        // Layer alpha based on zoom level
        float alpha = smoothstep(0.0, 0.3, layerZoom) * smoothstep(complexity, complexity * 0.7, layerZoom);

        float hue = fract(fi * 0.15 + iTime * colorSpeed);
        vec3 layerCol = hsv2rgb(vec3(hue, 0.7, pattern * brightness));

        col += layerCol * alpha;
        totalWeight += alpha;
    }

    col /= max(totalWeight, 1.0);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
