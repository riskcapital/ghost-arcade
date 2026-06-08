/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Deep metallic blobs with 3D depth and fluid morphing",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.4},
        {"NAME": "blobCount", "TYPE": "float", "MIN": 3.0, "MAX": 10.0, "DEFAULT": 6.0},
        {"NAME": "depth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "fluidAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "metalness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.9}
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
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float f = 0.0;
    f += 0.5 * noise(p); p *= 2.01;
    f += 0.25 * noise(p); p *= 2.02;
    f += 0.125 * noise(p); p *= 2.03;
    f += 0.0625 * noise(p);
    return f / 0.9375;
}

vec2 warp(vec2 p, float t) {
    float nx = fbm(p + vec2(t * 0.3, 0.0));
    float ny = fbm(p + vec2(0.0, t * 0.3) + 10.0);
    return vec2(nx, ny) * 2.0 - 1.0;
}

float metaball3D(vec3 p, vec3 center, float radius) {
    float d = length(p - center);
    return radius * radius / (d * d + 0.001);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Calculate field at a point (extracted for gradient calculation)
float calcField(vec2 uv, float t, float bCount, float depthParam, float fluidAmt) {
    vec2 w1 = warp(uv * 3.0, t);
    vec2 w2 = warp(uv * 3.0 + w1 * 0.5, t * 1.3);
    vec2 warpedUV = uv + (w1 + w2 * 0.5) * fluidAmt * 0.15;

    float totalField = 0.0;

    for (float i = 0.0; i < 10.0; i++) {
        if (i >= bCount) break;

        float phase = i * PI * 2.0 / bCount;
        float depthPhase = sin(t * 0.5 + i * 1.7) * 0.5 + 0.5;

        vec3 center;
        center.x = cos(phase + t * 0.3) * 0.3 + sin(t * 0.2 + i) * 0.1;
        center.y = sin(phase + t * 0.3) * 0.3 + cos(t * 0.25 + i * 1.3) * 0.1;
        center.z = depthPhase * depthParam - depthParam * 0.5;

        vec2 fluidOffset = warp(vec2(i * 1.5, t * 0.2), t) * fluidAmt * 0.1;
        center.xy += fluidOffset;

        float baseSize = 0.08 + hash(vec2(i, 0.0)) * 0.04;
        float sizeWithDepth = baseSize * (1.0 + center.z * 0.5);

        vec3 samplePos = vec3(warpedUV, 0.0);
        float contrib = metaball3D(samplePos, center, sizeWithDepth);

        float depthWeight = 1.0 - center.z * 0.5;
        totalField += contrib * depthWeight;
    }

    vec2 centerWarp = warp(vec2(t * 0.1), t * 0.5) * fluidAmt * 0.05;
    float centralBlob = metaball3D(vec3(warpedUV, 0.0), vec3(centerWarp, 0.0), 0.12);
    totalField += centralBlob;

    return totalField;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 w1 = warp(uv * 3.0, t);
    vec2 w2 = warp(uv * 3.0 + w1 * 0.5, t * 1.3);
    vec2 warpedUV = uv + (w1 + w2 * 0.5) * fluidAmount * 0.15;

    float totalField = 0.0;
    float depthField = 0.0;

    for (float i = 0.0; i < 10.0; i++) {
        if (i >= blobCount) break;

        float phase = i * PI * 2.0 / blobCount;
        float depthPhase = sin(t * 0.5 + i * 1.7) * 0.5 + 0.5;

        vec3 center;
        center.x = cos(phase + t * 0.3) * 0.3 + sin(t * 0.2 + i) * 0.1;
        center.y = sin(phase + t * 0.3) * 0.3 + cos(t * 0.25 + i * 1.3) * 0.1;
        center.z = depthPhase * depth - depth * 0.5;

        vec2 fluidOffset = warp(vec2(i * 1.5, t * 0.2), t) * fluidAmount * 0.1;
        center.xy += fluidOffset;

        float baseSize = 0.08 + hash(vec2(i, 0.0)) * 0.04;
        float sizeWithDepth = baseSize * (1.0 + center.z * 0.5);

        vec3 samplePos = vec3(warpedUV, 0.0);
        float contrib = metaball3D(samplePos, center, sizeWithDepth);

        float depthWeight = 1.0 - center.z * 0.5;
        totalField += contrib * depthWeight;
        depthField += contrib * center.z * depthWeight;
    }

    vec2 centerWarp = warp(vec2(t * 0.1), t * 0.5) * fluidAmount * 0.05;
    float centralBlob = metaball3D(vec3(warpedUV, 0.0), vec3(centerWarp, 0.0), 0.12);
    totalField += centralBlob;

    float threshold = 1.2;
    float surface = smoothstep(threshold - 0.4, threshold + 0.1, totalField);

    // Manual gradient calculation for normals
    float eps = 0.005;
    float fieldL = calcField(uv - vec2(eps, 0.0), t, blobCount, depth, fluidAmount);
    float fieldR = calcField(uv + vec2(eps, 0.0), t, blobCount, depth, fluidAmount);
    float fieldD = calcField(uv - vec2(0.0, eps), t, blobCount, depth, fluidAmount);
    float fieldU = calcField(uv + vec2(0.0, eps), t, blobCount, depth, fluidAmount);

    vec3 normal = normalize(vec3(
        (fieldL - fieldR) * 5.0,
        (fieldD - fieldU) * 5.0,
        0.3 + depthField * depth
    ));

    vec3 lightDir1 = normalize(vec3(0.5, 0.8, 1.0));
    vec3 lightDir2 = normalize(vec3(-0.7, 0.3, 0.8));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    float diffuse1 = max(dot(normal, lightDir1), 0.0);
    float diffuse2 = max(dot(normal, lightDir2), 0.0) * 0.3;
    float diffuse = diffuse1 + diffuse2;

    vec3 reflect1 = reflect(-lightDir1, normal);
    vec3 reflect2 = reflect(-lightDir2, normal);
    float spec1 = pow(max(dot(reflect1, viewDir), 0.0), 64.0);
    float spec2 = pow(max(dot(reflect2, viewDir), 0.0), 32.0) * 0.5;
    float specular = (spec1 + spec2) * metalness;

    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);

    vec3 metalColor = vec3(0.9, 0.9, 0.95);
    float depthTint = (depthField / max(totalField, 0.01) + 0.5);
    metalColor = mix(metalColor, vec3(0.7, 0.75, 0.9), depthTint * 0.3);

    vec3 col = metalColor * (0.15 + diffuse * 0.5) * metalness;
    col += metalColor * (1.0 - metalness) * 0.4;
    col += vec3(1.0) * specular;
    col += metalColor * fresnel * 0.4;

    float envReflect = fbm(normal.xy * 2.0 + warpedUV * 3.0 + t * 0.2);
    col += metalColor * envReflect * metalness * 0.25;

    float depthFog = smoothstep(-0.5, 0.5, depthField / max(totalField, 0.01));
    col = mix(col * 0.7, col, depthFog);

    col *= surface;

    vec3 bg = vec3(0.02, 0.02, 0.04);
    float bgGlow = smoothstep(0.3, 1.0, totalField) * (1.0 - surface);
    bg += metalColor * 0.08 * bgGlow;

    col = mix(bg, col, surface);

    float edge = smoothstep(threshold - 0.1, threshold, totalField) -
                 smoothstep(threshold, threshold + 0.2, totalField);
    col += metalColor * edge * 0.2;

    gl_FragColor = vec4(col, 1.0);
}
