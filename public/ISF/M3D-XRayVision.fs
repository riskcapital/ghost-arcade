/*{
    "DESCRIPTION": "X-ray vision - renders 3D model as translucent X-ray with glowing skeletal structure",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Model FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "xrayIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0, "LABEL": "Intensity"},
        {"NAME": "xrayColor", "TYPE": "color", "DEFAULT": [0.3, 0.7, 1.0, 1.0], "LABEL": "X-Ray Color"},
        {"NAME": "boneGlow", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0, "LABEL": "Structure Glow"},
        {"NAME": "edgeSharpness", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0, "LABEL": "Edge Detail"},
        {"NAME": "pulseRate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Pulse Rate"},
        {"NAME": "invertDepth", "TYPE": "bool", "DEFAULT": false, "LABEL": "Invert Depth"},
        {"NAME": "scanLine", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Scan Lines"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec4 src = IMG_NORM_PIXEL(inputImage, uv);
    float brightness = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    // Edge detection - Sobel filter for structural outlines
    vec2 px = 1.0 / RENDERSIZE;
    float tl = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(-px.x, px.y)).rgb, vec3(0.33));
    float t = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(0, px.y)).rgb, vec3(0.33));
    float tr = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, px.y)).rgb, vec3(0.33));
    float l = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(-px.x, 0)).rgb, vec3(0.33));
    float r = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, 0)).rgb, vec3(0.33));
    float bl = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(-px.x, -px.y)).rgb, vec3(0.33));
    float b = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(0, -px.y)).rgb, vec3(0.33));
    float br2 = dot(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, -px.y)).rgb, vec3(0.33));

    float sobelH = tl + 2.0 * l + bl - tr - 2.0 * r - br2;
    float sobelV = tl + 2.0 * t + tr - bl - 2.0 * b - br2;
    float edges = sqrt(sobelH * sobelH + sobelV * sobelV) * edgeSharpness;

    // X-ray: invert brightness for depth illusion
    float depth = invertDepth ? brightness : 1.0 - brightness;

    // Bone/structure glow from edges
    float structure = edges * boneGlow;

    // Pulse animation
    float pulse = 1.0 + sin(TIME * pulseRate * 3.14159) * 0.15 * pulseRate;

    // Scan lines
    float scan = 1.0;
    if (scanLine > 0.01) {
        scan = 0.85 + 0.15 * sin(uv.y * RENDERSIZE.y * 0.5);
        scan = mix(1.0, scan, scanLine);
    }

    // Compose X-ray look
    vec3 xray = xrayColor.rgb * depth * xrayIntensity;
    xray += vec3(1.0) * structure; // White bone glow
    xray *= pulse * scan;

    // Maintain alpha from source
    float alpha = src.a;
    alpha = max(alpha, edges * 0.5);

    gl_FragColor = vec4(xray, alpha);
}
