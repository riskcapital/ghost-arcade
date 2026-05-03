/*{
    "DESCRIPTION": "Lunar surface texture with embedded ring craters",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "craterCount", "TYPE": "float", "DEFAULT": 12.0, "MIN": 3.0, "MAX": 20.0},
        {"NAME": "roughness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0}
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

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
        v += a * noise(p); p *= 2.0; a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float t = TIME * speed;
    
    // Base terrain texture
    float terrain = fbm(uv * 8.0 * roughness + t * 0.05);
    terrain = terrain * 0.5 + 0.25;
    
    // Fine detail
    float detail = fbm(uv * 20.0 * roughness + t * 0.02) * 0.2;
    terrain += detail;
    
    // Craters with Saturn-like rings inside
    for (float i = 0.0; i < 20.0; i++) {
        if (i >= craterCount) break;
        
        float h1 = hash(vec2(i * 1.7, 3.1));
        float h2 = hash(vec2(7.3, i * 2.3));
        float h3 = hash(vec2(i, i));
        
        vec2 craterPos = vec2(h1, h2);
        float craterR = 0.03 + 0.06 * h3;
        
        float d = length(uv - craterPos);
        
        // Crater depression
        float crater = smoothstep(craterR, craterR * 0.3, d) * 0.3;
        terrain -= crater;
        
        // Crater rim
        float rim = smoothstep(craterR * 1.2, craterR, d) - smoothstep(craterR, craterR * 0.8, d);
        terrain += rim * 0.15;
        
        // Ring inside crater
        float ringDist = abs(d - craterR * 0.5);
        float ring = smoothstep(0.005, 0.001, ringDist) * smoothstep(craterR, craterR * 0.2, d);
        terrain += ring * 0.2;
    }
    
    // Directional lighting
    float light = terrain + 0.1;
    vec3 col = vec3(light * 0.7, light * 0.7, light * 0.75);
    
    gl_FragColor = vec4(col, 1.0);
}
