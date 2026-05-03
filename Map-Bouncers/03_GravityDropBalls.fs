/*{
    "DESCRIPTION": "Balls drop from the top with gravity, bounce off the bottom and sides, gradually filling the space",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "ballCount", "TYPE": "float", "MIN": 3.0, "MAX": 20.0, "DEFAULT": 10.0},
        {"NAME": "ballSize", "TYPE": "float", "MIN": 0.02, "MAX": 0.12, "DEFAULT": 0.05},
        {"NAME": "gravity", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.8},
        {"NAME": "bounceDamping", "TYPE": "float", "MIN": 0.3, "MAX": 0.95, "DEFAULT": 0.7},
        {"NAME": "colorMode", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 getDropBallPos(float id) {
    float dropTime = fract(sin(id * 73.1) * 43758.5453) * 5.0;
    float t = max(TIME - dropTime, 0.0);
    float period = 3.14159 / sqrt(gravity);
    float bounceT = mod(t, period * 4.0);
    float g = gravity * 2.0;
    float vy0 = 0.0;
    float y = 1.0 - 0.5 * g * bounceT * bounceT;
    float dampFactor = pow(bounceDamping, floor(bounceT / period));
    y = 1.0 - (1.0 - abs(sin(bounceT * sqrt(g)))) * dampFactor;
    y = clamp(y, ballSize, 1.0 - ballSize);
    float vx = sin(id * 3.7) * 0.3;
    float x = abs(fract((fract(sin(id * 127.1) * 43758.5453) + vx * t * 0.15) * 0.5) * 2.0 - 1.0);
    x = clamp(x, ballSize, 1.0 - ballSize);
    return vec2(x, y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = vec3(0.01);
    int count = int(ballCount);
    for (int i = 0; i < 20; i++) {
        if (i >= count) break;
        float id = float(i);
        float dropTime = fract(sin(id * 73.1) * 43758.5453) * 5.0;
        if (TIME < dropTime) continue;
        float t = TIME - dropTime;
        float startX = fract(sin(id * 127.1 + 311.7) * 43758.5453);
        float vx = (fract(sin(id * 47.3) * 43758.5453) - 0.5) * 0.4;
        float x = abs(fract((startX + vx * t * 0.2) * 0.5) * 2.0 - 1.0);
        float g = gravity;
        float yRaw = 1.0 - 0.5 * g * t * t;
        float bounceH = 1.0;
        float y = 1.0;
        float tRemain = t;
        for (int b = 0; b < 10; b++) {
            float fallTime = sqrt(2.0 * bounceH / g);
            if (tRemain < fallTime) {
                y = bounceH - 0.5 * g * tRemain * tRemain;
                break;
            }
            tRemain -= fallTime;
            bounceH *= bounceDamping;
            float riseTime = sqrt(2.0 * bounceH / g);
            if (tRemain < riseTime) {
                y = 0.5 * g * tRemain * tRemain * (2.0 * bounceH / (riseTime * riseTime)) - 0.5 * g * tRemain * tRemain + bounceH * tRemain / riseTime;
                y = tRemain * sqrt(2.0 * g * bounceH) - 0.5 * g * tRemain * tRemain;
                break;
            }
            tRemain -= riseTime;
        }
        y = clamp(y * 0.8 + 0.05, ballSize, 1.0 - ballSize);
        x = clamp(x, ballSize, 1.0 - ballSize);
        vec2 pos = vec2(x, y);
        vec2 diff = uv - pos;
        diff.x *= aspect;
        float dist = length(diff);
        float hue = fract(id * 0.137 + colorMode);
        vec3 ballCol = hsv2rgb(vec3(hue, 0.8, 1.0));
        float glow = (ballSize * 0.5) / (dist + 0.001);
        glow = clamp(glow, 0.0, 3.0);
        col += ballCol * glow * 0.15;
        float solid = smoothstep(ballSize, ballSize * 0.7, dist);
        col += ballCol * solid * 0.8;
        float highlight = smoothstep(ballSize * 0.5, ballSize * 0.2, dist);
        col += vec3(highlight * 0.3);
    }
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
