/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "Pixar-Inspired 3D Video Waves: Erupting Lava Lamp Blobs - Chaotic waves with blobs flying toward the screen",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "fractalDepth",
            "TYPE": "float",
            "MIN": 1.0,
            "MAX": 6.0,
            "DEFAULT": 4.0
        },
        {
            "NAME": "fractalChaos",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 5.0,
            "DEFAULT": 2.5
        },
        {
            "NAME": "flowSpeed",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 3.0,
            "DEFAULT": 1.2
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
            "MIN": 1.0,
            "MAX": 6.0,
            "DEFAULT": 3.0
        },
        {
            "NAME": "warpIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.5,
            "DEFAULT": 0.7
        },
        {
            "NAME": "plasticGloss",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 1.2
        },
        {
            "NAME": "surgeIntensity",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 3.0,
            "DEFAULT": 1.5
        },
        {
            "NAME": "zOscillation",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "zoom",
            "TYPE": "float",
            "MIN": 0.5,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "blobCount",
            "TYPE": "float",
            "MIN": 5.0,
            "MAX": 50.0,
            "DEFAULT": 20.0
        },
        {
            "NAME": "blobSize",
            "TYPE": "float",
            "MIN": 0.02,
            "MAX": 0.1,
            "DEFAULT": 0.05
        },
        {
            "NAME": "blobSpeed",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 0.5
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

// Fractal wave height with turbulent, surging motion
float fractalWave(vec2 p, float t) {
    float v = 0.0;
    vec2 q = p;
    float scale = 1.0;
    for (int i = 0; i < 6; i++) {
        if (i >= int(fractalDepth)) break;
        float n = fbm(q + vec2(t * flowSpeed * 0.5, t * flowSpeed));
        v += n * scale * fractalChaos;
        q = q * 2.0 + vec2(cos(n * TWO_PI) * 0.5, sin(n * TWO_PI) + t * flowSpeed);
        scale *= 0.5;
    }
    v += fbm(vec2(p.x * 1.5, p.y + t * flowSpeed * 2.0)) * surgeIntensity;
    v += sin(t * flowSpeed) * zOscillation;
    return v;
}

// Blob position calculation
vec3 getBlobPos(int i, float t) {
    float id = float(i);
    float h = hash(vec2(id, id * 0.123));
    
    // Base position in 2D
    vec2 pos = vec2(h * 2.0 - 1.0, fract(h * 123.45) * 2.0 - 1.0);
    
    // Use fBm to create a flow field for blobs
    vec2 flow = vec2(fbm(pos + vec2(t * blobSpeed, 0.0)), fbm(pos + vec2(0.0, t * blobSpeed + 100.0)));
    flow = flow * 2.0 - 1.0;
    pos += flow * 0.3;
    
    // Compute z-position based on wave height and time
    float baseZ = fractalWave(pos * 2.0, t);
    float z = baseZ * zDepthScale + fract(h + t * blobSpeed) * 10.0; // Blobs fly toward the screen
    return vec3(pos, z);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 cent = (uv * 2.0 - 1.0) / zoom; // Apply zoom by scaling the coordinate system
    cent.x *= iResolution.x / iResolution.y;
    cent.x -= posX;
    cent.y -= posY;
    float t = iGlobalTime * 0.2;

    // Compute wave height for the surface
    vec2 waveUV = cent * 2.0;
    float height = fractalWave(waveUV, t);
    height *= zDepthScale;
    
    // Normal calculation for enhanced 3D effect
    float h0 = fractalWave(waveUV + vec2(0.02, 0.0), t) * zDepthScale;
    float h1 = fractalWave(waveUV + vec2(0.0, 0.02), t) * zDepthScale;
    vec3 normal = normalize(vec3(h0 - height, h1 - height, 0.05));
    normal.z *= zDepthScale * 0.5;
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
    videoUV = clamp(videoUV, 0.0, 1.0);
    vec3 videoColor = texture2D(videoInput, videoUV).rgb;
    
    // Apply lighting to the video color for the wave surface
    vec3 color = videoColor * (diffuse * 0.8 + 0.2) * ao + vec3(1.0) * specular;

    // Add blobs flying toward the screen
    int maxBlobs = int(floor(blobCount + 0.5));
    maxBlobs = clamp(maxBlobs, 5, 50);
    float shadowPass = 1.0; // Accumulate shadow intensity

    for (int i = 0; i < 50; i++) {
        if (i >= maxBlobs) break;
        vec3 blob = getBlobPos(i, t);
        
        // Compute 2D distance with z-space effect
        float dz = blob.z; // Z-distance from the camera
        vec2 blob2d = blob.xy / (dz + 1.0); // Perspective projection
        float d = length(cent - blob2d);
        float blobGlow = smoothstep(blobSize, blobSize * 0.5, d);
        
        // Sample video color for the blob
        vec2 blobUV = (blob2d + 1.0) * 0.5;
        blobUV = clamp(blobUV, 0.0, 1.0);
        vec3 blobColor = texture2D(videoInput, blobUV).rgb;
        
        // Blob lighting
        vec3 blobNormal = normalize(vec3(blob2d - cent, dz * 0.1));
        float blobDiffuse = max(dot(blobNormal, lightDir), 0.0);
        float blobSpecular = pow(max(dot(viewDir, reflect(blobNormal, lightDir)), 0.0), 64.0) * plasticGloss;
        blobColor = blobColor * (blobDiffuse * 0.8 + 0.2) + vec3(1.0) * blobSpecular;
        
        // Add blob to the scene if it's closer to the camera
        if (dz > height) {
            color = mix(color, blobColor, blobGlow);
        }
        
        // Cast shadow on the wave surface
        vec2 shadowPos = blob.xy / (height + 1.0); // Project blob position onto the wave
        float shadowDist = length(cent - shadowPos);
        float shadow = smoothstep(blobSize * 1.5, blobSize * 0.5, shadowDist) * 0.5;
        shadowPass *= (1.0 - shadow);
    }

    // Apply shadows to the wave surface
    color *= shadowPass;

    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}