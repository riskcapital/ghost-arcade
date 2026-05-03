/*{
    "DESCRIPTION": "Liquid Fill - Simulated fluid that sloshes and settles to the bottom of the shape with realistic wave physics",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "fillLevel", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "waveAmplitude", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.0, "MAX": 0.2},
        {"NAME": "viscosity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "surfaceTension", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "liquidColor", "TYPE": "color", "DEFAULT": [0.1, 0.4, 0.9, 1.0]},
        {"NAME": "surfaceColor", "TYPE": "color", "DEFAULT": [0.3, 0.7, 1.0, 1.0]},
        {"NAME": "foamColor", "TYPE": "color", "DEFAULT": [0.8, 0.9, 1.0, 1.0]},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "refraction", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    // Edge distance for shape awareness
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    
    // Multi-wave surface simulation
    float surface = fillLevel;
    float dampFactor = mix(1.0, 0.3, viscosity);
    
    // Primary sloshing waves
    surface += sin(uv.x * 3.14159 * 2.0 + t * 2.0) * waveAmplitude * dampFactor;
    surface += sin(uv.x * 3.14159 * 4.0 - t * 3.0) * waveAmplitude * 0.5 * dampFactor;
    surface += sin(uv.x * 3.14159 * 7.0 + t * 1.5) * waveAmplitude * 0.25 * dampFactor;
    
    // Edge interaction - waves reflect off walls
    float wallProx = min(edgeL, edgeR);
    float wallWave = exp(-wallProx * 8.0) * sin(t * 4.0) * waveAmplitude * 0.5;
    surface += wallWave;
    
    // Turbulent surface detail
    float turbNoise = fbm(vec2(uv.x * 6.0 + t * 0.5, t * 0.3)) * turbulence * 0.03;
    surface += turbNoise;
    
    // Surface tension - meniscus at edges
    float meniscus = exp(-wallProx * 15.0) * surfaceTension * 0.04;
    surface += meniscus;
    
    // Liquid body
    float liquidMask = smoothstep(surface + 0.005, surface - 0.005, uv.y);
    
    // Depth color variation
    float depth = max(0.0, surface - uv.y);
    vec3 deepColor = liquidColor.rgb * 0.4;
    vec3 bodyColor = mix(liquidColor.rgb, deepColor, depth * 3.0);
    
    // Caustic patterns underwater
    float caustic1 = noise(vec2(uv.x * 8.0 + t, uv.y * 8.0 + t * 0.5));
    float caustic2 = noise(vec2(uv.x * 12.0 - t * 0.7, uv.y * 12.0 + t * 0.3));
    float caustics = pow(caustic1 * caustic2, 2.0) * refraction * 2.0;
    bodyColor += caustics * 0.3 * (1.0 - depth * 2.0);
    
    // Refraction distortion near surface
    float surfProx = abs(uv.y - surface);
    float refrDist = exp(-surfProx * 30.0) * refraction * 0.02;
    vec2 refrUV = uv + vec2(sin(uv.x * 20.0 + t * 3.0) * refrDist, 0.0);
    
    // Surface highlight / foam line
    float surfLine = exp(-surfProx * 80.0);
    vec3 surfCol = mix(surfaceColor.rgb, foamColor.rgb, surfLine * 0.5);
    
    // Foam particles on surface
    float foam = 0.0;
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float fx = hash(fi * 7.3) + sin(t * (0.3 + hash(fi * 3.1) * 0.5)) * 0.3;
        fx = fract(fx);
        float fy = surface + sin(fx * 6.28 + t * 2.0) * waveAmplitude * 0.3;
        float d = length(vec2((uv.x - fx) * 2.0, uv.y - fy));
        foam += smoothstep(0.02, 0.0, d) * 0.5;
    }
    
    // Bubbles rising
    float bubbles = 0.0;
    for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float bx = hash(fi * 13.7) * 0.8 + 0.1;
        float by = fract(hash(fi * 7.1) + t * (0.1 + hash(fi * 3.3) * 0.15));
        by *= surface;
        float bSize = 0.004 + hash(fi * 5.3) * 0.008;
        bx += sin(by * 10.0 + t + fi) * 0.02;
        float bd = length(vec2((uv.x - bx) * 1.5, uv.y - by));
        float bubble = smoothstep(bSize, bSize * 0.3, bd);
        float highlight = smoothstep(bSize * 0.8, bSize * 0.3, length(vec2(uv.x - bx + bSize * 0.3, uv.y - by + bSize * 0.3)));
        bubbles += bubble * 0.3 + highlight * 0.2;
    }
    
    // Compose
    vec3 col = vec3(0.0);
    col = mix(col, bodyColor + bubbles * foamColor.rgb * 0.5, liquidMask);
    col += surfCol * surfLine * liquidMask;
    col += foamColor.rgb * foam * liquidMask;
    
    // Edge glow underwater
    float edgeGlow = exp(-edgeDist * 20.0) * liquidMask * 0.3;
    col += surfaceColor.rgb * edgeGlow;
    
    // Bottom sediment/shadow
    float bottomShadow = exp(-uv.y * 8.0) * liquidMask * 0.2;
    col *= 1.0 - bottomShadow;
    
    gl_FragColor = vec4(col, 1.0);
}
