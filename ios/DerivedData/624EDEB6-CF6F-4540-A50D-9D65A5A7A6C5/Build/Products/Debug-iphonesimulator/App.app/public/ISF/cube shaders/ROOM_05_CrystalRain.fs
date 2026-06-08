/*{
    "DESCRIPTION": "Window into a room of falling crystal rain streaks at layered depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "streakWidth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "impactFlash", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash1(float n) {
    return fract(sin(n) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Room coordinates
    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    // Audio
    float beatFlash = audioBeat;
    float highSparkle = 1.0 + audioHigh * 0.5;

    vec3 col = vec3(0.0);

    for (int layer = 0; layer < 8; layer++) {
        float fl = float(layer);
        float layerDepth = (fl + 1.0) / 8.0 * depth;

        // Parallax
        float parallax = 1.0 - layerDepth * 0.45;
        vec2 luv = (uv - 0.5) * parallax + 0.5;
        luv.x *= aspect;

        // Fall speed: near=fast, far=slow
        float fallSpeed = (1.5 - layerDepth * 0.8) * 2.0;

        // Streak grid: columns per layer
        float columns = 8.0 + fl * 3.0;
        float colWidth = 1.0 / columns;
        float colIndex = floor(luv.x / colWidth);
        float colFrac = fract(luv.x / colWidth);

        // Per-column streak properties
        float h1 = hash(vec2(colIndex, fl * 17.1));
        float h2 = hash(vec2(colIndex + 100.0, fl * 31.3));
        float h3 = hash(vec2(colIndex + 200.0, fl * 53.7));

        // Streak timing: staggered falls
        float period = 1.5 + h1 * 2.0;
        float fall = fract(t * fallSpeed / period + h2);

        // Streak vertical position (falling from top to bottom)
        float streakY = 1.0 - fall;
        float streakLen = 0.08 + h3 * 0.12;

        // Distance to streak center line (horizontal)
        float dx = abs(colFrac - 0.5);
        float width = (0.02 + h3 * 0.01) * streakWidth * (1.0 - layerDepth * 0.4);

        // Vertical: streak is a line segment
        float dy = luv.y - streakY;
        float inStreak = step(0.0, dy) * step(dy, streakLen);
        float streakFade = 1.0 - dy / streakLen; // brighter at leading edge

        // Thin bright line
        float streak = exp(-dx * dx / (width * width)) * inStreak * streakFade;

        // Brightness: near=bright, far=dim
        float brightness = (1.0 - layerDepth * 0.65) * intensity * highSparkle;

        // Impact flash at bottom when streak reaches ground
        float impactY = 0.05 + h1 * 0.05;
        float impactPhase = fract(t * fallSpeed / period + h2 + 0.02);
        float atBottom = 1.0 - smoothstep(0.0, 0.15, impactPhase);
        float impactDist = length(vec2((colFrac - 0.5) * 3.0, (luv.y - impactY) * 5.0));
        float impact = exp(-impactDist * impactDist * 2.0) * atBottom * impactFlash;

        // Cool blue/white/cyan palette
        float hue = fl * 0.5 + colorShift;
        vec3 streakCol = vec3(
            0.4 + 0.3 * sin(hue + 3.8),
            0.6 + 0.3 * sin(hue + 2.0),
            0.8 + 0.2 * sin(hue + 0.5)
        );

        // Impact flash is white-hot
        vec3 impactCol = mix(streakCol, vec3(1.0, 0.98, 0.95), 0.7);

        col += streakCol * streak * brightness;
        col += impactCol * impact * brightness * (1.0 + beatFlash * 2.0);
    }

    // Subtle cool ambient floor reflection
    float floorReflect = exp(-(uv.y) * 6.0) * 0.08 * intensity;
    col += vec3(0.2, 0.4, 0.7) * floorReflect;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
