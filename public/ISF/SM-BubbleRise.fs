/*{
    "DESCRIPTION": "Bubbles rising from bottom edge, wobbling and popping when hitting top or side edges",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "bubbleCount", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0},
        {"NAME": "maxSize", "TYPE": "float", "MIN": 0.02, "MAX": 0.1, "DEFAULT": 0.05},
        {"NAME": "riseSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.6},
        {"NAME": "wobble", "TYPE": "float", "MIN": 0.0, "MAX": 0.1, "DEFAULT": 0.03},
        {"NAME": "iridescence", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6},
        {"NAME": "bgColor", "TYPE": "color", "DEFAULT": [0.02, 0.03, 0.08, 1.0]}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec3 col = bgColor.rgb;
    int count = int(bubbleCount);
    
    for (int i = 0; i < 30; i++) {
        if (i >= count) break;
        float id = float(i);
        float size = maxSize * (0.3 + hash(id * 73.1) * 0.7);
        float spd = riseSpeed * (0.5 + hash(id * 311.7) * 0.5);
        float phase = hash(id * 127.1);
        
        float yPos = fract(TIME * spd * 0.15 + phase);
        float xBase = hash(id * 269.5) * 0.8 + 0.1;
        float xWobble = sin(TIME * 2.0 + id * 3.0) * wobble;
        float xPos = xBase + xWobble;
        
        // Clamp to frame edges with slight squish
        xPos = clamp(xPos, size, 1.0 - size);
        
        vec2 bubbleCenter = vec2(xPos, yPos);
        vec2 diff = uv - bubbleCenter;
        diff.x *= aspect;
        float dist = length(diff);
        
        // Bubble body
        if (dist < size) {
            float t = dist / size;
            
            // Sphere shading
            vec2 normal = diff / size;
            float fresnel = pow(1.0 - sqrt(1.0 - t * t), 2.0);
            
            // Iridescent color based on viewing angle
            float hue = fract(fresnel * 2.0 + TIME * 0.1 + id * 0.13);
            vec3 iriCol = hsv2rgb(vec3(hue, 0.5 * iridescence, 1.0));
            
            // Transparent bubble with rim
            float rim = smoothstep(0.7, 1.0, t);
            float inner = smoothstep(0.0, 0.3, t);
            float alpha = rim * 0.5 + inner * 0.05;
            
            col = mix(col, iriCol, alpha * iridescence);
            
            // Specular highlight
            vec2 lightDir = normalize(vec2(-0.5, 0.7));
            float spec = pow(max(dot(normal, lightDir), 0.0), 20.0);
            col += vec3(spec * 0.6);
            
            // Secondary highlight
            float spec2 = pow(max(dot(normal, vec2(0.3, -0.5)), 0.0), 10.0);
            col += vec3(spec2 * 0.2);
            
            // Edge ring
            float ring = smoothstep(size, size * 0.92, dist) * smoothstep(size * 0.85, size * 0.92, dist);
            col += vec3(0.3, 0.4, 0.6) * ring * 0.5;
        }
        
        // Subtle glow
        float glow = size * 0.3 / (dist + 0.01);
        col += vec3(0.1, 0.15, 0.3) * clamp(glow * 0.02, 0.0, 0.05);
    }
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
