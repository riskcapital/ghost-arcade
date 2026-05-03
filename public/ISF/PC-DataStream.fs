/*{
    "DESCRIPTION": "Data stream visualization - converts point cloud into flowing digital data particles",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Point Cloud FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "flowSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Flow Speed"},
        {"NAME": "flowDirection", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28, "LABEL": "Direction"},
        {"NAME": "digitize", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Digitize"},
        {"NAME": "streamDensity", "TYPE": "float", "DEFAULT": 60.0, "MIN": 10.0, "MAX": 200.0, "LABEL": "Stream Density"},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.5, 1.0], "LABEL": "Glow Color"},
        {"NAME": "matrixRain", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Matrix Rain"},
        {"NAME": "energyPulse", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Energy Pulse"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec4 src = IMG_NORM_PIXEL(inputImage, uv);
    float brightness = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    // Flow direction vector
    vec2 flowDir = vec2(cos(flowDirection), sin(flowDirection));
    float t = TIME * flowSpeed;

    // Digital grid
    float gridSize = streamDensity;
    vec2 gridUV = floor(uv * gridSize) / gridSize;
    vec2 cellUV = fract(uv * gridSize);

    // Sample source at grid center
    float cellBright = dot(IMG_NORM_PIXEL(inputImage, gridUV + 0.5 / gridSize).rgb, vec3(0.299, 0.587, 0.114));

    // Flowing stream offset per column
    float colHash = hash(vec2(gridUV.x * 100.0, 0.0));
    float streamOffset = fract(t * (0.5 + colHash * 0.5) + colHash * 10.0);

    // Matrix rain: vertical streams of characters
    float charBright = 0.0;
    if (matrixRain > 0.01) {
        float rainY = fract(uv.y + streamOffset);
        float fadeDown = smoothstep(0.0, 0.5, rainY);
        float charRand = hash21(floor(vec2(uv.x * gridSize, (uv.y + streamOffset) * gridSize)));
        charBright = step(0.3, charRand) * fadeDown * cellBright * matrixRain;
    }

    // Digitize: quantize source colors
    vec3 digitized = src.rgb;
    if (digitize > 0.01) {
        float levels = mix(256.0, 4.0, digitize);
        digitized = floor(digitized * levels) / levels;
    }

    // Energy pulse
    float pulse = 1.0 + sin(TIME * energyPulse * 3.0) * 0.2 * energyPulse;

    // Composite: blend original with data stream effect
    vec3 streamColor = glowColor.rgb * (charBright + cellBright * 0.2);
    vec3 result = mix(digitized, digitized * glowColor.rgb, 0.3) + streamColor * 0.8;
    result *= pulse;

    // Add subtle grid lines
    float gridLine = 1.0 - smoothstep(0.0, 0.05, min(cellUV.x, cellUV.y)) * digitize;
    result += glowColor.rgb * gridLine * 0.05 * digitize;

    float alpha = max(src.a, charBright * matrixRain);

    gl_FragColor = vec4(result, alpha);
}
