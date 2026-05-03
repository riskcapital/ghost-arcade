/*{
    "DESCRIPTION": "Crystal refraction - 3D model seen through faceted crystal with prismatic light splitting",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Model FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "facets", "TYPE": "float", "DEFAULT": 6.0, "MIN": 3.0, "MAX": 12.0, "LABEL": "Facets"},
        {"NAME": "refractStrength", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.3, "LABEL": "Refraction"},
        {"NAME": "prismSpread", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.0, "MAX": 0.06, "LABEL": "Prism"},
        {"NAME": "crystalRotation", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0, "LABEL": "Rotation"},
        {"NAME": "facetEdge", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Edge Glow"},
        {"NAME": "sparkleAmount", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Sparkle"},
        {"NAME": "tintColor", "TYPE": "color", "DEFAULT": [0.9, 0.95, 1.0, 1.0], "LABEL": "Crystal Tint"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

#define PI 3.14159265359

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 centered = uv - 0.5;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    centered.x *= aspect;

    float t = TIME * crystalRotation;

    // Create faceted crystal geometry
    float angle = atan(centered.y, centered.x) + t;
    float dist = length(centered);
    float sides = floor(facets);

    // Voronoi-like facet pattern
    float facetAngle = floor(angle / (2.0 * PI) * sides) / sides * 2.0 * PI;
    float nextFacetAngle = facetAngle + 2.0 * PI / sides;

    // Distance to nearest facet edge
    vec2 facetDir1 = vec2(cos(facetAngle), sin(facetAngle));
    vec2 facetDir2 = vec2(cos(nextFacetAngle), sin(nextFacetAngle));
    float edgeDist1 = abs(dot(centered, vec2(-facetDir1.y, facetDir1.x)));
    float edgeDist2 = abs(dot(centered, vec2(-facetDir2.y, facetDir2.x)));
    float edgeDist = min(edgeDist1, edgeDist2);

    // Refraction: offset UV based on facet normal
    vec2 facetNormal = vec2(cos(facetAngle + PI / sides), sin(facetAngle + PI / sides));
    vec2 refractOffset = facetNormal * refractStrength * (0.5 + 0.5 * sin(facetAngle * 3.0 + t));
    refractOffset.x /= aspect;

    // Prismatic color split along facet normal
    vec2 prismDir = facetNormal * prismSpread;
    prismDir.x /= aspect;

    float r = IMG_NORM_PIXEL(inputImage, uv + refractOffset + prismDir).r;
    float g = IMG_NORM_PIXEL(inputImage, uv + refractOffset).g;
    float b = IMG_NORM_PIXEL(inputImage, uv + refractOffset - prismDir).b;
    float a = IMG_NORM_PIXEL(inputImage, uv + refractOffset).a;

    vec3 color = vec3(r, g, b);

    // Crystal tint
    color *= tintColor.rgb;

    // Facet edge highlights
    float edgeHighlight = smoothstep(0.03, 0.0, edgeDist) * facetEdge;
    color += vec3(1.0) * edgeHighlight;

    // Sparkle at facet intersections
    if (sparkleAmount > 0.01) {
        float sparkleHash = hash(vec2(floor(angle / (2.0 * PI) * sides), floor(dist * 10.0)));
        float sparkle = step(0.95 - sparkleAmount * 0.1, sparkleHash);
        sparkle *= sin(TIME * 5.0 + sparkleHash * 100.0) * 0.5 + 0.5;
        color += vec3(sparkle) * sparkleAmount * 2.0;
    }

    // Internal reflection: ghost image
    vec2 reflectUV = vec2(1.0 - uv.x, uv.y) + refractOffset * 0.5;
    vec4 reflection = IMG_NORM_PIXEL(inputImage, reflectUV);
    color += reflection.rgb * 0.08;

    gl_FragColor = vec4(color, a);
}
