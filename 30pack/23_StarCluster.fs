/*{
    "DESCRIPTION": "Star cluster - dense particle galaxy field",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "density", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 2.0},
        {"NAME": "clusterTightness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float starField(vec2 uv, float scale) {
    vec2 id = floor(uv * scale);
    vec2 gv = fract(uv * scale) - 0.5;
    float h = hash(id);
    float col = 0.0;
    if (h > 0.85) {
        float d = length(gv);
        float brightness = (h - 0.85) * 6.67;
        col = brightness * 0.01 / (d * d + 0.005);
    }
    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float d = length(uv);
    
    vec3 col = vec3(0.0);
    
    // Multiple star field layers
    float stars = 0.0;
    stars += starField(uv + t * 0.01, 20.0 * density);
    stars += starField(uv + t * 0.005 + 1.7, 40.0 * density);
    stars += starField(uv + t * 0.003 + 3.1, 80.0 * density);
    
    // Cluster concentration in center
    float clusterFade = exp(-d * d / (clusterTightness * clusterTightness) * 2.0);
    
    // Dense cluster particles
    for (float i = 0.0; i < 60.0; i++) {
        float h1 = hash(vec2(i, 1.0));
        float h2 = hash(vec2(i, 2.0));
        float h3 = hash(vec2(i, 3.0));
        
        float a = h1 * 6.28 + t * 0.05 * (h3 - 0.5);
        float r = h2 * clusterTightness * 0.5;
        
        vec2 pos = r * vec2(cos(a), sin(a));
        pos += vec2(sin(t * 0.1 + i), cos(t * 0.08 + i * 1.3)) * 0.02;
        
        float pd = length(uv - pos);
        float brightness = h3 * 0.5 + 0.5;
        col += vec3(0.8, 0.85, 1.0) * brightness * 0.001 / (pd * pd + 0.0002);
    }
    
    col += vec3(0.7, 0.75, 1.0) * stars;
    
    // Subtle nebula glow behind cluster
    col += vec3(0.1, 0.08, 0.15) * clusterFade * 0.5;
    
    gl_FragColor = vec4(col, 1.0);
}
