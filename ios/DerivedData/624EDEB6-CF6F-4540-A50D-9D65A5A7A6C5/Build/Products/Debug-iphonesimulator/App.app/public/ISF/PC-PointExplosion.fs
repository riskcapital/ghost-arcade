/*{
    "DESCRIPTION": "Point cloud explosion - radial force field that shatters and distorts point cloud data",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Point Cloud FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "explosionForce", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Force"},
        {"NAME": "epicenterX", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Center X"},
        {"NAME": "epicenterY", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Center Y"},
        {"NAME": "shockwaveSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0, "LABEL": "Shockwave Speed"},
        {"NAME": "chromaticSplit", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Chromatic Split"},
        {"NAME": "particleize", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Particleize"},
        {"NAME": "edgeGlow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Edge Glow"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 center = vec2(epicenterX, epicenterY);
    vec2 dir = uv - center;
    float dist = length(dir);
    vec2 normDir = dist > 0.001 ? dir / dist : vec2(0.0);

    // Animated shockwave ring
    float wave = fract(TIME * shockwaveSpeed * 0.3);
    float ring = smoothstep(wave - 0.15, wave, dist) * smoothstep(wave + 0.15, wave, dist);

    // Radial explosion displacement
    float force = explosionForce * (1.0 - smoothstep(0.0, 0.8, dist));
    force += ring * explosionForce * 2.0;

    // Pixelation/particleize effect
    vec2 sampleUV = uv;
    if (particleize > 0.01) {
        float gridSize = mix(1.0, 80.0, particleize);
        sampleUV = floor(sampleUV * gridSize) / gridSize;
    }

    vec2 displaced = sampleUV - normDir * force;

    // Chromatic aberration along explosion direction
    float chromOffset = chromaticSplit * force * 0.5;
    float r = IMG_NORM_PIXEL(inputImage, displaced - normDir * chromOffset).r;
    float g = IMG_NORM_PIXEL(inputImage, displaced).g;
    float b = IMG_NORM_PIXEL(inputImage, displaced + normDir * chromOffset).b;
    float a = IMG_NORM_PIXEL(inputImage, displaced).a;

    vec3 color = vec3(r, g, b);

    // Edge detection for glow
    vec2 px = 1.0 / RENDERSIZE;
    vec4 n = IMG_NORM_PIXEL(inputImage, uv + vec2(0, px.y));
    vec4 s2 = IMG_NORM_PIXEL(inputImage, uv - vec2(0, px.y));
    vec4 e = IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, 0));
    vec4 w = IMG_NORM_PIXEL(inputImage, uv - vec2(px.x, 0));
    float edge = length(n.rgb - s2.rgb) + length(e.rgb - w.rgb);

    // Add shockwave glow ring
    vec3 ringColor = vec3(0.4, 0.7, 1.0) * ring * edgeGlow * 3.0;
    color += ringColor;
    color += vec3(1.0, 0.6, 0.3) * edge * edgeGlow * force * 5.0;

    gl_FragColor = vec4(color, a);
}
