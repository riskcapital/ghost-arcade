/*{
    "DESCRIPTION": "Point cloud particle trails - creates luminous trailing echoes from point cloud motion",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Point Cloud FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "trailLength", "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.0, "MAX": 0.99, "LABEL": "Trail Length"},
        {"NAME": "trailBrightness", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 4.0, "LABEL": "Trail Brightness"},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Color Shift"},
        {"NAME": "distortAmount", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0, "MAX": 0.1, "LABEL": "Distortion"},
        {"NAME": "glowRadius", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.0, "MAX": 5.0, "LABEL": "Glow Radius"},
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Speed"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

// One pass: the trail buffer's feedback loop, unrolled. Each echo is the
// input seen through one more frame of flow distortion, hue-shifted once
// more and faded by trailLength once more, as a frame-by-frame buffer would
// have accumulated it.
#define ECHOES 12
#define FRAME_STEP (1.0 / 60.0)

vec3 hueShift(vec3 color, float shift) {
    float angle = shift * 6.28318;
    float s = sin(angle), c = cos(angle);
    vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;
    return vec3(
        dot(color, weights.xyz),
        dot(color, weights.zxy),
        dot(color, weights.yzx)
    );
}

// Bright particles from the point cloud glow hotter
vec3 particles(vec4 current) {
    float brightness = dot(current.rgb, vec3(0.299, 0.587, 0.114));
    return current.rgb * (1.0 + brightness * trailBrightness);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * speed;

    vec3 trail = vec3(0.0);
    float alpha = 0.0;
    float fade = 1.0;
    float fadeSum = 0.0;
    vec2 flowUV = uv;
    for (int k = 0; k < ECHOES; k++) {
        float fk = float(k);
        vec4 current = IMG_NORM_PIXEL(inputImage, flowUV);
        trail += hueShift(particles(current), colorShift * 0.01 * fk) * fade;
        alpha = max(alpha, current.a * fade);
        fadeSum += fade;

        // One frame further back along the flow
        float tk = t - fk * FRAME_STEP * speed;
        flowUV += vec2(
            sin(flowUV.y * 8.0 + tk) * distortAmount,
            cos(flowUV.x * 8.0 + tk * 0.7) * distortAmount
        );
        fade *= trailLength;
    }

    // Bloom/glow around the trails
    vec3 glow = vec3(0.0);
    float samples = 0.0;
    for (float x = -2.0; x <= 2.0; x += 1.0) {
        for (float y = -2.0; y <= 2.0; y += 1.0) {
            vec2 offset = vec2(x, y) * glowRadius / RENDERSIZE;
            glow += particles(IMG_NORM_PIXEL(inputImage, uv + offset));
            samples += 1.0;
        }
    }
    glow *= fadeSum / samples;

    vec3 final = trail + glow * 0.3;
    gl_FragColor = vec4(final, alpha);
}
