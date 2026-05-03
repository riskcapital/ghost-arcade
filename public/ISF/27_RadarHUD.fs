/*{
    "DESCRIPTION": "Concentric radar rings - technical HUD with scanning beam",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "rings", "TYPE": "float", "DEFAULT": 10.0, "MIN": 3.0, "MAX": 20.0},
        {"NAME": "scanSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    vec3 col = vec3(0.0);
    vec3 lineCol = vec3(0.3, 0.4, 0.9);
    
    // Concentric rings
    for (float i = 1.0; i <= 20.0; i++) {
        if (i > rings) break;
        float r = i * 0.04;
        float ring = abs(d - r);
        float alpha = 0.3 + 0.3 * (1.0 - i / rings);
        col += lineCol * 0.001 / (ring + 0.002) * alpha;
    }
    
    // Radial lines
    for (float i = 0.0; i < 8.0; i++) {
        float a = i * PI / 4.0;
        vec2 dir = vec2(cos(a), sin(a));
        float lineDist = abs(dot(uv, vec2(-dir.y, dir.x)));
        col += lineCol * 0.0003 / (lineDist + 0.003) * 0.3;
    }
    
    // Scanning beam
    float scanAngle = t * scanSpeed;
    float beamAngle = angle - scanAngle;
    beamAngle = mod(beamAngle + PI, PI * 2.0) - PI;
    float beam = smoothstep(0.0, -0.8, beamAngle) * smoothstep(-1.2, -0.8, beamAngle);
    col += lineCol * beam * 0.3 * smoothstep(0.5, 0.0, d);
    
    // Leading edge of beam
    float edge = smoothstep(0.02, 0.0, abs(beamAngle));
    col += lineCol * edge * 0.5;
    
    // Blips
    for (float i = 0.0; i < 5.0; i++) {
        float ba = fract(sin(i * 127.1) * 43758.5) * PI * 2.0;
        float br = 0.1 + fract(sin(i * 311.7) * 43758.5) * 0.3;
        vec2 blipPos = br * vec2(cos(ba), sin(ba));
        float bd = length(uv - blipPos);
        
        float blipAngle = ba - scanAngle;
        blipAngle = mod(blipAngle + PI, PI * 2.0) - PI;
        float blipFade = smoothstep(0.0, -2.0, blipAngle);
        
        col += vec3(0.5, 0.6, 1.0) * 0.003 / (bd + 0.005) * blipFade;
    }
    
    // Center dot
    col += vec3(0.5, 0.6, 1.0) * 0.005 / (d * d + 0.002);
    
    gl_FragColor = vec4(col, 1.0);
}
