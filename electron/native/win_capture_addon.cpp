// Windows native live capture — DXGI twin of live_capture_addon.mm.
//
// Exports the same surface the macOS addon exposes (available / listCameras /
// startCamera / startScreen / stop / receiveTextureInfo), but produces BGRA8
// frames as D3D11 shared textures rather than IOSurfaces. The broker's
// `prepareSharedTextureHandlesForNativeCore` duplicates the returned HANDLE
// into the render-core process, so `receiveTextureInfo` just returns the
// addon-process handle and the sync/broker plumbing takes it from there.
//
// Webcam: Media Foundation IMFSourceReader delivering MFVideoFormat_RGB32
// (BGRA in memory) samples. A background reader thread does IMFMediaBuffer
// Lock -> memcpy -> UpdateSubresource on the shared texture; the shared
// texture is created ONCE per session with D3D11_RESOURCE_MISC_SHARED_NTHANDLE
// so it can be opened by the render-core (which runs D3D12) through the
// duplicated NT HANDLE.
//
// Screen: DXGI Desktop Duplication (whole displays). AcquireNextFrame ->
// ID3D11Texture2D CopyResource -> shared texture. Windows capture (single
// HWND) is not implemented here yet — kind:"window" returns unsupported.
// The macOS behaviour is preserved: the sync sees the session "connect" but
// no frame is produced, and MediaTray reports the failure to the user.

#include <napi.h>

#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <dxgi1_5.h>
#include <dxgi1_6.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>

// Windows.Graphics.Capture (WGC). Preferred over DXGI Desktop Duplication:
// duplication is limited to ONE IDXGIOutputDuplication per output per PROCESS,
// and Chromium already holds one for desktopCapturer thumbnails — which is why
// DuplicateOutput returns DXGI_ERROR_UNSUPPORTED from inside Electron even
// with the correct adapter. WGC has no such limit and also captures single
// windows, which duplication cannot do at all.
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "ole32.lib")

namespace {

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

template <typename T>
void SafeRelease(T*& ptr) {
  if (ptr) {
    ptr->Release();
    ptr = nullptr;
  }
}

std::string Narrow(const std::wstring& w) {
  if (w.empty()) return {};
  int needed = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string out(needed, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), out.data(), needed, nullptr, nullptr);
  return out;
}

std::string HexOf(HRESULT hr) {
  char buf[32];
  sprintf_s(buf, "0x%08lX", (unsigned long)hr);
  return std::string(buf);
}

// The single MF startup / shutdown — MFStartup is refcounted internally so it
// is safe to call from Init, but do it exactly once from the addon's own scope
// to keep tear-down deterministic.
struct MediaFoundationBootstrap {
  MediaFoundationBootstrap() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE) coInited_ = SUCCEEDED(hr);
    hr = MFStartup(MF_VERSION, MFSTARTUP_LITE);
    mfInited_ = SUCCEEDED(hr);
  }
  ~MediaFoundationBootstrap() {
    if (mfInited_) MFShutdown();
    if (coInited_) CoUninitialize();
  }
  bool coInited_ = false;
  bool mfInited_ = false;
};
MediaFoundationBootstrap g_mf;

// -----------------------------------------------------------------------------
// Session base class: owns the D3D11 device and a persistent BGRA8 shared
// texture. Subclasses fill that texture from Media Foundation or DXGI Desktop
// Duplication and bump `frame_` when a new one is ready.
// -----------------------------------------------------------------------------

class Session {
 public:
  virtual ~Session() { StopThread(); Release(); }

  bool EnsureDevice(std::string* error) {
    if (device_) return true;
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    D3D_FEATURE_LEVEL got;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags,
                                    levels, ARRAYSIZE(levels), D3D11_SDK_VERSION,
                                    &device_, &got, &context_);
    if (FAILED(hr)) {
      *error = "D3D11CreateDevice failed (" + HexOf(hr) + ")";
      return false;
    }
    // The class mutex serialises every context_ call from every thread
    // (capture worker + Napi caller), so ID3D11Multithread protection would
    // be redundant. All UpdateSubresource / CopyResource sites are under
    // std::lock_guard<std::mutex>(mutex_).
    return true;
  }

  // Rebuild the shared texture at a new size. Returns false only if HRESULTs
  // fail — a rebuild is expected on the first frame and on any resolution
  // change (webcam format negotiation, monitor mode change).
  bool EnsureSharedTexture(uint32_t width, uint32_t height, std::string* error) {
    if (shared_ && width == width_ && height == height_) return true;
    SafeRelease(shared_);
    if (handle_) {
      CloseHandle(handle_);
      handle_ = nullptr;
    }
    width_ = width;
    height_ = height;

    D3D11_TEXTURE2D_DESC desc = {};
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    // NT handle is required because the render-core's D3D12
    // `OpenSharedHandle` only accepts NT handles, and the broker duplicates
    // it into the core's process (see prepareSharedTextureHandlesForNativeCore).
    // D3D11 mandates NT-handle textures also carry KEYEDMUTEX — the core
    // reads without acquiring (torn frames self-correct on the next update).
    desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;

    HRESULT hr = device_->CreateTexture2D(&desc, nullptr, &shared_);
    if (FAILED(hr) || !shared_) {
      *error = "CreateTexture2D(shared) failed (" + HexOf(hr) + ")";
      return false;
    }

    IDXGIResource1* dxgi1 = nullptr;
    hr = shared_->QueryInterface(__uuidof(IDXGIResource1), (void**)&dxgi1);
    if (FAILED(hr) || !dxgi1) {
      *error = "IDXGIResource1 query failed (" + HexOf(hr) + ")";
      return false;
    }
    hr = dxgi1->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
                                    nullptr, &handle_);
    dxgi1->Release();
    if (FAILED(hr) || !handle_) {
      *error = "CreateSharedHandle failed (" + HexOf(hr) + ")";
      SafeRelease(shared_);
      return false;
    }
    return true;
  }

  // Push a full BGRA8 frame to the shared texture. Called by the capture
  // thread; the class mutex serialises with any other thread that could
  // touch context_ or the keyed mutex.
  void UploadFrame(const uint8_t* bgra, uint32_t width, uint32_t height, int32_t stride) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::string err;
    if (!EnsureSharedTexture(width, height, &err)) {
      last_error_ = err;
      return;
    }
    if (!AcquireMutex()) return;
    UINT rowPitch = (UINT)std::abs(stride);
    const uint8_t* src = bgra;
    if (stride < 0) src = bgra + (height - 1) * rowPitch;
    context_->UpdateSubresource(shared_, 0, nullptr, src, (UINT)stride, 0);
    ReleaseMutex_();
    frame_.fetch_add(1, std::memory_order_release);
    last_update_ns_ = std::chrono::steady_clock::now().time_since_epoch().count();
  }

  // Push a D3D11 texture (from WGC / Desktop Duplication).
  void UploadTexture(ID3D11Texture2D* src) {
    if (!src) return;
    std::lock_guard<std::mutex> lock(mutex_);
    D3D11_TEXTURE2D_DESC sd = {};
    src->GetDesc(&sd);
    std::string err;
    if (!EnsureSharedTexture(sd.Width, sd.Height, &err)) {
      last_error_ = err;
      return;
    }
    if (!AcquireMutex()) return;
    context_->CopyResource(shared_, src);
    ReleaseMutex_();
    frame_.fetch_add(1, std::memory_order_release);
    last_update_ns_ = std::chrono::steady_clock::now().time_since_epoch().count();
  }

  Napi::Object StatusJson(Napi::Env env, const std::string& kind) {
    std::lock_guard<std::mutex> lock(mutex_);
    Napi::Object out = Napi::Object::New(env);
    out.Set("available", Napi::Boolean::New(env, shared_ != nullptr && handle_ != nullptr));
    out.Set("kind", Napi::String::New(env, kind));
    out.Set("platform", Napi::String::New(env, "dxgi"));
    out.Set("width", Napi::Number::New(env, width_));
    out.Set("height", Napi::Number::New(env, height_));
    // DXGI_FORMAT_B8G8R8A8_UNORM = 87. The core's shared_texture parser
    // treats this as `bgra8unorm`.
    out.Set("format", Napi::Number::New(env, (double)DXGI_FORMAT_B8G8R8A8_UNORM));
    out.Set("frame", Napi::Number::New(env, (double)frame_.load(std::memory_order_acquire)));
    if (handle_) {
      // The broker's duplicator expects a Buffer<HANDLE> so it can DuplicateHandle
      // into the render-core process. Serialise the raw pointer bytes.
      out.Set("handle", Napi::Buffer<uint8_t>::Copy(
          env, reinterpret_cast<uint8_t*>(&handle_), sizeof(HANDLE)));
    }
    if (!last_error_.empty()) out.Set("lastError", Napi::String::New(env, last_error_));
    return out;
  }

 protected:
  // Acquire the shared-texture keyed mutex on the writer side. Uses key 0 with
  // 100 ms timeout — the render-core reads without acquiring, so contention is
  // limited to consecutive writes on this same thread and effectively never blocks.
  bool AcquireMutex() {
    if (!shared_) return false;
    IDXGIKeyedMutex* km = nullptr;
    if (FAILED(shared_->QueryInterface(__uuidof(IDXGIKeyedMutex), (void**)&km)) || !km) return false;
    HRESULT hr = km->AcquireSync(0, 100);
    km->Release();
    return SUCCEEDED(hr);
  }
  void ReleaseMutex_() {
    if (!shared_) return;
    IDXGIKeyedMutex* km = nullptr;
    if (FAILED(shared_->QueryInterface(__uuidof(IDXGIKeyedMutex), (void**)&km)) || !km) return;
    km->ReleaseSync(0);
    km->Release();
  }

  void StopThread() {
    stop_.store(true, std::memory_order_release);
    if (worker_.joinable()) worker_.join();
  }
  virtual void Release() {
    if (handle_) { CloseHandle(handle_); handle_ = nullptr; }
    SafeRelease(shared_);
    SafeRelease(context_);
    SafeRelease(device_);
    width_ = 0; height_ = 0;
  }

  ID3D11Device* device_ = nullptr;
  ID3D11DeviceContext* context_ = nullptr;
  ID3D11Texture2D* shared_ = nullptr;
  HANDLE handle_ = nullptr;
  uint32_t width_ = 0, height_ = 0;
  std::atomic<uint64_t> frame_{0};
  int64_t last_update_ns_ = 0;
  std::string last_error_;
  std::mutex mutex_;
  std::thread worker_;
  std::atomic<bool> stop_{false};
};

// -----------------------------------------------------------------------------
// Webcam: Media Foundation source reader on a worker thread.
// -----------------------------------------------------------------------------

class WebcamSession : public Session {
 public:
  bool Start(const std::wstring& deviceId, std::string* error) {
    if (!EnsureDevice(error)) return false;

    IMFAttributes* attrs = nullptr;
    HRESULT hr = MFCreateAttributes(&attrs, 2);
    if (FAILED(hr)) { *error = "MFCreateAttributes (" + HexOf(hr) + ")"; return false; }
    attrs->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
    if (!deviceId.empty()) {
      attrs->SetString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, deviceId.c_str());
    }

    IMFActivate** activates = nullptr;
    UINT32 count = 0;
    hr = MFEnumDeviceSources(attrs, &activates, &count);
    attrs->Release();
    if (FAILED(hr) || count == 0) {
      if (activates) CoTaskMemFree(activates);
      *error = "no MF video capture device matched (" + HexOf(hr) + ")";
      return false;
    }

    IMFMediaSource* source = nullptr;
    if (!deviceId.empty()) {
      for (UINT32 i = 0; i < count; i++) {
        WCHAR* link = nullptr;
        UINT32 linkLen = 0;
        if (SUCCEEDED(activates[i]->GetAllocatedString(
                MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &link, &linkLen))) {
          bool match = link && deviceId == std::wstring(link);
          if (link) CoTaskMemFree(link);
          if (match) { hr = activates[i]->ActivateObject(__uuidof(IMFMediaSource), (void**)&source); break; }
        }
      }
    }
    if (!source) {
      // Fall through to the first camera when the requested device id is
      // missing (unplugged mid-session, or empty on the initial call).
      hr = activates[0]->ActivateObject(__uuidof(IMFMediaSource), (void**)&source);
    }
    for (UINT32 i = 0; i < count; i++) activates[i]->Release();
    CoTaskMemFree(activates);
    if (FAILED(hr) || !source) { *error = "ActivateObject failed (" + HexOf(hr) + ")"; return false; }

    // Advanced video processing turns on the Video Processor MFT, which is
    // what enables YUY2 / NV12 / MJPG -> RGB32 conversion inside the reader.
    // Without it, SetCurrentMediaType(RGB32) returns MF_E_INVALIDMEDIATYPE
    // on cameras whose native output isn't already RGB32.
    IMFAttributes* readerAttrs = nullptr;
    MFCreateAttributes(&readerAttrs, 2);
    readerAttrs->SetUINT32(MF_READWRITE_DISABLE_CONVERTERS, FALSE);
    readerAttrs->SetUINT32(MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, TRUE);
    hr = MFCreateSourceReaderFromMediaSource(source, readerAttrs, &reader_);
    if (readerAttrs) readerAttrs->Release();
    source->Release();
    if (FAILED(hr)) { *error = "MFCreateSourceReaderFromMediaSource (" + HexOf(hr) + ")"; return false; }

    // Force MFVideoFormat_RGB32 (BGRA in memory) — MF's decoder MFT chains
    // handle the conversion from YUY2/NV12/MJPG in-process, which is worth
    // the extra CPU to avoid a colour-conversion shader on our side.
    IMFMediaType* target = nullptr;
    MFCreateMediaType(&target);
    target->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    target->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
    hr = reader_->SetCurrentMediaType((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, target);
    target->Release();
    if (FAILED(hr)) {
      *error = "SetCurrentMediaType(RGB32) failed (" + HexOf(hr) + ") — try a different camera format";
      SafeRelease(reader_);
      return false;
    }
    reader_->SetStreamSelection((DWORD)MF_SOURCE_READER_ALL_STREAMS, FALSE);
    reader_->SetStreamSelection((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, TRUE);

    stop_.store(false, std::memory_order_release);
    worker_ = std::thread(&WebcamSession::ReadLoop, this);
    return true;
  }

 public:
  // A base destructor cannot reach a derived override — during ~Session the
  // vtable is already Session's, so Session::Release() runs and the MF reader
  // leaks, holding the camera open for the whole app lifetime (which then
  // makes getUserMedia fail with NotReadableError for MediaPipe et al).
  // Every subclass must therefore tear itself down in its OWN destructor.
  ~WebcamSession() override { StopThread(); Release(); }

 protected:
  void Release() override {
    SafeRelease(reader_);
    Session::Release();
  }

 private:
  void ReadLoop() {
    // ReadSample can be called from any thread as long as MF is up; we do it
    // on the worker so the JS-side start call returns immediately.
    while (!stop_.load(std::memory_order_acquire)) {
      DWORD streamIndex = 0, flags = 0;
      LONGLONG ts = 0;
      IMFSample* sample = nullptr;
      HRESULT hr = reader_->ReadSample((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                        0, &streamIndex, &flags, &ts, &sample);
      if (FAILED(hr)) {
        last_error_ = "ReadSample failed (" + HexOf(hr) + ")";
        break;
      }
      if (flags & MF_SOURCE_READERF_ENDOFSTREAM) { SafeRelease(sample); break; }
      // MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED: the reader re-queries the
      // current media type per-sample below, so nothing extra to do here.
      if (!sample) continue;

      IMFMediaBuffer* buffer = nullptr;
      if (SUCCEEDED(sample->ConvertToContiguousBuffer(&buffer)) && buffer) {
        BYTE* data = nullptr;
        DWORD maxLen = 0, curLen = 0;
        if (SUCCEEDED(buffer->Lock(&data, &maxLen, &curLen)) && data && curLen > 0) {
          // Pull the current width/height from the reader — the frame size can
          // change mid-stream (e.g. Continuity Camera re-negotiation).
          UINT32 w = 0, h = 0;
          IMFMediaType* cur = nullptr;
          if (SUCCEEDED(reader_->GetCurrentMediaType(
                  (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, &cur)) && cur) {
            MFGetAttributeSize(cur, MF_MT_FRAME_SIZE, &w, &h);
            cur->Release();
          }
          if (w > 0 && h > 0) {
            // MFVideoFormat_RGB32 is 4 bytes per pixel, bottom-up by default;
            // MF gives us the stride via MF_MT_DEFAULT_STRIDE (may be negative).
            LONG stride = (LONG)(w * 4);
            IMFMediaType* mt = nullptr;
            if (SUCCEEDED(reader_->GetCurrentMediaType(
                    (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, &mt)) && mt) {
              UINT32 s = 0;
              if (SUCCEEDED(mt->GetUINT32(MF_MT_DEFAULT_STRIDE, &s))) stride = (LONG)s;
              mt->Release();
            }
            UploadFrame(data, w, h, stride);
          }
          buffer->Unlock();
        }
        buffer->Release();
      }
      sample->Release();
    }
  }

  IMFSourceReader* reader_ = nullptr;
};

// -----------------------------------------------------------------------------
// Screen: DXGI Output Duplication on a worker thread.
// -----------------------------------------------------------------------------

class ScreenSession : public Session {
 public:
  // Bounds are in Windows virtual-desktop coordinates; hasBounds=false picks
  // the primary output. Chromium's display_id is NOT a DXGI IDXGIOutput index,
  // so we match by DesktopCoordinates instead.
  bool Start(RECT bounds, bool hasBounds, std::string* error) {
    // On hybrid-graphics laptops the render device tends to land on the
    // discrete GPU while the displays are attached to the iGPU. Desktop
    // Duplication needs the D3D device to sit on the SAME adapter as the
    // target output, so create a bespoke device on the output's adapter
    // rather than reusing the shared render device.
    IDXGIFactory1* factory = nullptr;
    if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&factory)) || !factory) {
      *error = "CreateDXGIFactory1 failed";
      return false;
    }
    // On hybrid-graphics laptops (NVIDIA Optimus / AMD switchable), the
    // integrated GPU owns the desktop composition surface; only IT can
    // successfully `DuplicateOutput`. The discrete GPU may present to the
    // same output, but calling DuplicateOutput on it returns UNSUPPORTED.
    // IDXGIFactory6 lets us enumerate with a power-preference; MINIMUM_POWER
    // returns the iGPU first when present.
    IDXGIFactory6* factory6 = nullptr;
    factory->QueryInterface(__uuidof(IDXGIFactory6), (void**)&factory6);

    IDXGIAdapter1* chosen = nullptr;
    IDXGIOutput* output = nullptr;
    auto enumAdapter = [&](UINT i, IDXGIAdapter1** out) -> HRESULT {
      if (factory6) {
        return factory6->EnumAdapterByGpuPreference(
            i, DXGI_GPU_PREFERENCE_MINIMUM_POWER, __uuidof(IDXGIAdapter1), (void**)out);
      }
      return factory->EnumAdapters1(i, out);
    };
    for (UINT i = 0; ; i++) {
      IDXGIAdapter1* cand = nullptr;
      HRESULT enumHr = enumAdapter(i, &cand);
      if (enumHr == DXGI_ERROR_NOT_FOUND || FAILED(enumHr) || !cand) break;
      for (UINT j = 0; ; j++) {
        IDXGIOutput* candOut = nullptr;
        HRESULT outHr = cand->EnumOutputs(j, &candOut);
        if (outHr == DXGI_ERROR_NOT_FOUND || FAILED(outHr) || !candOut) break;
        DXGI_OUTPUT_DESC desc = {};
        candOut->GetDesc(&desc);
        bool match = false;
        if (hasBounds) {
          match = (desc.DesktopCoordinates.left == bounds.left &&
                   desc.DesktopCoordinates.top == bounds.top);
        } else {
          // No bounds: first attached output is the primary.
          match = (desc.AttachedToDesktop == TRUE && output == nullptr);
        }
        if (match) {
          if (output) output->Release();
          output = candOut;
          if (chosen) chosen->Release();
          chosen = cand;
          cand->AddRef();
          if (hasBounds) break;  // definite match, stop searching
        } else {
          candOut->Release();
        }
      }
      cand->Release();
      if (hasBounds && output) break;
    }
    if (factory6) factory6->Release();
    factory->Release();

    if (!chosen || !output) {
      if (chosen) chosen->Release();
      if (output) output->Release();
      *error = "no DXGI output found for the requested display";
      return false;
    }
    {
      DXGI_ADAPTER_DESC1 ad = {}; chosen->GetDesc1(&ad);
      DXGI_OUTPUT_DESC od = {}; output->GetDesc(&od);
      char buf[512];
      sprintf_s(buf, "[WinCapture] using adapter=\"%ls\" (vendor=0x%04x device=0x%04x) output=\"%ls\" bounds=%ld,%ld-%ld,%ld\n",
               ad.Description, ad.VendorId, ad.DeviceId, od.DeviceName,
               od.DesktopCoordinates.left, od.DesktopCoordinates.top,
               od.DesktopCoordinates.right, od.DesktopCoordinates.bottom);
      fputs(buf, stderr);
    }

    // Now create the D3D11 device on the ADAPTER that owns the output.
    if (device_) { SafeRelease(context_); SafeRelease(device_); }
    // VIDEO_SUPPORT is required by DXGI Desktop Duplication on some driver
    // stacks (NVIDIA Optimus in particular) — without it DuplicateOutput
    // returns DXGI_ERROR_UNSUPPORTED even when the adapter/output pair is
    // correct.
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT;
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    D3D_FEATURE_LEVEL got;
    HRESULT hr = D3D11CreateDevice(chosen, D3D_DRIVER_TYPE_UNKNOWN, nullptr, flags,
                                    levels, ARRAYSIZE(levels), D3D11_SDK_VERSION,
                                    &device_, &got, &context_);
    chosen->Release();
    if (FAILED(hr) || !device_) {
      output->Release();
      *error = "D3D11CreateDevice on output-owning adapter failed (" + HexOf(hr) + ")";
      return false;
    }

    // Prefer DuplicateOutput1 with an explicit format list — it works on HDR
    // and hybrid-graphics displays where the legacy DuplicateOutput can
    // return DXGI_ERROR_UNSUPPORTED (0x887A0004). Fall back to the legacy
    // path on older Windows / drivers without IDXGIOutput5.
    IDXGIOutput5* output5 = nullptr;
    hr = output->QueryInterface(__uuidof(IDXGIOutput5), (void**)&output5);
    if (SUCCEEDED(hr) && output5) {
      DXGI_FORMAT formats[] = {
        DXGI_FORMAT_B8G8R8A8_UNORM,
        DXGI_FORMAT_R8G8B8A8_UNORM,
        DXGI_FORMAT_R16G16B16A16_FLOAT,
        DXGI_FORMAT_R10G10B10A2_UNORM,
      };
      hr = output5->DuplicateOutput1(device_, 0, ARRAYSIZE(formats), formats, &dup_);
      output5->Release();
    } else {
      IDXGIOutput1* output1 = nullptr;
      hr = output->QueryInterface(__uuidof(IDXGIOutput1), (void**)&output1);
      if (SUCCEEDED(hr) && output1) {
        hr = output1->DuplicateOutput(device_, &dup_);
        output1->Release();
      } else {
        hr = E_NOINTERFACE;
      }
    }
    if (FAILED(hr) || !dup_) {
      *error = "DuplicateOutput failed (" + HexOf(hr) +
               ") — display may be HDR/protected, on a different adapter, or a fullscreen exclusive app is running";
      return false;
    }

    stop_.store(false, std::memory_order_release);
    worker_ = std::thread(&ScreenSession::CaptureLoop, this);
    return true;
  }

 public:
  // See the note on ~WebcamSession: the base destructor cannot dispatch here.
  ~ScreenSession() override { StopThread(); Release(); }

 protected:
  void Release() override {
    SafeRelease(dup_);
    Session::Release();
  }

 private:
  void CaptureLoop() {
    while (!stop_.load(std::memory_order_acquire)) {
      DXGI_OUTDUPL_FRAME_INFO info = {};
      IDXGIResource* res = nullptr;
      // 16 ms timeout keeps us responsive to stop() while riding the display's
      // vsync when nothing has changed on screen (info.LastPresentTime == 0).
      HRESULT hr = dup_->AcquireNextFrame(16, &info, &res);
      if (hr == DXGI_ERROR_WAIT_TIMEOUT) { if (res) res->Release(); continue; }
      if (FAILED(hr)) {
        last_error_ = "AcquireNextFrame failed (" + HexOf(hr) + ")";
        if (res) res->Release();
        break;
      }
      ID3D11Texture2D* tex = nullptr;
      if (res && SUCCEEDED(res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&tex)) && tex) {
        UploadTexture(tex);
        tex->Release();
      }
      if (res) res->Release();
      dup_->ReleaseFrame();
    }
  }

  IDXGIOutputDuplication* dup_ = nullptr;
};

// -----------------------------------------------------------------------------
// Windows.Graphics.Capture session — monitors AND windows.
// -----------------------------------------------------------------------------

class WGCSession : public Session {
 public:
  static bool Supported() {
    try {
      return winrt::Windows::Graphics::Capture::GraphicsCaptureSession::IsSupported();
    } catch (...) {
      return false;
    }
  }

  // Exactly one of monitor / window is non-null.
  bool Start(HMONITOR monitor, HWND window, std::string* error) {
    if (!EnsureDevice(error)) return false;
    try {
      auto interop = winrt::get_activation_factory<
          winrt::Windows::Graphics::Capture::GraphicsCaptureItem,
          IGraphicsCaptureItemInterop>();
      winrt::Windows::Graphics::Capture::GraphicsCaptureItem item{nullptr};
      HRESULT hr = S_OK;
      if (monitor) {
        hr = interop->CreateForMonitor(
            monitor,
            winrt::guid_of<winrt::Windows::Graphics::Capture::GraphicsCaptureItem>(),
            winrt::put_abi(item));
      } else {
        hr = interop->CreateForWindow(
            window,
            winrt::guid_of<winrt::Windows::Graphics::Capture::GraphicsCaptureItem>(),
            winrt::put_abi(item));
      }
      if (FAILED(hr) || !item) {
        *error = std::string("GraphicsCaptureItem creation failed (") + HexOf(hr) + ")";
        return false;
      }

      // Wrap our D3D11 device as a WinRT IDirect3DDevice so the frame pool
      // produces surfaces we can CopyResource from directly.
      IDXGIDevice* dxgiDevice = nullptr;
      if (FAILED(device_->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgiDevice)) || !dxgiDevice) {
        *error = "IDXGIDevice query failed for WGC";
        return false;
      }
      winrt::com_ptr<::IInspectable> inspectable;
      hr = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, inspectable.put());
      dxgiDevice->Release();
      if (FAILED(hr) || !inspectable) {
        *error = std::string("CreateDirect3D11DeviceFromDXGIDevice failed (") + HexOf(hr) + ")";
        return false;
      }
      winrtDevice_ = inspectable.as<
          winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();

      auto size = item.Size();
      framePool_ = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::CreateFreeThreaded(
          winrtDevice_,
          winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
          2,
          size);
      session_ = framePool_.CreateCaptureSession(item);

      // NOTE: `IsBorderRequired(false)` (hides Win11's yellow capture outline)
      // lives on IGraphicsCaptureSession3, which the 19041 SDK does not
      // declare. Skipped rather than pinning a newer SDK — purely cosmetic.
      try {
        session_.IsCursorCaptureEnabled(true);
      } catch (...) {}

      frameToken_ = framePool_.FrameArrived({this, &WGCSession::OnFrame});
      item_ = item;
      session_.StartCapture();
      return true;
    } catch (winrt::hresult_error const& ex) {
      *error = std::string("WGC start failed (") + HexOf(ex.code()) + ")";
      return false;
    } catch (...) {
      *error = "WGC start failed (unknown exception)";
      return false;
    }
  }

 public:
  // See the note on ~WebcamSession: the base destructor cannot dispatch here.
  ~WGCSession() override { StopThread(); Release(); }

 protected:
  void Release() override {
    try {
      if (framePool_ && frameToken_.value) framePool_.FrameArrived(frameToken_);
      if (session_) session_.Close();
      if (framePool_) framePool_.Close();
    } catch (...) {}
    session_ = nullptr;
    framePool_ = nullptr;
    item_ = nullptr;
    winrtDevice_ = nullptr;
    Session::Release();
  }

 private:
  void OnFrame(winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& pool,
               winrt::Windows::Foundation::IInspectable const&) {
    try {
      auto frame = pool.TryGetNextFrame();
      if (!frame) return;
      auto surface = frame.Surface();
      auto access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
      winrt::com_ptr<ID3D11Texture2D> tex;
      if (SUCCEEDED(access->GetInterface(winrt::guid_of<ID3D11Texture2D>(), tex.put_void())) && tex) {
        UploadTexture(tex.get());
      }
      // A resized monitor/window changes ContentSize; recreate the pool so
      // subsequent frames arrive at the new dimensions instead of stretched.
      auto contentSize = frame.ContentSize();
      if (contentSize.Width != lastSize_.Width || contentSize.Height != lastSize_.Height) {
        lastSize_ = contentSize;
        pool.Recreate(
            winrtDevice_,
            winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            contentSize);
      }
    } catch (...) { /* a dropped frame is never fatal */ }
  }

  winrt::Windows::Graphics::Capture::GraphicsCaptureItem item_{nullptr};
  winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool framePool_{nullptr};
  winrt::Windows::Graphics::Capture::GraphicsCaptureSession session_{nullptr};
  winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice winrtDevice_{nullptr};
  winrt::event_token frameToken_{};
  winrt::Windows::Graphics::SizeInt32 lastSize_{0, 0};
};

// -----------------------------------------------------------------------------
// Session registry keyed by JS-supplied sessionId string.
// -----------------------------------------------------------------------------

std::mutex g_registry_mutex;
std::map<std::string, std::shared_ptr<Session>> g_sessions;
std::map<std::string, std::string> g_session_kind;

std::shared_ptr<Session> FindSession(const std::string& id) {
  std::lock_guard<std::mutex> lock(g_registry_mutex);
  auto it = g_sessions.find(id);
  return it == g_sessions.end() ? nullptr : it->second;
}

std::string FindSessionKind(const std::string& id) {
  std::lock_guard<std::mutex> lock(g_registry_mutex);
  auto it = g_session_kind.find(id);
  return it == g_session_kind.end() ? std::string() : it->second;
}

void StoreSession(const std::string& id, std::shared_ptr<Session> s, const std::string& kind) {
  std::lock_guard<std::mutex> lock(g_registry_mutex);
  g_sessions[id] = std::move(s);
  g_session_kind[id] = kind;
}

bool DropSession(const std::string& id) {
  std::lock_guard<std::mutex> lock(g_registry_mutex);
  bool erased = g_sessions.erase(id) > 0;
  g_session_kind.erase(id);
  return erased;
}

// -----------------------------------------------------------------------------
// Napi exports.
// -----------------------------------------------------------------------------

std::string Utf8Arg(const Napi::Object& obj, const char* key) {
  if (!obj.Has(key)) return {};
  Napi::Value v = obj.Get(key);
  return v.IsString() ? v.As<Napi::String>().Utf8Value() : std::string();
}

std::wstring Utf8ToWide(const std::string& s) {
  if (s.empty()) return {};
  int needed = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
  std::wstring out(needed, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), out.data(), needed);
  return out;
}

Napi::Value Available(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("available", Napi::Boolean::New(env, g_mf.mfInited_));
  out.Set("platform", Napi::String::New(env, "dxgi"));
  Napi::Object supports = Napi::Object::New(env);
  const bool wgc = WGCSession::Supported();
  supports.Set("webcam", Napi::Boolean::New(env, true));
  supports.Set("screen", Napi::Boolean::New(env, true));
  // Single-window capture is WGC-only; DXGI duplication cannot do it.
  supports.Set("window", Napi::Boolean::New(env, wgc));
  out.Set("wgc", Napi::Boolean::New(env, wgc));
  out.Set("supports", supports);
  if (!g_mf.mfInited_) {
    out.Set("error", Napi::String::New(env, "Media Foundation startup failed"));
  }
  return out;
}

Napi::Value ListCameras(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  IMFAttributes* attrs = nullptr;
  if (FAILED(MFCreateAttributes(&attrs, 1))) return out;
  attrs->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                 MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
  IMFActivate** activates = nullptr;
  UINT32 count = 0;
  HRESULT hr = MFEnumDeviceSources(attrs, &activates, &count);
  attrs->Release();
  if (FAILED(hr)) return out;

  uint32_t written = 0;
  for (UINT32 i = 0; i < count; i++) {
    WCHAR* nameW = nullptr;
    UINT32 nameLen = 0;
    WCHAR* linkW = nullptr;
    UINT32 linkLen = 0;
    activates[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &nameW, &nameLen);
    activates[i]->GetAllocatedString(
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &linkW, &linkLen);
    Napi::Object dev = Napi::Object::New(env);
    dev.Set("id", Napi::String::New(env, linkW ? Narrow(linkW) : ""));
    dev.Set("name", Napi::String::New(env, nameW ? Narrow(nameW) : "Webcam"));
    dev.Set("kind", Napi::String::New(env, "video"));
    out.Set(written++, dev);
    if (nameW) CoTaskMemFree(nameW);
    if (linkW) CoTaskMemFree(linkW);
    activates[i]->Release();
  }
  CoTaskMemFree(activates);
  return out;
}

Napi::Value StartCamera(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info.Length() || !info[0].IsObject()) return Napi::Boolean::New(env, false);
  Napi::Object args = info[0].As<Napi::Object>();
  std::string sessionId = Utf8Arg(args, "sessionId");
  std::string deviceId = Utf8Arg(args, "deviceId");
  if (sessionId.empty()) return Napi::Boolean::New(env, false);
  auto s = std::make_shared<WebcamSession>();
  std::string err;
  if (!s->Start(Utf8ToWide(deviceId), &err)) {
    fprintf(stderr, "[WinCapture] startCamera failed: %s\n", err.c_str());
    return Napi::Boolean::New(env, false);
  }
  StoreSession(sessionId, s, "webcam");
  return Napi::Boolean::New(env, true);
}

Napi::Value StartScreen(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info.Length() || !info[0].IsObject()) return Napi::Boolean::New(env, false);
  Napi::Object args = info[0].As<Napi::Object>();
  std::string sessionId = Utf8Arg(args, "sessionId");
  std::string kind = Utf8Arg(args, "kind");
  std::string sourceId = Utf8Arg(args, "sourceId");
  std::string displayIdStr = Utf8Arg(args, "displayId");
  if (sessionId.empty()) return Napi::Boolean::New(env, false);
  RECT bounds = {0, 0, 0, 0};
  bool hasBounds = false;
  auto readInt = [&](const char* key) -> int32_t {
    if (!args.Has(key)) return 0;
    Napi::Value v = args.Get(key);
    return v.IsNumber() ? v.As<Napi::Number>().Int32Value() : 0;
  };
  if (args.Has("hasBounds") && args.Get("hasBounds").ToBoolean()) {
    bounds.left = readInt("boundsLeft");
    bounds.top = readInt("boundsTop");
    bounds.right = readInt("boundsRight");
    bounds.bottom = readInt("boundsBottom");
    hasBounds = (bounds.right > bounds.left) && (bounds.bottom > bounds.top);
  }
  // Prefer WGC — it works inside Electron (no per-process duplication limit)
  // and is the only path that can capture a single window.
  if (WGCSession::Supported()) {
    HMONITOR monitor = nullptr;
    HWND window = nullptr;
    if (kind == "window") {
      // Electron's desktopCapturer window ids are "window:<hwnd>:<n>".
      size_t first = sourceId.find(':');
      size_t second = sourceId.find(':', first == std::string::npos ? 0 : first + 1);
      if (first != std::string::npos) {
        std::string hwndPart = sourceId.substr(
            first + 1, second == std::string::npos ? std::string::npos : second - first - 1);
        try {
          unsigned long long raw = std::stoull(hwndPart);
          window = (HWND)(uintptr_t)raw;
        } catch (...) { window = nullptr; }
      }
      if (!window || !IsWindow(window)) {
        fprintf(stderr, "[WinCapture] startScreen(window): bad HWND from sourceId \"%s\"\n",
                sourceId.c_str());
        return Napi::Boolean::New(env, false);
      }
    } else {
      if (hasBounds) {
        POINT pt = {bounds.left + 1, bounds.top + 1};
        monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
      } else {
        POINT origin = {0, 0};
        monitor = MonitorFromPoint(origin, MONITOR_DEFAULTTOPRIMARY);
      }
      if (!monitor) {
        fprintf(stderr, "[WinCapture] startScreen(screen): no HMONITOR resolved\n");
        return Napi::Boolean::New(env, false);
      }
    }
    auto wgc = std::make_shared<WGCSession>();
    std::string wgcErr;
    if (wgc->Start(monitor, window, &wgcErr)) {
      StoreSession(sessionId, wgc, kind == "window" ? "window" : "screen");
      fprintf(stderr, "[WinCapture] startScreen via WGC (%s) ok\n", kind.c_str());
      return Napi::Boolean::New(env, true);
    }
    fprintf(stderr, "[WinCapture] WGC failed (%s), falling back to DXGI duplication\n",
            wgcErr.c_str());
  }

  if (kind == "window") {
    fprintf(stderr, "[WinCapture] window capture requires WGC, which is unavailable\n");
    return Napi::Boolean::New(env, false);
  }
  auto s = std::make_shared<ScreenSession>();
  std::string err;
  if (!s->Start(bounds, hasBounds, &err)) {
    fprintf(stderr, "[WinCapture] startScreen failed: %s\n", err.c_str());
    return Napi::Boolean::New(env, false);
  }
  StoreSession(sessionId, s, "screen");
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info.Length() || !info[0].IsObject()) return Napi::Boolean::New(env, false);
  std::string sessionId = Utf8Arg(info[0].As<Napi::Object>(), "sessionId");
  if (sessionId.empty()) return Napi::Boolean::New(env, false);
  bool dropped = DropSession(sessionId);
  return Napi::Boolean::New(env, dropped);
}

Napi::Value ReceiveTextureInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!info.Length() || !info[0].IsObject()) return env.Null();
  Napi::Object args = info[0].As<Napi::Object>();
  std::string sessionId = Utf8Arg(args, "sessionId");
  auto s = FindSession(sessionId);
  if (!s) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("available", Napi::Boolean::New(env, false));
    out.Set("reason", Napi::String::New(env, "session not found"));
    return out;
  }
  return s->StatusJson(env, FindSessionKind(sessionId));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available", Napi::Function::New(env, Available));
  exports.Set("listCameras", Napi::Function::New(env, ListCameras));
  exports.Set("startCamera", Napi::Function::New(env, StartCamera));
  exports.Set("startScreen", Napi::Function::New(env, StartScreen));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("receiveTextureInfo", Napi::Function::New(env, ReceiveTextureInfo));
  exports.Set("platform", Napi::String::New(env, "win32"));
  return exports;
}

}  // namespace

NODE_API_MODULE(win_capture_addon, Init)
