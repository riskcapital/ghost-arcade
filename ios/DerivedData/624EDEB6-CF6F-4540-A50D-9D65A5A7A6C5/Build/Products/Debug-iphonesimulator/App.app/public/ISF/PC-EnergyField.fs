/*{
    "DESCRIPTION": "Energy field - wraps point cloud in pulsing electromagnetic force field visualization",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Point Cloud FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "fieldIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Field Intensity"},
        {"NAME": "fieldFrequency", "TYPE": "float", "DEFAULT": 8.0, "MIN": 1.0, "MAX": 30.0, "LABEL": "Frequency"},
        {"NAME": "fieldColor", "TYPE": "color", "DEFAULT": [0.3, 0.6, 1.0, 1.0], "LABEL": "Field Color"},
        {"NAME": "pulseSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Pulse Speed"},
        {"NAME": "arcCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 12.0, "LABEL": "Arc Count"},
        {"NAME": "distortField", "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.0, "MAX": 0.1, "LABEL": "Distortion"},
        {"NAME": "innerGlow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Inner Glow"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 centered = (uv - 0.5) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0);

    // Distort UV based on field
    float t = TIME * pulseSpeed;
    vec2 fieldDistort = vec2(
        sin(centered.y * fieldFrequency + t) * distortField,
        cos(centered.x * fieldFrequency + t * 0.8) * distortField
    );
    vec4 src = IMG_NORM_PIXEL(inputImage, uv + fieldDistort);
    float brightness = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    // Edge detection on source for field contours
    vec2 px = 1.0 / RENDERSIZE;
    float edgeH = length(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, 0)).rgb - IMG_NORM_PIXEL(inputImage, uv - vec2(px.x, 0)).rgb);
    float edgeV = length(IMG_NORM_PIXEL(inputImage, uv + vec2(0, px.y)).rgb - IMG_NORM_PIXEL(inputImage, uv - vec2(0, px.y)).rgb);
    float edges = (edgeH + edgeV) * 2.0;

    // Energy arcs along edges
    float arcEnergy = 0.0;
    for (float i = 0.0; i < 12.0; i++) {
        if (i >= arcCount) break;
        float phase = i / arcCount * 6.28318 + t;
        float wave = sin(uv.y * fieldFrequency * 2.0 + phase) * sin(uv.x * fieldFrequency * 1.5 + phase * 0.7);
        arcEnergy += smoothstep(0.8, 1.0, wave) * edges;
    }
    arcEnergy /= arcCount;

    // Pulsing field lines
    float fieldLines = sin(length(centered) * fieldFrequency * 3.0 - t * 2.0) * 0.5 + 0.5;
    fieldLines *= edges * fieldIntensity;

    // Inner glow on bright areas
    float glow = brightness * innerGlow;

    // Composite
    vec3 result = src.rgb;
    result += fieldColor.rgb * fieldLines * 1.5;
    result += fieldColor.rgb * arcEnergy * fieldIntensity * 3.0;
    result += fieldColor.rgb * glow * 0.5;

    // Pulse brightness
    float pulse = 1.0 + sin(t * 3.0) * 0.1 * fieldIntensity;
    result *= pulse;

    gl_FragColor = vec4(result, max(src.a, fieldLines * 0.5));
}
