/*{
    "DESCRIPTION": "Lava lamp style organic blobs that float, merge, and bounce off the frame edges",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "blobCount", "TYPE": "float", "MIN": 3.0, "MAX": 10.0, "DEFAULT": 6.0},
        {"NAME": "blobSize", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.25},
        {"NAME": "threshold", "TYPE": "float", "MIN": 0.3, "MAX": 0.9, "DEFAULT": 0.55},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "warmColor", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.05, 1.0]},
        {"NAME": "coolColor", "TYPE": "color", "DEFAULT": [0.8, 0.1, 0.5, 1.0]},
        {"NAME": "edgeSoftness", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.05}
    ]
}*/

vec2 getBlobPos(float id, float t) {
    float phase1 = sin(id * 1.7 + 0.3) * 1.1;
    float phase2 = cos(id * 2.3 + 0.7) * 0.9;
    float sx = sin(t * speed * (0.3 + id * 0.07) + phase1);
    float sy = cos(t * speed * (0.2 + id * 0.09) + phase2);
    float buoyancy = sin(t * speed * 0.15 + id * 2.0) * 0.1;
    float x = sx * 0.35 + 0.5;
    float y = sy * 0.35 + 0.5 + buoyancy;
    x = clamp(x, 0.05, 0.95);
    y = clamp(y, 0.05, 0.95);
    return vec2(x, y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME;
    float field = 0.0;
    float colorBlend = 0.0;
    int count = int(blobCount);
    for (int i = 0; i < 10; i++) {
        if (i >= count) break;
        float id = float(i);
        vec2 pos = getBlobPos(id, t);
        vec2 diff = uv - pos;
        diff.x *= aspect;
        float dist = length(diff);
        float influence = blobSize / (dist * dist + 0.01);
        field += influence;
        colorBlend += influence * fract(id * 0.37);
    }
    colorBlend /= max(field, 0.001);
    float blob = smoothstep(threshold - edgeSoftness, threshold + edgeSoftness, field * 0.1);
    vec3 blobColor = mix(warmColor.rgb, coolColor.rgb, colorBlend);
    float internalGlow = field * 0.01;
    blobColor += vec3(internalGlow * 0.2);
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeGlow = smoothstep(0.05, 0.0, edgeDist) * blob * 0.5;
    blobColor += edgeGlow * warmColor.rgb;
    vec3 bg = vec3(0.02, 0.01, 0.03);
    vec3 col = mix(bg, blobColor, blob);
    gl_FragColor = vec4(col, 1.0);
}
