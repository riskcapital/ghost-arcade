/*{
    "DESCRIPTION": "Holographic scan lines over point cloud - sci-fi hologram effect with scan beam",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Point Cloud FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "scanSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Scan Speed"},
        {"NAME": "scanWidth", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.01, "MAX": 0.3, "LABEL": "Scan Width"},
        {"NAME": "holoTint", "TYPE": "color", "DEFAULT": [0.2, 0.8, 1.0, 1.0], "LABEL": "Holo Color"},
        {"NAME": "scanlineCount", "TYPE": "float", "DEFAULT": 200.0, "MIN": 20.0, "MAX": 500.0, "LABEL": "Scanlines"},
        {"NAME": "flickerAmount", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5, "LABEL": "Flicker"},
        {"NAME": "wireframeStrength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Wireframe"},
        {"NAME": "transparency", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Transparency"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec4 src = IMG_NORM_PIXEL(inputImage, uv);

    float brightness = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    // Scan beam moving vertically
    float scanPos = fract(TIME * scanSpeed);
    float scanDist = abs(uv.y - scanPos);
    float scanBeam = smoothstep(scanWidth, 0.0, scanDist);

    // Horizontal scanlines
    float scanline = sin(uv.y * scanlineCount * 3.14159) * 0.5 + 0.5;
    scanline = mix(1.0, scanline, 0.4);

    // Edge detection for wireframe
    vec2 px = 1.0 / RENDERSIZE;
    float dx = length(IMG_NORM_PIXEL(inputImage, uv + vec2(px.x, 0)).rgb - IMG_NORM_PIXEL(inputImage, uv - vec2(px.x, 0)).rgb);
    float dy = length(IMG_NORM_PIXEL(inputImage, uv + vec2(0, px.y)).rgb - IMG_NORM_PIXEL(inputImage, uv - vec2(0, px.y)).rgb);
    float edges = (dx + dy) * wireframeStrength;

    // Flicker
    float flicker = 1.0 - flickerAmount * hash(floor(TIME * 30.0));

    // Hologram color: tint the source
    vec3 holoColor = mix(src.rgb, holoTint.rgb * brightness, 0.6);

    // Add wireframe edges
    holoColor += holoTint.rgb * edges * 2.0;

    // Add scan beam highlight
    holoColor += holoTint.rgb * scanBeam * 1.5;

    // Apply scanlines and flicker
    holoColor *= scanline * flicker;

    // Holographic alpha: keep point cloud shape but make it translucent
    float alpha = mix(src.a, src.a * (0.5 + brightness * 0.5), transparency);
    alpha = max(alpha, edges * wireframeStrength);
    alpha = max(alpha, scanBeam * 0.3);

    gl_FragColor = vec4(holoColor, alpha);
}
