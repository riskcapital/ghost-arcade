/*
{
    "CATEGORIES": [
        "Automatically Converted",
        "Shadertoy"
    ],
    "DESCRIPTION": "Automatically converted from https://www.shadertoy.com/view/DlVSWD by LydianLights. Enhanced with tunable parameters for animation speed, zoom, color morphing, and interactivity.",
    "IMPORTED": {},
    "INPUTS": [
        {
            "NAME": "Speed",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 5.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "Zoom",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 10.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "ColorSeed",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 10.0,
            "DEFAULT": 1.0
        }
    ],
    "PASSES": [
        {},
        {}
    ]
}
*/

// Color palette function
vec3 palette(in float t, in float seed) {
    vec3 a = vec3(0.708, 0.651, 0.715);
    vec3 b = vec3(0.684, 0.423, 0.166);
    vec3 c = vec3(0.706, 1.319, 0.117);
    vec3 d = vec3(5.639, 2.829, 3.690);
    return a + b * cos(6.28318 * (c * (t + seed) + d));
}

// Hash function for randomness
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// Main rendering pass
vec3 mainPass(in vec2 fragCoord) {
    vec2 uv = 2.0 * (fragCoord / RENDERSIZE.xy) - 1.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    uv *= Zoom; // Apply zoom parameter
    vec2 uv0 = uv;

    float d0 = length(uv0);
    float y0 = 0.5 * sin(0.25 * TIME * Speed) + 0.5; // Use Speed parameter

    vec3 finalColor;

    for (float i = 0.0; i < 5.0; i++) {
        uv = fract(uv * mix(1.0, 1.3, y0)) - 0.5;

        float p = pow(2.0, -d0 * 3.5);
        float d = length(uv) * p;

        // Use ColorSeed to randomize the color palette
        vec3 color = palette(d0 + i * 0.1 + TIME * Speed * 0.5, ColorSeed);

        float t = 0.05 * (5.0 - i) * TIME * Speed; // Use Speed parameter
        t = t + 0.05 * sin(3.0 * TIME * Speed) * sin(2.0 * TIME * Speed); // Use Speed parameter
        float y = 0.5 * cos(t) + 0.5;
        d = sin(mix(5.0, 19.0, y) * d + 3.0 * t) * sin(mix(31.0, 7.0, y) * d + 5.0 * t) + 0.3 * sin(mix(70.0, 100.0, y) * d + t);
        d = abs(d);
        float q = 0.006 * mix(1.0, 8.0, p);
        d = pow(q / d, 1.6);
        color *= d;

        finalColor += color;
    }

    return finalColor;
}

// Anti-aliasing pass
vec3 antialias(in vec2 fragCoord) {
    const float AA_STAGES = 3.0;
    const float AA_TOTAL_PASSES = AA_STAGES * AA_STAGES + 1.0;
    const float AA_JITTER = 0.5;

    vec3 color = mainPass(fragCoord);
    for (float x = 0.0; x < AA_STAGES; x++) {
        for (float y = 0.0; y < AA_STAGES; y++) {
            vec2 offset = AA_JITTER * (2.0 * hash22(vec2(x, y)) - 1.0);
            color += mainPass(fragCoord + offset);
        }
    }
    return color / AA_TOTAL_PASSES;
}

// Gamma correction
vec3 gamma(in vec3 color) {
    return pow(color, vec3(1.0 / 2.2));
}

void main() {
    if (PASSINDEX == 0) {
        // First pass: No changes needed here.
    } else if (PASSINDEX == 1) {
        // Second pass: Render the scene
        vec3 color = antialias(gl_FragCoord.xy);
        color = gamma(color);
        gl_FragColor = vec4(color, 1.0);
    }
}