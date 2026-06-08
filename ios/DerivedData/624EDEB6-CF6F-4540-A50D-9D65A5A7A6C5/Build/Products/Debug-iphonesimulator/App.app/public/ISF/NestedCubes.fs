/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Sol LeWitt inspired nested cube structures - shapes rotate around center",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.3},
        {"NAME": "cubeCount", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "lineWeight", "TYPE": "float", "MIN": 0.3, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "zoom", "TYPE": "float", "MIN": 0.3, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "rotateStyle", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 0.0},
        {"NAME": "colorGradient", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "spacing", "TYPE": "float", "MIN": 0.02, "MAX": 0.15, "DEFAULT": 0.06}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

mat3 rotX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotZ(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

float lineSegment(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

float wireCube(vec3 p, float size, float r) {
    float d = 1e10;
    float s = size;

    d = min(d, lineSegment(p, vec3(-s, -s, -s), vec3(s, -s, -s), r));
    d = min(d, lineSegment(p, vec3(-s, s, -s), vec3(s, s, -s), r));
    d = min(d, lineSegment(p, vec3(-s, -s, s), vec3(s, -s, s), r));
    d = min(d, lineSegment(p, vec3(-s, s, s), vec3(s, s, s), r));

    d = min(d, lineSegment(p, vec3(-s, -s, -s), vec3(-s, s, -s), r));
    d = min(d, lineSegment(p, vec3(s, -s, -s), vec3(s, s, -s), r));
    d = min(d, lineSegment(p, vec3(-s, -s, s), vec3(-s, s, s), r));
    d = min(d, lineSegment(p, vec3(s, -s, s), vec3(s, s, s), r));

    d = min(d, lineSegment(p, vec3(-s, -s, -s), vec3(-s, -s, s), r));
    d = min(d, lineSegment(p, vec3(s, -s, -s), vec3(s, -s, s), r));
    d = min(d, lineSegment(p, vec3(-s, s, -s), vec3(-s, s, s), r));
    d = min(d, lineSegment(p, vec3(s, s, -s), vec3(s, s, s), r));

    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera looks at origin from fixed distance, zoom affects distance
    vec3 ro = vec3(0.0, 0.0, -3.0 / zoom);
    vec3 rd = normalize(vec3(uv, 1.0));

    float lineR = lineWeight * 0.004;
    vec3 col = vec3(0.0);
    int count = int(floor(cubeCount));
    int style = int(floor(rotateStyle));

    for (int c = 0; c < 20; c++) {
        if (c >= count) break;

        float fc = float(c);
        float cubeSize = 0.1 + fc * spacing;

        // Rotation based on style - shapes rotate around their own center (origin)
        mat3 cubeRot;
        float dir = 1.0;
        if (style == 3) { // Alternate direction per cube
            dir = mod(fc, 2.0) < 1.0 ? 1.0 : -1.0;
        }

        if (style == 0) {
            // Rotate Y axis
            cubeRot = rotY(t * dir);
        } else if (style == 1) {
            // Rotate X axis
            cubeRot = rotX(t * dir);
        } else if (style == 2) {
            // Rotate Z axis
            cubeRot = rotZ(t * dir);
        } else if (style == 3) {
            // Alternate direction per cube (Y axis)
            cubeRot = rotY(t * dir);
        } else {
            // All axes
            cubeRot = rotY(t) * rotX(t * 0.7) * rotZ(t * 0.4);
        }

        float depth = 0.0;
        // Inner raymarch was 48 steps — trimmed to 32 (this is the hottest inner loop across all defaults).
        for (int i = 0; i < 32; i++) {
            vec3 p = ro + rd * depth;

            // Rotate the point around origin (cube center)
            vec3 rp = cubeRot * p;

            float d = wireCube(rp, cubeSize, lineR);

            if (d < 0.002) {
                float brightness = 1.0 - depth * 0.1;
                float depthFade = 1.0 - fc / cubeCount;

                vec3 cubeColor;
                if (colorGradient > 0.01) {
                    float h = fc / cubeCount * colorGradient;
                    cubeColor = hsv2rgb(vec3(h, 0.7, brightness * depthFade));
                } else {
                    cubeColor = vec3(brightness * depthFade);
                }

                col = max(col, cubeColor);
                break;
            }

            depth += d * 0.8;
            if (depth > 10.0) break;
        }
    }

    float bg = 0.02 + length(uv) * 0.02;
    col = max(col, vec3(bg));

    gl_FragColor = vec4(col, 1.0);
}
