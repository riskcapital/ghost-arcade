// Windows embedded native preview presenter.
//
// This is the DXGI twin of native_preview_addon.mm. The macOS version parents a
// CALayer into the Electron window and pumps an IOSurface into it; here we
// parent a child HWND into the Electron HWND and pump the render core's DXGI
// shared texture into a swapchain bound to that child.
//
// The core publishes its composite as a *named* D3D12 shared resource created
// with D3D12_HEAP_FLAG_SHARED and D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS
// (see create_output_export_target in native-renderer/src/main.rs). The name is
// process-scoped ("Local\\GhostArcadeNativeOutput-<pid>-<w>x<h>-<epoch>"), which
// is why we open by name rather than by HANDLE — the raw handle value the core
// reports is only valid inside the core process.
//
// Because the source is created with ALLOW_SIMULTANEOUS_ACCESS there is no keyed
// mutex to take; we read while the core writes. A torn preview frame is
// acceptable and self-corrects on the next present.
//
// The swapchain is sized to the *source* texture and created with
// DXGI_SCALING_STRETCH, so scaling to the on-screen preview rect is done by DXGI
// at present time. That keeps the present path a straight CopyResource with no
// shader pipeline of our own.

#include <napi.h>

#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <d3dcompiler.h>

#include <algorithm>
#include <map>
#include <memory>
#include <string>
#include <vector>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "d3dcompiler.lib")

namespace {

// Overlay geometry, ported from native_preview_addon.mm's Metal shaders so the
// editor chrome looks identical on both platforms. Metal draws points as point
// sprites with [[point_coord]]; D3D11 has no point sprites, so each point is
// expanded to a quad on the CPU and `uv` stands in for point_coord.
struct OverlayVertex {
  float x, y;          // swapchain pixels
  float u, v;          // point_coord equivalent (0..1); (0.5,0.5) for lines
  float color[4];      // fill
  float border[4];     // border / glyph colour
  float style[4];      // x=size(px) y=border z=kind w=scale ; kind<0 => line
};

const char kOverlayHlsl[] = R"HLSL(
struct VSIn {
  float2 pos    : POSITION;
  float2 uv     : TEXCOORD0;
  float4 color  : COLOR0;
  float4 border : COLOR1;
  float4 style  : TEXCOORD1;
};
struct VSOut {
  float4 position : SV_Position;
  float2 uv       : TEXCOORD0;
  float4 color    : COLOR0;
  float4 border   : COLOR1;
  float4 style    : TEXCOORD1;
};
cbuffer Xf : register(b0) { float4 transform; };  // x,y = origin  z,w = scale

VSOut vs_main(VSIn v) {
  VSOut o;
  o.position = float4(transform.x + v.pos.x * transform.z,
                      transform.y - v.pos.y * transform.w, 0.0, 1.0);
  o.uv = v.uv; o.color = v.color; o.border = v.border; o.style = v.style;
  return o;
}

float segmentDistance(float2 p, float2 a, float2 b) {
  float2 pa = p - a; float2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}

// Fullscreen blit. The swapchain is sized to the on-screen preview rect, so the
// scale from composite resolution to preview size happens here in the sampler
// rather than via DXGI_SCALING_STRETCH — which the flip model does not honour,
// and which silently presented a 1:1 crop of the composite instead.
struct BlitOut { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
BlitOut vs_blit(uint vid : SV_VertexID) {
  float2 p[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
  BlitOut o;
  o.pos = float4(p[vid], 0.0, 1.0);
  o.uv = float2((p[vid].x + 1.0) * 0.5, 1.0 - (p[vid].y + 1.0) * 0.5);
  return o;
}
Texture2D srcTex : register(t0);
SamplerState srcSmp : register(s0);
float4 ps_blit(BlitOut i) : SV_Target { return srcTex.Sample(srcSmp, i.uv); }

float4 ps_main(VSOut i) : SV_Target {
  int kind = int(i.style.z + 0.5);
  if (i.style.z < -0.5) return i.color;           // line segment

  float size   = i.style.x / max(i.style.w, 1.0);
  float border = i.style.y;
  float2 p = (i.uv - 0.5) * size;

  float coverage = 0.0;
  float borderMask = 0.0;
  if (kind == 2) {
    coverage = step(abs(p.y), 6.0);
    borderMask = coverage * max(step(4.0, abs(p.y)), step(size * 0.5 - 2.0, abs(p.x)));
  } else if (kind == 3) {
    coverage = step(abs(p.x), 6.0);
    borderMask = coverage * max(step(4.0, abs(p.x)), step(size * 0.5 - 2.0, abs(p.y)));
  } else {
    float radius = size * 0.5 - 1.0;
    float d = length(p);
    coverage = step(d, radius);
    borderMask = coverage * step(radius - border, d);
  }
  if (coverage < 0.5) discard;

  float4 result = lerp(i.color, i.border, borderMask);
  if (kind == 4) {
    float glyph = min(min(segmentDistance(p, float2(-8.0, 0.0), float2(8.0, 0.0)),
                          segmentDistance(p, float2(0.0, -8.0), float2(0.0, 8.0))),
                  min(min(segmentDistance(p, float2(-8.0, 0.0), float2(-5.0, -3.0)),
                          segmentDistance(p, float2(-8.0, 0.0), float2(-5.0, 3.0))),
                  min(min(segmentDistance(p, float2(8.0, 0.0), float2(5.0, -3.0)),
                          segmentDistance(p, float2(8.0, 0.0), float2(5.0, 3.0))),
                  min(min(segmentDistance(p, float2(0.0, -8.0), float2(-3.0, -5.0)),
                          segmentDistance(p, float2(0.0, -8.0), float2(3.0, -5.0))),
                  min(segmentDistance(p, float2(0.0, 8.0), float2(-3.0, 5.0)),
                      segmentDistance(p, float2(0.0, 8.0), float2(3.0, 5.0)))))));
    if (glyph < 1.15) result = i.border;
  } else if (kind == 5) {
    float ring = abs(length(p) - 6.0);
    bool arc = !(p.x > 2.0 && p.y < -4.5);
    float arrow = min(segmentDistance(p, float2(2.5, -6.0), float2(7.0, -6.0)),
                      segmentDistance(p, float2(7.0, -6.0), float2(7.0, -1.5)));
    if ((ring < 1.2 && arc) || arrow < 1.2) result = i.border;
  } else if (kind == 6) {
    float glyph = min(segmentDistance(p, float2(-6.0, 6.0), float2(6.0, -6.0)),
                  min(min(segmentDistance(p, float2(-6.0, 6.0), float2(-2.0, 6.0)),
                          segmentDistance(p, float2(-6.0, 6.0), float2(-6.0, 2.0))),
                  min(segmentDistance(p, float2(6.0, -6.0), float2(2.0, -6.0)),
                      segmentDistance(p, float2(6.0, -6.0), float2(6.0, -2.0)))));
    if (glyph < 1.1) result = i.border;
  }
  return result;
}
)HLSL";

const wchar_t* kWindowClass = L"GhostArcadeDxgiPreviewHost";

template <typename T>
void SafeRelease(T*& ptr) {
  if (ptr) {
    ptr->Release();
    ptr = nullptr;
  }
}

std::wstring Widen(const std::string& value) {
  if (value.empty()) return std::wstring();
  int needed = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), (int)value.size(), nullptr, 0);
  std::wstring out(needed, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), (int)value.size(), out.data(), needed);
  return out;
}

LRESULT CALLBACK PreviewWndProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  // The child is a pure presentation surface: it must never paint a background
  // (that would flash white over the composite) and must never take focus away
  // from the Electron window that hosts the UI.
  switch (msg) {
    case WM_ERASEBKGND:
      return 1;
    case WM_NCHITTEST:
      // Mirror the macOS presenter's `hitTest: nil`: this surface must never
      // consume an editor interaction. Every pointer event belongs to the DOM
      // chrome (warp handles, custom-shape points, light-painting strokes,
      // line control points), exactly as on the Metal underlay.
      return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
      // Never take activation/focus away from the Electron window that owns the
      // UI, and eat the click so it is re-dispatched to what is behind us.
      return MA_NOACTIVATEANDEAT;
    default:
      break;
  }
  return DefWindowProcW(hwnd, msg, wparam, lparam);
}

void EnsureWindowClass() {
  static bool registered = false;
  if (registered) return;
  WNDCLASSEXW wc = {};
  wc.cbSize = sizeof(wc);
  wc.style = CS_HREDRAW | CS_VREDRAW;
  wc.lpfnWndProc = PreviewWndProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hbrBackground = nullptr;
  wc.lpszClassName = kWindowClass;
  RegisterClassExW(&wc);
  registered = true;
}

struct Rect {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
};

Rect RectFromObject(const Napi::Object& obj) {
  Rect rect;
  auto readInt = [&](const char* key, int fallback) -> int {
    if (!obj.Has(key)) return fallback;
    Napi::Value v = obj.Get(key);
    if (!v.IsNumber()) return fallback;
    double d = v.As<Napi::Number>().DoubleValue();
    return (int)(d + 0.5);
  };
  rect.x = readInt("x", 0);
  rect.y = readInt("y", 0);
  rect.width = readInt("width", 0);
  rect.height = readInt("height", 0);
  if (rect.width < 1) rect.width = 1;
  if (rect.height < 1) rect.height = 1;
  return rect;
}

// One presentation surface: a child HWND plus the swapchain that feeds it.
// The primary editor preview uses one of these; each deck monitor / slice
// output gets its own, keyed by name.
class PreviewSurface {
 public:
  ~PreviewSurface() { Detach(); }

  bool Attach(HWND host, const Rect& rect, std::string* error) {
    if (!IsWindow(host)) {
      *error = "host window handle is not a live HWND";
      return false;
    }
    if (host_ != host) Detach();
    host_ = host;
    EnsureWindowClass();

    if (!child_) {
      // An UNDERLAY, mirroring the macOS presenter's
      // `addSubview:positioned:NSWindowBelow`. A Win32 child window is always
      // composited ABOVE its parent's Chromium surface, so a child can never be
      // an underlay — instead this is a borderless TOP-LEVEL window that is kept
      // directly BEHIND the (now transparent) Electron window. DWM shows it
      // through the editor canvas's alpha hole, and because it sits behind the
      // web content every DOM overlay — warp handles, custom-shape points,
      // light-painting strokes, line controls — draws on top of it and stays
      // fully interactive. WS_EX_NOACTIVATE keeps focus on the editor; TOOLWINDOW
      // hides it from the taskbar/alt-tab; TRANSPARENT keeps it out of hit-testing.
      child_ = CreateWindowExW(
          WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT,
          kWindowClass,
          L"",
          WS_POPUP | WS_VISIBLE,
          rect.x, rect.y, rect.width, rect.height,
          nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
      if (!child_) {
        *error = "CreateWindowExW failed for the preview underlay window (error " +
                 std::to_string(GetLastError()) + ")";
        return false;
      }
    }
    rect_ = rect;
    PositionBehind();

    if (!device_ && !CreateDevice(error)) return false;
    attached_ = true;
    return true;
  }

  bool Update(const Rect& rect) {
    if (!child_) return false;
    rect_ = rect;
    PositionBehind();
    return true;
  }

  // The underlay spans the host's ENTIRE client area, not just the canvas rect.
  // macOS gets an opaque backdrop for free (the NSWindow stays opaque and only
  // Chromium's surface is alpha-capable), but a Windows `transparent: true`
  // window has no backdrop at all — every unpainted DOM pixel would show the
  // desktop through the app. Covering the full client area and clearing it to
  // the app's backing colour reproduces the macOS arrangement; the composite is
  // then drawn only into the canvas rect via the viewport.
  void PositionBehind() {
    if (!child_ || !IsWindow(host_)) return;
    RECT client = {};
    if (!GetClientRect(host_, &client)) return;
    hostClientW_ = (uint32_t)(std::max)(1L, client.right - client.left);
    hostClientH_ = (uint32_t)(std::max)(1L, client.bottom - client.top);
    POINT origin = {0, 0};
    ClientToScreen(host_, &origin);
    SetWindowPos(child_, host_, origin.x, origin.y, (int)hostClientW_, (int)hostClientH_,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }

  void Detach() {
    ReleaseShared();
    SafeRelease(overlayVS_);
    SafeRelease(overlayPS_);
    SafeRelease(overlayLayout_);
    SafeRelease(overlayVB_);
    SafeRelease(overlayCB_);
    SafeRelease(overlayBlend_);
    overlayVBBytes_ = 0;
    SafeRelease(blitVS_);
    SafeRelease(blitPS_);
    SafeRelease(sampler_);
    SafeRelease(rasterizer_);
    swapWidth_ = 0;
    swapHeight_ = 0;
    SafeRelease(swapchain_);
    SafeRelease(context_);
    SafeRelease(device1_);
    SafeRelease(device_);
    if (child_) {
      DestroyWindow(child_);
      child_ = nullptr;
    }
    host_ = nullptr;
    attached_ = false;
    sourceWidth_ = 0;
    sourceHeight_ = 0;
  }

  // Opens (or reuses) the named shared texture and blits it to the swapchain.
  bool Present(const std::string& sharedName, uint32_t width, uint32_t height, std::string* error) {
    if (!attached_ || !device_ || !child_) {
      *error = "preview surface is not attached";
      return false;
    }
    if (sharedName.empty()) {
      *error = "shared texture name was empty";
      return false;
    }
    if (width == 0 || height == 0) {
      *error = "shared texture dimensions were zero";
      return false;
    }

    if (sharedName != sharedName_ || width != sourceWidth_ || height != sourceHeight_) {
      ReleaseShared();
      if (!OpenShared(sharedName, error)) return false;
      sharedName_ = sharedName;
      sourceWidth_ = width;
      sourceHeight_ = height;
    }
    // The swapchain tracks the preview rect, not the composite size.
    if (!EnsureSwapchain(error)) return false;
    if (!shared_ || !sampleTex_ || !swapchain_ || !EnsureBlitPipeline()) {
      *error = "shared texture, swapchain or blit pipeline is unavailable";
      return false;
    }

    ID3D11Texture2D* backBuffer = nullptr;
    HRESULT hr = swapchain_->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&backBuffer);
    if (FAILED(hr) || !backBuffer) {
      *error = "swapchain GetBuffer failed (hr=0x" + HexOf(hr) + ")";
      return false;
    }

    ID3D11RenderTargetView* rtv = nullptr;
    if (FAILED(device_->CreateRenderTargetView(backBuffer, nullptr, &rtv)) || !rtv) {
      backBuffer->Release();
      *error = "CreateRenderTargetView failed for the swapchain back buffer";
      return false;
    }
    context_->OMSetRenderTargets(1, &rtv, nullptr);
    // Opaque app backdrop for every pixel the DOM leaves transparent (matches
    // the macOS window backing colour #05070b), then the composite is drawn
    // only where the editor canvas hole is.
    const float backdrop[4] = {5.0f / 255.0f, 7.0f / 255.0f, 11.0f / 255.0f, 1.0f};
    context_->ClearRenderTargetView(rtv, backdrop);

    D3D11_VIEWPORT vp = {};
    vp.TopLeftX = (float)rect_.x;
    vp.TopLeftY = (float)rect_.y;
    vp.Width = (float)(std::max)(1, rect_.width);
    vp.Height = (float)(std::max)(1, rect_.height);
    vp.MaxDepth = 1.0f;
    context_->RSSetViewports(1, &vp);

    const float blendFactor[4] = {0, 0, 0, 0};
    context_->IASetInputLayout(nullptr);
    context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    context_->CopyResource(sampleTex_, shared_);
    context_->RSSetState(rasterizer_);
    context_->VSSetShader(blitVS_, nullptr, 0);
    context_->PSSetShader(blitPS_, nullptr, 0);
    context_->PSSetShaderResources(0, 1, &sampleSRV_);
    context_->PSSetSamplers(0, 1, &sampler_);
    context_->OMSetBlendState(nullptr, blendFactor, 0xffffffff);
    context_->Draw(3, 0);

    ID3D11ShaderResourceView* nullSrv = nullptr;
    context_->PSSetShaderResources(0, 1, &nullSrv);

    // No native overlay: as an underlay, all editor chrome is DOM drawn on top,
    // exactly as on the macOS Metal underlay. (DrawOverlay is kept dormant.)
    ID3D11RenderTargetView* nullRtv = nullptr;
    context_->OMSetRenderTargets(1, &nullRtv, nullptr);
    rtv->Release();
    backBuffer->Release();

    hr = swapchain_->Present(0, 0);
    if (FAILED(hr)) {
      *error = "swapchain Present failed (hr=0x" + HexOf(hr) + ")";
      return false;
    }
    framesPresented_++;
    // The editor window moves/resizes without notifying us, so re-assert the
    // behind-host position periodically to keep tracking the canvas hole.
    if ((framesPresented_ % 30) == 0) PositionBehind();
    return true;
  }

  // Overlay geometry arrives in preview-rect (CSS) pixels. The swapchain is
  // source-sized and DXGI stretches it to the child window, so scaling the
  // geometry by the same factor keeps handles a constant on-screen size —
  // this factor plays the role of Metal's contentsScale.
  void SetOverlay(const std::vector<OverlayVertex>& lines,
                  const std::vector<OverlayVertex>& points) {
    overlayLines_ = lines;
    overlayPoints_ = points;
  }

  // The swapchain matches the preview rect 1:1 now, so overlay geometry needs
  // no rescaling; this stays as the hook for a future DPI/backing-scale factor,
  // mirroring Metal's contentsScale.
  float overlayScale() const { return 1.0f; }
  uint32_t viewWidth() const { return swapWidth_; }
  uint32_t viewHeight() const { return swapHeight_; }

  bool attached() const { return attached_; }
  uint64_t framesPresented() const { return framesPresented_; }
  uint32_t width() const { return sourceWidth_; }
  uint32_t height() const { return sourceHeight_; }
  const Rect& rect() const { return rect_; }
  const std::string& sharedName() const { return sharedName_; }
  std::string hostId() const { return PtrId(host_); }
  std::string childId() const { return PtrId(child_); }
  bool childVisible() const { return child_ && IsWindowVisible(child_); }

 private:
  bool EnsureOverlayPipeline() {
    if (overlayVS_) return true;
    ID3DBlob* vsb = nullptr;
    ID3DBlob* psb = nullptr;
    ID3DBlob* err = nullptr;
    if (FAILED(D3DCompile(kOverlayHlsl, sizeof(kOverlayHlsl) - 1, nullptr, nullptr, nullptr,
                          "vs_main", "vs_4_0", 0, 0, &vsb, &err))) {
      SafeRelease(err);
      return false;
    }
    if (FAILED(D3DCompile(kOverlayHlsl, sizeof(kOverlayHlsl) - 1, nullptr, nullptr, nullptr,
                          "ps_main", "ps_4_0", 0, 0, &psb, &err))) {
      SafeRelease(err);
      SafeRelease(vsb);
      return false;
    }
    device_->CreateVertexShader(vsb->GetBufferPointer(), vsb->GetBufferSize(), nullptr, &overlayVS_);
    device_->CreatePixelShader(psb->GetBufferPointer(), psb->GetBufferSize(), nullptr, &overlayPS_);

    D3D11_INPUT_ELEMENT_DESC layout[] = {
      {"POSITION", 0, DXGI_FORMAT_R32G32_FLOAT,       0, 0,  D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT,       0, 8,  D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"COLOR",    0, DXGI_FORMAT_R32G32B32A32_FLOAT, 0, 16, D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"COLOR",    1, DXGI_FORMAT_R32G32B32A32_FLOAT, 0, 32, D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"TEXCOORD", 1, DXGI_FORMAT_R32G32B32A32_FLOAT, 0, 48, D3D11_INPUT_PER_VERTEX_DATA, 0},
    };
    device_->CreateInputLayout(layout, 5, vsb->GetBufferPointer(), vsb->GetBufferSize(), &overlayLayout_);
    SafeRelease(vsb);
    SafeRelease(psb);

    D3D11_BUFFER_DESC cb = {};
    cb.ByteWidth = 16;
    cb.Usage = D3D11_USAGE_DYNAMIC;
    cb.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    cb.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    device_->CreateBuffer(&cb, nullptr, &overlayCB_);

    D3D11_BLEND_DESC bd = {};
    bd.RenderTarget[0].BlendEnable = TRUE;
    bd.RenderTarget[0].SrcBlend = D3D11_BLEND_SRC_ALPHA;
    bd.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
    bd.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
    bd.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
    bd.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    device_->CreateBlendState(&bd, &overlayBlend_);
    return overlayVS_ && overlayPS_ && overlayLayout_;
  }

  bool UploadOverlay(const std::vector<OverlayVertex>& verts) {
    if (verts.empty()) return false;
    const UINT bytes = (UINT)(verts.size() * sizeof(OverlayVertex));
    if (bytes > overlayVBBytes_) {
      SafeRelease(overlayVB_);
      D3D11_BUFFER_DESC bd = {};
      bd.ByteWidth = bytes;
      bd.Usage = D3D11_USAGE_DYNAMIC;
      bd.BindFlags = D3D11_BIND_VERTEX_BUFFER;
      bd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
      if (FAILED(device_->CreateBuffer(&bd, nullptr, &overlayVB_))) return false;
      overlayVBBytes_ = bytes;
    }
    D3D11_MAPPED_SUBRESOURCE m;
    if (FAILED(context_->Map(overlayVB_, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) return false;
    memcpy(m.pData, verts.data(), bytes);
    context_->Unmap(overlayVB_, 0);
    return true;
  }

  void DrawOverlay(ID3D11RenderTargetView* rtv) {
    if (overlayLines_.empty() && overlayPoints_.empty()) return;
    if (!EnsureOverlayPipeline() || !rtv) return;

    context_->OMSetRenderTargets(1, &rtv, nullptr);

    // Overlay geometry is in preview-rect pixels and the swapchain now matches
    // that rect 1:1, so this is a plain pixel-space (y-down) -> NDC transform.
    D3D11_MAPPED_SUBRESOURCE m;
    if (SUCCEEDED(context_->Map(overlayCB_, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
      // App.svelte's presenterPoint() emits normalized 0..1 coordinates with the
      // y already flipped, matching the Metal presenter — so this is the same
      // (-1, 1, 2, 2) mapping Metal uses, NOT a pixel-space transform.
      float xf[4] = {-1.0f, 1.0f, 2.0f, 2.0f};
      memcpy(m.pData, xf, sizeof(xf));
      context_->Unmap(overlayCB_, 0);
    }

    const UINT stride = sizeof(OverlayVertex);
    const UINT offset = 0;
    const float blendFactor[4] = {0, 0, 0, 0};
    context_->IASetInputLayout(overlayLayout_);
    context_->VSSetShader(overlayVS_, nullptr, 0);
    context_->PSSetShader(overlayPS_, nullptr, 0);
    context_->VSSetConstantBuffers(0, 1, &overlayCB_);
    context_->OMSetBlendState(overlayBlend_, blendFactor, 0xffffffff);

    if (!overlayLines_.empty() && UploadOverlay(overlayLines_)) {
      context_->IASetVertexBuffers(0, 1, &overlayVB_, &stride, &offset);
      context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_LINELIST);
      context_->Draw((UINT)overlayLines_.size(), 0);
    }
    if (!overlayPoints_.empty() && UploadOverlay(overlayPoints_)) {
      context_->IASetVertexBuffers(0, 1, &overlayVB_, &stride, &offset);
      context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
      context_->Draw((UINT)overlayPoints_.size(), 0);
    }

  }

  static std::string PtrId(HWND h) {
    char buf[32];
    sprintf_s(buf, "%llu", (unsigned long long)(uintptr_t)h);
    return std::string(buf);
  }

  static std::string HexOf(HRESULT hr) {
    char buf[32];
    sprintf_s(buf, "%08lX", (unsigned long)hr);
    return std::string(buf);
  }

  bool CreateDevice(std::string* error) {
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    D3D_FEATURE_LEVEL obtained;
    HRESULT hr = D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags,
        levels, ARRAYSIZE(levels), D3D11_SDK_VERSION,
        &device_, &obtained, &context_);
    if (FAILED(hr)) {
      *error = "D3D11CreateDevice failed (hr=0x" + HexOf(hr) + ")";
      return false;
    }
    hr = device_->QueryInterface(__uuidof(ID3D11Device1), (void**)&device1_);
    if (FAILED(hr) || !device1_) {
      *error = "ID3D11Device1 is unavailable; OpenSharedResourceByName requires D3D11.1";
      return false;
    }
    return true;
  }

  bool OpenShared(const std::string& sharedName, std::string* error) {
    std::wstring wide = Widen(sharedName);
    HRESULT hr = device1_->OpenSharedResourceByName(
        wide.c_str(), DXGI_SHARED_RESOURCE_READ, __uuidof(ID3D11Texture2D), (void**)&shared_);
    if (FAILED(hr) || !shared_) {
      *error = "OpenSharedResourceByName failed for \"" + sharedName + "\" (hr=0x" + HexOf(hr) +
               "). The core must publish the output export on the same adapter.";
      return false;
    }
    D3D11_TEXTURE2D_DESC desc = {};
    shared_->GetDesc(&desc);
    sourceFormat_ = desc.Format;
    // A resource opened across the D3D12->D3D11 boundary is reliable as a copy
    // source but not as a shader resource, so mirror it into a texture we own
    // and sample that. This matches what the Metal presenter does: it samples a
    // texture it created from the IOSurface rather than the surface itself.
    SafeRelease(sampleSRV_);
    SafeRelease(sampleTex_);
    D3D11_TEXTURE2D_DESC td = {};
    td.Width = desc.Width;
    td.Height = desc.Height;
    td.MipLevels = 1;
    td.ArraySize = 1;
    // The export is srgb-encoded BGRA already; sampling through a _UNORM view
    // keeps it linear-in/linear-out instead of applying the curve twice.
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(device_->CreateTexture2D(&td, nullptr, &sampleTex_)) || !sampleTex_) {
      *error = "CreateTexture2D failed for the preview sampling copy";
      return false;
    }
    if (FAILED(device_->CreateShaderResourceView(sampleTex_, nullptr, &sampleSRV_)) || !sampleSRV_) {
      *error = "CreateShaderResourceView failed for the preview sampling copy";
      return false;
    }
    return true;
  }

  bool EnsureBlitPipeline() {
    if (blitVS_ && blitPS_ && sampler_) return true;
    ID3DBlob* vsb = nullptr;
    ID3DBlob* psb = nullptr;
    ID3DBlob* err = nullptr;
    if (FAILED(D3DCompile(kOverlayHlsl, sizeof(kOverlayHlsl) - 1, nullptr, nullptr, nullptr,
                          "vs_blit", "vs_4_0", 0, 0, &vsb, &err))) {
      SafeRelease(err);
      return false;
    }
    if (FAILED(D3DCompile(kOverlayHlsl, sizeof(kOverlayHlsl) - 1, nullptr, nullptr, nullptr,
                          "ps_blit", "ps_4_0", 0, 0, &psb, &err))) {
      SafeRelease(err);
      SafeRelease(vsb);
      return false;
    }
    device_->CreateVertexShader(vsb->GetBufferPointer(), vsb->GetBufferSize(), nullptr, &blitVS_);
    device_->CreatePixelShader(psb->GetBufferPointer(), psb->GetBufferSize(), nullptr, &blitPS_);
    SafeRelease(vsb);
    SafeRelease(psb);

    // The default rasterizer state culls back faces, and neither the fullscreen
    // blit triangle nor arbitrary overlay quads have a guaranteed winding —
    // a culled blit presents an empty back buffer that looks exactly like a
    // black composite.
    D3D11_RASTERIZER_DESC rd = {};
    rd.FillMode = D3D11_FILL_SOLID;
    rd.CullMode = D3D11_CULL_NONE;
    rd.DepthClipEnable = TRUE;
    device_->CreateRasterizerState(&rd, &rasterizer_);

    D3D11_SAMPLER_DESC sd = {};
    sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.MaxLOD = D3D11_FLOAT32_MAX;
    device_->CreateSamplerState(&sd, &sampler_);
    return blitVS_ && blitPS_ && sampler_ && rasterizer_;
  }

  bool EnsureSwapchain(std::string* error) {
    // Sized to the whole host client area — see PositionBehind().
    const uint32_t wantW = (std::max)(1u, hostClientW_);
    const uint32_t wantH = (std::max)(1u, hostClientH_);
    if (swapchain_ && wantW == swapWidth_ && wantH == swapHeight_) return true;
    if (swapchain_) {
      // Resize in place; recreating the swapchain on every layout change would
      // flash the child window.
      HRESULT hr = swapchain_->ResizeBuffers(0, wantW, wantH, DXGI_FORMAT_UNKNOWN, 0);
      if (SUCCEEDED(hr)) {
        swapWidth_ = wantW;
        swapHeight_ = wantH;
        return true;
      }
      SafeRelease(swapchain_);
    }
    swapWidth_ = wantW;
    swapHeight_ = wantH;
    return CreateSwapchain(error);
  }

  bool CreateSwapchain(std::string* error) {
    SafeRelease(swapchain_);
    IDXGIDevice* dxgiDevice = nullptr;
    if (FAILED(device_->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgiDevice)) || !dxgiDevice) {
      *error = "QueryInterface(IDXGIDevice) failed";
      return false;
    }
    IDXGIAdapter* adapter = nullptr;
    dxgiDevice->GetAdapter(&adapter);
    dxgiDevice->Release();
    if (!adapter) {
      *error = "IDXGIDevice::GetAdapter failed";
      return false;
    }
    IDXGIFactory2* factory = nullptr;
    adapter->GetParent(__uuidof(IDXGIFactory2), (void**)&factory);
    adapter->Release();
    if (!factory) {
      *error = "IDXGIFactory2 is unavailable";
      return false;
    }

    DXGI_SWAP_CHAIN_DESC1 desc = {};
    desc.Width = swapWidth_;
    desc.Height = swapHeight_;
    // Present in the non-sRGB view of the source family; the core already stores
    // srgb-encoded BGRA, so re-applying a gamma here would double-encode it.
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount = 2;
    desc.Scaling = DXGI_SCALING_STRETCH;
    desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
    desc.AlphaMode = DXGI_ALPHA_MODE_IGNORE;

    HRESULT hr = factory->CreateSwapChainForHwnd(device_, child_, &desc, nullptr, nullptr, &swapchain_);
    if (FAILED(hr) || !swapchain_) {
      // FLIP_SEQUENTIAL + STRETCH is unsupported on some older runtimes; fall
      // back to the bitblt model rather than losing the preview entirely.
      desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
      desc.BufferCount = 1;
      hr = factory->CreateSwapChainForHwnd(device_, child_, &desc, nullptr, nullptr, &swapchain_);
    }
    factory->Release();
    if (FAILED(hr) || !swapchain_) {
      *error = "CreateSwapChainForHwnd failed (hr=0x" + HexOf(hr) + ")";
      return false;
    }
    return true;
  }

  void ReleaseShared() {
    SafeRelease(sampleSRV_);
    SafeRelease(sampleTex_);
    SafeRelease(shared_);
    sharedName_.clear();
  }

  HWND host_ = nullptr;
  HWND child_ = nullptr;
  ID3D11Device* device_ = nullptr;
  ID3D11Device1* device1_ = nullptr;
  ID3D11DeviceContext* context_ = nullptr;
  IDXGISwapChain1* swapchain_ = nullptr;
  ID3D11Texture2D* shared_ = nullptr;
  DXGI_FORMAT sourceFormat_ = DXGI_FORMAT_B8G8R8A8_UNORM;
  std::string sharedName_;
  uint32_t sourceWidth_ = 0;
  uint32_t sourceHeight_ = 0;
  uint64_t framesPresented_ = 0;
  bool attached_ = false;
  Rect rect_;
  std::vector<OverlayVertex> overlayLines_;
  std::vector<OverlayVertex> overlayPoints_;
  ID3D11VertexShader* overlayVS_ = nullptr;
  ID3D11PixelShader* overlayPS_ = nullptr;
  ID3D11InputLayout* overlayLayout_ = nullptr;
  ID3D11Buffer* overlayVB_ = nullptr;
  ID3D11Buffer* overlayCB_ = nullptr;
  ID3D11BlendState* overlayBlend_ = nullptr;
  UINT overlayVBBytes_ = 0;
  ID3D11VertexShader* blitVS_ = nullptr;
  ID3D11PixelShader* blitPS_ = nullptr;
  ID3D11SamplerState* sampler_ = nullptr;
  ID3D11RasterizerState* rasterizer_ = nullptr;
  ID3D11Texture2D* sampleTex_ = nullptr;
  ID3D11ShaderResourceView* sampleSRV_ = nullptr;
  uint32_t hostClientW_ = 0;
  uint32_t hostClientH_ = 0;
  uint32_t swapWidth_ = 0;
  uint32_t swapHeight_ = 0;
};

PreviewSurface g_primary;
std::map<std::string, std::unique_ptr<PreviewSurface>> g_monitors;
std::string g_lastError;

HWND HwndFromBuffer(const Napi::Value& value) {
  if (!value.IsBuffer()) return nullptr;
  Napi::Buffer<uint8_t> buf = value.As<Napi::Buffer<uint8_t>>();
  if (buf.Length() < sizeof(HWND)) return nullptr;
  HWND hwnd = nullptr;
  memcpy(&hwnd, buf.Data(), sizeof(HWND));
  return hwnd;
}

Napi::Object StatusObject(Napi::Env env, const PreviewSurface& surface) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("attached", Napi::Boolean::New(env, surface.attached()));
  out.Set("platform", Napi::String::New(env, "win32"));
  out.Set("transport", Napi::String::New(env, "dxgi"));
  out.Set("mode", Napi::String::New(env, surface.attached() ? "shared-texture-import-blit" : "unavailable"));
  out.Set("presentation", Napi::String::New(env, surface.attached() ? "child-hwnd-swapchain" : "unavailable"));
  out.Set("framesPresented", Napi::Number::New(env, (double)surface.framesPresented()));
  out.Set("width", Napi::Number::New(env, surface.width()));
  out.Set("height", Napi::Number::New(env, surface.height()));
  out.Set("x", Napi::Number::New(env, surface.rect().x));
  out.Set("y", Napi::Number::New(env, surface.rect().y));
  out.Set("pumpActive", Napi::Boolean::New(env, surface.attached()));
  out.Set("lastSurfaceID", Napi::String::New(env, surface.sharedName()));
  out.Set("hostHwnd", Napi::String::New(env, surface.hostId()));
  out.Set("childHwnd", Napi::String::New(env, surface.childId()));
  out.Set("childVisible", Napi::Boolean::New(env, surface.childVisible()));
  out.Set("rectWidth", Napi::Number::New(env, surface.rect().width));
  out.Set("rectHeight", Napi::Number::New(env, surface.rect().height));
  if (!g_lastError.empty()) out.Set("error", Napi::String::New(env, g_lastError));
  return out;
}

Napi::Value Attach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND host = nullptr;
  Rect rect;
  for (size_t i = 0; i < info.Length(); i++) {
    if (info[i].IsBuffer()) {
      if (!host) host = HwndFromBuffer(info[i]);
    } else if (info[i].IsObject()) {
      Napi::Object candidate = info[i].As<Napi::Object>();
      if (candidate.Has("width") && candidate.Has("height")) rect = RectFromObject(candidate);
    }
  }
  std::string error;
  if (!host) {
    g_lastError = "main window native handle was not a usable HWND buffer";
  } else if (!g_primary.Attach(host, rect, &error)) {
    g_lastError = error;
  } else {
    g_lastError.clear();
  }
  return StatusObject(env, g_primary);
}

// main.js calls this both as update(rect) and as update(handle, rect). A Node
// Buffer is also an Object, so the argument must be chosen by shape rather than
// by position — taking info[0] blindly parses the HWND buffer as a rect and
// yields a 1x1 window at 0,0 that presents perfectly and shows nothing.
Napi::Value Update(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  for (size_t i = 0; i < info.Length(); i++) {
    if (!info[i].IsObject() || info[i].IsBuffer()) continue;
    Napi::Object candidate = info[i].As<Napi::Object>();
    if (!candidate.Has("width") || !candidate.Has("height")) continue;
    g_primary.Update(RectFromObject(candidate));
    break;
  }
  return StatusObject(env, g_primary);
}

Napi::Value Detach(const Napi::CallbackInfo& info) {
  g_primary.Detach();
  return Napi::Boolean::New(info.Env(), true);
}

// present(sharedName, width, height, flip)
Napi::Value PresentSharedTexture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3) return Napi::Boolean::New(env, false);
  std::string name = info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : std::string();
  uint32_t width = info[1].IsNumber() ? info[1].As<Napi::Number>().Uint32Value() : 0;
  uint32_t height = info[2].IsNumber() ? info[2].As<Napi::Number>().Uint32Value() : 0;
  std::string error;
  if (!g_primary.Present(name, width, height, &error)) {
    g_lastError = error;
    return Napi::Boolean::New(env, false);
  }
  g_lastError.clear();
  return Napi::Boolean::New(env, true);
}

Napi::Value Status(const Napi::CallbackInfo& info) {
  return StatusObject(info.Env(), g_primary);
}

Napi::Value StopPump(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

// Colour and size constants mirror native_preview_addon.mm exactly so the
// editor chrome is identical on both platforms.
// Centre is in normalized 0..1 space; the handle size stays in pixels (the
// shader does its shape maths in pixels, as Metal's point sprites did), so the
// quad's half-extent has to be converted into normalized units here.
void PushQuad(std::vector<OverlayVertex>& out, float cx, float cy,
              const float fill[4], const float border[4],
              float sizePx, float borderPx, float kind, float scale,
              float viewW, float viewH) {
  const float halfX = (sizePx * 0.5f) / (std::max)(1.0f, viewW);
  const float halfY = (sizePx * 0.5f) / (std::max)(1.0f, viewH);
  const float ux[6] = {0, 1, 0, 1, 1, 0};
  const float uy[6] = {0, 0, 1, 0, 1, 1};
  for (int i = 0; i < 6; i++) {
    OverlayVertex v = {};
    v.x = cx + (ux[i] - 0.5f) * 2.0f * halfX;
    v.y = cy + (uy[i] - 0.5f) * 2.0f * halfY;
    v.u = ux[i];
    v.v = uy[i];
    memcpy(v.color, fill, sizeof(float) * 4);
    memcpy(v.border, border, sizeof(float) * 4);
    v.style[0] = sizePx; v.style[1] = borderPx; v.style[2] = kind; v.style[3] = scale;
    out.push_back(v);
  }
}

bool ReadPoint(const Napi::Object& obj, float* x, float* y) {
  if (!obj.Has("x") || !obj.Has("y")) return false;
  Napi::Value vx = obj.Get("x");
  Napi::Value vy = obj.Get("y");
  if (!vx.IsNumber() || !vy.IsNumber()) return false;
  *x = vx.As<Napi::Number>().FloatValue();
  *y = vy.As<Napi::Number>().FloatValue();
  return true;
}

Napi::Value SetOverlay(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const float lineColor[4] = {0.72f, 0.43f, 1.0f, 0.9f};
  const float meshColor[4] = {1.0f, 0.0f, 0.67f, 1.0f};
  const float white[4] = {1.0f, 1.0f, 1.0f, 1.0f};
  const float darkFill[4] = {0.055f, 0.065f, 0.085f, 0.96f};
  const float lilac[4] = {0.73f, 0.53f, 0.99f, 1.0f};
  const float cyan[4] = {0.0f, 0.67f, 1.0f, 1.0f};
  const float scaleCyan[4] = {0.0f, 0.8f, 1.0f, 1.0f};

  std::vector<OverlayVertex> lines;
  std::vector<OverlayVertex> points;
  const float s = g_primary.overlayScale();
  const float viewW = (float)g_primary.viewWidth();
  const float viewH = (float)g_primary.viewHeight();

  Napi::Object overlay;
  for (size_t i = 0; i < info.Length(); i++) {
    if (!info[i].IsObject() || info[i].IsBuffer()) continue;
    Napi::Object candidate = info[i].As<Napi::Object>();
    if (candidate.Has("lines") || candidate.Has("points") || candidate.Has("handles")) {
      overlay = candidate;
      break;
    }
  }
  if (overlay.IsEmpty()) {
    g_primary.SetOverlay(lines, points);
    return StatusObject(env, g_primary);
  }

  if (overlay.Has("lines") && overlay.Get("lines").IsArray()) {
    Napi::Array arr = overlay.Get("lines").As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); i++) {
      Napi::Value item = arr.Get(i);
      float px, py;
      if (!item.IsObject() || !ReadPoint(item.As<Napi::Object>(), &px, &py)) continue;
      OverlayVertex v = {};
      v.x = px; v.y = py; v.u = 0.5f; v.v = 0.5f;
      memcpy(v.color, lineColor, sizeof(lineColor));
      memcpy(v.border, lineColor, sizeof(lineColor));
      v.style[0] = 1.0f; v.style[1] = 0.0f; v.style[2] = -1.0f; v.style[3] = s;
      lines.push_back(v);
    }
  }

  if (overlay.Has("points") && overlay.Get("points").IsArray()) {
    Napi::Array arr = overlay.Get("points").As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); i++) {
      Napi::Value item = arr.Get(i);
      float px, py;
      if (!item.IsObject() || !ReadPoint(item.As<Napi::Object>(), &px, &py)) continue;
      PushQuad(points, px, py, meshColor, white, 12.0f * s, 2.0f, 0.0f, s, viewW, viewH);
    }
  }

  if (overlay.Has("handles") && overlay.Get("handles").IsArray()) {
    Napi::Array arr = overlay.Get("handles").As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); i++) {
      Napi::Value item = arr.Get(i);
      float px, py;
      if (!item.IsObject()) continue;
      Napi::Object h = item.As<Napi::Object>();
      if (!ReadPoint(h, &px, &py)) continue;
      std::string kind = h.Has("kind") && h.Get("kind").IsString()
                             ? h.Get("kind").As<Napi::String>().Utf8Value()
                             : std::string();
      const float* fill = darkFill;
      const float* border = white;
      float size = 20.0f, shape = 1.0f;
      if (kind == "edge-horizontal") { fill = cyan; size = 40.0f; shape = 2.0f; }
      else if (kind == "edge-vertical") { fill = cyan; size = 40.0f; shape = 3.0f; }
      else if (kind == "move") { border = lilac; size = 36.0f; shape = 4.0f; }
      else if (kind == "rotate") { border = meshColor; size = 28.0f; shape = 5.0f; }
      else if (kind == "scale") { border = scaleCyan; size = 28.0f; shape = 6.0f; }
      else { fill = lilac; }
      PushQuad(points, px, py, fill, border, size * s, 2.0f, shape, s, viewW, viewH);
    }
  }

  g_primary.SetOverlay(lines, points);
  return StatusObject(env, g_primary);
}

Napi::Value StabilizeHost(const Napi::CallbackInfo& info) {
  // AppKit-specific on macOS; nothing to stabilise for a child HWND.
  return Napi::Boolean::New(info.Env(), true);
}

// monitorAttach(name, hwndBuffer, rect) — deck monitors and native slice output.
Napi::Value MonitorAttach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString()) return Napi::Boolean::New(env, false);
  std::string name = info[0].As<Napi::String>().Utf8Value();
  HWND host = HwndFromBuffer(info[1]);
  Rect rect;
  if (info.Length() > 2 && info[2].IsObject()) rect = RectFromObject(info[2].As<Napi::Object>());
  if (!host) {
    g_lastError = "monitor host handle was not a usable HWND buffer";
    return Napi::Boolean::New(env, false);
  }
  auto it = g_monitors.find(name);
  if (it == g_monitors.end()) {
    g_monitors[name] = std::make_unique<PreviewSurface>();
    it = g_monitors.find(name);
  }
  std::string error;
  if (!it->second->Attach(host, rect, &error)) {
    g_lastError = error;
    return Napi::Boolean::New(env, false);
  }
  g_lastError.clear();
  return Napi::Boolean::New(env, true);
}

Napi::Value MonitorSetSharedTexture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsString()) return Napi::Boolean::New(env, false);
  std::string name = info[0].As<Napi::String>().Utf8Value();
  auto it = g_monitors.find(name);
  if (it == g_monitors.end()) return Napi::Boolean::New(env, false);
  std::string shared = info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : std::string();
  uint32_t width = info[2].IsNumber() ? info[2].As<Napi::Number>().Uint32Value() : 0;
  uint32_t height = info[3].IsNumber() ? info[3].As<Napi::Number>().Uint32Value() : 0;
  std::string error;
  if (!it->second->Present(shared, width, height, &error)) {
    g_lastError = error;
    return Napi::Boolean::New(env, false);
  }
  g_lastError.clear();
  return Napi::Boolean::New(env, true);
}

Napi::Value MonitorDetach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return Napi::Boolean::New(env, false);
  std::string name = info[0].As<Napi::String>().Utf8Value();
  auto it = g_monitors.find(name);
  if (it == g_monitors.end()) return Napi::Boolean::New(env, false);
  it->second->Detach();
  g_monitors.erase(it);
  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, Attach));
  exports.Set("update", Napi::Function::New(env, Update));
  exports.Set("detach", Napi::Function::New(env, Detach));
  exports.Set("presentSharedTexture", Napi::Function::New(env, PresentSharedTexture));
  exports.Set("status", Napi::Function::New(env, Status));
  exports.Set("stopPump", Napi::Function::New(env, StopPump));
  exports.Set("setOverlay", Napi::Function::New(env, SetOverlay));
  exports.Set("stabilizeHost", Napi::Function::New(env, StabilizeHost));
  exports.Set("monitorAttach", Napi::Function::New(env, MonitorAttach));
  exports.Set("monitorSetSharedTexture", Napi::Function::New(env, MonitorSetSharedTexture));
  exports.Set("monitorDetach", Napi::Function::New(env, MonitorDetach));
  exports.Set("platform", Napi::String::New(env, "win32"));
  return exports;
}

}  // namespace

NODE_API_MODULE(dxgi_preview_addon, Init)
