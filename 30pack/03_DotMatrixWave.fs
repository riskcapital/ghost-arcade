/*{
    "DESCRIPTION": "Undulating dot matrix wave form - flowing particle grid",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "waveAmp", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "gridSize", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 50.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    
    // Create a flowing dot matrix with wave displacement
    vec2 grid = uv * gridSize;
    vec2 id = floor(grid);
    vec2 gv = fract(grid) - 0.5;
    
    for (float y = -1.0; y <= 1.0; y++) {
        for (float x = -1.0; x <= 1.0; x++) {
            vec2 offset = vec2(x, y);
            vec2 cellId = id + offset;
            
            // Wave displacement
            float wave = sin(cellId.x * 0.3 + t) * cos(cellId.y * 0.2 + t * 0.7) * waveAmp;
            float wave2 = cos(cellId.x * 0.15 - t * 0.5) * sin(cellId.y * 0.25 + t * 0.3) * waveAmp;
            
            vec2 dotPos = offset - gv + vec2(wave, wave2) * 0.3;
            float d = length(dotPos);
            
            float sz = 0.08 + 0.04 * sin(cellId.x * 0.5 + cellId.y * 0.3 + t);
            col += smoothstep(sz, sz - 0.02, d) * 0.6;
            col += 0.001 / (d + 0.01);
        }
    }
    
    // Perspective fade
    float fade = smoothstep(0.8, 0.0, abs(uv.x)) * smoothstep(0.5, 0.0, abs(uv.y - 0.1));
    col *= fade * 0.7 + 0.3;
    
    gl_FragColor = vec4(vec3(col), 1.0);
}
