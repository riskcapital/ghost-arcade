/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Pixelated rain falling effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Particles"],
    "INPUTS": [
        {"NAME": "pixelSize", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0, "LABEL": "Pixel Size"},
        {"NAME": "fallSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Fall Speed"},
        {"NAME": "density", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.4, "LABEL": "Density"},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0, "LABEL": "Trail Length"},
        {"NAME": "colorVariation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Color Variation"},
        {"NAME": "rainColor", "TYPE": "color", "DEFAULT": [0.0, 0.8, 1.0, 1.0], "LABEL": "Rain Color"},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.0, 0.05, 0.1, 1.0], "LABEL": "Background"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Pixelate
    vec2 pixelUV = floor(uv * RENDERSIZE / pixelSize) * pixelSize / RENDERSIZE;
    float columnId = floor(pixelUV.x * RENDERSIZE.x / pixelSize);

    float t = TIME * fallSpeed;

    vec3 col = bgColor.rgb;

    // Per-column random values
    float colRnd = hash(columnId);
    float colSpeed = 0.7 + colRnd * 0.6;
    float colOffset = colRnd * 100.0;

    // Check if this column has rain
    if (colRnd < density) {
        // Rain drop position
        float dropY = fract(-t * colSpeed + colOffset);

        // Distance from drop (in pixel units)
        float pixelY = pixelUV.y;
        float distFromDrop = dropY - pixelY;

        // Trail effect
        if (distFromDrop > 0.0 && distFromDrop < trailLength / (RENDERSIZE.y / pixelSize)) {
            float trailFade = 1.0 - distFromDrop / (trailLength / (RENDERSIZE.y / pixelSize));
            trailFade = pow(trailFade, 2.0);

            vec3 dropColor = rainColor.rgb;

            // Color variation
            if (colorVariation > 0.0) {
                float hueShift = (hash(columnId + 50.0) - 0.5) * colorVariation;
                dropColor.r += hueShift * 0.5;
                dropColor.b -= hueShift * 0.3;
            }

            // Brightness variation in trail
            float brightness = 0.3 + trailFade * 0.7;

            col = dropColor * brightness * trailFade;
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
