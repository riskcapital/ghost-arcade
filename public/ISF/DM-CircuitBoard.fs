/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated circuit board pattern with flowing data",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Tech"],
    "INPUTS": [
        {"NAME": "gridSize", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0, "LABEL": "Grid Size"},
        {"NAME": "flowSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Flow Speed"},
        {"NAME": "traceWidth", "TYPE": "float", "MIN": 0.1, "MAX": 0.4, "DEFAULT": 0.2, "LABEL": "Trace Width"},
        {"NAME": "nodeSize", "TYPE": "float", "MIN": 0.1, "MAX": 0.4, "DEFAULT": 0.25, "LABEL": "Node Size"},
        {"NAME": "pulseIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Pulse"},
        {"NAME": "traceColor", "TYPE": "color", "DEFAULT": [0.0, 0.6, 0.3, 1.0], "LABEL": "Trace Color"},
        {"NAME": "pulseColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Pulse Color"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.02, 0.05, 0.03, 1.0], "LABEL": "Background"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * flowSpeed;

    vec2 grid = uv * gridSize;
    vec2 gid = floor(grid);
    vec2 gf = fract(grid);

    vec3 col = bgColor.rgb;

    // Node at each grid intersection
    float nodeRnd = hash(gid);

    // Horizontal trace
    float hTrace = step(0.5 - traceWidth * 0.5, gf.y) * step(gf.y, 0.5 + traceWidth * 0.5);
    // Vertical trace
    float vTrace = step(0.5 - traceWidth * 0.5, gf.x) * step(gf.x, 0.5 + traceWidth * 0.5);

    // Randomly enable traces based on grid position
    float hasH = step(0.3, hash(gid + vec2(0.0, 100.0)));
    float hasV = step(0.3, hash(gid + vec2(100.0, 0.0)));

    float trace = hTrace * hasH + vTrace * hasV;
    trace = min(trace, 1.0);

    col = mix(col, traceColor.rgb * 0.5, trace);

    // Node circles at intersections
    float nodeDist = length(gf - 0.5);
    float node = smoothstep(nodeSize * 0.5, nodeSize * 0.3, nodeDist);

    // Only show node if there's a trace
    node *= step(0.4, hasH + hasV);

    col = mix(col, traceColor.rgb, node);

    // Animated pulse traveling along traces
    if (pulseIntensity > 0.0) {
        // Horizontal pulse
        float hPulsePos = fract(t + hash(gid + vec2(0.0, 50.0)) * 10.0);
        float hPulse = smoothstep(0.1, 0.0, abs(gf.x - hPulsePos)) * hTrace * hasH;

        // Vertical pulse
        float vPulsePos = fract(t * 0.7 + hash(gid + vec2(50.0, 0.0)) * 10.0);
        float vPulse = smoothstep(0.1, 0.0, abs(gf.y - vPulsePos)) * vTrace * hasV;

        float pulse = (hPulse + vPulse) * pulseIntensity;
        col += pulseColor.rgb * pulse;

        // Node glow when pulse arrives
        float nodeGlow = smoothstep(0.3, 0.0, nodeDist) * (hPulse + vPulse) * 0.5;
        col += pulseColor.rgb * nodeGlow;
    }

    gl_FragColor = vec4(col, 1.0);
}
