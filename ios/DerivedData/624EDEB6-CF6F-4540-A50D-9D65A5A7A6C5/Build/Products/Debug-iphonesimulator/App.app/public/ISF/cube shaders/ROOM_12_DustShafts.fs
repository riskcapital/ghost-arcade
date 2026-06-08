/*{
    "DESCRIPTION": "Window into a dusty room with diagonal light shafts and floating particles",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "beamCount", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 7.0},
        {"NAME": "dustAmount", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// Soft beam shape: distance from a diagonal line
float beamShape(vec2 uv, float angle, float offset, float width) {
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 perp = vec2(-dir.y, dir.x);
    float across = dot(uv - vec2(offset, 1.0), perp);
    // Cone: wider at bottom
    float along = dot(uv - vec2(offset, 1.0), dir);
    float coneWidth = width * (1.0 + max(0.0, -along) * 0.4);
    return exp(-across * across / (coneWidth * coneWidth));
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

    // Compute total beam light at this pixel (used for dust visibility)
    float totalBeamLight = 0.0;
    int numBeams = int(beamCount);

    for (int b = 0; b < 7; b++) {
        if (b >= numBeams) break;
        float fb = float(b);
        float angle = -0.4 - fb * 0.15 + sin(t * 0.1 + fb) * 0.05;
        float offset = -0.6 + fb * (1.4 / beamCount) + 0.2;
        float width = 0.06 + hash(vec2(fb, 3.3)) * 0.04;

        float beam = beamShape(uv, angle, offset, width);
        totalBeamLight += beam;
    }
    totalBeamLight = min(totalBeamLight, 1.0);

    // Depth layers: beam light with parallax + dust particles
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 8.0 * depth;

        float parallax = 1.0 - z * 0.4;
        vec2 luv = (uv - 0.5) * parallax + 0.5;

        // Recompute beams at this layer's parallax
        float layerBeam = 0.0;
        for (int b = 0; b < 7; b++) {
            if (b >= numBeams) break;
            float fb = float(b);
            float angle = -0.4 - fb * 0.15 + sin(t * 0.1 + fb) * 0.05;
            float offset = -0.6 + fb * (1.4 / beamCount) + 0.2;
            float width = 0.06 + hash(vec2(fb, 3.3)) * 0.04;
            // Deeper layers have slightly shifted beams for parallax
            float depthOffset = z * 0.08;
            layerBeam += beamShape(luv, angle, offset + depthOffset, width * (1.0 + z * 0.3));
        }
        layerBeam = min(layerBeam, 1.0);

        // Volumetric glow per layer
        float brightness = (1.0 - z * 0.6) * intensity;
        vec3 beamCol = vec3(
            1.0,
            0.85 + 0.1 * sin(colorShift),
            0.5 + 0.2 * sin(colorShift + 1.0)
        );
        beamCol *= 1.0 + high * 0.2;
        col += beamCol * layerBeam * brightness * 0.12;

        // Dust particles: hash-based dots that drift slowly
        if (dustAmount > 0.0) {
            vec2 dustUV = luv * (15.0 + fi * 3.0);
            // Slow drift
            dustUV += vec2(t * 0.05 * (1.0 + fi * 0.1), -t * 0.02 + fi * 0.3);
            vec2 dustCell = floor(dustUV);
            vec2 dustFrac = fract(dustUV);

            float dh = hash(dustCell + fi * 13.7);
            vec2 dustPos = vec2(
                0.2 + dh * 0.6,
                0.2 + hash(dustCell + fi * 27.1 + 50.0) * 0.6
            );
            // Gentle floating motion
            dustPos.y += sin(t * 0.5 + dh * 6.28) * 0.1;
            dustPos.x += cos(t * 0.3 + dh * 4.0) * 0.08;

            float d = length(dustFrac - dustPos);
            float dustSize = 0.03 + dh * 0.02;
            float dust = smoothstep(dustSize, dustSize * 0.2, d);

            // Only visible in light beams
            float inBeam = layerBeam;
            float dustBright = dust * inBeam * brightness * dustAmount * 0.5;
            dustBright *= 0.5 + beat * 0.3;
            col += beamCol * dustBright;
        }
    }

    // Dark ambient outside beams
    float darkness = 1.0 - totalBeamLight * 0.6;
    col += vec3(0.02, 0.015, 0.01) * darkness;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.4;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
