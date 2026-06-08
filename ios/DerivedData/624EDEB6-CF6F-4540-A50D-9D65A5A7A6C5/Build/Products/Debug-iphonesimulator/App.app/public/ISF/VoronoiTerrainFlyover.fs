/*{
    "DESCRIPTION": "Evolving plasma terrain with waves rolling toward the camera. Fractal sinusoidal layers create a living landscape that flows forward with chromatic edge lighting.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Terrain"],
    "INPUTS": [
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Speed" },
        { "NAME": "waveSpeed", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 3.0, "LABEL": "Wave Speed" },
        { "NAME": "rotAngle", "TYPE": "float", "DEFAULT": 4.0, "MIN": 0.0, "MAX": 6.28, "LABEL": "Layer Rotation" },
        { "NAME": "expFalloff", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 5.0, "LABEL": "Exp Falloff" },
        { "NAME": "hue", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Hue" },
        { "NAME": "satScale", "TYPE": "float", "DEFAULT": 0.16, "MIN": 0.0, "MAX": 0.5, "LABEL": "Saturation" },
        { "NAME": "terrainBlend", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.1, "MAX": 1.0, "LABEL": "Terrain Blend" },
        { "NAME": "edgeSharp", "TYPE": "float", "DEFAULT": 8000.0, "MIN": 2000.0, "MAX": 20000.0, "LABEL": "Edge Sharpness" },
        { "NAME": "waveHeight", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.5, "LABEL": "Wave Height" },
        { "NAME": "cameraHeight", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 4.0, "LABEL": "Camera Height" },
        { "NAME": "cameraTilt", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.1, "MAX": 1.2, "LABEL": "Camera Tilt" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 rgb = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(rgb - 1.0, 0.0, 1.0), c.y);
}

// Fractal terrain height at world position xz
float terrainHeight(vec2 pos, float t) {
    float c4 = cos(rotAngle), s4 = sin(rotAngle);
    mat2 layerRot = mat2(c4, s4, -s4, c4);

    float e = 0.0;
    float h = 0.0;
    vec2 p = pos;

    float aScale = 0.8;
    for (int k = 0; k < 20; k++) {
        if (aScale <= 0.01) break;
        p *= layerRot;
        // Waves moving toward camera (negative z direction)
        e += exp(sin(p.y / aScale + t * speed + p.x * 0.3) - expFalloff) * aScale;
        // Secondary wave layer flowing forward
        e += exp(sin((p.x + p.y) / aScale * 0.7 - t * waveSpeed) - expFalloff) * aScale * 0.5;
        h += abs(sin(p.x / aScale * 0.3) * aScale) + abs(sin(p.y / aScale * 0.3) * aScale);
        aScale *= 0.8;
    }

    float terrain = e * waveHeight;

    // Large rolling waves
    terrain += sin(pos.y * 0.8 - t * waveSpeed * 2.0) * waveHeight * 0.4;
    terrain += sin(pos.x * 0.5 + pos.y * 0.3 - t * waveSpeed * 1.5) * waveHeight * 0.25;

    return terrain * terrainBlend - 0.5;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME;

    // Camera flying forward over terrain
    vec3 ro = vec3(0.0, cameraHeight, -t * waveSpeed * 0.5);
    vec3 rd = normalize(vec3(uv.x, uv.y * cameraTilt - 0.3, 1.0));

    // Simple raymarching against terrain
    vec3 col = vec3(0.0);
    float totalDist = 0.0;
    bool hit = false;
    vec3 hitPos;

    for (int i = 0; i < 80; i++) {
        hitPos = ro + rd * totalDist;
        float h = terrainHeight(hitPos.xz, t);
        float d = hitPos.y - h;

        if (d < 0.01) {
            hit = true;
            break;
        }
        if (totalDist > 30.0) break;

        // Step proportional to height above terrain
        totalDist += max(d * 0.5, 0.05);
    }

    if (hit) {
        // Normal via central differences
        vec2 eps = vec2(0.05, 0.0);
        float hC = terrainHeight(hitPos.xz, t);
        float hX = terrainHeight(hitPos.xz + eps.xy, t);
        float hZ = terrainHeight(hitPos.xz + eps.yx, t);
        vec3 nor = normalize(vec3(hC - hX, eps.x, hC - hZ));

        // Color from terrain features
        float depthFade = exp(-totalDist * 0.08);
        float slopeVal = 1.0 - nor.y; // Steeper = brighter

        // Height-based hue shift
        float hVal = fract(hue + hC * 0.3 + hitPos.z * 0.02);

        // Edge detection: steep slopes glow
        float edgeFactor = smoothstep(0.2, 0.8, slopeVal);

        // Lighting
        vec3 lightDir = normalize(vec3(0.3, 0.8, -0.4));
        float diff = max(dot(nor, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 24.0);
        float fres = pow(1.0 - max(dot(nor, -rd), 0.0), 3.0);

        // Base terrain color
        vec3 terrCol = hsv2rgb(vec3(hVal, 0.5 + satScale * 2.0, 0.15 + diff * 0.4));

        // Bright edge/crest glow (wireframe-ish on wave peaks)
        vec3 edgeCol = hsv2rgb(vec3(fract(hVal + 0.15), 0.6, 1.0));
        terrCol += edgeCol * edgeFactor * 0.8;

        // Specular highlights on wave crests
        terrCol += spec * 0.5 * vec3(1.0, 0.95, 0.9);

        // Fresnel rim light
        terrCol += fres * 0.3 * hsv2rgb(vec3(fract(hVal + 0.3), 0.4, 1.0));

        // Distance fog
        vec3 fogCol = hsv2rgb(vec3(fract(hue + 0.5), 0.3, 0.06));
        col = mix(fogCol, terrCol * depthFade, depthFade);
    } else {
        // Sky / fog background
        float skyGrad = uv.y * 0.5 + 0.5;
        col = hsv2rgb(vec3(fract(hue + 0.5), 0.2, 0.04 + skyGrad * 0.03));
    }

    // Tone map
    col = col / (1.0 + col);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
