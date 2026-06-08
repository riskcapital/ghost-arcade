/*{
    "DESCRIPTION": "Atomic orbital model with electron paths and nucleus",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "orbits", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 6.0},
        {"NAME": "electronSize", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.005, "MAX": 0.05}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    
    // Nucleus
    float nd = length(uv);
    col += vec3(0.8, 0.6, 1.0) * 0.01 / (nd * nd + 0.002);
    
    // Smaller nucleus dots
    for (float i = 0.0; i < 3.0; i++) {
        float a = i * PI * 2.0 / 3.0 + t * 0.5;
        vec2 np = 0.015 * vec2(cos(a), sin(a));
        float d = length(uv - np);
        col += vec3(0.7, 0.5, 1.0) * 0.002 / (d * d + 0.0005);
    }
    
    // Orbital ellipses and electrons
    for (float i = 0.0; i < 6.0; i++) {
        if (i >= orbits) break;
        
        float orbitR = 0.1 + i * 0.07;
        float tiltAngle = i * PI / orbits + PI * 0.15;
        float orbitSpeed = (1.0 + i * 0.3) * t;
        
        // Elliptical orbit path
        float eccentricity = 0.3 + 0.2 * sin(i * 1.5);
        
        // Draw orbit path (was 60 samples → 30; ellipse still reads as a smooth curve at this resolution).
        for (float s = 0.0; s < 30.0; s++) {
            float a = s * PI * 2.0 / 30.0;
            vec2 orbPoint = vec2(cos(a) * orbitR, sin(a) * orbitR * eccentricity);
            
            // Rotate by tilt
            float c = cos(tiltAngle), sn = sin(tiltAngle);
            orbPoint = vec2(orbPoint.x * c - orbPoint.y * sn, orbPoint.x * sn + orbPoint.y * c);
            
            float d = length(uv - orbPoint);
            col += vec3(0.3, 0.4, 0.7) * 0.00001 / (d * d + 0.00005);
        }
        
        // Electron
        float ea = orbitSpeed;
        vec2 electronPos = vec2(cos(ea) * orbitR, sin(ea) * orbitR * eccentricity);
        float c = cos(tiltAngle), sn = sin(tiltAngle);
        electronPos = vec2(electronPos.x * c - electronPos.y * sn, electronPos.x * sn + electronPos.y * c);
        
        float ed = length(uv - electronPos);
        col += vec3(0.6, 0.7, 1.0) * electronSize * electronSize / (ed * ed + 0.0001);
    }
    
    gl_FragColor = vec4(col, 1.0);
}
