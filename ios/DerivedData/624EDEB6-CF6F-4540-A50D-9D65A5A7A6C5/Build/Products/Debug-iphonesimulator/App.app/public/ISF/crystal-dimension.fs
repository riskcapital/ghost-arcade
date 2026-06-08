/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Crystal Dimension - Raymarched 3D Geometric Structures",
  "INPUTS": [
    {
      "NAME": "cameraSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": -2.0,
      "MAX": 2.0
    },
    {
      "NAME": "rotationSpeed",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "geometryType",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "repetition",
      "TYPE": "float",
      "DEFAULT": 5.0,
      "MIN": 2.0,
      "MAX": 20.0
    },
    {
      "NAME": "tunnelRadius",
      "TYPE": "float",
      "DEFAULT": 2.0,
      "MIN": 0.5,
      "MAX": 5.0
    },
    {
      "NAME": "objectScale",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.1,
      "MAX": 2.0
    },
    {
      "NAME": "glowIntensity",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "hue",
      "TYPE": "float",
      "DEFAULT": 0.55,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "colorShift",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "saturation",
      "TYPE": "float",
      "DEFAULT": 0.8,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "fogDensity",
      "TYPE": "float",
      "DEFAULT": 0.05,
      "MIN": 0.0,
      "MAX": 0.3
    },
    {
      "NAME": "fov",
      "TYPE": "float",
      "DEFAULT": 1.2,
      "MIN": 0.5,
      "MAX": 2.5
    },
    {
      "NAME": "edgeGlow",
      "TYPE": "float",
      "DEFAULT": 0.8,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "kaleidoscope",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 8.0
    },
    {
      "NAME": "twist",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": -2.0,
      "MAX": 2.0
    }
  ]
}*/

// ============================================================================
// Crystal Dimension - Raymarched 3D Geometric Structures
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359
#define MAX_STEPS 100
#define MAX_DIST 50.0
#define SURF_DIST 0.001

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Rotation matrix
mat2 rot2D(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

// 3D rotation
vec3 rotateY(vec3 p, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 rotateX(vec3 p, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

// SDF primitives
float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    float m = p.x + p.y + p.z - s;
    vec3 q;
    if (3.0 * p.x < m) q = p.xyz;
    else if (3.0 * p.y < m) q = p.yzx;
    else if (3.0 * p.z < m) q = p.zxy;
    else return m * 0.57735027;

    float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
    return length(vec3(q.x, q.y - s + k, q.z - k));
}

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

// Operations
float opSmoothUnion(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}

vec3 opRep(vec3 p, vec3 c) {
    return mod(p + 0.5 * c, c) - 0.5 * c;
}

// Main scene SDF
float getDist(vec3 p) {
    // Apply twist
    if (twist != 0.0) {
        float k = twist * 0.5;
        float c = cos(k * p.z);
        float s = sin(k * p.z);
        mat2 m = mat2(c, -s, s, c);
        p.xy = m * p.xy;
    }

    // Kaleidoscope effect
    if (kaleidoscope > 0.0) {
        float ka = PI / max(kaleidoscope, 1.0);
        float angle = atan(p.y, p.x);
        angle = mod(angle, ka * 2.0);
        if (angle > ka) angle = ka * 2.0 - angle;
        float radius = length(p.xy);
        p.xy = vec2(cos(angle), sin(angle)) * radius;
    }

    // Repeat space
    vec3 rep = opRep(p, vec3(repetition));

    // Rotate repeated cells
    rep = rotateY(rep, TIME * rotationSpeed);
    rep = rotateX(rep, TIME * rotationSpeed * 0.7);

    float d = MAX_DIST;
    int geoType = int(geometryType);

    if (geoType == 0) {
        // Boxes
        d = sdBox(rep, vec3(objectScale));
    } else if (geoType == 1) {
        // Spheres
        d = sdSphere(rep, objectScale);
    } else if (geoType == 2) {
        // Octahedrons
        d = sdOctahedron(rep, objectScale);
    } else if (geoType == 3) {
        // Torus
        d = sdTorus(rep, vec2(objectScale * 0.8, objectScale * 0.3));
    } else if (geoType == 4) {
        // Box + Sphere hybrid
        float box = sdBox(rep, vec3(objectScale * 0.8));
        float sphere = sdSphere(rep, objectScale);
        d = opSmoothUnion(box, sphere, 0.3);
    } else if (geoType == 5) {
        // Complex structure
        float box = sdBox(rep, vec3(objectScale));
        vec3 rep2 = rotateY(rep, PI * 0.25);
        float box2 = sdBox(rep2, vec3(objectScale * 0.7));
        d = opSmoothUnion(box, box2, 0.2);
    }

    // Tunnel boundary
    float tunnel = -(length(p.xy) - tunnelRadius);
    d = max(d, tunnel);

    return d;
}

// Calculate normal
vec3 getNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    float d = getDist(p);
    vec3 n = d - vec3(
        getDist(p - e.xyy),
        getDist(p - e.yxy),
        getDist(p - e.yyx)
    );
    return normalize(n);
}

// Raymarching
float rayMarch(vec3 ro, vec3 rd) {
    float dO = 0.0;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * dO;
        float dS = getDist(p);
        dO += dS;

        if (dO > MAX_DIST || abs(dS) < SURF_DIST) break;
    }

    return dO;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec3 col = vec3(0.0);

    // Camera setup
    vec3 ro = vec3(0.0, 0.0, TIME * cameraSpeed * 2.0);
    vec3 rd = normalize(vec3(uv.x * fov, uv.y * fov, 1.0));

    // March the ray
    float d = rayMarch(ro, rd);

    if (d < MAX_DIST) {
        vec3 p = ro + rd * d;
        vec3 n = getNormal(p);

        // Lighting
        vec3 lightPos = ro + vec3(2.0, 2.0, -5.0);
        vec3 lightDir = normalize(lightPos - p);
        float diff = max(dot(n, lightDir), 0.0);

        // Fresnel-like edge glow
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

        // Color based on position and normal
        float colorVar = p.z * colorShift * 0.1 + length(p.xy) * 0.1;
        float h = fract(hue + colorVar);

        // Base color with lighting
        col = hsv2rgb(vec3(h, saturation, 0.3 + diff * 0.5));

        // Add edge glow
        col += fresnel * edgeGlow * hsv2rgb(vec3(h + 0.1, 1.0, 1.0));

        // Add specular highlight
        vec3 reflectDir = reflect(-lightDir, n);
        float spec = pow(max(dot(reflectDir, -rd), 0.0), 32.0);
        col += spec * glowIntensity * 0.5;
    }

    // Fog/Depth
    float fog = 1.0 - exp(-d * fogDensity);
    vec3 fogColor = hsv2rgb(vec3(hue, saturation * 0.3, 0.1));
    col = mix(col, fogColor, fog);

    // Glow in empty space
    if (d >= MAX_DIST) {
        float glow = 0.02 / (0.01 + length(uv));
        col += glow * glowIntensity * hsv2rgb(vec3(hue, saturation, 1.0));
    }

    // Vignette
    float vignette = 1.0 - length(uv) * 0.3;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
