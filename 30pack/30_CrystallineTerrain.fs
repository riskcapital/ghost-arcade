/*{
    "DESCRIPTION": "Crystalline terrain - white mineral landscape with sharp edges",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "scale", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "sharpness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float ridgedNoise(vec2 p) {
    return 1.0 - abs(noise(p) * 2.0 - 1.0);
}

float terrain(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
        v += a * ridgedNoise(p);
        p *= 2.0; a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float t = TIME * speed;
    
    // Camera perspective
    vec2 p = (uv - 0.5) * 2.0;
    p.y -= 0.3;
    
    // Simple perspective projection
    float z = 1.0 / (p.y + 1.2);
    float x = p.x * z;
    
    vec2 worldPos = vec2(x * 2.0, z * 3.0 + t) * scale;
    
    float h = terrain(worldPos * sharpness);
    
    // Lighting
    float eps = 0.01;
    float hx = terrain((worldPos + vec2(eps, 0.0)) * sharpness);
    float hy = terrain((worldPos + vec2(0.0, eps)) * sharpness);
    
    vec3 normal = normalize(vec3(h - hx, eps * 5.0, h - hy));
    vec3 light = normalize(vec3(0.5, 0.8, 0.3));
    float diff = max(dot(normal, light), 0.0);
    
    float spec = pow(max(dot(reflect(-light, normal), vec3(0, 1, 0)), 0.0), 16.0);
    
    vec3 col = vec3(0.75, 0.75, 0.8) * diff + vec3(0.15);
    col += vec3(0.9, 0.9, 0.95) * spec * 0.5;
    
    // Edge highlight for crystalline look
    float edge = abs(fract(h * 8.0) - 0.5) * 2.0;
    col += vec3(0.2) * pow(1.0 - edge, 4.0) * sharpness;
    
    // Depth fog
    float fog = 1.0 - exp(-z * 0.3);
    col = mix(col, vec3(0.6, 0.6, 0.65), fog);
    
    // Sky above horizon
    if (p.y > 0.3) {
        float skyGrad = (p.y - 0.3) * 2.0;
        col = mix(col, vec3(0.7, 0.7, 0.75), smoothstep(0.0, 0.3, skyGrad));
    }
    
    gl_FragColor = vec4(col, 1.0);
}
