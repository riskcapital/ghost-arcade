/**
 * Ghost Arcade — Spout Native Addon for Electron
 *
 * Two output modes:
 *   1. SendImage (CPU path): readPixels → IPC → SendImage() — works immediately
 *   2. SendTexture (GPU zero-copy): DXGI shared handle → SendTexture() — future
 *
 * Receiver uses SpoutDX's internal D3D11 device with SetAdapterAuto(true)
 * for automatic GPU adapter matching when sender is on a different GPU.
 */

#include <napi.h>

#include <map>
#include <memory>
#include <string>

// Windows headers
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dxguid.lib")

// SpoutDX SDK
#include "SpoutDX.h"

// NVIDIA Optimus: request discrete GPU
extern "C" {
    __declspec(dllexport) unsigned long NvOptimusEnablement = 1;
    __declspec(dllexport) int AmdPowerXpressRequestHighPerformance = 1;
}

using Microsoft::WRL::ComPtr;

/**
 * Find the best GPU adapter index for Spout.
 *
 * On NVIDIA Optimus / multi-GPU systems, the default adapter (0) is often
 * the Intel integrated GPU. But OBS, MadMapper, Resolume etc. run on the
 * discrete NVIDIA/AMD GPU. Spout shared texture handles CANNOT cross GPU
 * adapters — so we MUST create our D3D11 device on the same adapter as
 * the other Spout apps.
 *
 * Returns the index of the first discrete GPU (NVIDIA or AMD), or 0 if
 * only integrated GPUs are found.
 */
static int FindDiscreteGpuAdapter() {
    ComPtr<IDXGIFactory1> factory;
    if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return 0;

    int bestAdapter = 0;
    ComPtr<IDXGIAdapter> adapter;
    for (UINT i = 0; factory->EnumAdapters(i, &adapter) != DXGI_ERROR_NOT_FOUND; i++) {
        DXGI_ADAPTER_DESC desc;
        adapter->GetDesc(&desc);
        char name[128];
        wcstombs(name, desc.Description, sizeof(name));
        printf("[SpoutAddon] GPU Adapter %u: %s (VRAM: %llu MB)\n",
            i, name, (unsigned long long)(desc.DedicatedVideoMemory / (1024*1024)));

        // Check for NVIDIA or AMD discrete GPU
        if (wcsstr(desc.Description, L"NVIDIA") || wcsstr(desc.Description, L"AMD") ||
            wcsstr(desc.Description, L"Radeon")) {
            if (bestAdapter == 0 || i < (UINT)bestAdapter) {
                bestAdapter = (int)i;
                printf("[SpoutAddon]   -> Selected as discrete GPU (adapter %d)\n", bestAdapter);
            }
        }
        adapter.Reset();
    }

    printf("[SpoutAddon] Using GPU adapter %d for Spout\n", bestAdapter);
    return bestAdapter;
}


/**
 * SpoutOutput — Spout sender.
 *
 * Uses SpoutDX's internal D3D11 device so SendImage works without
 * adapter mismatch issues. Also supports SendTexture for zero-copy
 * when a DXGI shared handle is available (requires external device).
 */
class SpoutOutput : public Napi::ObjectWrap<SpoutOutput> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "SpoutOutput", {
            InstanceMethod("setSenderName", &SpoutOutput::SetSenderName),
            InstanceMethod("sendTexture", &SpoutOutput::SendTexture),
            InstanceMethod("sendImage", &SpoutOutput::SendImage),
            InstanceMethod("release", &SpoutOutput::Release),
            InstanceMethod("isInitialized", &SpoutOutput::IsInitialized),
            InstanceMethod("getSenderName", &SpoutOutput::GetSenderName),
            InstanceMethod("getWidth", &SpoutOutput::GetWidth),
            InstanceMethod("getHeight", &SpoutOutput::GetHeight),
            InstanceMethod("getAdapterIndex", &SpoutOutput::GetAdapterIndex),
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("SpoutOutput", func);
        return exports;
    }

    SpoutOutput(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<SpoutOutput>(info)
        , m_initialized(false)
        , m_width(0)
        , m_height(0)
        , m_hasExternalDevice(false)
        , m_adapterIndex(0)
    {
        // Find the discrete GPU (NVIDIA/AMD) — MUST match what OBS/MadMapper use
        int gpuAdapter = FindDiscreteGpuAdapter();
        m_adapterIndex = gpuAdapter;

        // Create our own D3D11 device on the discrete GPU.
        // This device is shared between SpoutDX (via OpenDirectX11(device)) AND
        // our OpenSharedResource1 calls for the zero-copy Electron OSR path.
        // CopyResource requires both textures on the SAME device — this guarantees it.
        CreateExternalDevice();

        if (m_hasExternalDevice) {
            // Pass our device to SpoutDX so it uses the SAME device for SendTexture
            if (m_spout.OpenDirectX11(m_extDevice.Get())) {
                m_initialized = true;
                printf("[SpoutAddon] Sender: SpoutDX opened with shared device on adapter %d\n", gpuAdapter);
            } else {
                printf("[SpoutAddon] Sender: SpoutDX OpenDirectX11(sharedDevice) failed, trying internal\n");
                // Fallback: let SpoutDX create its own device (CPU SendImage path still works)
                if (gpuAdapter > 0) {
                    m_spout.SetAdapter(gpuAdapter);
                }
                if (m_spout.OpenDirectX11()) {
                    m_initialized = true;
                    printf("[SpoutAddon] Sender: SpoutDX fallback internal device on adapter %d\n", gpuAdapter);
                } else {
                    printf("[SpoutAddon] Sender: SpoutDX OpenDirectX11 failed completely!\n");
                }
            }
        } else {
            // External device creation failed — use SpoutDX's internal device
            // (SendTexture won't work, but SendImage CPU path still works)
            printf("[SpoutAddon] Sender: No external device, using SpoutDX internal device\n");
            if (gpuAdapter > 0) {
                m_spout.SetAdapter(gpuAdapter);
            }
            if (m_spout.OpenDirectX11()) {
                m_initialized = true;
                printf("[SpoutAddon] Sender: SpoutDX internal device on adapter %d\n", gpuAdapter);
            } else {
                printf("[SpoutAddon] Sender: SpoutDX OpenDirectX11 failed!\n");
            }
        }
    }

    ~SpoutOutput() {
        Cleanup();
    }

private:
    spoutDX m_spout;
    // External device for zero-copy SendTexture path (optional)
    ComPtr<ID3D11Device> m_extDevice;
    ComPtr<ID3D11Device1> m_extDevice1;
    ComPtr<ID3D11DeviceContext> m_extContext;
    std::vector<uint8_t> m_sendBuffer;  // RGBA→BGRA + flip conversion buffer
    bool m_initialized;
    bool m_hasExternalDevice;
    int m_adapterIndex;                 // GPU adapter index for Spout (discrete GPU)
    std::string m_senderName;
    unsigned int m_width;
    unsigned int m_height;

    Napi::Value SetSenderName(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "String argument expected").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        m_senderName = info[0].As<Napi::String>().Utf8Value();
        m_spout.SetSenderName(m_senderName.c_str());
        printf("[SpoutAddon] Sender name set to: %s\n", m_senderName.c_str());

        return env.Undefined();
    }

    /**
     * Send a texture from a DXGI shared handle (zero-copy GPU path).
     *
     * For this to work, we need an external D3D11 device on the same
     * GPU adapter as the source (Chromium). Creates one lazily.
     */
    Napi::Value SendTexture(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!m_initialized) {
            Napi::Error::New(env, "Not initialized").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        if (info.Length() < 1 || !info[0].IsBuffer()) {
            Napi::TypeError::New(env, "Buffer argument expected (shared texture handle)")
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        // External device must exist (created in constructor, shared with SpoutDX)
        if (!m_hasExternalDevice) {
            static int warnCount = 0;
            if (warnCount++ < 3)
                printf("[SpoutAddon] SendTexture: no external device — zero-copy unavailable\n");
            return Napi::Boolean::New(env, false);
        }

        auto handleBuffer = info[0].As<Napi::Buffer<uint8_t>>();
        if (handleBuffer.Length() < sizeof(HANDLE)) {
            return Napi::Boolean::New(env, false);
        }

        HANDLE sharedHandle = *reinterpret_cast<HANDLE*>(handleBuffer.Data());
        if (!sharedHandle) {
            return Napi::Boolean::New(env, false);
        }

        // Open the shared DXGI resource on our device (same device SpoutDX uses)
        ComPtr<ID3D11Texture2D> sharedTexture;
        HRESULT hr = m_extDevice1->OpenSharedResource1(
            sharedHandle, IID_PPV_ARGS(&sharedTexture));

        if (FAILED(hr)) {
            hr = m_extDevice->OpenSharedResource(
                sharedHandle, IID_PPV_ARGS(&sharedTexture));
            if (FAILED(hr)) {
                static int errCount = 0;
                if (errCount++ < 5)
                    printf("[SpoutAddon] OpenSharedResource failed: 0x%08lx\n", hr);
                return Napi::Boolean::New(env, false);
            }
        }

        D3D11_TEXTURE2D_DESC desc;
        sharedTexture->GetDesc(&desc);
        m_width = desc.Width;
        m_height = desc.Height;

        static int diagCount = 0;
        if (diagCount < 5) {
            printf("[SpoutAddon] SendTexture: %ux%u format=%u bindFlags=0x%x miscFlags=0x%x\n",
                desc.Width, desc.Height, desc.Format, desc.BindFlags, desc.MiscFlags);
            diagCount++;
        }

        bool ok = m_spout.SendTexture(sharedTexture.Get());

        static int sendDiag = 0;
        if (sendDiag < 5) {
            printf("[SpoutAddon] SendTexture result: %s (sender='%s')\n",
                ok ? "true" : "false", m_senderName.c_str());
            sendDiag++;
        }

        return Napi::Boolean::New(env, ok);
    }

    /**
     * Send raw pixel data (CPU path).
     * Accepts a Buffer of RGBA pixel data + width + height.
     *
     * WebGL readPixels gives us RGBA, bottom-up (origin at bottom-left).
     * SpoutDX shared texture is BGRA, top-down (origin at top-left).
     * We do RGBA→BGRA swizzle + vertical flip before sending.
     */
    Napi::Value SendImage(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!m_initialized) {
            return Napi::Boolean::New(env, false);
        }

        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Expected (pixels, width, height)")
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        // Accept either Uint8Array or Buffer
        uint8_t* pixelData = nullptr;
        size_t pixelLength = 0;

        if (info[0].IsBuffer()) {
            auto buf = info[0].As<Napi::Buffer<uint8_t>>();
            pixelData = buf.Data();
            pixelLength = buf.Length();
        } else if (info[0].IsTypedArray()) {
            auto arr = info[0].As<Napi::Uint8Array>();
            pixelData = arr.Data();
            pixelLength = arr.ByteLength();
        } else {
            Napi::TypeError::New(env, "Expected Buffer or Uint8Array").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        unsigned int width = info[1].As<Napi::Number>().Uint32Value();
        unsigned int height = info[2].As<Napi::Number>().Uint32Value();

        unsigned int expected = width * height * 4;
        if (pixelLength < expected) {
            return Napi::Boolean::New(env, false);
        }

        m_width = width;
        m_height = height;

        // Diagnostic: check first few pixels on first frame
        static int diagCount = 0;
        if (diagCount < 2) {
            int nonZero = 0;
            for (unsigned int i = 0; i < expected && i < 1000; i++) {
                if (pixelData[i] != 0) nonZero++;
            }
            printf("[SpoutAddon] SendImage %ux%u pixel check: %d/1000 non-zero bytes\n",
                width, height, nonZero);
            diagCount++;
        }

        // Allocate/resize conversion buffer for BGRA + vertical flip
        unsigned int rowBytes = width * 4;
        if (m_sendBuffer.size() != expected) {
            m_sendBuffer.resize(expected);
        }

        // RGBA bottom-up → BGRA top-down in one pass
        // Use uint32 batch processing: RGBA(ABGR in LE) → BGRA(ARGB in LE)
        // Swap bytes 0,2 (R↔B) in each 4-byte pixel
        for (unsigned int y = 0; y < height; y++) {
            const uint32_t* srcRow = reinterpret_cast<const uint32_t*>(pixelData + y * rowBytes);
            uint32_t* dstRow = reinterpret_cast<uint32_t*>(m_sendBuffer.data() + (height - 1 - y) * rowBytes);

            for (unsigned int x = 0; x < width; x++) {
                uint32_t px = srcRow[x];
                // RGBA → BGRA: swap R and B channels
                // Little-endian memory: [R,G,B,A] = 0xAABBGGRR
                // We want:              [B,G,R,A] = 0xAARRGGBB
                uint32_t r = (px >>  0) & 0xFF;
                uint32_t b = (px >> 16) & 0xFF;
                dstRow[x] = (px & 0xFF00FF00u) | (r << 16) | b;
            }
        }

        // Send the converted BGRA top-down buffer
        bool ok = m_spout.SendImage(m_sendBuffer.data(), width, height);

        return Napi::Boolean::New(env, ok);
    }

    Napi::Value Release(const Napi::CallbackInfo& info) {
        Cleanup();
        return info.Env().Undefined();
    }

    Napi::Value IsInitialized(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), m_initialized);
    }

    Napi::Value GetSenderName(const Napi::CallbackInfo& info) {
        return Napi::String::New(info.Env(), m_senderName);
    }

    Napi::Value GetWidth(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), m_width);
    }

    Napi::Value GetHeight(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), m_height);
    }

    Napi::Value GetAdapterIndex(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), m_adapterIndex);
    }

    void CreateExternalDevice() {
        ComPtr<IDXGIFactory2> factory;
        HRESULT hr = CreateDXGIFactory(IID_PPV_ARGS(&factory));
        if (FAILED(hr)) return;

        // Use the same GPU adapter as SpoutDX's internal device.
        // DXGI shared texture handles CANNOT cross GPU adapters.
        ComPtr<IDXGIAdapter> adapter;
        hr = factory->EnumAdapters(m_adapterIndex, &adapter);
        if (FAILED(hr)) {
            printf("[SpoutAddon] EnumAdapters(%d) failed, falling back to 0\n", m_adapterIndex);
            factory->EnumAdapters(0, &adapter);
        }

        printf("[SpoutAddon] Creating external D3D11 device on adapter %d\n", m_adapterIndex);

        D3D_FEATURE_LEVEL featureLevels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
        D3D_FEATURE_LEVEL actualLevel;

        hr = D3D11CreateDevice(
            adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            featureLevels, ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &m_extDevice, &actualLevel, &m_extContext);

        if (FAILED(hr)) {
            printf("[SpoutAddon] External D3D11 device creation failed: 0x%08lx\n", hr);
            return;
        }

        hr = m_extDevice->QueryInterface(IID_PPV_ARGS(&m_extDevice1));
        if (FAILED(hr)) {
            printf("[SpoutAddon] ID3D11Device1 not available: 0x%08lx\n", hr);
            return;
        }

        m_hasExternalDevice = true;
        printf("[SpoutAddon] External D3D11 device created on adapter %d for zero-copy path\n", m_adapterIndex);
    }

    void Cleanup() {
        if (m_initialized) {
            m_spout.ReleaseSender();
            m_spout.CloseDirectX11();
            m_initialized = false;
            printf("[SpoutAddon] Sender '%s' released\n", m_senderName.c_str());
        }
        m_extDevice.Reset();
        m_extDevice1.Reset();
        m_extContext.Reset();
        m_hasExternalDevice = false;
    }
};


// ============================================================
// SpoutAtlasOutput — multi-slice zero-copy fan-out.
//
// One hidden OSR window renders ALL sender slices into a single atlas
// texture. Each paint we open the atlas's DXGI shared handle ONCE, then
// CopySubresourceRegion each configured sub-rect into a per-name BGRA
// texture and SendTexture it through that name's spoutDX sender. Cost is
// one shared-resource open + N GPU sub-copies — flat per slice, no CPU.
//
// All textures (atlas + every per-sender staging texture) live on the
// same external D3D11 device; CopySubresourceRegion requires it and the
// shared handle can't cross GPU adapters anyway.
// ============================================================

class SpoutAtlasOutput : public Napi::ObjectWrap<SpoutAtlasOutput> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "SpoutAtlasOutput", {
            InstanceMethod("configure", &SpoutAtlasOutput::Configure),
            InstanceMethod("sendAtlas", &SpoutAtlasOutput::SendAtlas),
            InstanceMethod("release", &SpoutAtlasOutput::Release),
            InstanceMethod("isInitialized", &SpoutAtlasOutput::IsInitialized),
            InstanceMethod("getSenderNames", &SpoutAtlasOutput::GetSenderNames),
            InstanceMethod("getAdapterIndex", &SpoutAtlasOutput::GetAdapterIndex),
        });

        exports.Set("SpoutAtlasOutput", func);
        return exports;
    }

    SpoutAtlasOutput(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<SpoutAtlasOutput>(info)
        , m_initialized(false)
        , m_adapterIndex(0)
    {
        m_adapterIndex = FindDiscreteGpuAdapter();
        CreateExternalDevice();
        // Unlike SpoutOutput there is NO CPU fallback here — the atlas path
        // exists purely for zero-copy fan-out. Without an external device
        // the caller should fall back to per-slice CPU sends.
        if (m_extDevice && m_extDevice1) {
            m_initialized = true;
            printf("[SpoutAddon] AtlasOutput: external device ready on adapter %d\n", m_adapterIndex);
        } else {
            printf("[SpoutAddon] AtlasOutput: external device creation FAILED — atlas fan-out unavailable\n");
        }
    }

    ~SpoutAtlasOutput() {
        Cleanup();
    }

private:
    struct AtlasSender {
        spoutDX spout;
        ComPtr<ID3D11Texture2D> texture;   // BGRA staging texture, slice-sized
        unsigned int w = 0;
        unsigned int h = 0;
        unsigned int x = 0;                // top-left within the atlas
        unsigned int y = 0;
        bool opened = false;               // spout.OpenDirectX11 succeeded
    };

    ComPtr<ID3D11Device> m_extDevice;
    ComPtr<ID3D11Device1> m_extDevice1;
    ComPtr<ID3D11DeviceContext> m_extContext;
    std::map<std::string, std::unique_ptr<AtlasSender>> m_senders;
    bool m_initialized;
    int m_adapterIndex;

    void CreateExternalDevice() {
        ComPtr<IDXGIFactory2> factory;
        HRESULT hr = CreateDXGIFactory(IID_PPV_ARGS(&factory));
        if (FAILED(hr)) return;

        ComPtr<IDXGIAdapter> adapter;
        hr = factory->EnumAdapters(m_adapterIndex, &adapter);
        if (FAILED(hr)) {
            printf("[SpoutAddon] AtlasOutput: EnumAdapters(%d) failed, falling back to 0\n", m_adapterIndex);
            factory->EnumAdapters(0, &adapter);
        }

        D3D_FEATURE_LEVEL featureLevels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
        D3D_FEATURE_LEVEL actualLevel;

        hr = D3D11CreateDevice(
            adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            featureLevels, ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &m_extDevice, &actualLevel, &m_extContext);
        if (FAILED(hr)) {
            printf("[SpoutAddon] AtlasOutput: D3D11CreateDevice failed: 0x%08lx\n", hr);
            return;
        }

        hr = m_extDevice->QueryInterface(IID_PPV_ARGS(&m_extDevice1));
        if (FAILED(hr)) {
            printf("[SpoutAddon] AtlasOutput: ID3D11Device1 not available: 0x%08lx\n", hr);
            m_extDevice.Reset();
            m_extContext.Reset();
        }
    }

    bool EnsureSenderTexture(AtlasSender& s, unsigned int w, unsigned int h) {
        if (s.texture && s.w == w && s.h == h) return true;

        s.texture.Reset();
        D3D11_TEXTURE2D_DESC td = {};
        td.Width = w;
        td.Height = h;
        td.MipLevels = 1;
        td.ArraySize = 1;
        td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;   // Chromium OSR atlas format
        td.SampleDesc.Count = 1;
        td.Usage = D3D11_USAGE_DEFAULT;
        td.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;

        HRESULT hr = m_extDevice->CreateTexture2D(&td, nullptr, &s.texture);
        if (FAILED(hr)) {
            printf("[SpoutAddon] AtlasOutput: CreateTexture2D %ux%u failed: 0x%08lx\n", w, h, hr);
            s.texture.Reset();
            s.w = s.h = 0;
            return false;
        }
        s.w = w;
        s.h = h;
        return true;
    }

    /**
     * configure(regions) — regions: [{ name, x, y, w, h }] in atlas pixels
     * (top-left origin, matching the captured top-down atlas texture).
     * Creates/resizes per-name senders, drops senders no longer listed.
     */
    Napi::Value Configure(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!m_initialized) {
            return Napi::Boolean::New(env, false);
        }
        if (info.Length() < 1 || !info[0].IsArray()) {
            Napi::TypeError::New(env, "Array of regions expected").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        Napi::Array regions = info[0].As<Napi::Array>();
        std::map<std::string, bool> wanted;

        for (uint32_t i = 0; i < regions.Length(); i++) {
            Napi::Value v = regions.Get(i);
            if (!v.IsObject()) continue;
            Napi::Object r = v.As<Napi::Object>();

            std::string name = r.Get("name").ToString().Utf8Value();
            unsigned int x = r.Get("x").ToNumber().Uint32Value();
            unsigned int y = r.Get("y").ToNumber().Uint32Value();
            unsigned int w = r.Get("w").ToNumber().Uint32Value();
            unsigned int h = r.Get("h").ToNumber().Uint32Value();
            if (name.empty() || w == 0 || h == 0) continue;
            if (wanted.count(name)) {
                printf("[SpoutAddon] AtlasOutput: duplicate sender name '%s' — skipping\n", name.c_str());
                continue;
            }
            wanted[name] = true;

            auto it = m_senders.find(name);
            if (it == m_senders.end()) {
                auto s = std::make_unique<AtlasSender>();
                // Share OUR device so SendTexture + CopySubresourceRegion
                // operate on the same device as the opened atlas resource.
                if (s->spout.OpenDirectX11(m_extDevice.Get())) {
                    s->spout.SetSenderName(name.c_str());
                    s->opened = true;
                    printf("[SpoutAddon] AtlasOutput: sender '%s' created (%ux%u @ %u,%u)\n",
                        name.c_str(), w, h, x, y);
                } else {
                    printf("[SpoutAddon] AtlasOutput: OpenDirectX11 failed for sender '%s'\n", name.c_str());
                }
                it = m_senders.emplace(name, std::move(s)).first;
            }

            AtlasSender& s = *it->second;
            if (s.w != w || s.h != h) {
                EnsureSenderTexture(s, w, h);
            }
            s.x = x;
            s.y = y;
        }

        // Drop senders that are no longer configured
        for (auto it = m_senders.begin(); it != m_senders.end(); ) {
            if (!wanted.count(it->first)) {
                printf("[SpoutAddon] AtlasOutput: sender '%s' removed\n", it->first.c_str());
                ReleaseSenderEntry(*it->second);
                it = m_senders.erase(it);
            } else {
                ++it;
            }
        }

        return Napi::Boolean::New(env, true);
    }

    /**
     * sendAtlas(handleBuffer, atlasW, atlasH) — open the atlas shared
     * handle once, sub-copy each configured region into its sender's
     * staging texture, SendTexture each. Returns # of senders fed.
     */
    Napi::Value SendAtlas(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!m_initialized || m_senders.empty()) {
            return Napi::Number::New(env, 0);
        }
        if (info.Length() < 1 || !info[0].IsBuffer()) {
            Napi::TypeError::New(env, "Buffer argument expected (shared texture handle)")
                .ThrowAsJavaScriptException();
            return Napi::Number::New(env, 0);
        }

        auto handleBuffer = info[0].As<Napi::Buffer<uint8_t>>();
        if (handleBuffer.Length() < sizeof(HANDLE)) {
            return Napi::Number::New(env, 0);
        }
        HANDLE sharedHandle = *reinterpret_cast<HANDLE*>(handleBuffer.Data());
        if (!sharedHandle) {
            return Napi::Number::New(env, 0);
        }

        ComPtr<ID3D11Texture2D> atlasTexture;
        HRESULT hr = m_extDevice1->OpenSharedResource1(
            sharedHandle, IID_PPV_ARGS(&atlasTexture));
        if (FAILED(hr)) {
            hr = m_extDevice->OpenSharedResource(
                sharedHandle, IID_PPV_ARGS(&atlasTexture));
            if (FAILED(hr)) {
                static int errCount = 0;
                if (errCount++ < 5)
                    printf("[SpoutAddon] AtlasOutput: OpenSharedResource failed: 0x%08lx\n", hr);
                return Napi::Number::New(env, 0);
            }
        }

        D3D11_TEXTURE2D_DESC atlasDesc;
        atlasTexture->GetDesc(&atlasDesc);

        static int diagCount = 0;
        if (diagCount < 3) {
            printf("[SpoutAddon] AtlasOutput: atlas %ux%u format=%u, %zu sender(s)\n",
                atlasDesc.Width, atlasDesc.Height, atlasDesc.Format, m_senders.size());
            diagCount++;
        }

        int sent = 0;
        for (auto& [name, sp] : m_senders) {
            AtlasSender& s = *sp;
            if (!s.opened || !s.texture) continue;

            // Region must lie fully inside the captured atlas. During a
            // layout change the OSR window resize races configure(); skip
            // out-of-bounds regions for a frame rather than send garbage.
            if (s.x + s.w > atlasDesc.Width || s.y + s.h > atlasDesc.Height) {
                static int skipCount = 0;
                if (skipCount++ < 5)
                    printf("[SpoutAddon] AtlasOutput: region '%s' %u,%u %ux%u outside atlas %ux%u — skipped\n",
                        name.c_str(), s.x, s.y, s.w, s.h, atlasDesc.Width, atlasDesc.Height);
                continue;
            }

            D3D11_BOX box;
            box.left = s.x;
            box.top = s.y;
            box.front = 0;
            box.right = s.x + s.w;
            box.bottom = s.y + s.h;
            box.back = 1;
            m_extContext->CopySubresourceRegion(
                s.texture.Get(), 0, 0, 0, 0,
                atlasTexture.Get(), 0, &box);

            if (s.spout.SendTexture(s.texture.Get())) {
                sent++;
            }
        }
        m_extContext->Flush();

        return Napi::Number::New(env, sent);
    }

    Napi::Value Release(const Napi::CallbackInfo& info) {
        Cleanup();
        return info.Env().Undefined();
    }

    Napi::Value IsInitialized(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), m_initialized);
    }

    Napi::Value GetSenderNames(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Array result = Napi::Array::New(env, m_senders.size());
        uint32_t i = 0;
        for (auto& [name, s] : m_senders) {
            result.Set(i++, Napi::String::New(env, name));
        }
        return result;
    }

    Napi::Value GetAdapterIndex(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), m_adapterIndex);
    }

    void ReleaseSenderEntry(AtlasSender& s) {
        if (s.opened) {
            s.spout.ReleaseSender();
            // CloseDirectX11 won't release OUR device — spoutDX only frees
            // a device it created itself.
            s.spout.CloseDirectX11();
            s.opened = false;
        }
        s.texture.Reset();
    }

    void Cleanup() {
        for (auto& [name, s] : m_senders) {
            ReleaseSenderEntry(*s);
        }
        if (!m_senders.empty()) {
            printf("[SpoutAddon] AtlasOutput: released %zu sender(s)\n", m_senders.size());
        }
        m_senders.clear();
        m_extDevice.Reset();
        m_extDevice1.Reset();
        m_extContext.Reset();
        m_initialized = false;
    }
};


// ============================================================
// Spout Receiver
//
// Uses SpoutDX's own internal D3D11 device + SetAdapterAuto(true)
// to automatically match the sender's GPU adapter.
// ============================================================

class SpoutReceiver : public Napi::ObjectWrap<SpoutReceiver> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "SpoutReceiver", {
            InstanceMethod("connect", &SpoutReceiver::Connect),
            InstanceMethod("receiveTextureInfo", &SpoutReceiver::ReceiveTextureInfo),
            InstanceMethod("receiveImage", &SpoutReceiver::ReceiveImage),
            InstanceMethod("isConnected", &SpoutReceiver::IsConnected),
            InstanceMethod("isUpdated", &SpoutReceiver::IsUpdated),
            InstanceMethod("getWidth", &SpoutReceiver::GetWidth),
            InstanceMethod("getHeight", &SpoutReceiver::GetHeight),
            InstanceMethod("release", &SpoutReceiver::Release),
        });

        exports.Set("SpoutReceiver", func);
        return exports;
    }

    SpoutReceiver(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<SpoutReceiver>(info)
        , m_connected(false)
        , m_width(0)
        , m_height(0)
        , m_initialized(false)
    {
        // Find the discrete GPU (NVIDIA/AMD) — MUST match sender's adapter
        int gpuAdapter = FindDiscreteGpuAdapter();

        // Set adapter BEFORE OpenDirectX11
        if (gpuAdapter > 0) {
            m_receiver.SetAdapter(gpuAdapter);
            printf("[SpoutAddon] Receiver: SetAdapter(%d) for discrete GPU\n", gpuAdapter);
        }

        // Let SpoutDX create its own D3D11 device on the selected adapter
        if (m_receiver.OpenDirectX11()) {
            m_initialized = true;
            // Also enable auto-switching as a fallback
            m_receiver.SetAdapterAuto(true);
            printf("[SpoutAddon] Receiver: SpoutDX device on adapter %d, AdapterAuto=true\n", gpuAdapter);
        } else {
            printf("[SpoutAddon] Receiver: SpoutDX OpenDirectX11 failed!\n");
        }
    }

    ~SpoutReceiver() {
        if (m_connected) {
            m_receiver.ReleaseReceiver();
        }
        if (m_initialized) {
            m_receiver.CloseDirectX11();
        }
    }

private:
    spoutDX m_receiver;
    bool m_connected;
    bool m_initialized;
    unsigned int m_width;
    unsigned int m_height;

    Napi::Value Connect(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!m_initialized) {
            Napi::Error::New(env, "Receiver not initialized").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "String sender name expected").ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        std::string senderName = info[0].As<Napi::String>().Utf8Value();
        m_receiver.SetReceiverName(senderName.c_str());
        m_connected = true;

        printf("[SpoutAddon] Receiver connecting to: %s (AdapterAuto=%d)\n",
            senderName.c_str(), m_receiver.GetAdapterAuto() ? 1 : 0);
        return Napi::Boolean::New(env, true);
    }

    /**
     * Receive the sender texture on the GPU and return metadata for the
     * shared DXGI texture. No staging texture, Map, readback, or pixel IPC.
     * This is the production hand-off for a native compositor; the existing
     * receiveImage path is a browser-preview compatibility path only.
     */
    Napi::Value ReceiveTextureInfo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!m_connected || !m_initialized) return env.Null();

        bool ok = m_receiver.ReceiveTexture();
        bool updated = m_receiver.IsUpdated();
        if (!ok) return env.Null();

        HANDLE sharedHandle = m_receiver.GetSenderHandle();
        unsigned int w = m_receiver.GetSenderWidth();
        unsigned int h = m_receiver.GetSenderHeight();
        DXGI_FORMAT format = m_receiver.GetSenderFormat();
        if (!sharedHandle || w == 0 || h == 0) return env.Null();

        m_width = w;
        m_height = h;

        Napi::Object result = Napi::Object::New(env);
        result.Set("handle", Napi::Buffer<uint8_t>::Copy(
            env,
            reinterpret_cast<uint8_t*>(&sharedHandle),
            sizeof(HANDLE)));
        result.Set("width", Napi::Number::New(env, w));
        result.Set("height", Napi::Number::New(env, h));
        result.Set("format", Napi::Number::New(env, static_cast<uint32_t>(format)));
        result.Set("updated", Napi::Boolean::New(env, updated));
        result.Set("isNewFrame", Napi::Boolean::New(env, m_receiver.IsFrameNew()));
        result.Set("frame", Napi::Number::New(env, static_cast<double>(m_receiver.GetSenderFrame())));
        result.Set("fps", Napi::Number::New(env, m_receiver.GetSenderFps()));
        result.Set("senderName", Napi::String::New(env, m_receiver.GetSenderName()));
        return result;
    }

    /**
     * Receive a frame as RGBA pixel data.
     * Returns a Buffer containing the raw pixels, or null if no frame available.
     */
    Napi::Value ReceiveImage(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!m_connected || !m_initialized) return env.Null();

        // Get sender dimensions
        unsigned int w = m_receiver.GetSenderWidth();
        unsigned int h = m_receiver.GetSenderHeight();
        if (w == 0 || h == 0) {
            // No sender info yet — try a receive to trigger connection
            w = 1920; h = 1080;
        }

        size_t tempSize = (size_t)w * (size_t)h * 4;
        Napi::ArrayBuffer frameBuffer = Napi::ArrayBuffer::New(env, tempSize);
        uint8_t* frameData = static_cast<uint8_t*>(frameBuffer.Data());

        // ReceiveImage internally calls IsUpdated and handles connection
        // bInvert=true flips vertically to match Three.js/WebGL texture orientation
        bool ok = m_receiver.ReceiveImage(frameData, w, h, false, true);

        if (!ok) {
            static int nullLogCount = 0;
            if (nullLogCount < 5) {
                printf("[SpoutAddon] ReceiveImage returned false (w=%u h=%u connected=%d)\n",
                    w, h, m_receiver.IsConnected() ? 1 : 0);
                nullLogCount++;
            }
            return env.Null();
        }

        // Check if IsUpdated was set (sender changed dimensions or is new)
        // After IsUpdated, we need to call ReceiveImage again to get actual pixel data
        if (m_receiver.IsUpdated()) {
            static int updLogCount = 0;
            if (updLogCount < 5) {
                printf("[SpoutAddon] Receiver IsUpdated - sender changed. New size: %ux%u\n",
                    m_receiver.GetSenderWidth(), m_receiver.GetSenderHeight());
                updLogCount++;
            }
            // Re-create buffer for new size
            w = m_receiver.GetSenderWidth();
            h = m_receiver.GetSenderHeight();
            return env.Null(); // Return null this frame, next frame will have data
        }

        // Update dimensions from SpoutDX
        m_width = m_receiver.GetSenderWidth();
        m_height = m_receiver.GetSenderHeight();
        if (m_width == 0 || m_height == 0) {
            m_width = w;
            m_height = h;
        }

        // Only send new frames — avoids IPC overhead for duplicate data
        // and prevents flicker from re-uploading stale buffers
        bool isNew = m_receiver.IsFrameNew();

        static int diagRecvCount = 0;
        if (diagRecvCount < 10) {
            int nonZero = 0;
            for (size_t i = 0; i < tempSize && i < 4000; i++) {
                if (frameData[i] != 0) nonZero++;
            }
            printf("[SpoutAddon] ReceiveImage OK %ux%u: nonZero=%d/4000 (IsNewFrame=%d)\n",
                m_width, m_height, nonZero, isNew ? 1 : 0);
            diagRecvCount++;
        }

        // No new frame from sender — return null so JS keeps displaying the last texture
        if (!isNew) {
            return env.Null();
        }

        // BGRA → RGBA in-place swizzle using uint32 batch processing
        unsigned int pixelCount = m_width * m_height;
        uint32_t* px = reinterpret_cast<uint32_t*>(frameData);
        for (unsigned int i = 0; i < pixelCount; i++) {
            uint32_t v = px[i];
            // Little-endian: [B,G,R,A] = 0xAARRGGBB → [R,G,B,A] = 0xAABBGGRR
            uint32_t r = (v >> 16) & 0xFF;
            uint32_t b = (v >>  0) & 0xFF;
            px[i] = (v & 0xFF00FF00u) | (r) | (b << 16);
        }

        size_t frameBytes = (size_t)m_width * (size_t)m_height * 4;
        if (frameBytes > tempSize) return env.Null();
        return Napi::Uint8Array::New(env, frameBytes, frameBuffer, 0);
    }

    Napi::Value IsConnected(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), m_connected && m_initialized && m_receiver.IsConnected());
    }

    Napi::Value IsUpdated(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), m_receiver.IsUpdated());
    }

    Napi::Value GetWidth(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), m_width > 0 ? m_width : m_receiver.GetSenderWidth());
    }

    Napi::Value GetHeight(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), m_height > 0 ? m_height : m_receiver.GetSenderHeight());
    }

    Napi::Value Release(const Napi::CallbackInfo& info) {
        if (m_connected) {
            m_receiver.ReleaseReceiver();
            m_connected = false;
        }
        return info.Env().Undefined();
    }
};


// ============================================================
// Utility: List active Spout senders
// ============================================================

Napi::Value ListSenders(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    spoutDX spout;
    int count = spout.GetSenderCount();

    Napi::Array result = Napi::Array::New(env, count);
    char name[256];
    for (int i = 0; i < count; i++) {
        if (spout.GetSender(i, name, 256)) {
            result.Set((uint32_t)i, Napi::String::New(env, name));
        }
    }

    return result;
}


// ============================================================
// Utility: GPU adapter diagnostics (visible in JS console)
// ============================================================

Napi::Value GetGpuInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    ComPtr<IDXGIFactory1> factory;
    if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
        result.Set("error", Napi::String::New(env, "CreateDXGIFactory1 failed"));
        return result;
    }

    Napi::Array adapters = Napi::Array::New(env);
    int discreteIdx = -1;
    ComPtr<IDXGIAdapter> adapter;
    for (UINT i = 0; factory->EnumAdapters(i, &adapter) != DXGI_ERROR_NOT_FOUND; i++) {
        DXGI_ADAPTER_DESC desc;
        adapter->GetDesc(&desc);
        char name[128];
        wcstombs(name, desc.Description, sizeof(name));

        Napi::Object adapterObj = Napi::Object::New(env);
        adapterObj.Set("index", Napi::Number::New(env, i));
        adapterObj.Set("name", Napi::String::New(env, name));
        adapterObj.Set("vramMB", Napi::Number::New(env, (double)(desc.DedicatedVideoMemory / (1024*1024))));

        bool isDiscrete = (wcsstr(desc.Description, L"NVIDIA") ||
                          wcsstr(desc.Description, L"AMD") ||
                          wcsstr(desc.Description, L"Radeon"));
        adapterObj.Set("isDiscrete", Napi::Boolean::New(env, isDiscrete));

        if (isDiscrete && discreteIdx < 0) discreteIdx = (int)i;

        adapters.Set(i, adapterObj);
        adapter.Reset();
    }

    result.Set("adapters", adapters);
    result.Set("selectedAdapter", Napi::Number::New(env, discreteIdx >= 0 ? discreteIdx : 0));

    return result;
}


// ============================================================
// Module init
// ============================================================

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    SpoutOutput::Init(env, exports);
    SpoutAtlasOutput::Init(env, exports);
    SpoutReceiver::Init(env, exports);
    exports.Set("listSenders", Napi::Function::New(env, ListSenders));
    exports.Set("getGpuInfo", Napi::Function::New(env, GetGpuInfo));
    return exports;
}

NODE_API_MODULE(spout_addon, Init)
