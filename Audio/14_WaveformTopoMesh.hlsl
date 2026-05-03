// ============================================================================
// Shader 14: Waveform Topological Mesh
// Flat grid mesh where every vertex Y-position is a sample from the
// circular waveform buffer. Mesh wraps toroidally. Lighting and color
// driven by local slope (derivative of waveform). Raymarched heightfield.
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

cbuffer ShaderParams : register(b1)
{
    float gMeshDensity;      // grid cell density, default 40.0
    float gHeightScale;      // waveform height multiplier, default 1.5
    float gCameraHeight;     // camera elevation, default 2.5
    float gCameraSpeed;      // camera orbit speed, default 0.15
    float gWireOpacity;      // wireframe overlay opacity, default 0.6
    float gSlopeColorScale;  // slope-to-color mapping, default 3.0
    float gFFTLayerScale;    // FFT second layer height, default 0.8
    float gEmissionBoost;    // peak emission brightness, default 2.5
};

// Sample height at a grid position (toroidal waveform)
float MeshHeight(float2 p)
{
    // Primary layer: waveform in X, FFT in Z
    float waveU = frac(p.x * 0.05);
    float fftU  = frac(p.y * 0.05);

    float waveH = SampleWaveform(waveU) * gHeightScale;
    float fftH  = SampleFFT(fftU) * gFFTLayerScale;

    // Combine: waveform is the primary surface, FFT modulates
    float h = waveH + fftH;

    // Add subtle noise for organic feel
    float noise = GradNoise(p * 0.3 + gTime * 0.05) * 0.2 * gAudioRMS;
    h += noise;

    return h;
}

// Surface normal via central differences
float3 MeshNormal(float2 p, float eps)
{
    float h  = MeshHeight(p);
    float hx = MeshHeight(p + float2(eps, 0));
    float hz = MeshHeight(p + float2(0, eps));
    return normalize(float3(h - hx, eps * 2.0, h - hz));
}

// Local slope magnitude (for coloring)
float SlopeMagnitude(float2 p, float eps)
{
    float hx1 = MeshHeight(p + float2(eps, 0));
    float hx2 = MeshHeight(p - float2(eps, 0));
    float hz1 = MeshHeight(p + float2(0, eps));
    float hz2 = MeshHeight(p - float2(0, eps));

    float dhdx = (hx1 - hx2) / (2.0 * eps);
    float dhdz = (hz1 - hz2) / (2.0 * eps);

    return sqrt(dhdx * dhdx + dhdz * dhdz);
}

// Grid wireframe pattern
float WireframePattern(float2 p, float density, float thickness)
{
    float2 grid = abs(frac(p * density) - 0.5);
    float2 dGrid = fwidth(p * density) * 0.5; // approximate for fullscreen
    float2 lines = smoothstep(thickness + 0.01, thickness, grid);
    return max(lines.x, lines.y);
}

// Raymarch heightfield
float2 RaymarchMesh(float3 ro, float3 rd, float tMin, float tMax)
{
    float t = tMin;
    float lastDelta = 0.0;
    float lastT = tMin;

    [loop]
    for (int i = 0; i < 100; i++)
    {
        if (t > tMax) break;

        float3 p = ro + rd * t;
        float h = MeshHeight(p.xz);
        float delta = p.y - h;

        if (delta < 0.005)
        {
            // Linear interpolation for precise hit
            float tHit = lastT + (t - lastT) * lastDelta / (lastDelta - delta + 0.0001);
            return float2(tHit, h);
        }

        lastDelta = delta;
        lastT = t;
        t += max(delta * 0.35, 0.03);
    }

    return float2(-1.0, 0.0);
}

float4 PS_TopoMesh(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = (uv - 0.5) * 2.0;
    ndc.x *= gResolution.x / gResolution.y;
    float t = gTime;

    // Camera
    float camAngle = t * gCameraSpeed;
    float camDist = 12.0 + sin(t * 0.08) * 2.0;
    float camH = gCameraHeight + gAudioRMS * 1.0 + sin(t * 0.12) * 0.5;

    float3 ro = float3(
        cos(camAngle) * camDist + t * 0.5,
        camH,
        sin(camAngle) * camDist + t * 0.3
    );

    float3 target = ro + float3(cos(camAngle + 0.3) * 3.0, -1.5, sin(camAngle + 0.3) * 3.0);
    float3 fwd = normalize(target - ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd * 1.6 + right * ndc.x + up * ndc.y);

    // Raymarch
    float2 hit = RaymarchMesh(ro, rd, 0.1, 60.0);

    float3 color = 0.0;

    if (hit.x > 0.0)
    {
        float3 pos = ro + rd * hit.x;
        float3 nor = MeshNormal(pos.xz, 0.05);

        // Slope for coloring
        float slope = SlopeMagnitude(pos.xz, 0.05);

        // FFT and waveform values at this position
        float fftVal = SampleFFT(frac(pos.z * 0.05));
        float waveVal = abs(SampleWaveform(frac(pos.x * 0.05)));

        // --- Slope-driven coloring ---
        // Flat areas: cool colors, steep areas: hot colors
        float slopeNorm = saturate(slope * gSlopeColorScale);
        float3 flatColor = Palette(0.3 + gSpectralCentroid * 0.2,
            float3(0.5, 0.5, 0.5), float3(0.5, 0.5, 0.5),
            float3(1.0, 1.0, 1.0), float3(0.0, 0.10, 0.20));
        float3 steepColor = Palette(0.7 + gSpectralCentroid * 0.3,
            float3(0.5, 0.5, 0.5), float3(0.5, 0.5, 0.3),
            float3(1.0, 0.7, 0.4), float3(0.0, 0.15, 0.30));

        float3 surfaceColor = lerp(flatColor, steepColor, slopeNorm);

        // Height-based emission: peaks glow
        float peakGlow = smoothstep(gHeightScale * 0.4, gHeightScale, hit.y);
        surfaceColor += SpectralColor(frac(pos.x * 0.05) + t * 0.01) * peakGlow * gEmissionBoost * fftVal;

        // Valley glow (negative waveform)
        float valleyGlow = smoothstep(-gHeightScale * 0.2, -gHeightScale * 0.8, hit.y);
        surfaceColor += SpectralColor(gSpectralCentroid + 0.5) * valleyGlow * gEmissionBoost * 0.5;

        // --- Lighting ---
        float3 lightDir = normalize(float3(0.4, 0.8, 0.3));
        float diff = max(dot(nor, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 24.0);
        float fresnel = pow(1.0 - max(dot(nor, -rd), 0.0), 4.0);

        float3 lit = surfaceColor * (0.08 + diff * 0.6);
        lit += float3(0.4, 0.6, 1.0) * spec * 0.4;
        lit += SpectralColor(gSpectralCentroid) * fresnel * 0.3;

        // --- Wireframe overlay ---
        float wire = WireframePattern(pos.xz, gMeshDensity * 0.05, 0.45);
        float3 wireColor = SpectralColor(frac(pos.x * 0.05) + 0.3 + t * 0.005);
        lit += wireColor * wire * gWireOpacity * (0.3 + fftVal);

        // --- Grid intersection glow (where waveform crosses zero) ---
        float zeroCross = exp(-waveVal * waveVal * 200.0) * 0.5;
        lit += SpectralColor(gSpectralCentroid + 0.2) * zeroCross;

        // Fog
        float fog = exp(-hit.x * 0.04);
        float3 fogColor = float3(0.01, 0.015, 0.03);
        color = lerp(fogColor, lit, fog);
    }
    else
    {
        // Sky
        float skyGrad = max(rd.y, 0.0);
        color = lerp(float3(0.01, 0.015, 0.03), float3(0.005, 0.008, 0.02), skyGrad);

        // Horizon glow
        float horizon = exp(-abs(rd.y) * 10.0) * gAudioRMS * 0.2;
        color += SpectralColor(gSpectralCentroid + t * 0.01) * horizon;
    }

    // Scanline overlay
    float scan = sin(uv.y * gResolution.y * 0.3 + t * 0.5) * 0.01;
    color += scan;

    return float4(ACESFilm(color), 1.0);
}
