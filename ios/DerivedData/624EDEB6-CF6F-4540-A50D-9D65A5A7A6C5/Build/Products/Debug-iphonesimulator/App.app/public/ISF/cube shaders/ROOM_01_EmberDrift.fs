/*{
    "DESCRIPTION": "Window into a room of rising embers at 8 depth layers with parallax",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "emberDensity", "TYPE": "float", "DEFAULT": 6.0, "MIN": 3.0, "MAX": 12.0},
        {"NAME": "trailLength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Room depth: edge=0 (near wall), center=1 (deep)
    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    // Audio reactivity
    float beatPulse = 1.0 + audioBeat * 0.6;
    float highReact = 1.0 + audioHigh * 0.3;

    vec3 col = vec3(0.0);

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float layerDepth = (fi + 1.0) / 8.0 * depth;

        // Parallax: deeper layers shrink UV toward center
        float parallax = 1.0 - layerDepth * 0.4;
        vec2 luv = (uv - 0.5) * parallax + 0.5;
        luv.x *= aspect;

        // Grid for this layer
        float gridScale = emberDensity * (1.0 + fi * 0.3);
        vec2 gridUV = luv * gridScale;
        vec2 cell = floor(gridUV);
        vec2 frac_uv = fract(gridUV);

        // Per-cell ember
        float h1 = hash(cell + fi * 17.3);
        float h2 = hash(cell + fi * 31.7 + 100.0);
        float h3 = hash(cell + fi * 53.1 + 200.0);

        // Rise animation with individual speed
        float riseSpeed = 0.3 + h1 * 0.7;
        float life = fract(t * riseSpeed * 0.5 + h2);

        // Ember position within cell, drifting inward from edges
        float inwardDrift = (0.5 - edgeDist) * 0.15 * layerDepth;
        vec2 emberPos = vec2(
            0.5 + sin(t * 0.7 + h1 * 6.28) * 0.2 + inwardDrift,
            fract(frac_uv.y - life)
        );

        float d = length(frac_uv - emberPos);

        // Size: near layers large, far layers small
        float size = (0.15 - layerDepth * 0.08) * (0.6 + h3 * 0.4) * beatPulse;

        // Soft glow
        float glow = smoothstep(size, size * 0.1, d);

        // Trail stretching upward
        float trail = smoothstep(size * (1.0 + trailLength * 2.0), size * 0.2,
            length(vec2((frac_uv.x - emberPos.x) * 2.0, frac_uv.y - emberPos.y - size * 0.5)));
        glow = max(glow, trail * 0.4);

        // Brightness: near=bright, far=dim
        float brightness = (1.0 - layerDepth * 0.7) * intensity * (1.0 - life * 0.5);

        // Color: orange base, shift toward white for hot embers
        float heat = (1.0 - life) * h3;
        vec3 emberCol = mix(
            vec3(1.0, 0.4 + sin(colorShift) * 0.2, 0.05),
            vec3(1.0, 0.9, 0.7),
            heat * 0.6
        );
        emberCol *= highReact;

        col += emberCol * glow * brightness;
    }

    // Subtle warm ambient at bottom (floor glow)
    float floorGlow = exp(-uv.y * 4.0) * 0.15 * intensity;
    col += vec3(1.0, 0.3, 0.05) * floorGlow * beatPulse;

    // Dim edges to reinforce room walls
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
