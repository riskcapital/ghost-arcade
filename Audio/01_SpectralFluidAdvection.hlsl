// ============================================================================
// Shader 01: Spectral Fluid Advection
// FFT bands drive curl noise velocity fields. Low freqs push large slow
// vortices, highs create fine turbulent filaments. Feedback loop advection.
// Target: D3D11 PS 5.0 | Fullscreen quad | Ping-pong RT required
// ============================================================================

#include "AudioShaderCommon.hlsli"

Texture2D<float4> gFeedback : register(t3); // previous frame (ping-pong)

cbuffer ShaderParams : register(b1)
{
    float gFluidDecay;       // feedback decay [0.92-0.99], default 0.965
    float gVorticityScale;   // overall curl strength, default 1.0
    float gColorCycleRate;   // palette rotation speed, default 0.05
    float gZoom;             // noise coordinate zoom, default 1.0
    float gFilamentSharp;    // high-freq filament sharpness, default 1.5
    float gFeedbackMix;      // blend with previous frame, default 0.95
    float2 _spad0;
};

// Multi-octave curl field driven by audio bands
float2 AudioCurlField(float2 uv, float t)
{
    float bass = BassBand();
    float mid  = MidBand();
    float high = HighBand();

    // Large-scale vortices from bass
    float2 c1 = CurlNoise2D(uv * 1.5 * gZoom + t * 0.05, 0.01) * bass * 3.0;

    // Mid-scale swirl from mids
    float2 c2 = CurlNoise2D(uv * 4.0 * gZoom + t * 0.12, 0.005) * mid * 2.0;

    // Fine turbulent filaments from highs
    float2 c3 = CurlNoise2D(uv * 12.0 * gZoom + t * 0.3, 0.002) * high * gFilamentSharp;

    float intensity = lerp(0.6, 1.4, gSpectralCentroid);
    return (c1 + c2 + c3) * gVorticityScale * intensity;
}

// Inject colored density at FFT-driven positions
float3 InjectDensity(float2 uv, float t)
{
    float3 density = 0.0;

    // 8 frequency band injection points orbiting center
    [unroll]
    for (int i = 0; i < 8; i++)
    {
        float fi = (float)i / 8.0;
        float energy = SampleFFT(fi);
        float angle = fi * TWO_PI + t * (0.1 + fi * 0.15);
        float radius = 0.15 + fi * 0.08;
        float2 center = 0.5 + float2(cos(angle), sin(angle)) * radius;

        float dist = length(uv - center);
        float inj = exp(-dist * dist * (80.0 + energy * 200.0)) * energy;
        density += SpectralColor(fi + t * gColorCycleRate) * inj * 2.0;
    }

    // Waveform-driven injection along center
    float waveY = SampleWaveform(uv.x) * 0.15;
    float waveDist = abs(uv.y - 0.5 - waveY);
    density += SpectralColor(gSpectralCentroid + t * 0.1)
             * exp(-waveDist * waveDist * 300.0) * gAudioRMS;

    return density;
}

float4 PS_SpectralFluid(VS_OUTPUT input) : SV_Target
{
    float2 uv = input.TexCoord;
    float t = gTime;

    // Advect previous frame along audio curl field
    float2 vel = AudioCurlField(uv, t);
    float2 advUV = uv - vel * gDeltaTime;
    float3 color = gFeedback.SampleLevel(samLinearClamp, advUV, 0).rgb * gFluidDecay;

    // Add new density
    color += InjectDensity(uv, t);

    // Hue rotation by local curl magnitude
    float curlMag = length(vel);
    float h = curlMag * 0.5;
    float ch = cos(h), sh = sin(h);
    float3x3 hueRot = float3x3(
        0.299+0.701*ch+0.168*sh, 0.587-0.587*ch+0.330*sh, 0.114-0.114*ch-0.497*sh,
        0.299-0.299*ch-0.328*sh, 0.587+0.413*ch+0.035*sh, 0.114-0.114*ch+0.292*sh,
        0.299-0.300*ch+1.250*sh, 0.587-0.588*ch-1.050*sh, 0.114+0.886*ch-0.203*sh
    );
    color = mul(hueRot, color);

    // Bloom on bright areas
    float lum = dot(color, float3(0.2126, 0.7152, 0.0722));
    color += color * smoothstep(0.6, 1.2, lum) * 0.3;

    return float4(ACESFilm(color), 1.0);
}
