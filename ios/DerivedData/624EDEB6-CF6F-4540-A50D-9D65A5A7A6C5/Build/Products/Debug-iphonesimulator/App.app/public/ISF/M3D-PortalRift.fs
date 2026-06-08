/*{
    "DESCRIPTION": "Portal rift - tears open dimensional portals around the 3D model with warped space",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Model FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "riftSize", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rift Size"},
        {"NAME": "riftX", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rift X"},
        {"NAME": "riftY", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rift Y"},
        {"NAME": "warpStrength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.5, "LABEL": "Warp"},
        {"NAME": "portalColor", "TYPE": "color", "DEFAULT": [0.5, 0.0, 1.0, 1.0], "LABEL": "Portal Color"},
        {"NAME": "rotationSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Rotation"},
        {"NAME": "dimensions", "TYPE": "float", "DEFAULT": 3.0, "MIN": 2.0, "MAX": 8.0, "LABEL": "Complexity"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

#define PI 3.14159265359

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 center = vec2(riftX, riftY);
    vec2 delta = uv - center;
    delta.x *= aspect;
    float dist = length(delta);
    float angle = atan(delta.y, delta.x);

    float t = TIME * rotationSpeed;

    // Portal shape: spinning polygon edges
    float sides = floor(dimensions);
    float riftRadius = riftSize * 0.5;
    float polyAngle = angle + t;
    float polyDist = cos(PI / sides) / cos(mod(polyAngle, 2.0 * PI / sides) - PI / sides);
    float portalEdge = smoothstep(riftRadius * polyDist + 0.02, riftRadius * polyDist - 0.02, dist);
    float portalRing = smoothstep(riftRadius * polyDist + 0.04, riftRadius * polyDist, dist) *
                       (1.0 - smoothstep(riftRadius * polyDist, riftRadius * polyDist - 0.04, dist));

    // Space warping near the portal
    float warp = smoothstep(riftRadius * 2.0, riftRadius * 0.5, dist) * warpStrength;
    vec2 warpedUV = uv;

    // Spiral warp toward portal center
    float spiralAngle = warp * 3.0;
    float s = sin(spiralAngle), c = cos(spiralAngle);
    vec2 rotDelta = uv - center;
    warpedUV = center + vec2(rotDelta.x * c - rotDelta.y * s, rotDelta.x * s + rotDelta.y * c);

    // Pull toward center
    warpedUV = mix(warpedUV, center, warp * 0.3);

    // Sample the model with warped coordinates
    vec4 src = IMG_NORM_PIXEL(inputImage, warpedUV);

    // Portal interior: dimensional pattern
    vec3 portalInterior = vec3(0.0);
    if (portalEdge > 0.01) {
        float innerDist = dist / (riftRadius * polyDist);
        float rings = sin(innerDist * 20.0 - t * 5.0) * 0.5 + 0.5;
        float spiral = sin(angle * dimensions + innerDist * 10.0 - t * 3.0) * 0.5 + 0.5;
        portalInterior = portalColor.rgb * (rings * 0.5 + spiral * 0.5);
        portalInterior += portalColor.rgb * smoothstep(0.8, 0.0, innerDist) * 2.0;
    }

    // Portal edge glow
    vec3 edgeGlow = portalColor.rgb * portalRing * 4.0;
    edgeGlow += vec3(1.0) * portalRing * portalRing * 2.0; // white-hot center of ring

    // Chromatic aberration near portal
    vec3 chromatic = src.rgb;
    if (warp > 0.01) {
        vec2 chromDir = normalize(delta) * warp * 0.02;
        chromatic.r = IMG_NORM_PIXEL(inputImage, warpedUV + chromDir).r;
        chromatic.b = IMG_NORM_PIXEL(inputImage, warpedUV - chromDir).b;
    }

    // Composite
    vec3 result = mix(chromatic, portalInterior, portalEdge * 0.8);
    result += edgeGlow;

    float alpha = mix(src.a, 1.0, portalEdge);
    alpha = max(alpha, portalRing * 0.8);

    gl_FragColor = vec4(result, alpha);
}
