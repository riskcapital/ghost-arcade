/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Flowing chrome/liquid metal with iridescent reflections",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "flowSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.4},
        {"NAME": "waveScale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0},
        {"NAME": "iridescence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "reflectivity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.8},
        {"NAME": "warpAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // Quintic interpolation

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float f = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        f += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return f;
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * flowSpeed;

    // Create flowing distortion
    vec2 flow = uv * waveScale;

    // Multi-layer warping for fluid movement
    float warp1 = fbm(flow + t * 0.3);
    float warp2 = fbm(flow * 1.5 - t * 0.2 + 5.0);

    vec2 warped = flow + vec2(warp1, warp2) * warpAmount;

    // Height field for surface
    float height = fbm(warped);
    float height2 = fbm(warped * 2.0 + t * 0.5);
    float surface = height * 0.7 + height2 * 0.3;

    // Calculate fake normals for lighting
    float eps = 0.01;
    float hL = fbm(warped - vec2(eps, 0.0));
    float hR = fbm(warped + vec2(eps, 0.0));
    float hD = fbm(warped - vec2(0.0, eps));
    float hU = fbm(warped + vec2(0.0, eps));

    vec3 normal = normalize(vec3(hL - hR, hD - hU, eps * 10.0));

    // Lighting
    vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);

    float diffuse = max(dot(normal, lightDir), 0.0);
    float specular = pow(max(dot(reflectDir, viewDir), 0.0), 64.0);

    // Chrome base color
    vec3 chrome = vec3(0.85, 0.85, 0.9);

    // Iridescent color shift based on view angle
    float fresnel = 1.0 - max(dot(normal, viewDir), 0.0);
    fresnel = pow(fresnel, 3.0);

    float iriHue = surface + fresnel * 0.5 + t * 0.05;
    vec3 iriColor = hsv2rgb(vec3(iriHue, 0.7, 1.0));

    // Mix chrome with iridescence
    vec3 col = mix(chrome, iriColor, iridescence * fresnel);

    // Apply lighting
    col *= 0.3 + diffuse * 0.4;
    col += vec3(1.0) * specular * reflectivity;

    // Environment reflection fake
    float envReflect = fbm(normal.xy * 3.0 + t * 0.2);
    col += chrome * envReflect * reflectivity * 0.3;

    // Fresnel rim
    col += iriColor * fresnel * iridescence * 0.5;

    // Contrast boost
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
