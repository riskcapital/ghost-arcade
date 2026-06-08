/*{
    "DESCRIPTION": "Raymarched skeletal radiolaria — microscopic silica organisms whose lattice skeletons are built from nested voronoi dual-graphs. Each shell is a geodesic cage where voronoi edges become structural spines and cell centers become fenestrations (windows). Multiple concentric shells rotate independently with cytoplasmic streaming visible through the gaps. Axopods (needle-like pseudopods) radiate from the central capsule using the SDF as signed distance along angular slices. Light diffracts through the silica lattice creating structural coloration like opal. Nothing like this exists in shader art — it merges protistology with crystallography.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Organic"],
    "INPUTS": [
        { "NAME": "shells", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 5.0, "LABEL": "Shell Count" },
        { "NAME": "spineThickness", "TYPE": "float", "DEFAULT": 0.03, "MIN": 0.005, "MAX": 0.08, "LABEL": "Spine Thickness" },
        { "NAME": "fenestrationSize", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.1, "MAX": 1.0, "LABEL": "Fenestration Size" },
        { "NAME": "axopodLength", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0, "LABEL": "Axopod Length" },
        { "NAME": "axopodCount", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 24.0, "LABEL": "Axopod Count" },
        { "NAME": "cytoplasmFlow", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0, "LABEL": "Cytoplasm Flow" },
        { "NAME": "shellRotation", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0, "LABEL": "Shell Rotation" },
        { "NAME": "diffractionStrength", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.5, "LABEL": "Structural Color" },
        { "NAME": "silicaClarity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Silica Clarity" },
        { "NAME": "rotateX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14, "MAX": 3.14, "LABEL": "Rotate X" },
        { "NAME": "rotateY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14, "MAX": 3.14, "LABEL": "Rotate Y" },
        { "NAME": "zoom", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0, "LABEL": "Zoom" },
        { "NAME": "darkfieldMode", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Darkfield / Brightfield" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Spherical voronoi approximation via angular coordinates
// Returns (edge distance, cell id) — the EDGE is the skeleton
vec3 sphericalVoronoi(vec3 nor, float cellDensity, float anim) {
    // Project to two angular coords on sphere
    float theta = atan(nor.z, nor.x);
    float phi = asin(clamp(nor.y, -1.0, 1.0));
    vec2 uv = vec2(theta * cellDensity / 3.14159, phi * cellDensity / 1.5708);

    vec2 ip = floor(uv), fp = fract(uv);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 pt = hash2(ip + nb);
        pt = 0.5 + 0.4 * sin(anim + 6.2831 * pt);
        float dist = length(nb + pt - fp);
        if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
        else if (dist < d2) { d2 = dist; }
    }
    return vec3(d1, d2 - d1, id);
}

// Radiolarian skeleton SDF
float radiolariaSDF(vec3 p, float t) {
    float d = 1e5;
    float R = length(p);

    // === CONCENTRIC SHELLS ===
    int shellCount = int(shells);
    for (int s = 0; s < 5; s++) {
        if (s >= shellCount) break;
        float fs = float(s);

        // Shell radius
        float shellR = 0.4 + fs * 0.35;

        // Independent rotation per shell
        vec3 sp = p;
        float rotAngle = t * shellRotation * (1.0 + fs * 0.3) * (mod(fs, 2.0) < 1.0 ? 1.0 : -1.0);
        sp.xz *= rot2(rotAngle);
        sp.yz *= rot2(rotAngle * 0.7 + fs * 0.5);

        // Sphere shell distance
        float shellDist = abs(R - shellR) - spineThickness;

        // Voronoi lattice on this shell — edges are spines, centers are holes
        vec3 nor = sp / max(R, 0.001);
        float cellDensity = 3.0 + fs * 1.5;
        vec3 vor = sphericalVoronoi(nor, cellDensity, t * 0.3 + fs * 2.0);

        // Fenestrations: carve out cell centers (keep only edges = skeleton)
        float edgeDist = vor.y; // distance to nearest edge
        float fenestration = smoothstep(0.0, fenestrationSize * 0.15, edgeDist);

        // Spine: only where close to shell AND on a voronoi edge
        float spine = max(shellDist, fenestration * shellR * 0.5 - spineThickness);

        // Spine nodes (intersections are thickened)
        float nodeThicken = exp(-vor.x * 20.0) * spineThickness * 0.5;
        spine -= nodeThicken;

        d = min(d, spine);

        // Inter-shell connecting struts (radial bars at voronoi vertices)
        if (s < shellCount - 1) {
            float nextR = shellR + 0.35;
            float radialDist = max(abs(R - (shellR + nextR) * 0.5) - 0.175, 0.0);
            float strutMask = step(edgeDist, 0.02) * step(vor.x, 0.25);
            float strut = length(vec2(radialDist, edgeDist)) - spineThickness * 0.5;
            d = min(d, max(strut, -strutMask + 0.5));
        }
    }

    // === AXOPODS (needle pseudopods radiating outward) ===
    if (axopodLength > 0.01) {
        float outerShellR = 0.4 + float(shellCount - 1) * 0.35;
        if (R > outerShellR - 0.1) {
            // Angular slicing for axopod directions
            float theta = atan(p.z, p.x);
            float phi = atan(p.y, length(p.xz));

            // Quantize to axopod directions
            float thetaQ = floor(theta * axopodCount / 6.2831 + 0.5) * 6.2831 / axopodCount;
            float phiQ = floor(phi * axopodCount * 0.5 / 3.14159 + 0.5) * 3.14159 / (axopodCount * 0.5);

            // Distance to nearest axopod axis
            vec3 axoDir = vec3(cos(thetaQ) * cos(phiQ), sin(phiQ), sin(thetaQ) * cos(phiQ));
            float axoDist = length(cross(p, axoDir)) / max(length(axoDir), 0.001);

            // Taper: thin at tip
            float radialPos = max(R - outerShellR, 0.0);
            float taper = spineThickness * 0.3 * (1.0 - radialPos / axopodLength);

            // Axopod SDF: cylinder with taper, only outside shells
            if (taper > 0.001) {
                float axo = axoDist - taper;
                axo = max(axo, R - outerShellR - axopodLength);
                axo = max(axo, outerShellR - R);
                d = min(d, axo);
            }
        }
    }

    // === CENTRAL CAPSULE (endoplasm) ===
    float capsule = R - 0.25;
    d = min(d, capsule);

    return d;
}

vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(0.003, 0.0);
    return normalize(vec3(
        radiolariaSDF(p + e.xyy, t) - radiolariaSDF(p - e.xyy, t),
        radiolariaSDF(p + e.yxy, t) - radiolariaSDF(p - e.yxy, t),
        radiolariaSDF(p + e.yyx, t) - radiolariaSDF(p - e.yyx, t)
    ));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * 0.5;

    // Camera
    vec3 ro = vec3(0.0, 0.0, -3.0 / zoom);
    vec3 rd = normalize(vec3(uv, 0.8));

    float autoRot = t * 0.15;
    ro.xz *= rot2(rotateY + autoRot);
    rd.xz *= rot2(rotateY + autoRot);
    ro.yz *= rot2(rotateX + sin(t * 0.2) * 0.08);
    rd.yz *= rot2(rotateX + sin(t * 0.2) * 0.08);

    // Raymarch
    float totalDist = 0.0;
    bool hit = false;
    for (int i = 0; i < 90; i++) {
        vec3 pos = ro + rd * totalDist;
        float d = radiolariaSDF(pos, t);
        if (d < 0.001) { hit = true; break; }
        if (totalDist > 8.0) break;
        totalDist += d;
    }

    vec3 col;

    // Background: microscopy field
    vec3 bgCol;
    if (darkfieldMode > 0.5) {
        bgCol = vec3(0.0, 0.0, 0.02); // darkfield: black background
    } else {
        bgCol = vec3(0.88, 0.92, 0.95); // brightfield: light background
    }
    col = bgCol;

    if (hit) {
        vec3 pos = ro + rd * totalDist;
        vec3 nor = calcNormal(pos, t);
        float R = length(pos);

        // Identify what we hit
        bool isCapsule = R < 0.27;
        float outerR = 0.4 + (shells - 1.0) * 0.35;
        bool isAxopod = R > outerR + 0.05;

        // Light
        vec3 light1 = normalize(vec3(0.5, 0.8, -0.4));
        vec3 light2 = normalize(vec3(-0.4, -0.3, 0.6));
        float diff1 = max(dot(nor, light1), 0.0);
        float diff2 = max(dot(nor, light2), 0.0);
        float spec = pow(max(dot(reflect(-light1, nor), -rd), 0.0), 64.0);
        float fres = pow(1.0 - abs(dot(nor, -rd)), 4.0);

        // === STRUCTURAL COLORATION (thin-film diffraction) ===
        // Silica lattice creates iridescence like opal
        float thinFilm = fres * diffractionStrength;
        float diffHue = fract(0.3 + dot(nor, rd) * 0.5 + R * 2.0);

        // Three-channel prismatic split
        vec3 diffraction;
        diffraction.r = hsv2rgb(vec3(fract(diffHue - 0.05), 0.8, 1.0)).r;
        diffraction.g = hsv2rgb(vec3(diffHue, 0.8, 1.0)).g;
        diffraction.b = hsv2rgb(vec3(fract(diffHue + 0.05), 0.8, 1.0)).b;

        if (isCapsule) {
            // Central capsule: dark endoplasm with organelles
            vec3 capsuleNor = pos / max(R, 0.001);
            vec3 vor = sphericalVoronoi(capsuleNor, 6.0, t);

            // Cytoplasmic streaming
            float streaming = sin(vor.z * 12.0 + t * cytoplasmFlow * 4.0) * 0.5 + 0.5;

            vec3 endoplasm = vec3(0.15, 0.1, 0.08);
            vec3 organelle = hsv2rgb(vec3(0.1, 0.4, 0.3 + streaming * 0.2));
            float orgMask = exp(-vor.x * vor.x * 10.0);

            col = mix(endoplasm, organelle, orgMask);
            col *= 0.5 + diff1 * 0.3;
        } else if (isAxopod) {
            // Axopods: translucent silica needles
            vec3 silica = mix(vec3(0.7, 0.75, 0.8), vec3(0.9, 0.92, 0.95), silicaClarity);
            col = silica * (0.3 + diff1 * 0.5 + diff2 * 0.2);
            col += diffraction * thinFilm * 0.5;
            col += spec * 0.4;
        } else {
            // Skeleton lattice: silica with structural color
            vec3 silica = mix(vec3(0.6, 0.65, 0.7), vec3(0.85, 0.88, 0.9), silicaClarity);

            col = silica * (0.2 + diff1 * 0.5 + diff2 * 0.15);
            col += diffraction * thinFilm;
            col += spec * 0.6;
            col += fres * 0.2 * vec3(0.8, 0.85, 1.0);

            // Cytoplasm visible through fenestrations (fake SSS)
            float sss = exp(-R * 3.0) * cytoplasmFlow * 0.3;
            float sssFlow = sin(t * 2.0 + R * 8.0) * 0.5 + 0.5;
            col += vec3(0.2, 0.15, 0.1) * sss * sssFlow;
        }

        // Darkfield mode: bright on dark (edge-lit)
        if (darkfieldMode > 0.5) {
            float edge = fres;
            col = col * 0.3 + col * edge * 2.0;
            col += diffraction * thinFilm * 1.5;
        }

        // Depth fog
        float fog = exp(-totalDist * 0.15);
        col = mix(bgCol, col, fog);

    } else {
        // Volumetric glow around organism (subsurface scatter halo)
        // Cheap: trace approx distance to center
        vec3 toCenter = -ro;
        float closestApproach = length(cross(rd, toCenter));
        float haloR = 0.4 + (shells - 1.0) * 0.35 + axopodLength;
        float halo = exp(-(closestApproach - haloR * 0.5) * 3.0) * 0.05;
        halo = max(halo, 0.0);

        if (darkfieldMode > 0.5) {
            col += hsv2rgb(vec3(0.55, 0.3, halo));
        } else {
            col -= vec3(halo * 0.3);
        }
    }

    col = clamp(col, 0.0, 1.0);
    col = pow(col, vec3(0.95));

    gl_FragColor = vec4(col, 1.0);
}
