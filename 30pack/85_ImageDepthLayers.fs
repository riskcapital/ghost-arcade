/*{
    "DESCRIPTION": "Image Depth Layers - Separates image into parallax depth layers like a popup diorama. Front-facing = original image; tilt to separate layers.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Effect"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "cameraAngleX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -30.0, "MAX": 30.0, "LABEL": "Camera Tilt X"},
        {"NAME": "cameraAngleY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -30.0, "MAX": 30.0, "LABEL": "Camera Tilt Y"},
        {"NAME": "numLayers", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 16.0, "LABEL": "Layer Count"},
        {"NAME": "layerSpacing", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Layer Separation"},
        {"NAME": "layerSoftness", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0, "MAX": 0.1, "LABEL": "Layer Edge Softness"},
        {"NAME": "shadowAmount", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Depth Shadow"},
        {"NAME": "animateAngle", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "animateSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

// ============================================================================
// Image Depth Layers - Popup Diorama Effect
// Bright areas float to front, dark areas recede to back.
// Each depth slice shifts independently under parallax camera tilt.
// At camera (0,0): layers overlap perfectly = original image.
// ============================================================================

#define PI 3.14159265359

float getLuminance(vec2 uv) {
    vec4 tex = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999));
    return dot(tex.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Camera angle
    float ax = cameraAngleX;
    float ay = cameraAngleY;
    if (animateAngle > 0.01) {
        ax += sin(TIME * animateSpeed) * 12.0 * animateAngle;
        ay += cos(TIME * animateSpeed * 0.7) * 8.0 * animateAngle;
    }
    ax += audioBass * 4.0;
    ay += audioMid * 2.0;

    vec2 tiltDir = vec2(sin(ax * PI / 180.0), sin(ay * PI / 180.0));

    int layers = int(numLayers);
    vec3 finalColor = vec3(0.0);
    float finalMask = 0.0;

    // Render layers from deepest (dark) to nearest (bright)
    // Each later iteration overwrites, giving correct front-to-back occlusion
    for (int i = 0; i < 16; i++) {
        if (i >= layers) break;

        float layerDepth = float(i) / float(layers - 1); // 0=deep, 1=near

        // Deeper layers get more parallax offset
        // Bright = near = less offset, Dark = far = more offset
        float depthOffset = (1.0 - layerDepth) * layerSpacing;
        vec2 layerUV = uv + tiltDir * depthOffset;

        // Bounds check
        if (layerUV.x < -0.05 || layerUV.x > 1.05 || layerUV.y < -0.05 || layerUV.y > 1.05) continue;

        vec2 clampedUV = clamp(layerUV, 0.001, 0.999);
        float lum = getLuminance(clampedUV);

        // Layer brightness range
        float layerMin = float(i) / float(layers);
        float layerMax = float(i + 1) / float(layers);

        // Soft layer boundaries
        float inLayer = smoothstep(layerMin - layerSoftness, layerMin + layerSoftness, lum) *
                        (1.0 - smoothstep(layerMax - layerSoftness, layerMax + layerSoftness, lum));

        if (inLayer > 0.01) {
            vec3 color = IMG_NORM_PIXEL(inputImage, clampedUV).rgb;

            // Depth shadow - deeper layers are slightly darker
            float shadow = 1.0 - (1.0 - layerDepth) * shadowAmount * 0.5;
            color *= shadow;

            // Blend this layer (later = nearer = overwrites)
            finalColor = mix(finalColor, color, inLayer);
            finalMask = max(finalMask, inLayer);
        }
    }

    // Background fill for unclaimed pixels
    if (finalMask < 0.1) {
        finalColor = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999)).rgb * 0.3;
    }

    gl_FragColor = vec4(finalColor, 1.0);
}
