/*{
    "CREDIT": "Shrink Wrap",
    "DESCRIPTION": "Rising embers and sparks with volumetric smoke",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.6},
        {"NAME": "emberCount", "TYPE": "float", "MIN": 30.0, "MAX": 150.0, "DEFAULT": 80.0},
        {"NAME": "emberSize", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "smokeAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4},
        {"NAME": "heatGlow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "turbulence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    vec3 col = vec3(0.0);
    float emberGlow = 0.0;

    // Smoke layer
    float smoke = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 smokeUV = uv * (1.5 + fi * 0.5);
        smokeUV.y += t * (0.2 + fi * 0.1);
        smokeUV.x += snoise(smokeUV * 0.5 + t) * turbulence * 0.3;
        smoke += snoise(smokeUV) * (0.5 - fi * 0.15);
    }
    smoke = smoothstep(-0.5, 0.8, smoke) * smokeAmount;

    // Embers
    int count = int(emberCount);
    for (int i = 0; i < 150; i++) {
        if (i >= count) break;

        float fi = float(i);
        float seed = fi * 7.234;

        // Ember properties
        float lifetime = mod(t + hash(seed) * 5.0, 5.0);
        float age = lifetime / 5.0;

        // Position with rising motion
        float startX = (hash(seed + 1.0) - 0.5) * 1.5;
        float startY = -0.7;

        float riseSpeed = 0.3 + hash(seed + 2.0) * 0.2;
        float y = startY + lifetime * riseSpeed;

        // Horizontal drift with turbulence
        float drift = snoise(vec2(seed, t * 0.5)) * turbulence * 0.3;
        float x = startX + drift + sin(lifetime * 2.0 + seed) * 0.1;

        vec2 emberPos = vec2(x, y);

        // Fade out as ember rises
        float fade = 1.0 - age;
        fade *= smoothstep(0.0, 0.1, age);

        // Flicker
        float flicker = 0.7 + 0.3 * sin(t * 10.0 + seed * 5.0);

        // Distance to ember
        float d = length(uv - emberPos);
        float ember = 0.002 * emberSize * fade * flicker / (d + 0.001);

        emberGlow += ember;

        // Color varies with age (white -> yellow -> orange -> red)
        vec3 emberColor = mix(
            vec3(1.0, 0.9, 0.7),
            vec3(1.0, 0.3, 0.05),
            age
        );

        col += emberColor * ember;
    }

    // Heat glow from bottom
    float heat = exp(-pow((uv.y + 0.5) * 2.0, 2.0)) * heatGlow;
    heat *= 0.5 + 0.5 * snoise(vec2(uv.x * 3.0, t));

    // Combine
    col += vec3(0.08, 0.06, 0.05) * smoke;
    col += vec3(1.0, 0.3, 0.05) * heat * 0.3;
    col += vec3(1.0, 0.5, 0.2) * emberGlow * heatGlow * 0.3;

    // Background gradient
    float bgGrad = 1.0 - (uv.y + 0.5) * 0.5;
    col += vec3(0.05, 0.02, 0.01) * bgGrad;

    gl_FragColor = vec4(col, 1.0);
}
