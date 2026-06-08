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
    ],
    "PERSISTENT_BUFFERS": ["trailBuffer"],
    "PASSES": [
        {"TARGET": "trailBuffer", "PERSISTENT": true},
        {}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

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

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    if (PASSINDEX == 0) {
        // Trail accumulation pass
        vec2 flowUV = uv;
        float t = TIME * speed;
        flowUV += vec2(
            sin(uv.y * 8.0 + t) * distortAmount,
            cos(uv.x * 8.0 + t * 0.7) * distortAmount
        );

        vec4 prevTrail = IMG_NORM_PIXEL(trailBuffer, flowUV);
        vec4 current = IMG_NORM_PIXEL(inputImage, uv);

        // Detect bright particles from point cloud
        float brightness = dot(current.rgb, vec3(0.299, 0.587, 0.114));

        // Shift trail colors over time
        vec3 shiftedTrail = hueShift(prevTrail.rgb, colorShift * 0.01);

        // Blend: keep trails, add new particles
        vec3 result = shiftedTrail * trailLength + current.rgb * (1.0 + brightness * trailBrightness);

        gl_FragColor = vec4(result, max(prevTrail.a * trailLength, current.a));
    } else {
        // Output pass with glow
        vec4 trail = IMG_NORM_PIXEL(trailBuffer, uv);

        // Add bloom/glow
        vec3 glow = vec3(0.0);
        float samples = 0.0;
        for (float x = -2.0; x <= 2.0; x += 1.0) {
            for (float y = -2.0; y <= 2.0; y += 1.0) {
                vec2 offset = vec2(x, y) * glowRadius / RENDERSIZE;
                glow += IMG_NORM_PIXEL(trailBuffer, uv + offset).rgb;
                samples += 1.0;
            }
        }
        glow /= samples;

        vec3 final = trail.rgb + glow * 0.3;
        gl_FragColor = vec4(final, trail.a);
    }
}
