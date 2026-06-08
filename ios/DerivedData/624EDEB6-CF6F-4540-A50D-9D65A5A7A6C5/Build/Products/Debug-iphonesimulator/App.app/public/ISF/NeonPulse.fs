/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Neon pulsing bars VJ effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "barCount", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "glowAmount", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "barWidth", "TYPE": "float", "MIN": 0.1, "MAX": 0.9, "DEFAULT": 0.6},
        {"NAME": "direction", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    // Direction switch (horizontal/vertical)
    float coord = mix(uv.x, uv.y, direction);
    float perpCoord = mix(uv.y, uv.x, direction);

    float t = iTime * pulseSpeed;

    vec3 col = vec3(0.0);

    int bars = int(barCount);
    for (int i = 0; i < 20; i++) {
        if (i >= bars) break;

        float fi = float(i);
        float barPos = (fi + 0.5) / barCount;

        // Pulse for this bar
        float pulse = sin(t + fi * 0.5) * 0.5 + 0.5;
        pulse = pow(pulse, 2.0);

        // Bar shape
        float dist = abs(coord - barPos) * barCount;
        float bar = smoothstep(barWidth * 0.5 + 0.1, barWidth * 0.5, dist);

        // Height animation
        float height = pulse * 0.8 + 0.2;
        bar *= smoothstep(height, height - 0.1, abs(perpCoord - 0.5) * 2.0);

        // Glow
        float glow = exp(-dist * 3.0) * pulse * glowAmount;

        // Color
        float hue = fract(fi / barCount + t * 0.1);
        vec3 barCol = hsv2rgb(vec3(hue, 0.9, 1.0));

        col += barCol * bar;
        col += barCol * glow * 0.3;
    }

    // Background pulse
    col += vec3(0.02, 0.01, 0.03) * (0.5 + 0.5 * sin(t * 0.5));

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
