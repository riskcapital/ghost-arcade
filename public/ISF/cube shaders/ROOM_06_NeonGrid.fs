/*{
    "DESCRIPTION": "Window into a neon-lit room with perspective floor and ceiling grids receding into depth",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "gridDensity", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 20.0},
        {"NAME": "glowWidth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    vec3 col = vec3(0.0);

    // Floor and ceiling grids via fake 1/z perspective
    for (int layer = 0; layer < 10; layer++) {
        float fl = float(layer);
        float z = (fl + 1.0) / 10.0 * depth;
        float invZ = 1.0 / (z + 0.1);

        // Parallax: deeper layers compress toward center
        float parallax = 1.0 - z * 0.5;
        vec2 luv = fromCenter * parallax;

        // Perspective grid: project X lines at this Z depth
        float gridX = luv.x * gridDensity * invZ * 0.5;
        float gridY = luv.y * gridDensity * invZ * 0.5;

        // Scroll the grid lines into the room
        gridY += t * (1.5 - z) * 0.3;
        gridX += sin(t * 0.3 + fl) * 0.2;

        // Line intensity using fractional distance to nearest grid line
        float lineX = abs(fract(gridX) - 0.5);
        float lineY = abs(fract(gridY) - 0.5);

        // Width scales with depth: near=thick, far=thin
        float w = (0.06 + 0.04 * (1.0 - z)) * glowWidth;
        float gx = exp(-lineX * lineX / (w * w));
        float gy = exp(-lineY * lineY / (w * w));
        float grid = max(gx, gy) + gx * gy * 0.5;

        // Only draw on floor (bottom half) and ceiling (top half)
        float floorCeil = smoothstep(0.0, 0.3, abs(fromCenter.y));
        grid *= floorCeil;

        // Also draw side wall lines
        float sideWall = smoothstep(0.0, 0.3, abs(fromCenter.x));
        float wallGrid = gy * sideWall * (1.0 - floorCeil) * 0.5;
        grid += wallGrid;

        // Brightness falloff with depth
        float brightness = (1.0 - z * 0.7) * intensity;
        brightness *= 1.0 + beat * 0.8 * (1.0 - z);

        // Neon color: cyberpunk pink/blue/purple
        float hue = fl * 0.6 + colorShift + t * 0.1;
        vec3 neon = vec3(
            0.8 + 0.2 * sin(hue + 0.0),
            0.2 + 0.3 * sin(hue + 2.1),
            0.9 + 0.1 * sin(hue + 4.2)
        );

        // Hot-white core blend
        vec3 lineCol = mix(neon, vec3(1.0), grid * 0.3);

        col += lineCol * grid * brightness * (0.15 + high * 0.1);
    }

    // Horizon glow at center
    float horizonGlow = exp(-fromCenter.y * fromCenter.y * 8.0) * 0.2 * intensity;
    col += vec3(0.6, 0.2, 0.9) * horizonGlow * (1.0 + beat);

    // Vanishing point bloom
    float centerDist = length(fromCenter);
    float vanish = exp(-centerDist * centerDist * 3.0) * 0.15 * intensity;
    col += vec3(0.9, 0.3, 1.0) * vanish;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.35;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
