/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated Voronoi cells with flowing colors",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Noise"],
    "INPUTS": [
        {"NAME": "scale", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0, "LABEL": "Scale"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "edgeWidth", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.05, "LABEL": "Edge Width"},
        {"NAME": "edgeGlow", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Edge Glow"},
        {"NAME": "colorMode", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0, "LABEL": "Color Mode"},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.1, 0.0, 0.3, 1.0], "LABEL": "Color A"},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [0.0, 0.8, 0.8, 1.0], "LABEL": "Color B"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    uv *= scale;

    float t = TIME * speed;

    vec2 n = floor(uv);
    vec2 f = fract(uv);

    float minDist = 10.0;
    float secondDist = 10.0;
    vec2 closestPoint = vec2(0.0);
    vec2 closestId = vec2(0.0);

    // Find closest and second closest points
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = hash2(n + neighbor);

            // Animate points
            point = 0.5 + 0.5 * sin(t + 6.2831 * point);

            vec2 diff = neighbor + point - f;
            float d = length(diff);

            if (d < minDist) {
                secondDist = minDist;
                minDist = d;
                closestPoint = point;
                closestId = n + neighbor;
            } else if (d < secondDist) {
                secondDist = d;
            }
        }
    }

    // Edge detection
    float edge = secondDist - minDist;
    float edgeLine = smoothstep(edgeWidth, edgeWidth * 0.5, edge);

    // Cell color
    vec3 cellColor;
    if (colorMode < 1.0) {
        // Gradient based on position
        float h = fract(dot(closestId, vec2(0.1, 0.13)) + t * 0.1);
        cellColor = hsv2rgb(vec3(h, 0.7, 0.8));
    } else if (colorMode < 2.0) {
        // Two-color blend
        float blend = fract(dot(closestId, vec2(0.15, 0.17)));
        cellColor = mix(colorA.rgb, colorB.rgb, blend);
    } else {
        // Distance-based
        cellColor = mix(colorA.rgb, colorB.rgb, minDist);
    }

    // Apply edge
    vec3 color = cellColor * (1.0 - edgeLine * 0.8);
    color += vec3(1.0) * edgeLine * edgeGlow;

    gl_FragColor = vec4(color, 1.0);
}
