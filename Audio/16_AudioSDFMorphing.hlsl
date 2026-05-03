// ============================================================================
// Shader 16: Audio Reactive SDF Morphing
// Signed distance field blending between primitive shapes (sphere, torus,
// octahedron, gyroid). Blend weights are normalised energy in 4-5 frequency
// bands. Continuous organic metamorphosis with raymarched lighting.
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3);

cbuffer ShaderParams : register(b1)
{
    float gMorphSpeed;       // morph transition speed, default 0.5
    float gScale;            // object scale, default 1.2
    float gSmoothK;          // smooth blend factor, default 0.3
    float gEmission;         // surface emission, default 2.5
    float gCameraOrbit;      // camera orbit speed, default 0.15
    float gIridescence;      // iridescent surface strength, default 1.0
    float gTrailDecay;       // feedback decay, default 0.94
    float gDisplaceAmt;      // waveform surface displacement, default 0.1
};

// Additional SDF primitives
float sdOctahedron(float3 p, float s)
{
    p = abs(p);
    float m = p.x + p.y + p.z - s;
    float3 q;
    if (3.0 * p.x < m) q = p.xyz;
    else if (3.0 * p.y < m) q = p.yzx;
    else if (3.0 * p.z < m) q = p.zxy;
    else return m * 0.57735027;
    float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
    return length(float3(q.x, q.y - s + k, q.z - k));
}

float sdGyroid(float3 p, float scale, float thickness)
{
    p *= scale;
    float g = dot(sin(p), cos(p.zxy));
    return abs(g) / scale - thickness;
}

float sdRoundBox(float3 p, float3 b, float r)
{
    float3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Main morphing SDF
float MorphSDF(float3 p, float t, out float3 matColor)
{
    // Audio band weights
    float w0 = BassBand();
    float w1 = SampleFFT(0.15);  // low-mid
    float w2 = MidBand();
    float w3 = SampleFFT(0.55);  // upper-mid
    float w4 = HighBand();

    // Normalise weights
    float totalW = w0 + w1 + w2 + w3 + w4 + 0.001;
    w0 /= totalW; w1 /= totalW; w2 /= totalW; w3 /= totalW; w4 /= totalW;

    // Slow rotation of shape
    float rotAngle = t * 0.2;
    float cr = cos(rotAngle), sr = sin(rotAngle);
    float3 rp = float3(p.x * cr - p.z * sr, p.y, p.x * sr + p.z * cr);

    // Second rotation axis
    float rotAngle2 = t * 0.13;
    float cr2 = cos(rotAngle2), sr2 = sin(rotAngle2);
    rp = float3(rp.x, rp.y * cr2 - rp.z * sr2, rp.y * sr2 + rp.z * cr2);

    // Waveform surface displacement
    float waveU = frac(atan2(rp.z, rp.x) / TWO_PI + 0.5);
    float wave = SampleWaveform(waveU) * gDisplaceAmt;

    // Five primitive SDFs
    float d0 = sdSphere(rp, gScale + wave);
    float d1 = sdTorus(rp, float2(gScale * 0.8, gScale * 0.3 + wave * 0.5));
    float d2 = sdOctahedron(rp, gScale * 1.1 + wave * 0.3);
    float d3 = sdGyroid(rp, 3.0 / gScale, 0.03 + gAudioRMS * 0.02);
    float d4 = sdRoundBox(rp, float3(gScale * 0.6, gScale * 0.6, gScale * 0.6) + wave * 0.2, 0.1);

    // Smooth blend all shapes weighted by audio
    float k = gSmoothK;
    float d = d0; // start with sphere
    d = smin(d * (1.0 - w0) + d0 * w0, d1 * w1 + d * (1.0 - w1), k);
    d = smin(d, d2, k * w2 * 2.0);
    d = smin(d, d3, k * w3 * 3.0);
    d = smin(d, d4, k * w4 * 2.0);

    // Weighted combination (more direct)
    d = d0 * w0 + d1 * w1 + d2 * w2 + d3 * w3 + d4 * w4;

    // Color per shape contribution
    float3 c0 = SpectralColor(0.0 + t * 0.01);
    float3 c1 = SpectralColor(0.2 + t * 0.01);
    float3 c2 = SpectralColor(0.4 + t * 0.01);
    float3 c3 = SpectralColor(0.6 + t * 0.01);
    float3 c4 = SpectralColor(0.8 + t * 0.01);
    matColor = c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4;

    return d;
}

// Normal estimation
float3 MorphNormal(float3 p, float t)
{
    float eps = 0.002;
    float3 dummy;
    float d = MorphSDF(p, t, dummy);
    return normalize(float3(
        MorphSDF(p + float3(eps, 0, 0), t, dummy) - d,
        MorphSDF(p + float3(0, eps, 0), t, dummy) - d,
        MorphSDF(p + float3(0, 0, eps), t, dummy) - d
    ));
}

float4 PS_SDFMorph(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = (uv - 0.5) * 2.0;
    ndc.x *= gResolution.x / gResolution.y;
    float t = gTime;

    // Orbiting camera
    float camAngle = t * gCameraOrbit;
    float camPitch = sin(t * gCameraOrbit * 0.3) * 0.3;
    float camDist = 3.5 + sin(t * 0.1) * 0.3;

    float3 ro = float3(
        cos(camAngle) * cos(camPitch) * camDist,
        sin(camPitch) * camDist * 1.5,
        sin(camAngle) * cos(camPitch) * camDist
    );

    float3 fwd = normalize(-ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd * 1.8 + right * ndc.x + up * ndc.y);

    // Feedback
    float3 trail = gFeedback.SampleLevel(samLinearClamp, uv, 0).rgb * gTrailDecay;

    // Raymarch
    float3 color = 0.0;
    float totalT = 0.0;
    bool hit = false;
    float3 matColor = 0.0;

    [loop]
    for (int i = 0; i < 80; i++)
    {
        float3 p = ro + rd * totalT;
        float3 mc;
        float d = MorphSDF(p, t, mc);

        // Volumetric glow near surface
        if (d < 0.5)
        {
            float glow = exp(-d * d * 50.0);
            color += mc * glow * 0.01 * gAudioRMS;
        }

        if (d < 0.001)
        {
            matColor = mc;
            hit = true;
            break;
        }

        totalT += d * 0.7;
        if (totalT > 10.0) break;
    }

    if (hit)
    {
        float3 pos = ro + rd * totalT;
        float3 nor = MorphNormal(pos, t);

        // Lighting
        float3 lightDir1 = normalize(float3(0.5, 0.8, 0.3));
        float3 lightDir2 = normalize(float3(-0.3, 0.5, -0.8));

        float diff1 = max(dot(nor, lightDir1), 0.0);
        float diff2 = max(dot(nor, lightDir2), 0.0) * 0.3;
        float spec1 = pow(max(dot(reflect(-lightDir1, nor), -rd), 0.0), 32.0);
        float spec2 = pow(max(dot(reflect(-lightDir2, nor), -rd), 0.0), 16.0);
        float fresnel = pow(1.0 - max(dot(nor, -rd), 0.0), 4.0);

        // Iridescent color shift based on view angle
        float iridAngle = dot(nor, -rd);
        float3 iridColor = SpectralColor(iridAngle * 2.0 + gSpectralCentroid + t * 0.02);

        // Compose surface
        float3 surface = matColor * (0.05 + diff1 * 0.5 + diff2 * 0.2);
        surface += float3(1.0, 0.95, 0.9) * spec1 * 0.6;
        surface += matColor * spec2 * 0.3;
        surface += iridColor * fresnel * gIridescence;

        // Audio emission: surface glows with energy
        surface += matColor * gEmission * gAudioRMS * 0.5;

        // Subsurface scattering approximation
        float sss = max(dot(-nor, lightDir1), 0.0) * 0.3;
        surface += matColor * sss * float3(1.0, 0.5, 0.3) * 0.2;

        // Depth fog
        float fog = exp(-totalT * 0.15);
        color += surface * fog;
    }

    // Background: gradient + subtle particles
    float bgR = length(ndc);
    float3 bg = lerp(float3(0.008, 0.005, 0.015), float3(0.002, 0.002, 0.005), bgR);
    float stars = pow(ValueNoise(ndc * 35.0 + t * 0.003), 12.0) * 0.15;
    bg += stars;

    color += bg * (1.0 - saturate(dot(color, float3(0.33, 0.33, 0.33)) * 3.0));
    color += trail * 0.2;

    // Bloom
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.4, 1.0, lum) * 0.4;

    // Vignette
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 2.0;
    color *= smoothstep(0.0, 0.5, vig);

    return float4(ACESFilm(color), 1.0);
}
