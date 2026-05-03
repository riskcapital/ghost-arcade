/*{
    "DESCRIPTION": "Gyroscopic rings - interlocking 3D gimbal with occluded depth",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "ringPairs", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 6.0},
        {"NAME": "ringRadius", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 0.5},
        {"NAME": "ringWidth", "TYPE": "float", "DEFAULT": 0.008, "MIN": 0.002, "MAX": 0.02},
        {"NAME": "tiltRange", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 2.0},
        {"NAME": "precessionSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "depthShading", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "coreGlow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "colorSpread", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "bgDimness", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 0.2}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359
// RING_SAMPLES was 120.0 — trimmed to 80.0 (rings still render cleanly, ~33% fewer evals).
#define RING_SAMPLES 80.0

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 col = vec3(bgDimness);
    
    // For each ring, sample points along a 3D circle and project
    for (float ring = 0.0; ring < 6.0; ring++) {
        if (ring >= ringPairs) break;
        
        // Ring orientation (each ring tilted differently)
        float tiltA = ring * PI / ringPairs * tiltRange + t * precessionSpeed * (1.0 + ring * 0.3);
        float tiltB = ring * 0.7 + t * precessionSpeed * 0.5;
        
        float cosA = cos(tiltA), sinA = sin(tiltA);
        float cosB = cos(tiltB), sinB = sin(tiltB);
        
        float r = ringRadius - ring * 0.02;
        
        vec3 ringCol = mix(
            vec3(0.5, 0.6, 0.9),
            vec3(0.8, 0.6, 1.0),
            ring / ringPairs * colorSpread
        );
        
        for (float s = 0.0; s < RING_SAMPLES; s++) {
            float a = s / RING_SAMPLES * PI * 2.0;
            
            // 3D circle point
            vec3 p = vec3(cos(a) * r, sin(a) * r, 0.0);
            
            // Rotate around X axis (tilt)
            p = vec3(p.x, p.y * cosA - p.z * sinA, p.y * sinA + p.z * cosA);
            // Rotate around Y axis (precession)
            p = vec3(p.x * cosB + p.z * sinB, p.y, -p.x * sinB + p.z * cosB);
            
            // Project
            float perspective = 1.0 / (1.2 + p.z * 0.3);
            vec2 proj = p.xy * perspective;
            
            float d = length(uv - proj);
            
            // Depth-based brightness
            float zBright = mix(1.0, 0.3 + 0.7 * (0.5 + 0.5 * p.z / r), depthShading);
            
            float glow = ringWidth / (d + ringWidth * 0.3) * zBright;
            
            col += ringCol * glow * (1.0 / RING_SAMPLES) * 3.0;
        }
    }
    
    // Central core
    float d = length(uv);
    col += mix(vec3(0.5, 0.6, 1.0), vec3(0.8, 0.7, 1.0), colorSpread) * coreGlow * 0.008 / (d * d + 0.003);
    
    gl_FragColor = vec4(col, 1.0);
}
