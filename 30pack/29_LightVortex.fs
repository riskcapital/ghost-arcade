/*{
    "DESCRIPTION": "Light trail vortex - spiraling energy rings",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "spiralCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "trailLength", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0}
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
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    for (float i = 0.0; i < 10.0; i++) {
        if (i >= spiralCount) break;
        
        float offset = i * PI * 2.0 / spiralCount;
        
        // Spiral formula: r = a + b*theta
        float spiralAngle = angle + offset - t * 2.0;
        float spiralR = 0.05 + spiralAngle * 0.03 * trailLength;
        
        // Multiple wraps
        for (float wrap = -3.0; wrap <= 3.0; wrap++) {
            float wAngle = spiralAngle + wrap * PI * 2.0;
            float wR = 0.05 + wAngle * 0.03 * trailLength;
            
            if (wR > 0.0 && wR < 0.5) {
                float spiralDist = abs(d - wR);
                
                // Trail fade
                float fade = smoothstep(0.5, 0.05, wR);
                
                float glow = 0.002 / (spiralDist + 0.003) * fade;
                
                vec3 trailCol = mix(vec3(0.4, 0.5, 1.0), vec3(0.8, 0.7, 1.0), wR * 3.0);
                col += trailCol * glow;
            }
        }
    }
    
    // Central energy core
    col += vec3(0.6, 0.7, 1.0) * 0.02 / (d * d + 0.005);
    
    // Outer ring
    float outerRing = abs(d - 0.4);
    col += vec3(0.3, 0.4, 0.8) * 0.001 / (outerRing + 0.005) * 0.3;
    
    gl_FragColor = vec4(col, 1.0);
}
