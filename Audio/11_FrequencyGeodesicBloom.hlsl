// ============================================================================
// Shader 11: Frequency Geodesic Bloom
// Geodesic dome structure where each triangular face extrudes based on
// its mapped frequency bin. Faces emit particle trails on amplitude peaks
// creating a breathing spore/bloom effect.
// Target: D3D11 PS 5.0 | Fullscreen quad | Raymarched
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gDomeRadius;       // base geodesic radius, default 1.5
    float gExtrudeStrength;  // face extrusion amount, default 0.6
    float gSporeEmission;    // particle trail brightness, default 2.0
    float gRotationSpeed;    // dome rotation speed, default 0.08
    float gFaceGlow;         // face edge glow intensity, default 3.0
    float gTrailDecay;       // feedback persistence, default 0.96
    float gBreathScale;      // organic breathing amplitude, default 0.15
    float gWireThickness;    // wireframe edge thickness, default 0.02
};

// Icosahedron vertices (normalised to unit sphere)
// 12 vertices of a regular icosahedron
static const float PHI_G = 1.618033988749895;
static const float INV_PHI_G = 0.618033988749895;

float3 IcoVertex(int idx)
{
    // 12 vertices
    static const float3 verts[12] = {
        normalize(float3(-1,  PHI_G, 0)),
        normalize(float3( 1,  PHI_G, 0)),
        normalize(float3(-1, -PHI_G, 0)),
        normalize(float3( 1, -PHI_G, 0)),
        normalize(float3(0, -1,  PHI_G)),
        normalize(float3(0,  1,  PHI_G)),
        normalize(float3(0, -1, -PHI_G)),
        normalize(float3(0,  1, -PHI_G)),
        normalize(float3( PHI_G, 0, -1)),
        normalize(float3( PHI_G, 0,  1)),
        normalize(float3(-PHI_G, 0, -1)),
        normalize(float3(-PHI_G, 0,  1))
    };
    return verts[idx % 12];
}

// Subdivided geodesic face: returns distance to nearest edge and face ID
// Uses a simplified geodesic approximation via spherical voronoi
float3 GeodesicField(float3 dir, float t)
{
    // Generate geodesic-like points on sphere (42 points = 1-subdivision icosahedron)
    float minDist = 1e6;
    float secondDist = 1e6;
    float faceID = 0.0;
    float3 closestPoint = 0.0;

    // 12 icosahedron vertices
    [unroll]
    for (int i = 0; i < 12; i++)
    {
        float3 v = IcoVertex(i);
        float d = acos(clamp(dot(dir, v), -1.0, 1.0));

        if (d < minDist)
        {
            secondDist = minDist;
            minDist = d;
            faceID = (float)i / 12.0;
            closestPoint = v;
        }
        else if (d < secondDist)
        {
            secondDist = d;
        }
    }

    // 30 edge midpoints for finer geodesic
    [unroll]
    for (int j = 0; j < 12; j++)
    {
        for (int k = j + 1; k < 12; k++)
        {
            float3 vj = IcoVertex(j);
            float3 vk = IcoVertex(k);
            float edgeDot = dot(vj, vk);

            // Only adjacent vertices (icosahedron edge length threshold)
            if (edgeDot > 0.3 && edgeDot < 0.9)
            {
                float3 mid = normalize(vj + vk);
                float d = acos(clamp(dot(dir, mid), -1.0, 1.0));

                if (d < minDist)
                {
                    secondDist = minDist;
                    minDist = d;
                    faceID = (float)(j * 12 + k) / 144.0;
                    closestPoint = mid;
                }
                else if (d < secondDist)
                {
                    secondDist = d;
                }
            }
        }
    }

    float edge = secondDist - minDist;
    return float3(minDist, edge, faceID);
}

// SDF for the geodesic bloom structure
float GeodesicSDF(float3 p, float t, out float faceID, out float edgeDist)
{
    float r = length(p);
    float3 dir = p / max(r, 0.001);

    // Breathing: organic pulsation
    float breath = sin(t * gBreathScale * TWO_PI) * gBreathScale;

    // Get geodesic face info
    float3 geo = GeodesicField(dir, t);
    faceID = geo.z;
    edgeDist = geo.y;

    // FFT energy for this face
    float energy = SampleFFT(frac(faceID));

    // Base sphere with per-face extrusion
    float baseR = gDomeRadius + breath;
    float extrude = energy * gExtrudeStrength;

    // Smooth extrusion: face centers push out, edges stay at base
    float faceCenterBlend = smoothstep(0.0, 0.3, geo.y);
    float surfaceR = baseR + extrude * faceCenterBlend;

    // Waveform adds fine surface detail
    float waveU = frac(faceID * 7.0 + dir.x * 0.5);
    float wave = SampleWaveform(waveU) * 0.02 * gAudioRMS;
    surfaceR += wave;

    return r - surfaceR;
}

float4 PS_GeodesicBloom(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = (uv - 0.5) * 2.0;
    ndc.x *= gResolution.x / gResolution.y;
    float t = gTime;

    // Orbiting camera
    float camAngle = t * gRotationSpeed;
    float camPitch = sin(t * gRotationSpeed * 0.4) * 0.4;
    float camDist = 4.0 + sin(t * 0.1) * 0.3;

    float3 ro = float3(
        cos(camAngle) * cos(camPitch) * camDist,
        sin(camPitch) * camDist,
        sin(camAngle) * cos(camPitch) * camDist
    );

    float3 fwd = normalize(-ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd * 1.8 + right * ndc.x + up * ndc.y);

    // Feedback trail
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Raymarch
    float3 color = 0.0;
    float totalT = 0.0;
    float faceID = 0.0;
    float edgeDist = 0.0;
    bool hit = false;

    [loop]
    for (int i = 0; i < 80; i++)
    {
        float3 p = ro + rd * totalT;

        // Rotate the dome itself slowly
        float domeRot = t * 0.03;
        float cr = cos(domeRot), sr = sin(domeRot);
        float3 rp = float3(p.x * cr - p.z * sr, p.y, p.x * sr + p.z * cr);

        float d = GeodesicSDF(rp, t, faceID, edgeDist);

        // Accumulate volumetric glow near surface
        if (d < 0.5)
        {
            float energy = SampleFFT(frac(faceID));
            float glow = exp(-d * d * 100.0) * energy;
            float3 glowCol = SpectralColor(faceID + gSpectralCentroid + t * 0.01);
            color += glowCol * glow * 0.03;
        }

        if (d < 0.003)
        {
            hit = true;
            break;
        }

        totalT += max(d * 0.6, 0.005);
        if (totalT > 12.0) break;
    }

    if (hit)
    {
        float3 hitPos = ro + rd * totalT;

        float energy = SampleFFT(frac(faceID));

        // Surface color from face ID
        float hue = faceID + gSpectralCentroid * 0.3 + t * 0.01;
        float3 faceColor = SpectralColor(hue);

        // Wireframe edges
        float wire = exp(-edgeDist * edgeDist / (gWireThickness * gWireThickness));
        float3 wireColor = SpectralColor(hue + 0.3) * wire * gFaceGlow;

        // Normal estimation for lighting
        float eps = 0.005;
        float fid, ed;
        float domeRot = t * 0.03;
        float cr = cos(domeRot), sr = sin(domeRot);

        float3 hp = float3(hitPos.x*cr - hitPos.z*sr, hitPos.y, hitPos.x*sr + hitPos.z*cr);
        float d0 = GeodesicSDF(hp, t, fid, ed);

        float3 hpx = hp + float3(eps,0,0);
        float dx = GeodesicSDF(hpx, t, fid, ed);
        float3 hpy = hp + float3(0,eps,0);
        float dy = GeodesicSDF(hpy, t, fid, ed);
        float3 hpz = hp + float3(0,0,eps);
        float dz = GeodesicSDF(hpz, t, fid, ed);

        float3 nor = normalize(float3(dx - d0, dy - d0, dz - d0));

        // Lighting
        float3 lightDir = normalize(float3(0.5, 0.8, -0.3));
        float diff = max(dot(nor, lightDir), 0.0) * 0.5;
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 16.0);
        float fresnel = pow(1.0 - max(dot(nor, -rd), 0.0), 3.0);

        // Compose surface
        float3 surface = faceColor * (0.05 + diff) * (0.3 + energy * 1.5);
        surface += float3(0.3, 0.5, 0.8) * spec * 0.3;
        surface += SpectralColor(hue + 0.5) * fresnel * 0.4;
        surface += wireColor;

        // Spore emission: bright points on face centers during peaks
        if (energy > 0.5)
        {
            float sporePulse = smoothstep(0.5, 0.8, energy);
            float sporeGlow = exp(-edgeDist * 10.0) * sporePulse;
            surface += SpectralColor(hue + 0.15) * sporeGlow * gSporeEmission;
        }

        // Depth fog
        float fog = exp(-totalT * 0.1);
        color += surface * fog;
    }

    // Background
    float bgGrad = length(ndc) * 0.3;
    float3 bg = lerp(float3(0.008, 0.004, 0.016), float3(0.002, 0.002, 0.006), bgGrad);
    float stars = pow(ValueNoise(ndc * 40.0 + t * 0.005), 14.0) * 0.2;
    bg += stars;

    color += bg * (1.0 - saturate(dot(color, float3(0.33, 0.33, 0.33)) * 2.0));
    color += trail * 0.25;

    // Bloom
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.4, 1.0, lum) * 0.35;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
