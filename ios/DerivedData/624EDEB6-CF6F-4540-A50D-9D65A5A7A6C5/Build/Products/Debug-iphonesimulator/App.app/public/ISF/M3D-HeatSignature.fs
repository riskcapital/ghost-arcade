/*{
    "DESCRIPTION": "Heat signature - thermal imaging effect that maps 3D model luminance to heat palette",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Model FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "heatSensitivity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0, "LABEL": "Sensitivity"},
        {"NAME": "coldColor", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.3, 1.0], "LABEL": "Cold"},
        {"NAME": "warmColor", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.0, 1.0], "LABEL": "Warm"},
        {"NAME": "hotColor", "TYPE": "color", "DEFAULT": [1.0, 1.0, 0.2, 1.0], "LABEL": "Hot"},
        {"NAME": "noiseGrain", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5, "LABEL": "Noise Grain"},
        {"NAME": "bloomHeat", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Heat Bloom"},
        {"NAME": "contours", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Contours"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 heatPalette(float t, vec3 cold, vec3 warm, vec3 hot) {
    if (t < 0.5) return mix(cold, warm, t * 2.0);
    return mix(warm, hot, (t - 0.5) * 2.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec4 src = IMG_NORM_PIXEL(inputImage, uv);

    // Luminance as heat value
    float heat = dot(src.rgb, vec3(0.299, 0.587, 0.114)) * heatSensitivity;
    heat = clamp(heat, 0.0, 1.0);

    // Add temporal noise for thermal camera feel
    float noise = hash(uv * RENDERSIZE + vec2(floor(TIME * 30.0), 0.0));
    heat += (noise - 0.5) * noiseGrain;
    heat = clamp(heat, 0.0, 1.0);

    // Heat contour lines
    if (contours > 0.01) {
        float contourVal = fract(heat * 10.0);
        float contourLine = smoothstep(0.05, 0.0, abs(contourVal - 0.5) - 0.45);
        heat = mix(heat, heat + contourLine * 0.2, contours);
    }

    // Map to heat palette
    vec3 thermalColor = heatPalette(heat, coldColor.rgb, warmColor.rgb, hotColor.rgb);

    // Heat bloom on hot areas
    if (bloomHeat > 0.01) {
        float bloom = 0.0;
        float samples = 0.0;
        for (float x = -2.0; x <= 2.0; x += 1.0) {
            for (float y = -2.0; y <= 2.0; y += 1.0) {
                vec2 offset = vec2(x, y) * 2.0 / RENDERSIZE;
                float sHeat = dot(IMG_NORM_PIXEL(inputImage, uv + offset).rgb, vec3(0.299, 0.587, 0.114));
                bloom += max(0.0, sHeat - 0.6);
                samples += 1.0;
            }
        }
        bloom /= samples;
        thermalColor += hotColor.rgb * bloom * bloomHeat * 2.0;
    }

    // Scanline effect for thermal camera feel
    float scanline = 1.0 - 0.03 * sin(uv.y * RENDERSIZE.y * 0.5);

    gl_FragColor = vec4(thermalColor * scanline, src.a);
}
