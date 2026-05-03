/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Prismatic light dispersion effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Light"],
    "INPUTS": [
        {"NAME": "spread", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Color Spread"},
        {"NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.28, "DEFAULT": 0.785, "LABEL": "Angle"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Animation"},
        {"NAME": "bands", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 7.0, "LABEL": "Color Bands"},
        {"NAME": "softness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Softness"},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Intensity"},
        {"NAME": "centerX", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center Y"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 hue2rgb(float h) {
    h = fract(h);
    float r = abs(h * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h * 6.0 - 2.0);
    float b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = vec2(centerX, centerY);
    vec2 p = uv - center;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;

    // Direction of light
    vec2 lightDir = vec2(cos(angle + t * 0.2), sin(angle + t * 0.2));

    // Project position onto light direction
    float proj = dot(p, lightDir);

    // Distance from light axis
    float perpDist = length(p - lightDir * proj);

    vec3 col = vec3(0.0);

    // Create color bands
    for (float i = 0.0; i < 12.0; i++) {
        if (i >= bands) break;

        float bandOffset = (i / bands - 0.5) * spread;
        float bandPos = proj + bandOffset;

        // Each band is a different hue
        float hue = i / bands;
        vec3 bandColor = hue2rgb(hue);

        // Band intensity based on position and perpendicular distance
        float bandIntensity = smoothstep(spread * softness, 0.0, abs(bandPos - 0.1));
        bandIntensity *= smoothstep(0.3, 0.0, perpDist);

        // Light cone shape
        bandIntensity *= smoothstep(-0.2, 0.3, proj);

        col += bandColor * bandIntensity * intensity / bands;
    }

    // Add white core
    float core = smoothstep(0.1, 0.0, perpDist) * smoothstep(-0.1, 0.1, proj);
    col += vec3(1.0) * core * 0.5;

    gl_FragColor = vec4(col, 1.0);
}
