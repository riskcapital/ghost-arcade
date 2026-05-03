/*{
    "CREDIT": "Grok, created by xAI",
    "DESCRIPTION": "Lava Lamp Fractal Waves: Geometric Tracking - 3D waves with varied colors, splashes, and computer vision-like tracking",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Generator" ],
    "INPUTS": [
        {
            "NAME": "fractalDepth",
            "TYPE": "float",
            "MIN": 1.0,
            "MAX": 8.0,
            "DEFAULT": 4.0
        },
        {
            "NAME": "fractalChaos",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 3.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "flowSpeed",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "lightAngle",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 6.28,
            "DEFAULT": 1.57
        },
        {
            "NAME": "baseColorHue",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.6 // Blue base
        },
        {
            "NAME": "secondaryColorHue",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.0 // Red highlights
        },
        {
            "NAME": "splashColorHue",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.3 // Green splashes
        },
        {
            "NAME": "zDepthScale",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "trackingDensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.5
        },
        {
            "NAME": "splashIntensity",
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
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y * (RENDERSIZE.x / RENDERSIZE.y), 1.0);
float iGlobalTime = TIME;

#define PI 3.141592653589793
#define TWO_PI 6.283185307179586

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
    for (int i = 0; i < 8; i++) {
        if (i >= int(fractalDepth)) break;
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Fractal wave height with drastic chaos
float fractalWave(vec2 p, float t) {
    float v = 0.0;
    vec2 q = p;
    float scale = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= int(fractalDepth)) break;
        float n = fbm(q + t * flowSpeed);
        v += n * scale * fractalChaos;
        q = q * 2.0 + vec2(cos(n * TWO_PI), sin(n * TWO_PI));
        scale *= 0.5;
    }
    return v;
}

// HSV to RGB conversion for color customization
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Distance to a grid of tracking lines (computer vision effect)
float sdTrackingGrid(vec2 p, float height, float scale) {
    p = mod(p, scale) - scale * 0.5;
    float d = min(abs(p.x), abs(p.y));
    // Intensify lines at wave peaks
    float peak = smoothstep(0.3, 0.7, height);
    return d * (1.0 - peak * trackingDensity);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 cent = uv * 2.0 - 1.0;
    cent.x *= iResolution.x / iResolution.y;
    cent.x -= posX;
    cent.y -= posY;
    float t = iGlobalTime * 0.2;

    // Compute wave height for the liquid surface
    vec2 waveUV = cent * 2.0;
    float height = fractalWave(waveUV, t);
    
    // Normal calculation for lighting
    float h0 = fractalWave(waveUV + vec2(0.01, 0.0), t);
    float h1 = fractalWave(waveUV + vec2(0.0, 0.01), t);
    vec3 normal = normalize(vec3(h0 - height, h1 - height, 0.1));
    
    // Adjust z-depth with slider
    height *= zDepthScale;
    normal.z *= zDepthScale;
    normal = normalize(normal);
    
    // Lighting direction from angle
    vec3 lightDir = normalize(vec3(cos(lightAngle), sin(lightAngle), 1.0));
    
    // Diffuse and specular lighting
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);
    float specular = pow(max(dot(viewDir, reflectDir), 0.0), 32.0) * 0.5;
    
    // Base wave color with gradient
    vec3 baseColor = hsv2rgb(vec3(baseColorHue, 0.3, 0.9));
    vec3 secondaryColor = hsv2rgb(vec3(secondaryColorHue, 0.8, 1.0));
    vec3 waveColor = mix(baseColor, secondaryColor, height * 0.5 + 0.5);
    waveColor = waveColor * diffuse + secondaryColor * specular;

    // Lava lamp splashes and splatters
    vec2 splashUV = waveUV * 1.5 + vec2(t * flowSpeed * 0.5, t * flowSpeed);
    float splashNoise = fbm(splashUV);
    float splash = smoothstep(0.5, 0.7, splashNoise) * splashIntensity;
    vec3 splashColor = hsv2rgb(vec3(splashColorHue + splashNoise * 0.2, 0.9, 1.0)); // Hue varies slightly
    vec3 color = mix(waveColor, splashColor, splash);

    // Computer vision-like tracking grid
    float gridDist = sdTrackingGrid(cent + normal.xy * height, height, 0.2);
    float gridGlow = smoothstep(0.02, 0.0, gridDist);
    vec3 gridColor = hsv2rgb(vec3(fract(splashColorHue + 0.5), 0.9, 1.0)); // Complementary color
    color += gridColor * gridGlow * trackingDensity;

    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}