/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Flying through a starfield - classic space warp effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Particles"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "starCount", "TYPE": "float", "MIN": 50.0, "MAX": 400.0, "DEFAULT": 150.0, "LABEL": "Star Count"},
        {"NAME": "trailLength", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Trail Length"},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Brightness"},
        {"NAME": "colorShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "Color Shift"},
        {"NAME": "centerX", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center X"},
        {"NAME": "centerY", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Center Y"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec2 hash2(float n) {
    return vec2(hash(n), hash(n + 7.3));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = vec2(centerX, centerY);
    vec2 p = uv - center;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed * 0.5;
    vec3 col = vec3(0.0);

    // Create multiple star layers
    for (float i = 0.0; i < 400.0; i++) {
        if (i >= starCount) break;

        // Random angle and base distance for each star
        vec2 rnd = hash2(i * 1.34);
        float angle = rnd.x * 6.283185;
        float baseDepth = rnd.y;

        // Star moves outward over time (cycling through depth)
        float depth = fract(baseDepth + t * 0.3);
        float z = 0.01 + depth * depth * 2.0; // Non-linear depth for speed variation

        // Star position expands outward from center
        vec2 starPos = vec2(cos(angle), sin(angle)) * depth * 1.5;

        // Distance from this pixel to star
        vec2 diff = p - starPos;
        float dist = length(diff);

        // Star size grows as it gets "closer" (depth increases)
        float size = 0.002 + depth * 0.015;

        // Trail effect - elongate star in radial direction
        vec2 radialDir = normalize(starPos + 0.0001);
        float radialDist = abs(dot(diff, radialDir));
        float perpDist = length(diff - radialDir * dot(diff, radialDir));

        float trailSize = size * (1.0 + trailLength * depth * 10.0);
        float star = smoothstep(trailSize, 0.0, radialDist) * smoothstep(size, 0.0, perpDist);

        // Fade in as stars approach
        star *= smoothstep(0.0, 0.3, depth);

        // Color based on star "temperature"
        vec3 starColor = vec3(1.0);
        float colorRnd = hash(i * 2.71);
        if (colorShift > 0.0) {
            if (colorRnd < 0.3) {
                starColor = mix(vec3(1.0), vec3(0.7, 0.85, 1.0), colorShift); // Blue-white
            } else if (colorRnd < 0.6) {
                starColor = mix(vec3(1.0), vec3(1.0, 0.95, 0.8), colorShift); // Yellow-white
            } else if (colorRnd < 0.8) {
                starColor = mix(vec3(1.0), vec3(1.0, 0.8, 0.6), colorShift); // Orange
            }
        }

        col += star * starColor * brightness;
    }

    // Subtle vignette
    float vig = 1.0 - length(p) * 0.3;
    col *= vig;

    gl_FragColor = vec4(col, 1.0);
}
