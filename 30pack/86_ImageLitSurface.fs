/*{
    "DESCRIPTION": "Image Lit Surface - Relight any image as a 3D surface using heightmap normals. Perfect for paintings - makes brush strokes catch light.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Effect"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "lightAngleX", "TYPE": "float", "DEFAULT": 30.0, "MIN": -90.0, "MAX": 90.0, "LABEL": "Light Angle X"},
        {"NAME": "lightAngleY", "TYPE": "float", "DEFAULT": 30.0, "MIN": -90.0, "MAX": 90.0, "LABEL": "Light Angle Y"},
        {"NAME": "lightIntensity", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0, "LABEL": "Light Mix"},
        {"NAME": "bumpScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 0.5, "MAX": 15.0, "LABEL": "Surface Bumpiness"},
        {"NAME": "ambient", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Ambient Light"},
        {"NAME": "specularPower", "TYPE": "float", "DEFAULT": 32.0, "MIN": 4.0, "MAX": 128.0, "LABEL": "Specular Sharpness"},
        {"NAME": "specularIntensity", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 2.0, "LABEL": "Specular Brightness"},
        {"NAME": "heightChannel", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Height Source"},
        {"NAME": "animateLight", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "animateSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0}
    ]
}*/

// ============================================================================
// Image Lit Surface - Normal Map Relighting
// Computes surface normals from image luminance (heightmap), then applies
// Phong lighting. Moving the light creates shadows and highlights that make
// flat images appear deeply 3D. Ideal for projection mapping paintings.
// ============================================================================

#define PI 3.14159265359

float getHeight(vec2 uv) {
    vec4 tex = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999));
    int ch = int(heightChannel);
    if (ch == 1) return tex.r;
    if (ch == 2) return tex.g;
    if (ch == 3) return tex.b;
    return dot(tex.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec3 originalColor = IMG_NORM_PIXEL(inputImage, clamp(uv, 0.001, 0.999)).rgb;

    // Compute surface normals via central differences
    float texelSize = 1.5 / max(RENDERSIZE.x, RENDERSIZE.y);
    float hL = getHeight(uv - vec2(texelSize, 0.0));
    float hR = getHeight(uv + vec2(texelSize, 0.0));
    float hD = getHeight(uv - vec2(0.0, texelSize));
    float hU = getHeight(uv + vec2(0.0, texelSize));

    vec3 normal = normalize(vec3(
        (hL - hR) * bumpScale,
        (hD - hU) * bumpScale,
        1.0
    ));

    // Light direction
    float lx = lightAngleX;
    float ly = lightAngleY;
    if (animateLight > 0.01) {
        lx += sin(TIME * animateSpeed) * 40.0 * animateLight;
        ly += cos(TIME * animateSpeed * 0.7) * 30.0 * animateLight;
    }

    // Audio-reactive light movement
    lx += audioBass * 15.0;
    ly += audioMid * 10.0;

    vec3 lightDir = normalize(vec3(
        sin(lx * PI / 180.0),
        sin(ly * PI / 180.0),
        cos(lx * PI / 180.0) * cos(ly * PI / 180.0)
    ));

    // Diffuse lighting
    float diffuse = max(dot(normal, lightDir), 0.0);

    // Specular highlight
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);
    float specular = pow(max(dot(viewDir, reflectDir), 0.0), specularPower);

    // Compute lit color
    vec3 litColor = originalColor * (ambient + diffuse * (1.0 - ambient));
    litColor += vec3(specular * specularIntensity);

    // Audio-reactive highlight boost
    litColor += vec3(specular * audioBeat * 0.3);

    // Subtle ambient occlusion from local curvature
    float center = getHeight(uv);
    float ao = 0.0;
    ao += max(center - hL, 0.0);
    ao += max(center - hR, 0.0);
    ao += max(center - hD, 0.0);
    ao += max(center - hU, 0.0);
    ao = 1.0 - ao * 2.0;
    litColor *= mix(1.0, clamp(ao, 0.3, 1.0), lightIntensity * 0.5);

    // Mix original and lit based on intensity
    vec3 finalColor = mix(originalColor, litColor, lightIntensity);

    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
