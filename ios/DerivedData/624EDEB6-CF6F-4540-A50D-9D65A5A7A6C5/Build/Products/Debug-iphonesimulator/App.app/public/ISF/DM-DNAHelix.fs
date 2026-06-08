/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated DNA double helix structure",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Organic"],
    "INPUTS": [
        {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Rotation"},
        {"NAME": "verticalSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Flow"},
        {"NAME": "helixWidth", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.25, "LABEL": "Width"},
        {"NAME": "baseSize", "TYPE": "float", "MIN": 0.01, "MAX": 0.05, "DEFAULT": 0.02, "LABEL": "Base Size"},
        {"NAME": "basePairs", "TYPE": "float", "MIN": 5.0, "MAX": 20.0, "DEFAULT": 10.0, "LABEL": "Base Pairs"},
        {"NAME": "strand1Color", "TYPE": "color", "DEFAULT": [0.0, 0.5, 1.0, 1.0], "LABEL": "Strand 1"},
        {"NAME": "strand2Color", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.5, 1.0], "LABEL": "Strand 2"},
        {"NAME": "baseColor1", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Base A"},
        {"NAME": "baseColor2", "TYPE": "color", "DEFAULT": [1.0, 1.0, 0.0, 1.0], "LABEL": "Base B"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    vec2 center = vec2(RENDERSIZE.x / RENDERSIZE.y * 0.5, 0.5);
    vec2 p = uv - center;

    float t = TIME * rotateSpeed;
    float scrollY = TIME * verticalSpeed;

    vec3 col = vec3(0.0);

    // Draw multiple levels of the helix
    // Use fixed iteration count since WebGL requires constant loop step
    for (float _yi = 0.0; _yi < 42.0; _yi++) {
        float y = -1.0 + _yi / basePairs;
        if (y > 1.0) break;
        float localY = fract(y + scrollY) * 2.0 - 1.0;

        // Calculate helix positions
        float phase = localY * 3.14159 * basePairs / 2.0 + t * 3.0;

        float x1 = sin(phase) * helixWidth;
        float x2 = sin(phase + 3.14159) * helixWidth;

        // Depth for 3D effect
        float z1 = cos(phase);
        float z2 = cos(phase + 3.14159);

        float size1 = baseSize * (1.0 + z1 * 0.3);
        float size2 = baseSize * (1.0 + z2 * 0.3);

        // Strand 1
        float d1 = length(p - vec2(x1, localY * 0.4));
        float strand1 = smoothstep(size1, size1 * 0.5, d1);
        col += strand1Color.rgb * strand1 * (0.7 + z1 * 0.3);

        // Strand 2
        float d2 = length(p - vec2(x2, localY * 0.4));
        float strand2 = smoothstep(size2, size2 * 0.5, d2);
        col += strand2Color.rgb * strand2 * (0.7 + z2 * 0.3);

        // Base pairs (connecting rungs)
        if (z1 > 0.0 || z2 > 0.0) {
            // Line between strands
            vec2 p1 = vec2(x1, localY * 0.4);
            vec2 p2 = vec2(x2, localY * 0.4);

            vec2 pa = p - p1;
            vec2 ba = p2 - p1;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            float lineDist = length(pa - ba * h);

            float bridge = smoothstep(baseSize * 0.5, 0.0, lineDist);
            bridge *= max(z1, z2);

            vec3 bridgeColor = mix(baseColor1.rgb, baseColor2.rgb, hash(floor(localY * basePairs)));
            col += bridgeColor * bridge * 0.5;
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
