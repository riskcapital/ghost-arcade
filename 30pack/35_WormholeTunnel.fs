/*{
    "DESCRIPTION": "Wormhole tunnel - infinite passage with grid walls and depth rings",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "tunnelRadius", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.1, "MAX": 0.8},
        {"NAME": "ringCount", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 30.0},
        {"NAME": "gridLines", "TYPE": "float", "DEFAULT": 16.0, "MIN": 4.0, "MAX": 32.0},
        {"NAME": "twist", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "convergence", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Vanishing Point"},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "edgeGlow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "offsetX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -0.3, "MAX": 0.3},
        {"NAME": "offsetY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -0.3, "MAX": 0.3}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    uv -= vec2(offsetX, offsetY);
    float t = TIME * speed;
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    vec3 col = vec3(0.0);
    
    // Map to tunnel coordinates
    float depth = tunnelRadius / (d + 0.001);
    float tunnelAngle = angle + twist * depth * 0.1 + t * 0.1;
    
    // Depth rings
    float depthPhase = fract(depth * 0.1 - t * 0.2);
    for (float i = 0.0; i < 30.0; i++) {
        if (i >= ringCount) break;
        float ringDepth = fract(i / ringCount - t * 0.2);
        float ringR = tunnelRadius / (ringDepth * 3.0 + convergence);
        
        float ringDist = abs(d - ringR);
        float ringGlow = 0.001 / (ringDist + 0.002);
        
        float depthFade = smoothstep(0.0, 0.3, ringDepth) * smoothstep(1.0, 0.7, ringDepth);
        
        vec3 ringCol = mix(vec3(0.3, 0.4, 0.8), vec3(0.6, 0.4, 0.9), ringDepth * colorShift);
        col += ringCol * ringGlow * depthFade * 0.3;
    }
    
    // Longitudinal grid lines
    for (float i = 0.0; i < 32.0; i++) {
        if (i >= gridLines) break;
        float lineAngle = i * PI * 2.0 / gridLines + twist * 0.2 * sin(t + d * 3.0);
        
        float angleDiff = abs(mod(angle - lineAngle + PI, PI * 2.0) - PI);
        float lineDist = angleDiff * d;
        float lineGlow = 0.001 / (lineDist + 0.003);
        lineGlow *= smoothstep(0.0, 0.1, d); // Fade near center
        
        vec3 lineCol = mix(vec3(0.2, 0.3, 0.6), vec3(0.4, 0.3, 0.7), colorShift);
        col += lineCol * lineGlow * 0.15;
    }
    
    // Central vanishing point glow
    float coreGlow = convergence * 0.01 / (d * d + 0.005);
    col += mix(vec3(0.5, 0.6, 1.0), vec3(0.8, 0.6, 1.0), colorShift) * coreGlow;
    
    // Edge glow at tunnel mouth
    float edgeDist = abs(d - tunnelRadius * 0.8);
    float edge = exp(-edgeDist * edgeDist * 100.0) * edgeGlow;
    col += vec3(0.4, 0.5, 0.9) * edge * 0.5;
    
    // Depth fog
    col *= smoothstep(0.0, 0.05, d);
    
    gl_FragColor = vec4(col, 1.0);
}
