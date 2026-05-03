/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Scanning laser beam effect",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "beamCount", "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 4.0},
        {"NAME": "scanSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "beamWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.05, "DEFAULT": 0.01},
        {"NAME": "glowSize", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.05},
        {"NAME": "hueShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359
#define TAU 6.28318530718

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * scanSpeed;
    vec3 col = vec3(0.0);

    int beams = int(beamCount);
    for (int i = 0; i < 12; i++) {
        if (i >= beams) break;

        float fi = float(i);
        float phase = fi * TAU / beamCount + hash(fi) * 0.5;

        // Beam angle oscillation
        float angle = sin(t * (0.5 + fi * 0.2) + phase) * PI * 0.4;
        angle += sin(t * 1.3 + fi) * 0.2;

        // Beam direction
        vec2 dir = vec2(cos(angle), sin(angle));

        // Origin point (can be varied)
        vec2 origin = vec2(0.0, -0.3);

        // Distance from beam line
        vec2 toPoint = uv - origin;
        float alongBeam = dot(toPoint, dir);
        float perpDist = abs(dot(toPoint, vec2(-dir.y, dir.x)));

        // Only show beam going forward
        float forwardMask = smoothstep(0.0, 0.1, alongBeam);

        // Beam core
        float beam = smoothstep(beamWidth, 0.0, perpDist) * forwardMask;

        // Beam glow
        float glow = exp(-perpDist / glowSize) * forwardMask * 0.5;

        // Beam falloff with distance
        float falloff = 1.0 / (1.0 + alongBeam * alongBeam * 0.5);

        // Color
        float hue = fract(fi / beamCount * 0.5 + hueShift + t * 0.1);
        vec3 beamCol = hsv2rgb(vec3(hue, 0.9, 1.0));

        col += beamCol * (beam + glow) * falloff;
    }

    // Fog/atmosphere
    float fog = exp(-length(uv) * 2.0) * 0.1;
    col += vec3(0.1, 0.1, 0.15) * fog;

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
