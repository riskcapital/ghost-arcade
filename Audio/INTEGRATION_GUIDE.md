# Audio-Reactive Shader System — Integration Guide
## Shaders 01–05 for Shrink-Wrap / D3D11

---

## Architecture Overview

All 5 shaders share a common header (`AudioShaderCommon.hlsli`) and follow the same resource binding convention, making them hot-swappable at runtime.

```
┌─────────────────────────────────────────────┐
│  Host App (D3D11)                           │
│  ┌───────────┐  ┌────────────┐              │
│  │ Audio In   │→│ FFT / RMS  │              │
│  │ (WASAPI)   │  │ Analysis   │              │
│  └───────────┘  └─────┬──────┘              │
│                       │                      │
│          ┌────────────┴────────────┐         │
│          ▼            ▼            ▼         │
│    ┌──────────┐ ┌──────────┐ ┌─────────┐    │
│    │ FFT Tex  │ │ Wave Tex │ │ CB Data │    │
│    │ t0 (1D)  │ │ t1 (1D)  │ │ b0      │    │
│    └──────────┘ └──────────┘ └─────────┘    │
│          │            │            │         │
│          ▼            ▼            ▼         │
│    ┌─────────────────────────────────────┐   │
│    │  Active Pixel Shader (01–05)        │   │
│    │  + Fullscreen VS from common header │   │
│    └──────────────────┬──────────────────┘   │
│                       │                      │
│              ┌────────┴────────┐             │
│              ▼                 ▼             │
│        ┌──────────┐    ┌──────────┐         │
│        │ RT (out) │    │ Feedback │         │
│        │ Display  │    │ (ping-   │         │
│        │          │    │  pong)   │         │
│        └──────────┘    └──────────┘         │
└─────────────────────────────────────────────┘
```

---

## Resource Binding Contract

### Constant Buffer b0 — PerFrame (all shaders)

```cpp
struct PerFrameCB {
    XMFLOAT4X4 viewProj;       // camera view-projection
    XMFLOAT4X4 world;          // world transform
    XMFLOAT4X4 invViewProj;    // inverse view-projection
    XMFLOAT3   cameraPos;
    float      time;            // seconds since start
    float      deltaTime;       // frame delta (seconds)
    float      audioRMS;        // root-mean-square [0,1]
    float      spectralCentroid;// normalised [0,1]
    float      spectralFlux;    // frame delta spectral change [0,1]
    XMFLOAT2   resolution;     // render target size (pixels)
    float      bpm;            // detected BPM (0 if N/A)
    float      _pad;
};
// Total: 256 bytes (aligned)
```

### Constant Buffer b1 — ShaderParams (per-shader)

Each shader defines its own `ShaderParams` struct in `b1`. All are 32 bytes (8 floats). Map and update per-shader when switching.

### Texture Slots

| Slot | Resource | Format | Description |
|------|----------|--------|-------------|
| t0 | `gFFTTexture` | `R32_FLOAT`, 512 or 1024 wide | FFT magnitude bins, normalised [0,1] |
| t1 | `gWaveformTexture` | `R32_FLOAT`, 512 or 1024 wide | Raw waveform samples [-1,1] |
| t2 | `gFFTHistory` | `R32_FLOAT`, 512×128 | Scrolling FFT spectrogram (optional) |
| t3 | `gFeedback` | `R16G16B16A16_FLOAT` | Previous frame for feedback (ping-pong) |

### Samplers

| Slot | Name | Config |
|------|------|--------|
| s0 | `samLinearClamp` | Linear filter, Clamp addressing |
| s1 | `samLinearWrap` | Linear filter, Wrap addressing |
| s2 | `samPointClamp` | Point filter, Clamp addressing |

---

## Host-Side Setup (D3D11 C++ Pseudocode)

### 1. Audio Texture Updates (every frame)

```cpp
// FFT data from your audio engine (FMOD, BASS, WASAPI, etc.)
float fftData[512];
audioEngine->GetFFT(fftData, 512);

// Normalise to [0,1]
float maxVal = *std::max_element(fftData, fftData + 512);
if (maxVal > 0.0f)
    for (int i = 0; i < 512; i++) fftData[i] /= maxVal;

// Update 1D texture
D3D11_MAPPED_SUBRESOURCE mapped;
ctx->Map(fftTexture, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
memcpy(mapped.pData, fftData, sizeof(fftData));
ctx->Unmap(fftTexture, 0);

// Same for waveform
float waveData[512];
audioEngine->GetWaveform(waveData, 512);
ctx->Map(waveTexture, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
memcpy(mapped.pData, waveData, sizeof(waveData));
ctx->Unmap(waveTexture, 0);
```

### 2. 1D Texture Creation

```cpp
D3D11_TEXTURE1D_DESC desc = {};
desc.Width = 512;
desc.MipLevels = 1;
desc.ArraySize = 1;
desc.Format = DXGI_FORMAT_R32_FLOAT;
desc.Usage = D3D11_USAGE_DYNAMIC;
desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
desc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;

device->CreateTexture1D(&desc, nullptr, &fftTexture);
device->CreateShaderResourceView(fftTexture, nullptr, &fftSRV);
```

### 3. Feedback Ping-Pong

```cpp
// Create two R16G16B16A16_FLOAT render targets at display resolution
for (int i = 0; i < 2; i++) {
    D3D11_TEXTURE2D_DESC rtDesc = {};
    rtDesc.Width = width;
    rtDesc.Height = height;
    rtDesc.MipLevels = 1;
    rtDesc.ArraySize = 1;
    rtDesc.Format = DXGI_FORMAT_R16G16B16A16_FLOAT;
    rtDesc.SampleDesc = { 1, 0 };
    rtDesc.Usage = D3D11_USAGE_DEFAULT;
    rtDesc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    device->CreateTexture2D(&rtDesc, nullptr, &feedbackRT[i]);
    device->CreateRenderTargetView(feedbackRT[i], nullptr, &feedbackRTV[i]);
    device->CreateShaderResourceView(feedbackRT[i], nullptr, &feedbackSRV[i]);
}

// Per frame: render to feedbackRT[current], bind feedbackSRV[1-current] as t3
int current = frameCount % 2;
ctx->OMSetRenderTargets(1, &feedbackRTV[current], nullptr);
ctx->PSSetShaderResources(3, 1, &feedbackSRV[1 - current]);
// ... draw fullscreen quad ...
// Then copy/resolve to backbuffer for display
```

### 4. Fullscreen Draw (no vertex buffer needed)

```cpp
// The FullscreenVS in the common header generates a triangle from SV_VertexID
ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
ctx->IASetInputLayout(nullptr);  // no input layout needed
ctx->VSSetShader(fullscreenVS, nullptr, 0);
ctx->PSSetShader(activePixelShader, nullptr, 0);
ctx->Draw(3, 0);  // 3 vertices = fullscreen triangle
```

---

## Per-Shader Parameter Defaults

### 01 — Spectral Fluid Advection
```
FluidDecay:      0.965
VorticityScale:  1.0
ColorCycleRate:  0.05
Zoom:            1.0
FilamentSharp:   1.5
FeedbackMix:     0.95
```
**Feedback:** Required (ping-pong). Heavy use of advection feedback.

### 02 — Frequency Terrain Marching
```
TerrainHeight:   2.0
FlySpeed:        0.4
FogDensity:      0.08
ErosionStrength: 1.0
ColorIntensity:  1.5
GridGlow:        0.3
```
**Feedback:** Not required. Self-contained raymarcher.

### 03 — Centrifugal Frequency Rings
```
RingCount:       12
ExpansionRate:   1.5
TrailDecay:      0.94
ParticleDensity: 60.0
ColorShiftRate:  0.1
RingThickness:   0.004
GlowRadius:      0.02
CenterPulse:     1.0
```
**Feedback:** Required (trails).

### 04 — Waveform Ribbon Helix
```
HelixRadius:     1.2
HelixPitch:      0.8
RibbonWidth:     0.08
TwistRate:       3.0
CameraOrbitSpeed:0.2
EmissionPower:   3.0
TrailLength:     6.0
WaveformScale:   0.4
```
**Feedback:** Not required. Volumetric glow via accumulation in raymarch.

### 05 — Harmonic Voronoi Fracture
```
CellScale:       4.0
OrbitRadius:     0.3
BorderWidth:     0.06
ShatterForce:    2.0
ColorDepth:      1.0
TrailDecay:      0.92
BorderEmission:  4.0
ReformSpeed:     2.0
```
**Feedback:** Required (trails + chromatic aberration).

---

## Audio Analysis Requirements

Your audio engine needs to provide per-frame:

| Parameter | Source | Notes |
|-----------|--------|-------|
| FFT (512 bins) | FFT of audio buffer | Normalise to [0,1], apply windowing (Hann) |
| Waveform (512 samples) | Raw PCM circular buffer | Keep as [-1,1] signed |
| RMS | `sqrt(mean(samples²))` | Normalise to [0,1] range |
| Spectral Centroid | `sum(freq[i]*mag[i]) / sum(mag[i])` | Normalise to [0,1] by dividing by Nyquist |
| Spectral Flux | `sum((mag[i] - prevMag[i])²)` | Normalise; great for transient detection |
| BPM (optional) | Onset detection + tempo estimation | 0 if unavailable |

### Recommended: Smoothing

Apply exponential smoothing to RMS, centroid, and flux to avoid jittery visuals:

```cpp
smoothedRMS = lerp(smoothedRMS, rawRMS, deltaTime * 12.0f); // attack
if (rawRMS < smoothedRMS)
    smoothedRMS = lerp(smoothedRMS, rawRMS, deltaTime * 4.0f); // release
```

---

## Compilation

```
fxc /T vs_5_0 /E FullscreenVS /I "." AudioShaderCommon.hlsli /Fo FullscreenVS.cso
fxc /T ps_5_0 /E PS_SpectralFluid /I "." 01_SpectralFluidAdvection.hlsl /Fo 01_PS.cso
fxc /T ps_5_0 /E PS_FrequencyTerrain /I "." 02_FrequencyTerrainMarching.hlsl /Fo 02_PS.cso
fxc /T ps_5_0 /E PS_CentrifugalRings /I "." 03_CentrifugalFrequencyRings.hlsl /Fo 03_PS.cso
fxc /T ps_5_0 /E PS_WaveformRibbon /I "." 04_WaveformRibbonHelix.hlsl /Fo 04_PS.cso
fxc /T ps_5_0 /E PS_HarmonicVoronoi /I "." 05_HarmonicVoronoiFracture.hlsl /Fo 05_PS.cso
```

---

## Performance Notes

- **01 (Fluid):** ~0.5ms at 1080p on GTX 1080+. Feedback texture is the bottleneck.
- **02 (Terrain):** ~1.2ms at 1080p. 128-step raymarch is the cost; reduce for lower-end GPUs.
- **03 (Rings):** ~0.3ms at 1080p. Very lightweight; scale `RingCount` up on powerful GPUs.
- **04 (Ribbon):** ~2.0ms at 1080p. 64×96 ray×spine samples. Reduce `SAMPLES` to 48 for budget GPUs.
- **05 (Voronoi):** ~0.8ms at 1080p. 5×5 neighbor search × 3 crack layers. Solid mid-range cost.

All shaders target 60fps+ at 1080p on GTX 1070 / RX 580 class hardware.
