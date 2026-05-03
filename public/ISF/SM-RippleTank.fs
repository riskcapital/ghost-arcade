/*{
    "DESCRIPTION": "Ripple tank simulation with waves emanating from moving sources and reflecting off frame edges",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "sourceCount", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 3.0},
        {"NAME": "waveFrequency", "TYPE": "float", "MIN": 5.0, "MAX": 50.0, "DEFAULT": 20.0},
        {"NAME": "waveSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "decay", "TYPE": "float", "MIN": 0.5, "MAX": 5.0, "DEFAULT": 2.0},
        {"NAME": "moveSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "colorIntensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "reflections", "TYPE": "bool", "DEFAULT": true}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 getSourcePos(float id) {
    float t = TIME * moveSpeed;
    float x = abs(fract((fract(sin(id * 127.1) * 43758.5) + sin(id * 1.7 + 0.5) * 0.3 * t * 0.1) * 0.5) * 2.0 - 1.0);
    float y = abs(fract((fract(sin(id * 311.7) * 43758.5) + cos(id * 2.3 + 0.8) * 0.25 * t * 0.1) * 0.5) * 2.0 - 1.0);
    return vec2(x * 0.8 + 0.1, y * 0.8 + 0.1);
}

float ripple(vec2 uv, vec2 src, float t) {
    float dist = length(uv - src);
    float wave = sin(dist * waveFrequency - t * waveSpeed * 6.2832) * exp(-dist * decay);
    return wave;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2(uv.x * aspect, uv.y);
    float t = TIME;
    
    float totalWave = 0.0;
    int count = int(sourceCount);
    
    for (int i = 0; i < 6; i++) {
        if (i >= count) break;
        vec2 src = getSourcePos(float(i));
        src.x *= aspect;
        
        totalWave += ripple(p, src, t);
        
        // Reflected sources (mirror across edges)
        if (reflections) {
            totalWave += ripple(p, vec2(-src.x, src.y), t) * 0.5;
            totalWave += ripple(p, vec2(src.x + aspect, src.y), t) * 0.5;  // Right wall reflection hack
            totalWave += ripple(p, vec2(src.x, -src.y), t) * 0.5;
            totalWave += ripple(p, vec2(src.x, src.y + 1.0), t) * 0.5;  // Top reflection hack
        }
    }
    
    totalWave = clamp(totalWave, -1.0, 1.0);
    
    float hue = 0.55 + totalWave * 0.15;
    float sat = 0.6 + abs(totalWave) * 0.3;
    float val = 0.1 + abs(totalWave) * colorIntensity * 0.6;
    vec3 col = hsv2rgb(vec3(hue, sat, val));
    
    // Edge highlight where waves hit
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeWave = smoothstep(0.03, 0.0, edgeDist) * abs(totalWave) * 0.5;
    col += vec3(0.3, 0.6, 1.0) * edgeWave;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
