/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Matrix-style digital rain effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Particles"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Speed"},
        {"NAME": "density", "TYPE": "float", "MIN": 5.0, "MAX": 50.0, "DEFAULT": 20.0, "LABEL": "Density"},
        {"NAME": "charSize", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Size"},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "Trail Length"},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.3, 1.0], "LABEL": "Glow Color"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.05, 0.02, 1.0], "LABEL": "Background"},
        {"NAME": "flicker", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Flicker"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float char(vec2 p, float n) {
    // Simple pseudo-random character pattern
    p = floor(p * 8.0);
    float h = hash(n + p.x + p.y * 10.0);
    return step(0.5, h);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    float columns = density;
    vec2 p = uv * vec2(columns, columns * RENDERSIZE.y / RENDERSIZE.x);

    vec2 cell = floor(p);
    vec2 f = fract(p);

    float t = TIME * speed;

    vec3 color = bgColor.rgb;

    // Column properties
    float columnHash = hash(cell.x);
    float columnSpeed = 0.5 + columnHash * 0.5;
    float columnOffset = columnHash * 100.0;

    // Calculate drop position
    float dropY = fract(t * columnSpeed + columnOffset);
    float dropPos = cell.y / (columns * RENDERSIZE.y / RENDERSIZE.x);

    // Distance from drop head
    float distFromHead = dropY - (1.0 - dropPos);
    if (distFromHead < 0.0) distFromHead += 1.0;

    // Trail
    float trail = smoothstep(trailLength, 0.0, distFromHead);

    // Flicker effect
    float flickerVal = 1.0 - flicker * (0.5 + 0.5 * sin(t * 20.0 + cell.x * 10.0 + cell.y * 5.0));

    // Character pattern
    float charPattern = char(f * charSize, cell.x + cell.y + floor(t * 10.0));

    // Brightness
    float brightness = trail * charPattern * flickerVal;

    // Head glow
    float headGlow = smoothstep(0.02, 0.0, distFromHead) * 2.0;
    brightness += headGlow;

    color += glowColor.rgb * brightness;

    // Subtle scan lines
    color *= 0.9 + 0.1 * sin(uv.y * RENDERSIZE.y * 2.0);

    gl_FragColor = vec4(color, 1.0);
}
