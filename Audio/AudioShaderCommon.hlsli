// ============================================================================
// AudioShaderCommon.hlsli
// Shared types, constants, and utility functions for audio-reactive shaders
// Target: D3D11 / Shader Model 5.0
// ============================================================================

#ifndef AUDIO_SHADER_COMMON_HLSLI
#define AUDIO_SHADER_COMMON_HLSLI

// ---------------------------------------------------------------------------
// Constant Buffers
// ---------------------------------------------------------------------------
cbuffer PerFrame : register(b0)
{
    float4x4 gViewProj;
    float4x4 gWorld;
    float4x4 gInvViewProj;
    float3   gCameraPos;
    float    gTime;           // seconds since start
    float    gDeltaTime;      // frame delta
    float    gAudioRMS;       // root-mean-square energy [0,1]
    float    gSpectralCentroid;// normalised spectral centroid [0,1]
    float    gSpectralFlux;   // frame-to-frame spectral change [0,1]
    float2   gResolution;     // render target dimensions
    float    gBPM;            // detected BPM (0 if unavailable)
    float    _pad0;
};

// Audio data textures ---------------------------------------------------------
// gFFTTexture:      1D texture, 512 or 1024 floats, magnitude per bin [0,1]
// gWaveformTexture: 1D texture, 512 or 1024 floats, signed waveform [-1,1]
// gFFTHistory:      2D texture, rows = time (newest at y=0), cols = bins

Texture1D<float>  gFFTTexture      : register(t0);
Texture1D<float>  gWaveformTexture : register(t1);
Texture2D<float>  gFFTHistory      : register(t2);

SamplerState samLinearClamp  : register(s0);
SamplerState samLinearWrap   : register(s1);
SamplerState samPointClamp   : register(s2);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
static const float PI        = 3.14159265358979;
static const float TWO_PI    = 6.28318530717959;
static const float INV_PI    = 0.31830988618379;
static const float HALF_PI   = 1.57079632679490;
static const float E         = 2.71828182845905;
static const float PHI       = 1.61803398874989; // golden ratio
static const float SQRT2     = 1.41421356237310;

// ---------------------------------------------------------------------------
// Audio Helpers
// ---------------------------------------------------------------------------

// Sample FFT with interpolation at normalised position u in [0,1]
float SampleFFT(float u)
{
    return gFFTTexture.SampleLevel(samLinearClamp, u, 0);
}

// Sample raw waveform at normalised position u in [0,1]
float SampleWaveform(float u)
{
    return gWaveformTexture.SampleLevel(samLinearClamp, u, 0);
}

// Get energy in a frequency band [lo, hi] normalised 0-1
float BandEnergy(float lo, float hi)
{
    const int STEPS = 16;
    float sum = 0.0;
    float dt = (hi - lo) / (float)STEPS;
    [unroll]
    for (int i = 0; i < STEPS; i++)
    {
        sum += SampleFFT(lo + dt * (i + 0.5));
    }
    return sum / (float)STEPS;
}

// Common band splits
float BassBand()   { return BandEnergy(0.0, 0.08); }   // ~20-350 Hz
float MidBand()    { return BandEnergy(0.08, 0.35); }   // ~350-3kHz
float HighBand()   { return BandEnergy(0.35, 1.0); }    // ~3kHz+

// Smooth envelope follower (call per-pixel, stateless approximation)
float EnvelopeFollow(float current, float attack, float release)
{
    float coeff = current > 0.5 ? attack : release;
    return lerp(current, gAudioRMS, coeff);
}

// ---------------------------------------------------------------------------
// Noise Functions
// ---------------------------------------------------------------------------

// Hash functions
float Hash11(float p)
{
    p = frac(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return frac(p);
}

float Hash21(float2 p)
{
    float3 p3 = frac(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return frac((p3.x + p3.y) * p3.z);
}

float2 Hash22(float2 p)
{
    float3 p3 = frac(float3(p.xyx) * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return frac((p3.xx + p3.yz) * p3.zy);
}

float3 Hash33(float3 p)
{
    p = float3(dot(p, float3(127.1, 311.7, 74.7)),
               dot(p, float3(269.5, 183.3, 246.1)),
               dot(p, float3(113.5, 271.9, 124.6)));
    return frac(sin(p) * 43758.5453123);
}

// Value noise 2D
float ValueNoise(float2 p)
{
    float2 i = floor(p);
    float2 f = frac(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = Hash21(i);
    float b = Hash21(i + float2(1, 0));
    float c = Hash21(i + float2(0, 1));
    float d = Hash21(i + float2(1, 1));

    return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
}

// Gradient noise 2D (Perlin-style)
float GradNoise(float2 p)
{
    float2 i = floor(p);
    float2 f = frac(p);
    float2 u = f * f * (3.0 - 2.0 * f);

    float2 ga = Hash22(i + float2(0, 0)) * 2.0 - 1.0;
    float2 gb = Hash22(i + float2(1, 0)) * 2.0 - 1.0;
    float2 gc = Hash22(i + float2(0, 1)) * 2.0 - 1.0;
    float2 gd = Hash22(i + float2(1, 1)) * 2.0 - 1.0;

    float va = dot(ga, f - float2(0, 0));
    float vb = dot(gb, f - float2(1, 0));
    float vc = dot(gc, f - float2(0, 1));
    float vd = dot(gd, f - float2(1, 1));

    return lerp(lerp(va, vb, u.x), lerp(vc, vd, u.x), u.y) + 0.5;
}

// FBM (fractal Brownian motion)
float FBM(float2 p, int octaves)
{
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    [loop]
    for (int i = 0; i < octaves; i++)
    {
        value += amp * GradNoise(p * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return value;
}

// Curl noise 2D (returns 2D velocity)
float2 CurlNoise2D(float2 p, float eps)
{
    float n1 = GradNoise(p + float2(0, eps));
    float n2 = GradNoise(p - float2(0, eps));
    float n3 = GradNoise(p + float2(eps, 0));
    float n4 = GradNoise(p - float2(eps, 0));

    float dndx = (n3 - n4) / (2.0 * eps);
    float dndy = (n1 - n2) / (2.0 * eps);

    return float2(dndy, -dndx);
}

// 3D simplex-style noise
float Noise3D(float3 p)
{
    float3 i = floor(p);
    float3 f = frac(p);
    f = f * f * (3.0 - 2.0 * f);

    float n = dot(i, float3(1.0, 57.0, 113.0));

    float a = Hash11(n);
    float b = Hash11(n + 1.0);
    float c = Hash11(n + 57.0);
    float d = Hash11(n + 58.0);
    float e = Hash11(n + 113.0);
    float g = Hash11(n + 114.0);
    float h = Hash11(n + 170.0);
    float k = Hash11(n + 171.0);

    return lerp(
        lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y),
        lerp(lerp(e, g, f.x), lerp(h, k, f.x), f.y),
        f.z);
}

// ---------------------------------------------------------------------------
// Color Utilities
// ---------------------------------------------------------------------------

// HSV to RGB
float3 HSVtoRGB(float3 hsv)
{
    float3 rgb = clamp(abs(fmod(hsv.x * 6.0 + float3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsv.z * lerp(float3(1, 1, 1), rgb, hsv.y);
}

// Spectral color from wavelength-like parameter t [0,1]
float3 SpectralColor(float t)
{
    float3 a = float3(0.5, 0.5, 0.5);
    float3 b = float3(0.5, 0.5, 0.5);
    float3 c = float3(1.0, 1.0, 1.0);
    float3 d = float3(0.00, 0.33, 0.67);
    return a + b * cos(TWO_PI * (c * t + d));
}

// Palette generator (iq cosine palette)
float3 Palette(float t, float3 a, float3 b, float3 c, float3 d)
{
    return a + b * cos(TWO_PI * (c * t + d));
}

// Tonemap (ACES approximation)
float3 ACESFilm(float3 x)
{
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}

// ---------------------------------------------------------------------------
// SDF Primitives (for raymarching shaders)
// ---------------------------------------------------------------------------
float sdSphere(float3 p, float r) { return length(p) - r; }

float sdBox(float3 p, float3 b)
{
    float3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdTorus(float3 p, float2 t)
{
    float2 q = float2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdCapsule(float3 p, float3 a, float3 b, float r)
{
    float3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// Smooth min for SDF blending
float smin(float a, float b, float k)
{
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return lerp(b, a, h) - k * h * (1.0 - h);
}

// ---------------------------------------------------------------------------
// Fullscreen Quad Vertex Shader
// ---------------------------------------------------------------------------
struct VS_OUTPUT
{
    float4 Position : SV_POSITION;
    float2 TexCoord : TEXCOORD0;
};

// Use with a fullscreen triangle (vertices 0,1,2)
VS_OUTPUT FullscreenVS(uint vertexID : SV_VertexID)
{
    VS_OUTPUT o;
    o.TexCoord = float2((vertexID << 1) & 2, vertexID & 2);
    o.Position = float4(o.TexCoord * 2.0 - 1.0, 0.0, 1.0);
    o.TexCoord.y = 1.0 - o.TexCoord.y; // flip Y for D3D
    return o;
}

#endif // AUDIO_SHADER_COMMON_HLSLI
