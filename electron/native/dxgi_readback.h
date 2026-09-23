#pragma once
#include <wrl/client.h>
#include <array>
#include <cstring>
#include <cmath>

// Independent of the preview window/pump. Never wait for the GPU on Electron's
// main thread: read a completed staging slot, then queue the next copy.
namespace ghost_readback {
using Microsoft::WRL::ComPtr;
class Capture {
  struct Slot {
    ComPtr<ID3D11Texture2D> texture;
    ComPtr<ID3D11Query> done;
    uint64_t frame = 0;
    bool busy = false;
  };
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  ComPtr<ID3D11Texture2D> source;
  std::array<Slot, 2> slots;
  std::string name;
  UINT width = 0, height = 0;
  size_t read = 0, write = 0;
  uint64_t lastQueued = 0;

  void Open(const std::string& next) {
    Reset();
    std::wstring wide(next.begin(), next.end()); // Core-generated ASCII name.
    ComPtr<IDXGIFactory1> factory;
    HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(hr)) throw std::runtime_error("Cannot enumerate DXGI adapters for NDI capture");
    for (UINT index = 0; ; ++index) {
      ComPtr<IDXGIAdapter1> adapter;
      hr = factory->EnumAdapters1(index, &adapter);
      if (hr == DXGI_ERROR_NOT_FOUND) break;
      if (FAILED(hr)) throw std::runtime_error("Cannot enumerate DXGI adapter for NDI capture");
      D3D_FEATURE_LEVEL level;
      hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
          D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
          &device, &level, &context);
      ComPtr<ID3D11Device1> device1;
      if (SUCCEEDED(hr) && SUCCEEDED(device.As(&device1))) {
        hr = device1->OpenSharedResourceByName(wide.c_str(), DXGI_SHARED_RESOURCE_READ,
            IID_PPV_ARGS(&source));
        if (SUCCEEDED(hr)) break;
      }
      context.Reset(); device.Reset();
    }
    if (!source) throw std::runtime_error("Cannot open the native output texture on any DXGI adapter");
    D3D11_TEXTURE2D_DESC desc{};
    source->GetDesc(&desc);
    if (desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM || desc.SampleDesc.Count != 1 ||
        !desc.Width || !desc.Height || desc.Width > 8192 || desc.Height > 8192) {
      Reset();
      throw std::runtime_error("NDI capture requires a BGRA8 native output texture (up to 8192 pixels per dimension)");
    }
    width = desc.Width; height = desc.Height;
    desc.Usage = D3D11_USAGE_STAGING;
    desc.BindFlags = 0; desc.MiscFlags = 0;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    D3D11_QUERY_DESC query{D3D11_QUERY_EVENT, 0};
    for (auto& slot : slots) {
      if (FAILED(device->CreateTexture2D(&desc, nullptr, &slot.texture)) ||
          FAILED(device->CreateQuery(&query, &slot.done))) {
        Reset();
        throw std::runtime_error("Cannot allocate NDI readback textures");
      }
    }
    name = next;
  }
 public:
  void Reset() {
    for (auto& slot : slots) slot = Slot{};
    source.Reset(); context.Reset(); device.Reset();
    name.clear(); width = height = 0; read = write = 0; lastQueued = 0;
  }
  Napi::Value Read(Napi::Env env, const std::string& next, uint64_t frame) {
    if (next != name) Open(next);
    Napi::Value result = env.Null();
    auto& ready = slots[read];
    if (ready.busy) {
      HRESULT hr = context->GetData(ready.done.Get(), nullptr, 0, D3D11_ASYNC_GETDATA_DONOTFLUSH);
      if (FAILED(hr)) { Reset(); throw std::runtime_error("NDI GPU readback failed"); }
      if (hr == S_OK) {
        auto data = Napi::Buffer<uint8_t>::New(env, static_cast<size_t>(width) * height * 4);
        D3D11_MAPPED_SUBRESOURCE mapped{};
        hr = context->Map(ready.texture.Get(), 0, D3D11_MAP_READ, D3D11_MAP_FLAG_DO_NOT_WAIT, &mapped);
        if (SUCCEEDED(hr)) {
          for (UINT y = 0; y < height; ++y)
            std::memcpy(data.Data() + static_cast<size_t>(y) * width * 4,
                static_cast<uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch, width * 4);
          context->Unmap(ready.texture.Get(), 0);
          auto out = Napi::Object::New(env);
          out.Set("data", data); out.Set("width", width); out.Set("height", height);
          out.Set("frame", Napi::Number::New(env, static_cast<double>(ready.frame)));
          result = out;
          ready.busy = false; read = (read + 1) % slots.size();
        } else if (hr != DXGI_ERROR_WAS_STILL_DRAWING) {
          Reset(); throw std::runtime_error("Cannot map NDI readback texture");
        }
      }
    }
    auto& pending = slots[write];
    if (!pending.busy && frame != lastQueued) {
      context->CopyResource(pending.texture.Get(), source.Get());
      context->End(pending.done.Get()); context->Flush();
      pending.frame = frame; pending.busy = true; lastQueued = frame;
      write = (write + 1) % slots.size();
    }
    return result;
  }
};
static Capture capture;
inline Napi::Value Read(const Napi::CallbackInfo& info) {
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber() ||
      info[0].As<Napi::String>().Utf8Value().empty() ||
      !std::isfinite(info[1].As<Napi::Number>().DoubleValue()) ||
      info[1].As<Napi::Number>().DoubleValue() <= 0 ||
      info[1].As<Napi::Number>().DoubleValue() > 9007199254740991.0) {
    Napi::TypeError::New(info.Env(), "Expected shared texture name and positive frame number").ThrowAsJavaScriptException();
    return info.Env().Null();
  }
  try { return capture.Read(info.Env(), info[0].As<Napi::String>().Utf8Value(), info[1].As<Napi::Number>().Int64Value()); }
  catch (const std::exception& error) {
    Napi::Error::New(info.Env(), error.what()).ThrowAsJavaScriptException();
    return info.Env().Null();
  }
}
inline Napi::Value Release(const Napi::CallbackInfo& info) { capture.Reset(); return info.Env().Undefined(); }
} // namespace ghost_readback
