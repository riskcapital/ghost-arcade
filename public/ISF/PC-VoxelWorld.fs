/*{
    "DESCRIPTION": "Voxel world - converts point cloud into 3D voxel blocks with depth and lighting",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Point Cloud FX"],
    "INPUTS": [
        {"NAME": "inputImage", "TYPE": "image"},
        {"NAME": "voxelSize", "TYPE": "float", "DEFAULT": 30.0, "MIN": 5.0, "MAX": 100.0, "LABEL": "Voxel Size"},
        {"NAME": "depthExtrude", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "3D Depth"},
        {"NAME": "lightAngle", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 6.28, "LABEL": "Light Angle"},
        {"NAME": "shadowStrength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Shadows"},
        {"NAME": "outlineWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Outline"},
        {"NAME": "colorQuantize", "TYPE": "float", "DEFAULT": 8.0, "MIN": 2.0, "MAX": 32.0, "LABEL": "Color Levels"},
        {"NAME": "animateHeight", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Animate"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

uniform float TIME;
uniform vec2 RENDERSIZE;

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    // Voxel grid
    vec2 grid = floor(uv * voxelSize) / voxelSize;
    vec2 cell = fract(uv * voxelSize);

    // Sample at voxel center
    vec4 src = IMG_NORM_PIXEL(inputImage, grid + 0.5 / voxelSize);
    float brightness = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    // Skip empty voxels
    if (src.a < 0.01 && brightness < 0.02) {
        gl_FragColor = vec4(0.0);
        return;
    }

    // Animate voxel height
    float voxHash = fract(sin(dot(grid * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
    float height = brightness;
    if (animateHeight > 0.01) {
        height *= 0.7 + 0.3 * sin(TIME * 2.0 + voxHash * 6.28) * animateHeight;
    }

    // Quantize colors
    vec3 qColor = floor(src.rgb * colorQuantize) / colorQuantize;

    // Pseudo-3D: isometric-style shading
    vec2 lightDir = vec2(cos(lightAngle), sin(lightAngle));

    // Top face (brightest)
    float topFace = 1.0;
    // Right face
    float rightFace = 0.7;
    // Left face
    float leftFace = 0.5;

    // Determine which face is visible based on cell position and depth
    float faceLight = topFace;
    if (cell.x > 1.0 - depthExtrude * 0.3) {
        faceLight = rightFace;
        qColor *= 0.7;
    }
    if (cell.y < depthExtrude * 0.3) {
        faceLight = leftFace;
        qColor *= 0.5;
    }

    // Shadow from neighboring voxels
    vec2 shadowOffset = lightDir * 1.0 / voxelSize;
    float neighborBright = dot(IMG_NORM_PIXEL(inputImage, grid + shadowOffset + 0.5 / voxelSize).rgb, vec3(0.299, 0.587, 0.114));
    float shadow = 1.0 - smoothstep(0.0, 0.5, neighborBright - brightness) * shadowStrength;

    // Outline
    float outline = 1.0;
    if (outlineWidth > 0.01) {
        float edgeDist = min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y));
        outline = smoothstep(0.0, outlineWidth * 0.1, edgeDist);
    }

    vec3 result = qColor * faceLight * shadow * outline;

    // Add subtle highlight on top edge
    float highlight = smoothstep(0.15, 0.0, cell.y) * depthExtrude * 0.3;
    result += vec3(highlight);

    gl_FragColor = vec4(result, src.a);
}
