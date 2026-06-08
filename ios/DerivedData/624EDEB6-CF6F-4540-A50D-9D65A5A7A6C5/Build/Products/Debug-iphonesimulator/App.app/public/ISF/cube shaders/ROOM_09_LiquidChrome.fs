/*{
    "DESCRIPTION": "Window into a room of flowing liquid chrome surfaces at layered depths",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "flowSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "iridescence", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

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

// Domain-warped noise for liquid flow
float warpedNoise(vec2 p, float t) {
    vec2 q = vec2(noise(p + t * 0.3), noise(p + vec2(5.2, 1.3) + t * 0.2));
    vec2 r = vec2(noise(p + q * 2.0 + vec2(1.7, 9.2) + t * 0.15),
                  noise(p + q * 2.0 + vec2(8.3, 2.8) + t * 0.1));
    return noise(p + r * 2.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 fromCenter = (uv - 0.5) * 2.0;
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    vec3 col = vec3(0.0);

    for (int layer = 0; layer < 8; layer++) {
        float fl = float(layer);
        float z = (fl + 1.0) / 8.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = (uv - 0.5) * parallax + 0.5;
        luv.x *= aspect;

        // Each layer flows in a different direction
        float flowAngle = fl * 0.785 + t * 0.1;
        vec2 flowDir = vec2(cos(flowAngle), sin(flowAngle)) * flowSpeed;
        vec2 flowUV = luv * (3.0 + fl * 0.5) + flowDir * t * 0.3;

        // Domain-warped liquid surface
        float n1 = warpedNoise(flowUV, t * flowSpeed * 0.5 + fl * 3.0);
        float n2 = warpedNoise(flowUV * 1.5 + 10.0, t * flowSpeed * 0.3 + fl * 7.0);

        // Chrome reflection: sharp peaks from noise derivatives
        float eps = 0.02;
        float nx = warpedNoise(flowUV + vec2(eps, 0.0), t * flowSpeed * 0.5 + fl * 3.0);
        float ny = warpedNoise(flowUV + vec2(0.0, eps), t * flowSpeed * 0.5 + fl * 3.0);
        float sharpness = 1.0 - z * 0.7; // near=sharp, far=smooth
        float reflection = abs(nx - n1) + abs(ny - n1);
        reflection = pow(reflection / eps * 0.1, 1.0 + sharpness * 2.0);

        // Combine smooth flow and sharp highlights
        float chrome = n1 * 0.3 + n2 * 0.2 + reflection * 0.5;
        chrome *= 1.0 + beat * 0.6 * (1.0 - z);

        // Depth brightness
        float brightness = (1.0 - z * 0.6) * intensity;

        // Silver/chrome base
        vec3 baseCol = vec3(0.7, 0.72, 0.75) * (0.5 + chrome);

        // Rainbow iridescence based on surface angle
        float iriAngle = (n1 + n2) * 6.28 + colorShift;
        vec3 iriCol = vec3(
            0.5 + 0.5 * sin(iriAngle + 0.0),
            0.5 + 0.5 * sin(iriAngle + 2.094),
            0.5 + 0.5 * sin(iriAngle + 4.189)
        );
        baseCol = mix(baseCol, iriCol, iridescence * reflection * 2.0);

        // Specular highlights
        float spec = pow(max(chrome, 0.0), 3.0 + sharpness * 5.0) * 2.0;
        baseCol += vec3(1.0) * spec * sharpness * (1.0 + high * 0.5);

        col += baseCol * brightness * 0.2;
    }

    // Ambient chrome reflection at center
    float centerGlow = exp(-length(fromCenter) * 2.5) * 0.12 * intensity;
    col += vec3(0.8, 0.82, 0.85) * centerGlow;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
