// ============================================================================
// Shader 02: Frequency Terrain Marching
// Raymarched heightfield where the terrain IS the waveform/FFT.
// Camera flies over it, amplitude controls erosion depth.
// Target: D3D11 PS 5.0 | Fullscreen quad
// ============================================================================

#include "AudioShaderCommon.hlsli"

cbuffer ShaderParams : register(b1)
{
    float gTerrainHeight;    // max terrain displacement, default 2.0
    float gFlySpeed;         // camera fly speed, default 0.4
    float gFogDensity;       // atmospheric fog, default 0.08
    float gErosionStrength;  // audio-driven erosion, default 1.0
    float gColorIntensity;   // emission brightness, default 1.5
    float gGridGlow;         // wireframe grid overlay intensity, default 0.3
    float2 _spad1;
};

// Terrain height function: FFT-driven
float TerrainHeight(float2 p)
{
    // Base: sample FFT at x-position, waveform adds fine detail
    float fftU = frac(p.x * 0.05);
    float waveU = frac(p.y * 0.08);

    float fftH = SampleFFT(fftU) * gTerrainHeight;
    float waveH = SampleWaveform(waveU) * gTerrainHeight * 0.3;

    // FBM erosion modulated by audio RMS
    float erosion = FBM(p * 0.5, 4) * gErosionStrength * gAudioRMS;

    // Layered noise terrain
    float base = FBM(p * 0.15 + gTime * 0.02, 5) * gTerrainHeight * 0.5;

    return base + fftH + waveH - erosion;
}

// Terrain normal via central differences
float3 TerrainNormal(float2 p, float eps)
{
    float h  = TerrainHeight(p);
    float hx = TerrainHeight(p + float2(eps, 0));
    float hz = TerrainHeight(p + float2(0, eps));
    return normalize(float3(h - hx, eps, h - hz));
}

// Raymarching terrain
float2 RaymarchTerrain(float3 ro, float3 rd, float tMin, float tMax)
{
    float t = tMin;
    float lastH = 0.0;
    float lastY = 0.0;

    [loop]
    for (int i = 0; i < 128; i++)
    {
        if (t > tMax) break;

        float3 p = ro + rd * t;
        float h = TerrainHeight(p.xz);
        float delta = p.y - h;

        if (delta < 0.001)
        {
            // Bisection refinement
            float tBack = t - (t - lastH) * delta / (delta - lastY + 0.0001);
            return float2(tBack, h);
        }

        lastH = t;
        lastY = delta;

        // Adaptive step size
        t += max(delta * 0.4, 0.02);
    }

    return float2(-1.0, 0.0);
}

// Grid overlay for cyberpunk aesthetic
float GridPattern(float2 p, float lineWidth)
{
    float2 grid = abs(frac(p) - 0.5);
    float2 lines = smoothstep(lineWidth, lineWidth + 0.01, grid);
    return 1.0 - min(lines.x, lines.y);
}

float4 PS_FrequencyTerrain(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float2 ndc = uv * 2.0 - 1.0;
    ndc.x *= gResolution.x / gResolution.y;

    float t = gTime;

    // Flyover camera
    float camY = 3.0 + sin(t * 0.15) * 1.0 + gAudioRMS * 2.0;
    float3 ro = float3(t * gFlySpeed * 8.0, camY, t * gFlySpeed * 5.0);

    // Look direction with gentle sway
    float lookX = sin(t * 0.1) * 0.3;
    float lookZ = cos(t * 0.08) * 0.2;
    float3 target = ro + float3(lookX + 2.0, -1.0, lookZ + 3.0);
    float3 fwd = normalize(target - ro);
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float3 rd = normalize(fwd + right * ndc.x * 0.8 + up * ndc.y * 0.8);

    // Raymarch
    float2 hit = RaymarchTerrain(ro, rd, 0.1, 80.0);

    float3 color = 0.0;

    if (hit.x > 0.0)
    {
        float3 pos = ro + rd * hit.x;
        float3 nor = TerrainNormal(pos.xz, 0.05);

        // FFT value at hit point for coloring
        float fftVal = SampleFFT(frac(pos.x * 0.05));
        float bandPos = frac(pos.x * 0.05);

        // Emission color based on frequency position
        float3 emission = SpectralColor(bandPos + t * 0.02) * fftVal * gColorIntensity;

        // Simple directional light
        float3 lightDir = normalize(float3(0.5, 0.8, 0.3));
        float diff = max(dot(nor, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 32.0);

        // Base terrain color
        float3 terrainCol = float3(0.02, 0.03, 0.06);
        terrainCol += diff * float3(0.05, 0.08, 0.15);
        terrainCol += spec * float3(0.2, 0.4, 0.8) * 0.5;

        // Add frequency emission
        terrainCol += emission;

        // Grid overlay
        float grid = GridPattern(pos.xz * 0.5, 0.48);
        float3 gridCol = SpectralColor(bandPos + 0.5) * grid * gGridGlow * (0.5 + fftVal);
        terrainCol += gridCol;

        // Height-based glow at peaks
        float peakGlow = smoothstep(gTerrainHeight * 0.5, gTerrainHeight, hit.y);
        terrainCol += SpectralColor(gSpectralCentroid) * peakGlow * gAudioRMS * 2.0;

        // Exponential fog
        float fogAmount = 1.0 - exp(-hit.x * gFogDensity);
        float3 fogColor = lerp(float3(0.01, 0.01, 0.03), SpectralColor(t * 0.01), 0.3) * 0.5;
        color = lerp(terrainCol, fogColor, fogAmount);
    }
    else
    {
        // Sky: subtle aurora effect
        float skyGrad = uv.y;
        color = lerp(float3(0.0, 0.0, 0.02), float3(0.01, 0.01, 0.05), skyGrad);

        // Aurora bands driven by FFT
        float auroraY = uv.y * 3.0 + t * 0.05;
        float aurora = 0.0;
        [unroll]
        for (int i = 0; i < 4; i++)
        {
            float fi = (float)i / 4.0;
            float wave = sin(auroraY * (3.0 + fi * 2.0) + uv.x * 5.0 + t * 0.2) * 0.5 + 0.5;
            aurora += wave * SampleFFT(fi * 0.5) * 0.15;
        }
        color += SpectralColor(gSpectralCentroid + t * 0.03) * aurora;
    }

    // Scanline effect
    float scan = sin(uv.y * gResolution.y * 0.5) * 0.02;
    color += scan;

    return float4(ACESFilm(color), 1.0);
}
