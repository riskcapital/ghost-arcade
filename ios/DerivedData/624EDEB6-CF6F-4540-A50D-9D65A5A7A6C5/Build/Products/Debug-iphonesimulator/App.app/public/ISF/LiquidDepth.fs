/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Layered liquid metal with parallax depth effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.4},
        {"NAME": "layers", "TYPE": "float", "MIN": 2.0, "MAX": 5.0, "DEFAULT": 3.0},
        {"NAME": "parallax", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "fluidity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "colorShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2}
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
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float f = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        f += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return f;
}

vec2 fluidWarp(vec2 p, float t, float strength) {
    vec2 w1 = vec2(fbm(p + t * 0.2), fbm(p + vec2(5.2, 1.3) + t * 0.2));
    vec2 w2 = vec2(fbm(p + w1 * 2.0 + t * 0.1), fbm(p + w1 * 2.0 + vec2(1.7, 9.2) + t * 0.1));
    return (w1 + w2 * 0.5) * strength;
}

float metaball(vec2 p, vec2 center, float radius) {
    float d = length(p - center);
    return radius * radius / (d * d + 0.001);
}

float layerField(vec2 uv, float t, float layerIndex, float blobCount) {
    float field = 0.0;

    for (float i = 0.0; i < 6.0; i++) {
        if (i >= blobCount) break;

        float angle = (i + layerIndex * 2.3) * PI * 2.0 / blobCount + t * (0.2 + layerIndex * 0.1);
        float dist = 0.25 + sin(t * 0.5 + i * 1.7 + layerIndex) * 0.1;

        vec2 center;
        center.x = cos(angle) * dist + sin(t * 0.3 + i * 2.1 + layerIndex * 1.5) * 0.08;
        center.y = sin(angle) * dist + cos(t * 0.35 + i * 1.9 + layerIndex * 1.2) * 0.08;

        float size = 0.06 + hash(vec2(i, layerIndex)) * 0.03;
        field += metaball(uv, center, size);
    }

    vec2 layerCenter = vec2(
        sin(t * 0.2 + layerIndex * PI) * 0.05,
        cos(t * 0.25 + layerIndex * PI * 0.7) * 0.05
    );
    field += metaball(uv, layerCenter, 0.08);

    return field;
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    vec3 finalColor = vec3(0.02, 0.02, 0.04);
    float totalAlpha = 0.0;

    int numLayers = int(layers);

    for (int layer = 0; layer < 5; layer++) {
        if (layer >= numLayers) break;

        float layerDepth = float(layer) / max(float(numLayers - 1), 1.0);
        float layerZ = 1.0 - layerDepth;

        vec2 parallaxOffset = uv * parallax * layerZ * 0.2;
        vec2 layerUV = uv - parallaxOffset;

        vec2 warp = fluidWarp(layerUV * 3.0 + float(layer) * 1.5, t, fluidity * (0.3 + layerDepth * 0.2));
        layerUV += warp;

        float blobsPerLayer = 4.0 + float(layer) * 0.5;
        float field = layerField(layerUV, t, float(layer), blobsPerLayer);

        float threshold = 1.0 + layerZ * 0.2;
        float surface = smoothstep(threshold - 0.3, threshold + 0.1, field);

        if (surface < 0.01) continue;

        // Manual gradient for normals
        float eps = 0.008;
        float fieldL = layerField(layerUV - vec2(eps, 0.0), t, float(layer), blobsPerLayer);
        float fieldR = layerField(layerUV + vec2(eps, 0.0), t, float(layer), blobsPerLayer);
        float fieldD = layerField(layerUV - vec2(0.0, eps), t, float(layer), blobsPerLayer);
        float fieldU = layerField(layerUV + vec2(0.0, eps), t, float(layer), blobsPerLayer);

        vec3 normal = normalize(vec3(
            (fieldL - fieldR) * 4.0,
            (fieldD - fieldU) * 4.0,
            0.4 + layerDepth * 0.3
        ));

        vec3 lightDir = normalize(vec3(0.4 + layerDepth * 0.2, 0.6, 1.0));
        vec3 viewDir = vec3(0.0, 0.0, 1.0);

        float diffuse = max(dot(normal, lightDir), 0.0);
        float specular = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 32.0 + layerDepth * 32.0);

        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);

        vec3 baseColor = vec3(0.85, 0.85, 0.92);
        float hueShift = layerZ * colorShift * 0.15 + t * 0.02;
        vec3 tintColor = hsv2rgb(vec3(0.6 + hueShift, 0.2, 1.0));
        vec3 layerColor = mix(baseColor, tintColor, colorShift * 0.5);

        layerColor *= 0.6 + layerDepth * 0.4;

        vec3 col = layerColor * (0.2 + diffuse * 0.5);
        col += vec3(1.0) * specular * (0.5 + layerDepth * 0.5);
        col += layerColor * fresnel * 0.3;

        float env = fbm(normal.xy * 2.0 + t * 0.1);
        col += layerColor * env * 0.2;

        float edge = smoothstep(threshold - 0.1, threshold, field) -
                     smoothstep(threshold, threshold + 0.3, field);
        col += layerColor * edge * 0.15;

        float alpha = surface * (0.7 + layerDepth * 0.3);
        finalColor = mix(finalColor, col, alpha * (1.0 - totalAlpha * 0.3));
        totalAlpha = min(1.0, totalAlpha + alpha * 0.4);
    }

    gl_FragColor = vec4(finalColor, 1.0);
}
