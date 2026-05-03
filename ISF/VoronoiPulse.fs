/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Pulsing voronoi cells with neon edges",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "cellCount", "TYPE": "float", "MIN": 3.0, "MAX": 30.0, "DEFAULT": 12.0},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "edgeGlow", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "colorSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2},
        {"NAME": "cellFill", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime * speed;
    vec2 st = uv * cellCount;
    vec2 i_st = floor(st);
    vec2 f_st = fract(st);

    float m_dist = 10.0;
    float m_dist2 = 10.0;
    vec2 m_point;
    float cellId = 0.0;

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = hash2(i_st + neighbor);
            point = 0.5 + 0.5 * sin(t * 2.0 + 6.2831 * point);
            vec2 diff = neighbor + point - f_st;
            float dist = length(diff);

            if (dist < m_dist) {
                m_dist2 = m_dist;
                m_dist = dist;
                m_point = point;
                cellId = dot(i_st + neighbor, vec2(1.0, 113.0));
            } else if (dist < m_dist2) {
                m_dist2 = dist;
            }
        }
    }

    float edge = m_dist2 - m_dist;
    float edgeLine = 1.0 - smoothstep(0.0, 0.1, edge);

    float hue = fract(cellId * 0.1 + iTime * colorSpeed);
    float pulse = sin(cellId + iTime * 3.0) * 0.5 + 0.5;

    vec3 col = hsv2rgb(vec3(hue, 0.8, 1.0)) * edgeLine * edgeGlow;
    col += hsv2rgb(vec3(hue + 0.1, 0.6, pulse * cellFill)) * (1.0 - edgeLine);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
