/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated vertical bars like an audio visualizer",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio-Visual"],
    "INPUTS": [
        {"NAME": "barCount", "TYPE": "float", "MIN": 8.0, "MAX": 64.0, "DEFAULT": 32.0, "LABEL": "Bar Count"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Speed"},
        {"NAME": "smoothness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Smoothness"},
        {"NAME": "minHeight", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1, "LABEL": "Min Height"},
        {"NAME": "mirror", "TYPE": "bool", "DEFAULT": true, "LABEL": "Mirror"},
        {"NAME": "gapSize", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.2, "LABEL": "Gap Size"},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Low Color"},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [1.0, 1.0, 0.0, 1.0], "LABEL": "Mid Color"},
        {"NAME": "color3", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.3, 1.0], "LABEL": "High Color"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453123); }

float getBarHeight(float barIndex, float t) {
    float h = 0.0;
    h += sin(t * 2.0 + barIndex * 0.3) * 0.3;
    h += sin(t * 3.7 + barIndex * 0.5) * 0.2;
    h += sin(t * 1.3 + barIndex * 0.8) * 0.15;
    h += hash(floor(t * 4.0) + barIndex) * 0.2;
    return minHeight + (h * 0.5 + 0.5) * (1.0 - minHeight);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;

    // Calculate which bar we're in
    float barWidth = 1.0 / barCount;
    float barIndex = floor(uv.x / barWidth);
    float barLocalX = fract(uv.x / barWidth);

    // Gap between bars
    float inBar = smoothstep(gapSize * 0.5, gapSize * 0.5 + smoothness * 0.1, barLocalX) *
                  smoothstep(1.0 - gapSize * 0.5, 1.0 - gapSize * 0.5 - smoothness * 0.1, barLocalX);

    // Get bar height
    float barHeight = getBarHeight(barIndex, t);

    // Handle mirroring
    float y = mirror ? abs(uv.y - 0.5) * 2.0 : uv.y;
    float maxY = mirror ? barHeight : barHeight;

    // Check if we're inside the bar
    float inBarHeight = smoothstep(maxY + smoothness * 0.05, maxY - smoothness * 0.05, y);

    // Color gradient based on height
    vec3 col;
    float heightNorm = y / maxY;
    if (heightNorm < 0.5) {
        col = mix(color1.rgb, color2.rgb, heightNorm * 2.0);
    } else {
        col = mix(color2.rgb, color3.rgb, (heightNorm - 0.5) * 2.0);
    }

    // Glow at top of bar
    float topGlow = smoothstep(0.1, 0.0, abs(y - maxY)) * 0.5;

    col = col * inBar * inBarHeight;
    col += color3.rgb * topGlow * inBar;

    gl_FragColor = vec4(col, 1.0);
}
