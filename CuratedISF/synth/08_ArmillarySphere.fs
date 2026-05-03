/*{
    "DESCRIPTION": "Gyroscope armillary sphere with translucent orbital rings",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "ringCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "tilt", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    
    float baseR = 0.25;
    
    for (float i = 0.0; i < 8.0; i++) {
        if (i >= ringCount) break;
        
        float tiltAngle = i * PI / ringCount * tilt + t * (0.2 + i * 0.05);
        
        // Project 3D ellipse to 2D
        vec2 p = uv;
        p *= rot(tiltAngle);
        
        float r = baseR + i * 0.02;
        float eccentricity = 0.3 + 0.5 * abs(sin(i * 0.7 + t * 0.3)) * tilt;
        
        float ellipseDist = length(vec2(p.x / (1.0), p.y / eccentricity)) - r;
        float ring = abs(ellipseDist);
        
        float glow = 0.001 / (ring + 0.002);
        float alpha = 0.4 + 0.3 * sin(i * 1.5);
        
        vec3 ringCol = mix(vec3(0.6, 0.6, 0.9), vec3(0.8, 0.7, 1.0), i / ringCount);
        col += ringCol * glow * alpha;
    }
    
    // Central sphere glow
    float d = length(uv);
    col += vec3(0.7, 0.75, 0.95) * 0.01 / (d * d + 0.005);
    
    // Background gradient
    col += vec3(0.15, 0.15, 0.25) * smoothstep(0.6, 0.0, d);
    
    gl_FragColor = vec4(col, 1.0);
}
