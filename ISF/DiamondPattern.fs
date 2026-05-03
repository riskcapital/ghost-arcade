/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated diamond tile pattern",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "tileSize", "TYPE": "float", "MIN": 2.0, "MAX": 20.0, "DEFAULT": 8.0},
        {"NAME": "animSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "depth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "glow", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "hueShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0}
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

float diamond(vec2 p) {
    return abs(p.x) + abs(p.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float t = iTime * animSpeed;

    // Rotate 45 degrees to create diamond grid
    mat2 rot = mat2(0.707, -0.707, 0.707, 0.707);
    vec2 p = rot * uv * tileSize;

    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;

    // Diamond shape
    float d = diamond(f);

    // Animated scale per tile
    float scale = sin(id.x * 1.3 + id.y * 0.7 + t * 3.0) * 0.2 + 0.8;
    d *= scale;

    // Create layered effect
    float edge = smoothstep(0.5, 0.4, d);
    float inner = smoothstep(0.3, 0.2, d) * depth;

    // Color based on tile position
    float hue = fract((id.x + id.y) * 0.1 + t * 0.1 + hueShift);
    float brightness = edge * glow;

    vec3 col = hsv2rgb(vec3(hue, 0.7, brightness));
    col += hsv2rgb(vec3(hue + 0.2, 0.5, inner * 0.5));

    // Subtle background
    col += vec3(0.02, 0.02, 0.05) * (1.0 - edge);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
