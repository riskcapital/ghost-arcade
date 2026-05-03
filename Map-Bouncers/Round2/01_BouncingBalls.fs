/*{
    "DESCRIPTION": "Multiple balls bouncing off the edges of the frame with physics-based motion",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "ballCount", "TYPE": "float", "MIN": 2.0, "MAX": 12.0, "DEFAULT": 6.0},
        {"NAME": "ballSize", "TYPE": "float", "MIN": 0.02, "MAX": 0.15, "DEFAULT": 0.06},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "glowIntensity", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "bgBrightness", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.02}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 getBallPos(float id) {
    float t = TIME * speed;
    float px = fract(sin(id * 127.1 + 311.7) * 43758.5453);
    float py = fract(sin(id * 269.5 + 183.3) * 43758.5453);
    float vx = sin(id * 1.7 + 0.5) * 0.6 + 0.3;
    float vy = cos(id * 2.3 + 0.8) * 0.5 + 0.4;
    float x = abs(fract((px + vx * t) * 0.5) * 2.0 - 1.0);
    float y = abs(fract((py + vy * t) * 0.5) * 2.0 - 1.0);
    return vec2(x, y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = vec3(bgBrightness);
    int count = int(ballCount);
    for (int i = 0; i < 12; i++) {
        if (i >= count) break;
        float id = float(i);
        vec2 pos = getBallPos(id);
        vec2 diff = uv - pos;
        diff.x *= aspect;
        float dist = length(diff);
        float glow = ballSize / dist * 0.1 * glowIntensity;
        float hue = fract(id * 0.13 + colorShift + TIME * 0.05);
        vec3 ballCol = hsv2rgb(vec3(hue, 0.85, 1.0));
        col += ballCol * glow;
        if (dist < ballSize) {
            col += ballCol * smoothstep(ballSize, ballSize * 0.3, dist) * 0.5;
        }
    }
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
