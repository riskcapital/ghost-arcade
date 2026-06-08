/*{
    "DESCRIPTION": "PCB circuit board trace pattern with flowing energy pulses and audio-reactive glow",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "traceScale", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 15.0},
        {"NAME": "glowWidth", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 4.0},
        {"NAME": "pulseSpeed", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0},
        {"NAME": "colorTemp", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float traceLine(vec2 uv, vec2 cellID, float t) {
    vec2 cellUV = fract(uv) - 0.5;
    float h = hash(cellID);

    // Decide trace direction: horizontal, vertical, or corner
    float lineH = smoothstep(0.06, 0.02, abs(cellUV.y)) * step(h, 0.4);
    float lineV = smoothstep(0.06, 0.02, abs(cellUV.x)) * step(0.4, h) * step(h, 0.7);

    // L-shaped corner traces
    float corner = 0.0;
    if (h > 0.7) {
        float cx = smoothstep(0.06, 0.02, abs(cellUV.x)) * step(0.0, cellUV.y);
        float cy = smoothstep(0.06, 0.02, abs(cellUV.y)) * step(cellUV.x, 0.0);
        corner = max(cx, cy);
    }

    // Via pads at intersections
    float pad = smoothstep(0.12, 0.08, length(cellUV)) * step(0.85, hash(cellID + 99.0));

    return max(max(lineH, lineV), max(corner, pad));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    // Audio reactivity
    float bassEnergy = 1.0 + audioBass * 2.0;
    float beatPulse = audioBeat * 1.5;
    float midGlow = 1.0 + audioMid * 1.0;

    // Grid
    vec2 gridUV = uv * vec2(traceScale * aspect, traceScale);
    vec2 cellID = floor(gridUV);

    // Trace pattern
    float trace = traceLine(gridUV, cellID, t);

    // Flowing energy pulse along traces
    float pulse = sin((cellID.x + cellID.y) * 1.5 + t * pulseSpeed + audioSpectralCentroid * 2.0) * 0.5 + 0.5;
    pulse = pow(pulse, 3.0) * bassEnergy;

    // Base circuit color (green to blue based on colorTemp)
    vec3 baseColor = mix(
        vec3(0.0, 0.8, 0.3),
        vec3(0.2, 0.4, 1.0),
        colorTemp
    );

    // Pulse highlight color
    vec3 pulseColor = mix(
        vec3(0.3, 1.0, 0.5),
        vec3(0.5, 0.7, 1.0),
        colorTemp
    );

    // Compositing
    vec3 col = vec3(0.02, 0.02, 0.03); // dark PCB background
    col += baseColor * trace * 0.4 * midGlow;
    col += pulseColor * trace * pulse * glowWidth * 0.5;

    // Beat flash on traces
    col += vec3(0.8, 0.9, 1.0) * trace * beatPulse * 0.3;

    // Subtle grid lines for PCB substrate
    float gridLine = smoothstep(0.04, 0.0, abs(fract(gridUV.x) - 0.5));
    gridLine += smoothstep(0.04, 0.0, abs(fract(gridUV.y) - 0.5));
    col += vec3(0.02, 0.03, 0.02) * gridLine;

    gl_FragColor = vec4(col, 1.0);
}
