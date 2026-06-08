/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated circuit board with data flow",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "gridScale", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 10.0},
        {"NAME": "flowSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "nodeGlow", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.1, "DEFAULT": 0.03},
        {"NAME": "colorMode", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
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

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime * flowSpeed;
    vec2 grid = uv * gridScale;
    vec2 gridId = floor(grid);
    vec2 gridUv = fract(grid);

    float col = 0.0;

    // Horizontal lines
    float hLine = step(0.5 - lineWidth, gridUv.y) * step(gridUv.y, 0.5 + lineWidth);
    float hDir = step(0.5, hash(gridId));
    float hFlow = fract(gridUv.x * hDir - t + hash(gridId) * 10.0);
    col += hLine * smoothstep(0.0, 0.3, hFlow) * smoothstep(1.0, 0.7, hFlow);

    // Vertical lines
    float vLine = step(0.5 - lineWidth, gridUv.x) * step(gridUv.x, 0.5 + lineWidth);
    float vDir = step(0.5, hash(gridId + 100.0));
    float vFlow = fract(gridUv.y * vDir - t + hash(gridId + 50.0) * 10.0);
    col += vLine * smoothstep(0.0, 0.3, vFlow) * smoothstep(1.0, 0.7, vFlow);

    // Nodes at intersections
    float nodeDist = length(gridUv - 0.5);
    float node = smoothstep(0.1, 0.0, nodeDist);
    float nodePulse = sin(t * 3.0 + hash(gridId) * 6.28) * 0.5 + 0.5;
    col += node * nodePulse * nodeGlow;

    // Coloring
    float hue = mix(0.5, hash(gridId) * 0.3 + 0.4, colorMode);
    vec3 color = hsv2rgb(vec3(hue, 0.8, col));

    // Background glow
    color += vec3(0.0, 0.1, 0.15) * (1.0 - col) * 0.5;

    fragColor = vec4(color, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
