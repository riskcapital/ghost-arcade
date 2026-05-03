/*{
    "DESCRIPTION": "Glitch melt - 3D model melts and glitches with digital corruption artifacts",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Model FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "meltAmount", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Melt"},
        {"NAME": "glitchIntensity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Glitch"},
        {"NAME": "blockSize", "TYPE": "float", "DEFAULT": 20.0, "MIN": 4.0, "MAX": 80.0, "LABEL": "Block Size"},
        {"NAME": "rgbSplit", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0, "MAX": 0.08, "LABEL": "RGB Split"},
        {"NAME": "noiseAmount", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0, "LABEL": "Noise"},
        {"NAME": "meltSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Speed"},
        {"NAME": "corruption", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.5, "LABEL": "Corruption"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float t = TIME * meltSpeed;

    // Melt: gravity-like dripping distortion
    float meltOffset = 0.0;
    if (meltAmount > 0.01) {
        float meltNoise = hash2(vec2(floor(uv.x * 40.0), 0.0));
        meltOffset = meltAmount * meltNoise * sin(t + meltNoise * 10.0) * 0.3;
        meltOffset *= smoothstep(0.0, 1.0, uv.y); // More melt at top
    }

    // Glitch block displacement
    vec2 glitchUV = uv;
    if (glitchIntensity > 0.01) {
        float blockY = floor(uv.y * blockSize);
        float blockRand = hash(blockY + floor(t * 8.0));

        if (blockRand > 1.0 - glitchIntensity * 0.3) {
            float shift = (hash(blockY + floor(t * 12.0) * 3.0) - 0.5) * glitchIntensity * 0.2;
            glitchUV.x += shift;
        }
    }

    vec2 sampleUV = vec2(glitchUV.x, glitchUV.y - meltOffset);

    // RGB channel split
    float r = IMG_NORM_PIXEL(inputImage, sampleUV + vec2(rgbSplit, 0.0)).r;
    float g = IMG_NORM_PIXEL(inputImage, sampleUV).g;
    float b = IMG_NORM_PIXEL(inputImage, sampleUV - vec2(rgbSplit, 0.0)).b;
    float a = IMG_NORM_PIXEL(inputImage, sampleUV).a;

    vec3 color = vec3(r, g, b);

    // Digital noise overlay
    if (noiseAmount > 0.01) {
        float noise = hash2(uv * RENDERSIZE + vec2(t * 100.0, 0.0));
        color = mix(color, vec3(noise), noiseAmount * 0.3);
    }

    // Corruption: random color channel swap
    if (corruption > 0.01) {
        float corrRand = hash(floor(uv.y * blockSize * 0.5) + floor(t * 4.0) * 7.0);
        if (corrRand > 1.0 - corruption) {
            color = color.gbr; // Channel rotation
        }
    }

    // Scan line artifacts at glitch boundaries
    float scanArtifact = sin(uv.y * RENDERSIZE.y) * 0.5 + 0.5;
    color *= mix(1.0, scanArtifact, glitchIntensity * 0.1);

    gl_FragColor = vec4(color, a);
}
