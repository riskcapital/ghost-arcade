/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Pulsating energy field with electric arcs",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Motion"],
    "INPUTS": [
        {"NAME": "pulseSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Pulse Speed"},
        {"NAME": "fieldIntensity", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Intensity"},
        {"NAME": "distortionAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Distortion"},
        {"NAME": "arcFrequency", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Arc Frequency"},
        {"NAME": "colorCore", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0], "LABEL": "Core Color"},
        {"NAME": "colorField", "TYPE": "color", "DEFAULT": [0.3, 0.5, 1.0, 1.0], "LABEL": "Field Color"},
        {"NAME": "centerX", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center Y"}
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

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = vec2(centerX, centerY);
    vec2 p = uv - center;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * pulseSpeed;

    // Distance from center
    float d = length(p);
    float angle = atan(p.y, p.x);

    // Add distortion
    float distort = noise(vec2(angle * 3.0, t)) * distortionAmount;
    d += distort * 0.1;

    // Pulsating rings
    float pulse = sin(d * 20.0 - t * 3.0) * 0.5 + 0.5;
    pulse *= exp(-d * 3.0);

    // Core glow
    float core = exp(-d * 8.0);

    // Electric arcs
    float arcs = 0.0;
    if (arcFrequency > 0.0) {
        for (int i = 0; i < 6; i++) {
            float arcAngle = float(i) * 1.047 + t;
            float arcD = abs(angle - arcAngle);
            arcD = min(arcD, 6.28318 - arcD);

            float arcIntensity = noise(vec2(float(i), t * 2.0));
            if (arcIntensity > 1.0 - arcFrequency) {
                float arc = exp(-arcD * 10.0) * exp(-d * 5.0);
                arc *= noise(vec2(d * 20.0, t * 5.0 + float(i)));
                arcs += arc;
            }
        }
    }

    // Combine
    vec3 color = vec3(0.0);
    color += colorCore.rgb * core * 2.0;
    color += colorField.rgb * pulse * fieldIntensity;
    color += colorCore.rgb * arcs * 2.0;

    // Outer glow
    color += colorField.rgb * exp(-d * 2.0) * 0.3 * fieldIntensity;

    gl_FragColor = vec4(color, 1.0);
}
