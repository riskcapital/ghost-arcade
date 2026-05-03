/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "3D Honey Video Drips with Layers - Viscous liquid dripping with layers, noise, glitch, and zoom controls",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "dripAmount",
            "TYPE": "float",
            "MIN": 5.0,
            "MAX": 50.0,
            "DEFAULT": 20.0
        },
        {
            "NAME": "dripLayers",
            "TYPE": "float",
            "MIN": 1.0,
            "MAX": 5.0,
            "DEFAULT": 3.0
        },
        {
            "NAME": "dripSpeed",
            "TYPE": "float",
            "MIN": 0.05,
            "MAX": 1.0,
            "DEFAULT": 0.2
        },
        {
            "NAME": "dripLength",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 1.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "dripWidth",
            "TYPE": "float",
            "MIN": 0.02,
            "MAX": 0.2,
            "DEFAULT": 0.1
        },
        {
            "NAME": "dropOffset",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "noiseAmount",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.3
        },
        {
            "NAME": "glitchAmount",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.2
        },
        {
            "NAME": "zoom",
            "TYPE": "float",
            "MIN": 0.5,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "lightAngle",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 6.28,
            "DEFAULT": 1.57
        },
        {
            "NAME": "glossiness",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "posX",
            "TYPE": "float",
            "MIN": -1.0,
            "MAX": 1.0,
            "DEFAULT": 0.0
        },
        {
            "NAME": "posY",
            "TYPE": "float",
            "MIN": -1.0,
            "MAX": 1.0,
            "DEFAULT": 0.0
        },
        {
            "NAME": "videoInput",
            "TYPE": "image",
            "LABEL": "Video Input"
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.141592653589793
#define TWO_PI 6.283185307179586

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y * (RENDERSIZE.x / RENDERSIZE.y), 1.0);
float iGlobalTime = TIME;

// Simple 2D hash function
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 2D noise function
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractional Brownian Motion (fBm) for smooth noise
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Drip position and shape calculation
vec4 getDrip(int i, int layer, float t) {
    float id = float(i) + float(layer) * 100.0; // Unique ID per drip and layer
    float h = hash(vec2(id, id * 0.123));
    
    // Drip position (x is fixed, y moves from top to bottom)
    float x = h * 2.0 - 1.0; // Random x position across the screen
    float offset = h * dropOffset; // Random offset for starting position
    float y = 1.0 - fract(t * dripSpeed * (0.5 + h * 0.5) + offset) * 2.0; // Y position with varied speed
    
    // Drip shape parameters with variation
    float len = dripLength * (0.7 + h * 0.6); // Varied length
    float width = dripWidth * (0.5 + h * 1.0); // Varied width
    
    // Adjust width based on drip position for a honey-like shape
    float tShape = (1.0 - y) / 2.0; // Map y from [1, -1] to [0, 1]
    width *= mix(0.3, 1.0, tShape); // Narrower at the top, wider at the bottom (bulbous end)
    
    return vec4(x, y, width, len);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 cent = (uv * 2.0 - 1.0) / zoom; // Apply zoom
    cent.x *= iResolution.x / iResolution.y;
    cent.x -= posX;
    cent.y -= posY;
    float t = iGlobalTime;

    // Background (black)
    vec3 color = vec3(0.0);

    // Lighting direction
    vec3 lightDir = normalize(vec3(cos(lightAngle), sin(lightAngle), 1.0));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    // Draw drips across multiple layers
    int maxLayers = int(floor(dripLayers + 0.5));
    maxLayers = clamp(maxLayers, 1, 5);
    int maxDrips = int(floor(dripAmount + 0.5));
    maxDrips = clamp(maxDrips, 5, 50);

    for (int layer = 0; layer < 5; layer++) {
        if (layer >= maxLayers) break;
        for (int i = 0; i < 50; i++) {
            if (i >= maxDrips) break;
            vec4 drip = getDrip(i, layer, t);
            float x = drip.x;
            float y = drip.y;
            float width = drip.z;
            float len = drip.w;
            
            // Add glitch effect (random jitter in x)
            float glitch = hash(vec2(float(i) + float(layer) * 100.0, t * 0.1)) * glitchAmount;
            x += sin(t * 10.0 + float(i) + float(layer)) * glitch * 0.1;
            
            // Calculate distance to the drip's vertical axis
            float dx = abs(cent.x - x);
            
            // Check if the point is within the drip's vertical range
            float dy = cent.y - y;
            if (dy < 0.0 || dy > len) continue; // Outside the drip's length
            
            // Create a honey-like teardrop shape with noise
            float tShape = dy / len; // Map position along the drip [0, 1]
            float w = width * mix(0.3, 1.0, tShape); // Narrower at the top, wider at the bottom
            
            // Add noise to the drip shape
            float noiseVal = fbm(vec2(cent.x * 5.0 + float(i) + float(layer), cent.y * 5.0 + t * 0.5)) * noiseAmount;
            w += noiseVal * 0.1; // Perturb the width with noise
            
            float dist = dx / w; // Normalized distance from the drip's center
            
            // Rounded bottom using a circular cap
            float capDist = length(vec2(dx, dy - len) / vec2(w, width));
            float capAlpha = step(capDist, 1.0); // Circular cap at the bottom
            
            // Main body of the drip with a sharp edge
            float aa = 0.001; // Minimal anti-aliasing
            float bodyAlpha = 1.0 - smoothstep(1.0 - aa / w, 1.0, dist); // Sharp edge with minimal AA
            
            // Combine cap and body (cap only applies at the bottom)
            float alpha = max(bodyAlpha, capAlpha * step(dy, len));
            if (alpha <= 0.0) continue;
            
            // Normal calculation for 3D effect
            vec2 offset = vec2(0.01, 0.0);
            float dx1 = abs((cent.x + offset.x) - x) / (w + fbm(vec2((cent.x + offset.x) * 5.0 + float(i) + float(layer), cent.y * 5.0 + t * 0.5)) * noiseAmount * 0.1);
            float dx2 = abs((cent.x - offset.x) - x) / (w + fbm(vec2((cent.x - offset.x) * 5.0 + float(i) + float(layer), cent.y * 5.0 + t * 0.5)) * noiseAmount * 0.1);
            float dy1 = abs((cent.y + offset.y) - y) / (width * mix(0.3, 1.0, (cent.y + offset.y - y) / len));
            float dy2 = abs((cent.y - offset.y) - y) / (width * mix(0.3, 1.0, (cent.y - offset.y - y) / len));
            vec3 normal = normalize(vec3(dx1 - dx2, dy1 - dy2, 0.1));
            normal = normalize(normal);
            
            // Lighting for 3D effect
            float diffuse = max(dot(normal, lightDir), 0.0);
            vec3 reflectDir = reflect(-lightDir, normal);
            float specular = pow(max(dot(viewDir, reflectDir), 0.0), 32.0) * glossiness;
            
            // Sample video color along the drip
            vec2 videoUV = vec2((cent.x + 1.0) * 0.5, tShape); // Map x to [0, 1], y along drip to [0, 1]
            videoUV = clamp(videoUV, 0.0, 1.0);
            vec3 dripColor = texture2D(videoInput, videoUV).rgb;
            
            // Apply lighting to the drip color
            dripColor = dripColor * (diffuse * 0.7 + 0.3) + vec3(1.0) * specular;
            
            // Add drip to the scene with blending
            color = mix(color, dripColor, alpha * 0.8); // Slight transparency for overlapping layers
        }
    }

    fragColor = vec4(color, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}