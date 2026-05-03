/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "Galactic Video Blobs: Cosmic Connections - Galaxy-like blobs with connecting lines, influenced by video input",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "blobCount",
            "TYPE": "float",
            "MIN": 10.0,
            "MAX": 100.0,
            "DEFAULT": 50.0
        },
        {
            "NAME": "blobSize",
            "TYPE": "float",
            "MIN": 0.01,
            "MAX": 0.1,
            "DEFAULT": 0.03
        },
        {
            "NAME": "blobSpeed",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "lineThickness",
            "TYPE": "float",
            "MIN": 0.001,
            "MAX": 0.01,
            "DEFAULT": 0.003
        },
        {
            "NAME": "zoom",
            "TYPE": "float",
            "MIN": 0.5,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "videoInfluence",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
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
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Blob position calculation
vec3 getBlobPos(int i, float t) {
    float id = float(i);
    float h = hash(vec2(id, id * 0.123));
    
    // Base position in 2D
    vec2 pos = vec2(h * 2.0 - 1.0, fract(h * 123.45) * 2.0 - 1.0);
    
    // Sample video brightness to influence position
    vec2 videoUV = (pos + 1.0) * 0.5;
    vec3 videoSample = texture2D(videoInput, videoUV).rgb;
    float brightness = dot(videoSample, vec3(0.299, 0.587, 0.114));
    pos += vec2(cos(brightness * TWO_PI), sin(brightness * TWO_PI)) * videoInfluence * 0.2;
    
    // Use fBm to create a flow field for blobs
    vec2 flow = vec2(fbm(pos + vec2(t * blobSpeed, 0.0)), fbm(pos + vec2(0.0, t * blobSpeed + 100.0)));
    flow = flow * 2.0 - 1.0;
    pos += flow * 0.3;
    
    // Compute z-position with oscillation
    float z = fract(h + t * blobSpeed) * 10.0 - 5.0; // Z ranges from -5 to 5, creating depth
    return vec3(pos, z);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 cent = (uv * 2.0 - 1.0) / zoom;
    cent.x *= iResolution.x / iResolution.y;
    cent.x -= posX;
    cent.y -= posY;
    float t = iGlobalTime * 0.2;

    // Initialize color (black background for space)
    vec3 color = vec3(0.0);

    // Draw blobs and connections
    int maxBlobs = int(floor(blobCount + 0.5));
    maxBlobs = clamp(maxBlobs, 10, 100);

    for (int i = 0; i < 100; i++) {
        if (i >= maxBlobs) break;
        vec3 blob1 = getBlobPos(i, t);
        
        // Compute 2D distance with z-space effect
        float dz = blob1.z + 5.0; // Shift z to positive range for perspective
        vec2 blob1_2d = blob1.xy / (dz * 0.2 + 1.0); // Perspective projection
        float d = length(cent - blob1_2d);
        float blobGlow = smoothstep(blobSize, blobSize * 0.3, d);
        
        // Sample video color for the blob
        vec2 blobUV = (blob1_2d + 1.0) * 0.5;
        blobUV = clamp(blobUV, 0.0, 1.0);
        vec3 blobColor = texture2D(videoInput, blobUV).rgb;
        
        // Add glow effect for galaxy-like appearance
        blobColor += blobColor * blobGlow * 0.5; // Brighten the core
        color += blobColor * blobGlow;

        // Connect to nearby blobs
        for (int j = i + 1; j < 100; j++) {
            if (j >= maxBlobs) break;
            vec3 blob2 = getBlobPos(j, t);
            float dz2 = blob2.z + 5.0;
            vec2 blob2_2d = blob2.xy / (dz2 * 0.2 + 1.0);
            float dist = length(blob1_2d - blob2_2d);
            if (dist < 0.3) { // Connect if within range
                vec2 pa = cent - blob1_2d;
                vec2 ba = blob2_2d - blob1_2d;
                float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                float lineDist = length(pa - ba * h);
                float lineGlow = smoothstep(lineThickness, 0.0, lineDist) * (1.0 - dist / 0.3);
                
                // Sample video color for the line (average of the two blobs)
                vec2 lineUV = mix(blobUV, (blob2_2d + 1.0) * 0.5, h);
                lineUV = clamp(lineUV, 0.0, 1.0);
                vec3 lineColor = texture2D(videoInput, lineUV).rgb;
                color += lineColor * lineGlow * 0.5;
            }
        }
    }

    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}