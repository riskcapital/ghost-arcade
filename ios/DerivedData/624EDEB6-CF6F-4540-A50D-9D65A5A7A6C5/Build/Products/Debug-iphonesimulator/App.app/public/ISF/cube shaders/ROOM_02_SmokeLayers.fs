/*{
    "DESCRIPTION": "Window into a room of layered translucent smoke drifting at different depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "curlAmount", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "smokeDetail", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 6.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// Warped sine noise - cheap flowing smoke approximation
float smokeNoise(vec2 p, float warp) {
    float v = sin(p.x * 1.5 + sin(p.y * 1.3) * warp);
    v += sin(p.y * 1.7 + sin(p.x * 1.1 + 0.5) * warp) * 0.8;
    v += sin((p.x + p.y) * 0.9 + sin(p.x * 2.1 - p.y) * warp * 0.5) * 0.6;
    return v * 0.25 + 0.5;
}

// Multi-octave smoke
float layeredSmoke(vec2 p, float warp, float octaves) {
    float val = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    float total = 0.0;
    for (float i = 0.0; i < 6.0; i++) {
        if (i >= octaves) break;
        val += smokeNoise(p * freq, warp) * amp;
        total += amp;
        amp *= 0.5;
        freq *= 2.1;
        p += vec2(1.7, 1.3);
    }
    return val / total;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Room coordinates: edge proximity
    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    // Audio
    float beatSwell = 1.0 + audioBeat * 0.5;
    float highWisp = audioHigh * 0.4;

    vec3 col = vec3(0.0);

    for (int i = 0; i < 10; i++) {
        float fi = float(i);
        float layerDepth = (fi + 1.0) / 10.0 * depth;

        // Parallax shrink toward center for deeper layers
        float parallax = 1.0 - layerDepth * 0.45;
        vec2 luv = (uv - 0.5) * parallax + 0.5;
        luv.x *= aspect;

        // Scroll direction varies per layer
        float angle = fi * 1.37 + sin(fi * 0.7) * 0.5;
        vec2 scrollDir = vec2(cos(angle), sin(angle) * 0.3);
        float scrollSpeed = (0.2 + fi * 0.08) * (1.0 + highWisp);

        vec2 smokeUV = luv * (2.0 + fi * 0.5) + scrollDir * t * scrollSpeed;

        // Warp amount increases with curl
        float warp = curlAmount * (0.8 + sin(t * 0.3 + fi) * 0.3);

        float smoke = layeredSmoke(smokeUV, warp, smokeDetail);

        // Shape: soft threshold for wispy edges
        smoke = smoothstep(0.3, 0.7, smoke);

        // Opacity: near layers opaque, far layers translucent
        float opacity = (1.0 - layerDepth * 0.6) * 0.35 * intensity;

        // Chromatic tinting per depth layer
        float hueAngle = fi * 0.8 + colorShift;
        vec3 smokeCol = vec3(
            0.5 + 0.3 * sin(hueAngle),
            0.5 + 0.3 * sin(hueAngle + 2.09),
            0.5 + 0.3 * sin(hueAngle + 4.18)
        );

        // Deeper layers are desaturated and dimmer
        smokeCol = mix(smokeCol, vec3(0.4), layerDepth * 0.5);
        smokeCol *= (1.0 - layerDepth * 0.4);

        col += smokeCol * smoke * opacity * beatSwell;
    }

    // Subtle floor shadow gradient
    col *= 0.8 + uv.y * 0.3;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.35;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
