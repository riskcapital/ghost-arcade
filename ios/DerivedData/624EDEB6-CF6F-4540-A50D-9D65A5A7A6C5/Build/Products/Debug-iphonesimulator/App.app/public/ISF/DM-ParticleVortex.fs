/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Swirling particle vortex with trails",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Particles"],
    "INPUTS": [
        {"NAME": "particleCount", "TYPE": "float", "MIN": 50.0, "MAX": 500.0, "DEFAULT": 200.0, "LABEL": "Particles"},
        {"NAME": "vortexStrength", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0, "LABEL": "Vortex Strength"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "particleSize", "TYPE": "float", "MIN": 0.002, "MAX": 0.02, "DEFAULT": 0.008, "LABEL": "Particle Size"},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Trail Length"},
        {"NAME": "innerColor", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.0, 1.0], "LABEL": "Inner Color"},
        {"NAME": "outerColor", "TYPE": "color", "DEFAULT": [0.0, 0.5, 1.0, 1.0], "LABEL": "Outer Color"},
        {"NAME": "centerX", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center Y"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = vec2(centerX, centerY);
    vec2 p = uv - center;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;
    vec3 col = vec3(0.0);

    for (float i = 0.0; i < 500.0; i++) {
        if (i >= particleCount) break;

        // Initial particle properties
        float baseAngle = hash(i * 1.234) * 6.283185;
        float baseRadius = hash(i * 5.678) * 0.8 + 0.1;
        float particleSpeed = hash(i * 9.012) * 0.5 + 0.5;

        // Vortex motion
        float angle = baseAngle + t * particleSpeed * vortexStrength / (baseRadius + 0.1);
        float radius = baseRadius * (0.8 + 0.2 * sin(t * particleSpeed + i));

        // Particle position
        vec2 particlePos = vec2(cos(angle), sin(angle)) * radius;

        // Trail effect (was 5 iterations — trimmed to 3 for ~40% fewer inner iterations)
        for (float trail = 0.0; trail < 3.0; trail++) {
            float trailT = trail * trailLength * 0.15;
            float trailAngle = angle - trailT * vortexStrength / (baseRadius + 0.1);
            vec2 trailPos = vec2(cos(trailAngle), sin(trailAngle)) * radius;

            float d = length(p - trailPos);
            float size = particleSize * (1.0 - trail * 0.25);
            float particle = smoothstep(size, 0.0, d);
            particle *= 1.0 - trail * 0.33; // Fade trail (rescaled for 3-step loop)

            // Color based on radius
            vec3 pCol = mix(innerColor.rgb, outerColor.rgb, radius / 0.9);
            col += particle * pCol * 0.5;
        }
    }

    // Center glow
    float centerDist = length(p);
    col += innerColor.rgb * 0.3 * smoothstep(0.3, 0.0, centerDist);

    gl_FragColor = vec4(col, 1.0);
}
