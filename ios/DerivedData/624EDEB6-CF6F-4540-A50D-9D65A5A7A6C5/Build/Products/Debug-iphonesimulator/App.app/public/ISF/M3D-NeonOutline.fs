/*{
    "DESCRIPTION": "Neon outline - extracts 3D model edges and renders as glowing neon wireframe",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Model FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "edgeThreshold", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.01, "MAX": 0.5, "LABEL": "Edge Threshold"},
        {"NAME": "neonColor1", "TYPE": "color", "DEFAULT": [1.0, 0.1, 0.5, 1.0], "LABEL": "Neon Color 1"},
        {"NAME": "neonColor2", "TYPE": "color", "DEFAULT": [0.1, 0.5, 1.0, 1.0], "LABEL": "Neon Color 2"},
        {"NAME": "glowSize", "TYPE": "float", "DEFAULT": 3.0, "MIN": 0.0, "MAX": 8.0, "LABEL": "Glow Size"},
        {"NAME": "fillOpacity", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.5, "LABEL": "Fill Opacity"},
        {"NAME": "animateColors", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Color Animate"},
        {"NAME": "doubleLine", "TYPE": "bool", "DEFAULT": false, "LABEL": "Double Line"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 px = 1.0 / RENDERSIZE;
    vec4 src = IMG_NORM_PIXEL(inputImage, uv);

    // Multi-scale edge detection
    float edge1 = 0.0;
    float edge2 = 0.0;

    // Fine edges
    for (float x = -1.0; x <= 1.0; x += 1.0) {
        for (float y = -1.0; y <= 1.0; y += 1.0) {
            if (x == 0.0 && y == 0.0) continue;
            vec4 neighbor = IMG_NORM_PIXEL(inputImage, uv + vec2(x, y) * px);
            float diff = length(src.rgb - neighbor.rgb);
            edge1 += step(edgeThreshold, diff);
        }
    }
    edge1 /= 8.0;

    // Coarser edges for double line
    if (doubleLine) {
        for (float x = -2.0; x <= 2.0; x += 2.0) {
            for (float y = -2.0; y <= 2.0; y += 2.0) {
                if (x == 0.0 && y == 0.0) continue;
                vec4 neighbor = IMG_NORM_PIXEL(inputImage, uv + vec2(x, y) * px);
                float diff = length(src.rgb - neighbor.rgb);
                edge2 += step(edgeThreshold * 1.5, diff);
            }
        }
        edge2 /= 8.0;
    }

    float edges = max(edge1, edge2 * 0.7);

    // Animated color gradient along edges
    float colorMix = sin(uv.x * 10.0 + uv.y * 10.0 + TIME * animateColors) * 0.5 + 0.5;
    vec3 neonColor = mix(neonColor1.rgb, neonColor2.rgb, colorMix);

    // Glow: blur the edges
    float glow = 0.0;
    if (glowSize > 0.1) {
        for (float x = -3.0; x <= 3.0; x += 1.0) {
            for (float y = -3.0; y <= 3.0; y += 1.0) {
                vec2 offset = vec2(x, y) * px * glowSize;
                vec4 s = IMG_NORM_PIXEL(inputImage, uv + offset);
                // Check edge at offset position
                vec4 sn = IMG_NORM_PIXEL(inputImage, uv + offset + px);
                glow += step(edgeThreshold, length(s.rgb - sn.rgb));
            }
        }
        glow /= 49.0;
    }

    // Composite
    vec3 result = vec3(0.0);

    // Subtle fill
    result += src.rgb * fillOpacity;

    // Neon glow halo
    result += neonColor * glow * 0.6;

    // Sharp neon edges on top
    result += neonColor * edges * 2.0;

    // HDR bloom on edges
    result += neonColor * edges * edges * 3.0;

    float alpha = max(edges, glow * 0.5);
    alpha = max(alpha, src.a * fillOpacity);

    gl_FragColor = vec4(result, alpha);
}
