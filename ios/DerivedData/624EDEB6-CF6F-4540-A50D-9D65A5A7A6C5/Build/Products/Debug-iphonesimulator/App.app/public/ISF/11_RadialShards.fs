/*{
    "DESCRIPTION": "Explosive radial shards - geometric burst pattern",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "shardCount", "TYPE": "float", "DEFAULT": 24.0, "MIN": 8.0, "MAX": 48.0},
        {"NAME": "explosionForce", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    // Radial shards
    for (float i = 0.0; i < 48.0; i++) {
        if (i >= shardCount) break;
        
        float shardAngle = i * PI * 2.0 / shardCount + sin(t * 0.3 + i) * 0.1;
        float angleDiff = abs(mod(angle - shardAngle + PI, PI * 2.0) - PI);
        
        float shardWidth = 0.02 + 0.01 * hash(i * 7.3);
        float shardLen = 0.15 + 0.3 * hash(i * 3.7) * explosionForce;
        shardLen *= 0.8 + 0.2 * sin(t + i * 0.5);
        
        // Tapered shard shape
        float widthAtDist = shardWidth * (1.0 - d / shardLen);
        float shard = smoothstep(widthAtDist, 0.0, angleDiff * d);
        shard *= smoothstep(shardLen, 0.02, d);
        shard *= smoothstep(0.01, 0.03, d);
        
        col += shard;
    }
    
    // Central burst
    col += 0.05 / (d * d + 0.01);
    
    // Flying rectangles/debris
    for (float i = 0.0; i < 20.0; i++) {
        float a = hash(i * 13.7) * PI * 2.0 + t * 0.2;
        float r = 0.1 + hash(i * 7.1) * 0.4 * explosionForce;
        r += t * 0.05 * hash(i * 3.3);
        r = mod(r, 0.6);
        
        vec2 pos = r * vec2(cos(a), sin(a));
        vec2 dp = uv - pos;
        float rect = max(abs(dp.x), abs(dp.y));
        float sz = 0.005 + 0.01 * hash(i);
        col += smoothstep(sz, sz - 0.002, rect) * 0.3;
    }
    
    gl_FragColor = vec4(vec3(col), 1.0);
}
