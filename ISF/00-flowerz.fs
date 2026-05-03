/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "Pixar-Inspired 3D Video Waves: Random Water Surge - Chaotic waves with video input, surging toward the camera",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "fractalDepth",
            "TYPE": "float",
            "MIN": 1.0,
            "MAX": 6.0,
            "DEFAULT": 3.0
        },
        {
            "NAME": "fractalChaos",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 4.0,
            "DEFAULT": 2.0
        },
        {
            "NAME": "flowSpeed",
            "TYPE": "float",
            "MIN": 0.1,
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
            "NAME": "zDepthScale",
            "TYPE": "float",
            "MIN": 0.5,
            "MAX": 4.0,
            "DEFAULT": 1.5
        },
        {
            "NAME": "warpIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "plasticGloss",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "surgeIntensity",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 0.8
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
    for (int i = 0; i < 6; i++) {
        if (i >= int(fractalDepth)) break;
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Fractal wave height with chaotic, random waves
float fractalWave(vec2 p, float t) {
    float v = 0.0;
    vec2 q = p;
    float scale = 1.0;
    for (int i = 0; i < 6; i++) {
        if (i >= int(fractalDepth)) break;
        // Add directional motion toward the camera (y-axis)
        float n = fbm(q + vec2(t * flowSpeed * 0.3, t * flowSpeed));
        v += n * scale * fractalChaos;
        q = q * 2.0 + vec2(cos(n * TWO_PI), sin(n * TWO_PI) + t * flowSpeed);
        scale *= 0.5;
    }
    // Add surge effect toward the camera
    v += fbm(vec2(p.x, p.y + t * flowSpeed)) * surgeIntensity;
    return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 cent = uv * 2.0 - 1.0;
    cent.x *= iResolution.x / iResolution.y;
    cent.x -= posX;
    cent.y -= posY;
    float t = iGlobalTime * 0.2;

    // Compute wave height for the surface
    vec2 waveUV = cent * 2.0;
    float height = fractalWave(waveUV, t);
    height *= zDepthScale;
    
    // Normal calculation for lighting
    float h0 = fractalWave(waveUV + vec2(0.01, 0.0), t) * zDepthScale;
    float h1 = fractalWave(waveUV + vec2(0.0, 0.01), t) * zDepthScale;
    vec3 normal = normalize(vec3(h0 - height, h1 - height, 0.1));
    normal.z *= zDepthScale;
    normal = normalize(normal);
    
    // Lighting direction from angle
    vec3 lightDir = normalize(vec3(cos(lightAngle), sin(lightAngle), 1.0));
    
    // Diffuse and specular lighting for plastic look
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);
    float specular = pow(max(dot(viewDir, reflectDir), 0.0), 64.0) * plasticGloss;
    
    // Ambient occlusion (approximated)
    float ao = smoothstep(-1.0, 1.0, height) * 0.5 + 0.5;
    
    // Warp the video texture using the normal and height
    vec2 videoUV = uv + normal.xy * warpIntensity * height;
    videoUV = clamp(videoUV, 0.0, 1.0); // Prevent texture sampling outside bounds
    vec3 videoColor = texture2D(videoInput, videoUV).rgb;
    
    // Apply lighting to the video color for a plastic effect
    vec3 color = videoColor * (diffuse * 0.8 + 0.2) * ao + vec3(1.0) * specular;
    
    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}