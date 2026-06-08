/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Sol LeWitt inspired modular pyramid structures - shapes rotate around center",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.3},
        {"NAME": "pyramidCount", "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 4.0},
        {"NAME": "lineWeight", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.2},
        {"NAME": "zoom", "TYPE": "float", "MIN": 0.3, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "rotateStyle", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 0.0},
        {"NAME": "divisions", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 3.0},
        {"NAME": "colorMode", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
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

float pyramid(vec3 p, float size, float r, int divs) {
    float d = 1e10;

    vec3 apex = vec3(0.0, size, 0.0);
    vec3 b1 = vec3(-size, 0.0, -size);
    vec3 b2 = vec3(size, 0.0, -size);
    vec3 b3 = vec3(size, 0.0, size);
    vec3 b4 = vec3(-size, 0.0, size);

    d = min(d, lineSegment(p, b1, b2, r));
    d = min(d, lineSegment(p, b2, b3, r));
    d = min(d, lineSegment(p, b3, b4, r));
    d = min(d, lineSegment(p, b4, b1, r));

    d = min(d, lineSegment(p, b1, apex, r));
    d = min(d, lineSegment(p, b2, apex, r));
    d = min(d, lineSegment(p, b3, apex, r));
    d = min(d, lineSegment(p, b4, apex, r));

    for (int i = 1; i < 6; i++) {
        if (i >= divs) break;

        float fi = float(i) / float(divs);
        float levelY = fi * size;
        float levelSize = size * (1.0 - fi);

        vec3 l1 = vec3(-levelSize, levelY, -levelSize);
        vec3 l2 = vec3(levelSize, levelY, -levelSize);
        vec3 l3 = vec3(levelSize, levelY, levelSize);
        vec3 l4 = vec3(-levelSize, levelY, levelSize);

        d = min(d, lineSegment(p, l1, l2, r * 0.7));
        d = min(d, lineSegment(p, l2, l3, r * 0.7));
        d = min(d, lineSegment(p, l3, l4, r * 0.7));
        d = min(d, lineSegment(p, l4, l1, r * 0.7));
    }

    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera looks at origin, zoom affects distance
    vec3 ro = vec3(0.0, 0.0, -3.0 / zoom);
    vec3 rd = normalize(vec3(uv, 1.0));

    float lineR = lineWeight * 0.006;
    int divs = int(floor(divisions));
    int count = int(floor(pyramidCount));
    int style = int(floor(rotateStyle));

    vec3 col = vec3(0.0);
    float minDist = 1e10;

    for (int pyr = 0; pyr < 12; pyr++) {
        if (pyr >= count) break;

        float fpyr = float(pyr);
        float pyrSize = 0.15 + fpyr * 0.1;

        // Rotation based on style - shapes rotate around their center (origin)
        mat3 pyrRot;
        float dir = 1.0;
        if (style == 3) {
            dir = mod(fpyr, 2.0) < 1.0 ? 1.0 : -1.0;
        }

        if (style == 0) {
            pyrRot = rotY(t * dir);
        } else if (style == 1) {
            pyrRot = rotX(t * dir);
        } else if (style == 2) {
            pyrRot = rotZ(t * dir);
        } else if (style == 3) {
            pyrRot = rotY(t * dir);
        } else {
            pyrRot = rotY(t) * rotX(t * 0.7) * rotZ(t * 0.4);
        }

        float depth = 0.0;
        for (int i = 0; i < 80; i++) {
            vec3 p = ro + rd * depth;
            vec3 rp = pyrRot * p;

            float d = pyramid(rp, pyrSize, lineR, divs);
            minDist = min(minDist, d);

            if (d < 0.001) {
                float brightness = 1.0 - depth * 0.15;
                float depthFade = 1.0 - fpyr / pyramidCount * 0.4;

                if (colorMode > 0.5) {
                    float h = atan(rp.x, rp.z) / (PI * 2.0) + 0.5;
                    col = max(col, hsv2rgb(vec3(h, 0.6, brightness * depthFade)));
                } else {
                    col = max(col, vec3(brightness * depthFade));
                }
                break;
            }

            depth += d * 0.7;
            if (depth > 8.0) break;
        }
    }

    float ao = smoothstep(0.0, 0.1, minDist);
    col = col * (0.5 + ao * 0.5);

    vec3 bg = mix(vec3(0.02), vec3(0.06), uv.y + 0.5);
    col = max(col, bg * (1.0 - smoothstep(0.0, 0.2, minDist)));

    gl_FragColor = vec4(col, 1.0);
}
