/*{
    "DESCRIPTION": "Interlocking weave pattern with depth, color variation, and audio-reactive motion",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "weaveScale", "TYPE": "float", "DEFAULT": 10.0, "MIN": 3.0, "MAX": 25.0},
        {"NAME": "threadWidth", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.3, "MAX": 0.95},
        {"NAME": "colorMix", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    // Audio reactivity
    float bassWarp = audioBass * 0.15;
    float midColor = audioMid * 0.5;
    float beatBright = 1.0 + audioBeat * 0.8;
    float highDetail = 1.0 + audioHigh * 0.3;

    // Weave grid
    vec2 wUV = uv * vec2(aspect, 1.0) * weaveScale;

    // Add audio-driven warp
    wUV.x += sin(uv.y * 20.0 + t * 3.0) * bassWarp;
    wUV.y += cos(uv.x * 20.0 + t * 2.0) * bassWarp;

    vec2 cellID = floor(wUV);
    vec2 cellUV = fract(wUV);

    // Determine weave pattern: over/under alternation
    float checker = mod(cellID.x + cellID.y, 2.0);

    // Thread masks - horizontal and vertical
    float hThread = smoothstep(0.5 - threadWidth * 0.5, 0.5 - threadWidth * 0.5 + 0.05, cellUV.y)
                  * smoothstep(0.5 + threadWidth * 0.5, 0.5 + threadWidth * 0.5 - 0.05, cellUV.y);
    float vThread = smoothstep(0.5 - threadWidth * 0.5, 0.5 - threadWidth * 0.5 + 0.05, cellUV.x)
                  * smoothstep(0.5 + threadWidth * 0.5, 0.5 + threadWidth * 0.5 - 0.05, cellUV.x);

    // Weave crossing: which thread is on top
    float hTop = hThread * checker;
    float vTop = vThread * (1.0 - checker);

    // Thread colors - warp (vertical) and weft (horizontal)
    float hue1 = 0.6 + colorMix * 0.3 + t * 0.02 + midColor * 0.1;
    float hue2 = 0.0 + colorMix * 0.2 + t * 0.02 + midColor * 0.1;

    vec3 warpColor = vec3(
        0.3 + 0.4 * sin(hue1 * 6.28),
        0.3 + 0.4 * sin(hue1 * 6.28 + 2.09),
        0.3 + 0.4 * sin(hue1 * 6.28 + 4.18)
    ) * highDetail;

    vec3 weftColor = vec3(
        0.3 + 0.4 * sin(hue2 * 6.28),
        0.3 + 0.4 * sin(hue2 * 6.28 + 2.09),
        0.3 + 0.4 * sin(hue2 * 6.28 + 4.18)
    ) * highDetail;

    // Depth shading - thread that is underneath is darker
    float shadowH = 1.0 - depth * (1.0 - checker) * 0.5;
    float shadowV = 1.0 - depth * checker * 0.5;

    // Compose
    vec3 col = vec3(0.05);
    col = mix(col, weftColor * shadowH, hThread);
    col = mix(col, warpColor * shadowV, vThread);

    // Top thread overwrites
    if (hTop > 0.5) {
        col = weftColor;
    }
    if (vTop > 0.5) {
        col = warpColor;
    }

    // Subtle thread texture
    float threadTex = 0.9 + 0.1 * sin(wUV.x * 50.0) * sin(wUV.y * 50.0);
    col *= threadTex;

    // Beat brightness
    col *= beatBright;

    gl_FragColor = vec4(col, 1.0);
}
