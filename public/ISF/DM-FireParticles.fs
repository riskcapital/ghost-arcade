/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Rising fire particles with ember glow",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Particles"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Speed"},
        {"NAME": "density", "TYPE": "float", "MIN": 5.0, "MAX": 50.0, "DEFAULT": 20.0, "LABEL": "Density"},
        {"NAME": "turbulence", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Turbulence"},
        {"NAME": "particleSize", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Size"},
        {"NAME": "colorHot", "TYPE": "color", "DEFAULT": [1.0, 0.9, 0.3, 1.0], "LABEL": "Hot Color"},
        {"NAME": "colorCold", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.0, 1.0], "LABEL": "Cold Color"},
        {"NAME": "baseY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "Base Height"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;
    vec3 color = vec3(0.0);

    for (int i = 0; i < 50; i++) {
        if (float(i) >= density) break;

        float id = float(i);
        float h = hash(id);
        float h2 = hash(id + 100.0);

        // Particle position
        float x = h * 2.0 - 0.5;
        float life = fract(t * (0.5 + h * 0.5) + h2);
        float y = baseY + life * (1.0 - baseY);

        // Turbulence
        x += sin(y * 5.0 + t + h * 6.28) * turbulence * 0.2;
        x += (noise(vec2(id, t * 0.5)) - 0.5) * turbulence * 0.3;

        vec2 pos = vec2(x, y);
        float d = length(uv - pos);

        // Particle with heat falloff
        float size = (0.02 + h * 0.01) * particleSize * (1.0 - life * 0.5);
        float particle = smoothstep(size, size * 0.3, d);

        // Color based on life (hot at bottom, cooler as rises)
        vec3 particleColor = mix(colorHot.rgb, colorCold.rgb, life);
        particleColor *= (1.0 - life * 0.7); // Fade out

        color += particleColor * particle;
    }

    // Add base glow
    float baseGlow = smoothstep(baseY + 0.2, baseY, uv.y);
    color += colorCold.rgb * baseGlow * 0.3;

    gl_FragColor = vec4(color, 1.0);
}
