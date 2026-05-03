/*{
    "DESCRIPTION": "Electric plasma tendrils - blue/purple energy discharge",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "tendrils", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 12.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 col = vec3(0.0);
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    for (float i = 0.0; i < 12.0; i++) {
        if (i >= tendrils) break;
        
        float baseAngle = i * PI * 2.0 / tendrils + t * 0.2;
        vec2 dir = vec2(cos(baseAngle), sin(baseAngle));
        
        // Tendril path with noise displacement
        float along = dot(uv, dir);
        float perp = dot(uv, vec2(-dir.y, dir.x));
        
        float displacement = fbm(vec2(along * 5.0, t * 2.0 + i * 3.0)) * 0.1;
        displacement += fbm(vec2(along * 10.0, t * 3.0 + i * 7.0)) * 0.05;
        
        float tendrilDist = abs(perp - displacement);
        
        // Only show in forward direction
        float mask = smoothstep(0.0, 0.05, along) * smoothstep(0.5, 0.1, along);
        
        float glow = 0.003 / (tendrilDist + 0.005) * mask * intensity;
        
        vec3 tendrilCol = mix(vec3(0.3, 0.2, 0.8), vec3(0.5, 0.7, 1.0), along * 2.0);
        col += tendrilCol * glow;
    }
    
    // Central core
    col += vec3(0.5, 0.4, 1.0) * 0.02 / (d * d + 0.005) * intensity;
    
    // Orbiting dots
    for (float i = 0.0; i < 8.0; i++) {
        float a = i * PI * 2.0 / 8.0 + t * 1.5;
        float r = 0.05 + 0.02 * sin(t * 3.0 + i);
        vec2 dotPos = r * vec2(cos(a), sin(a));
        float dd = length(uv - dotPos);
        col += vec3(0.4, 0.6, 1.0) * 0.001 / (dd * dd + 0.0002);
    }
    
    gl_FragColor = vec4(col, 1.0);
}
