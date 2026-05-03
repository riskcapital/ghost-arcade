/*{
    "DESCRIPTION": "Image Relief Terrain - Parallax depth mapping extrudes image content into 3D. Front-facing camera shows original image; tilt to reveal depth.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Effect"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "cameraAngleX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -45.0, "MAX": 45.0, "LABEL": "Camera Tilt X"},
        {"NAME": "cameraAngleY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -45.0, "MAX": 45.0, "LABEL": "Camera Tilt Y"},
        {"NAME": "depthScale", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5, "LABEL": "Depth Amount"},
        {"NAME": "heightChannel", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Height Source"},
        {"NAME": "invertHeight", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "edgeLight", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "shadowStrength", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "animateAngle", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "animateSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

// ============================================================================
// Image Relief Terrain - Steep Parallax Occlusion Mapping
// Uses image luminance as a heightmap. Camera at 0,0 = original image.
// Tilt camera to reveal 3D depth extrusion of the actual image colors.
// Designed for projection mapping paintings onto real surfaces.
// ============================================================================

#define PI 3.14159265359
#define STEPS 32

float getHeight(vec2 uv) {
    vec4 tex = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999));
    float h;
    int ch = int(heightChannel);
    if (ch == 1) h = tex.r;
    else if (ch == 2) h = tex.g;
    else if (ch == 3) h = tex.b;
    else h = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    if (invertHeight > 0.5) h = 1.0 - h;
    return h;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Camera angle with optional animation
    float ax = cameraAngleX;
    float ay = cameraAngleY;
    if (animateAngle > 0.01) {
        ax += sin(TIME * animateSpeed) * 15.0 * animateAngle;
        ay += cos(TIME * animateSpeed * 0.7) * 10.0 * animateAngle;
    }

    // Audio-reactive tilt
    ax += audioBass * 5.0;
    ay += audioMid * 3.0;

    float tiltX = ax * PI / 180.0;
    float tiltY = ay * PI / 180.0;

    // Audio-reactive depth
    float depth = depthScale + audioBeat * 0.05;

    // Parallax direction from camera tilt
    vec2 parallaxDir = vec2(tan(tiltX), tan(tiltY)) * depth;

    // Steep parallax occlusion mapping
    float layerStep = 1.0 / float(STEPS);
    vec2 uvStep = parallaxDir / float(STEPS);

    float currentLayerDepth = 0.0;
    vec2 currentUV = uv;
    float currentMapDepth = 1.0 - getHeight(currentUV);

    for (int i = 0; i < STEPS; i++) {
        if (currentLayerDepth >= currentMapDepth) break;
        currentUV += uvStep;
        currentMapDepth = 1.0 - getHeight(currentUV);
        currentLayerDepth += layerStep;
    }

    // Binary refinement for smooth surface
    vec2 prevUV = currentUV - uvStep;
    float prevMapDepth = 1.0 - getHeight(prevUV);
    float prevLayerDepth = currentLayerDepth - layerStep;

    float afterD = currentMapDepth - currentLayerDepth;
    float beforeD = prevMapDepth - prevLayerDepth;
    float w = afterD / (afterD - beforeD + 0.0001);
    vec2 finalUV = mix(currentUV, prevUV, clamp(w, 0.0, 1.0));

    // Sample color at displaced UV
    vec3 color = IMG_NORM_PIXEL(inputImage, clamp(finalUV, 0.001, 0.999)).rgb;

    // Edge lighting from heightmap normals
    if (edgeLight > 0.01) {
        float eps = 2.0 / max(RENDERSIZE.x, RENDERSIZE.y);
        float hL = getHeight(finalUV - vec2(eps, 0.0));
        float hR = getHeight(finalUV + vec2(eps, 0.0));
        float hD = getHeight(finalUV - vec2(0.0, eps));
        float hU = getHeight(finalUV + vec2(0.0, eps));

        vec3 normal = normalize(vec3(hL - hR, hD - hU, eps * 6.0));
        vec3 lightDir = normalize(vec3(sin(tiltX) * 0.5 + 0.3, sin(tiltY) * 0.5 + 0.3, 1.0));
        float diff = max(dot(normal, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 16.0);

        color *= mix(1.0, diff * 1.2 + 0.3, edgeLight);
        color += vec3(spec * edgeLight * 0.4);
    }

    // Self-shadowing along tilt direction
    if (shadowStrength > 0.01 && (abs(tiltX) > 0.01 || abs(tiltY) > 0.01)) {
        float surfaceH = getHeight(finalUV);
        float shadow = 0.0;
        vec2 shadowDir = normalize(vec2(tiltX, tiltY)) * 0.01;
        for (int j = 1; j < 8; j++) {
            vec2 sUV = finalUV + shadowDir * float(j);
            float sH = getHeight(sUV);
            if (sH > surfaceH + float(j) * 0.02) {
                shadow = 1.0;
                break;
            }
        }
        color *= 1.0 - shadow * shadowStrength;
    }

    // Fade at image bounds
    float edge = smoothstep(0.0, 0.03, finalUV.x) * smoothstep(0.0, 0.03, finalUV.y) *
                 smoothstep(0.0, 0.03, 1.0 - finalUV.x) * smoothstep(0.0, 0.03, 1.0 - finalUV.y);
    color *= edge;

    gl_FragColor = vec4(color, 1.0);
}
