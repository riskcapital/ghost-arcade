// Linux embedded native editor preview presenter — X11/EGL twin of
// native_preview_addon.mm (macOS, IOSurface+Metal) and dxgi_preview_addon.cpp
// (Windows, DXGI+D3D11). Milestone 3 of the Linux zero-copy preview work.
//
// The core publishes its composite as a real Vulkan dma-buf fd (see
// create_output_export_target's Linux branch in native-renderer/src/main.rs)
// handed to Electron main over the SCM_RIGHTS side channel
// (linux_fd_channel_addon.cpp / native-renderer-broker.js). This addon
// imports that fd as an EGLImage (EGL_EXT_image_dma_buf_import) and blits it
// with a plain textured-quad GLES2 shader into a child X11 window parented
// under the Electron window's native handle — the X11 analog of the child
// HWND / CALayer approach the other two platforms use.
//
// Scope note: targets X11 (including XWayland) specifically. Electron's
// getNativeWindowHandle() on Linux returns an X11 Window XID — meaningful
// only when running under the x11 ozone platform. Native Wayland windowing
// (wl_subsurface) is a separate, not-yet-attempted follow-up.

#include <napi.h>

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
#include <X11/Xlib.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <unistd.h>

namespace {

// DRM_FORMAT_ARGB8888 ('A','R','2','4'), little-endian [31:0] A:R:G:B —
// byte order B,G,R,A in memory, matching Vulkan's B8G8R8A8_UNORM exactly.
// Inlined rather than pulling in libdrm for one constant.
constexpr uint32_t kDrmFormatArgb8888 =
    (uint32_t)'A' | ((uint32_t)'R' << 8) | ((uint32_t)'2' << 16) | ((uint32_t)'4' << 24);

struct Rect {
  int x = 0;
  int y = 0;
  int width = 1;
  int height = 1;
};

Rect RectFromObject(const Napi::Object& obj) {
  Rect rect;
  auto readInt = [&](const char* key, int fallback) -> int {
    if (!obj.Has(key)) return fallback;
    Napi::Value v = obj.Get(key);
    if (!v.IsNumber()) return fallback;
    return (int)(v.As<Napi::Number>().DoubleValue() + 0.5);
  };
  rect.x = readInt("x", 0);
  rect.y = readInt("y", 0);
  rect.width = readInt("width", 1);
  rect.height = readInt("height", 1);
  if (rect.width < 1) rect.width = 1;
  if (rect.height < 1) rect.height = 1;
  return rect;
}

// Electron's getNativeWindowHandle() docs promise "Window (unsigned long)"
// on Linux, but X11's Window is a 32-bit resource ID on the wire (Xlib's
// `unsigned long` typedef is a historical/portability artifact, not the
// actual value width) — Electron returns a 4-byte buffer in practice, not
// sizeof(unsigned long) (8 on x86_64). Accept either.
Window WindowFromBuffer(const Napi::Value& value) {
  if (!value.IsBuffer()) return 0;
  Napi::Buffer<uint8_t> buf = value.As<Napi::Buffer<uint8_t>>();
  if (buf.Length() >= sizeof(unsigned long)) {
    unsigned long xid = 0;
    memcpy(&xid, buf.Data(), sizeof(unsigned long));
    return (Window)xid;
  }
  if (buf.Length() >= sizeof(uint32_t)) {
    uint32_t xid = 0;
    memcpy(&xid, buf.Data(), sizeof(uint32_t));
    return (Window)xid;
  }
  return 0;
}

GLuint CompileShader(GLenum type, const char* source) {
  GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint ok = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    glDeleteShader(shader);
    return 0;
  }
  return shader;
}

const char kVertexShaderSrc[] =
    "attribute vec2 aPos;\n"
    "attribute vec2 aUv;\n"
    "varying vec2 vUv;\n"
    "void main() {\n"
    "  vUv = aUv;\n"
    "  gl_Position = vec4(aPos, 0.0, 1.0);\n"
    "}\n";

// Fullscreen quad: NDC position (x,y) + UV. Flipped vertically (V=0 at
// top) since the dma-buf's row 0 is the composite's top row but GL texture
// V=0 is conventionally the bottom in NDC-mapped sampling here.
const float kQuadVertices[] = {
    // x,    y,     u,   v
    -1.0f, -1.0f,  0.0f, 1.0f,
     1.0f, -1.0f,  1.0f, 1.0f,
    -1.0f,  1.0f,  0.0f, 0.0f,
     1.0f,  1.0f,  1.0f, 0.0f,
};

class PreviewSurface {
 public:
  bool Attach(Window host, const Rect& rect, std::string* error) {
    Detach();

    display_ = XOpenDisplay(nullptr);
    if (!display_) {
      *error = "XOpenDisplay failed";
      return false;
    }

    int screen = DefaultScreen(display_);
    child_ = XCreateSimpleWindow(display_, host, rect.x, rect.y, rect.width, rect.height, 0,
                                  BlackPixel(display_, screen), BlackPixel(display_, screen));
    if (!child_) {
      *error = "XCreateSimpleWindow failed";
      Detach();
      return false;
    }
    XMapWindow(display_, child_);
    XSync(display_, False);

    eglDisplay_ = eglGetDisplay((EGLNativeDisplayType)display_);
    if (eglDisplay_ == EGL_NO_DISPLAY) {
      *error = "eglGetDisplay failed";
      Detach();
      return false;
    }
    EGLint major = 0, minor = 0;
    if (!eglInitialize(eglDisplay_, &major, &minor)) {
      *error = "eglInitialize failed";
      Detach();
      return false;
    }
    eglBindAPI(EGL_OPENGL_ES_API);

    const EGLint configAttribs[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE,
    };
    EGLint numConfigs = 0;
    EGLConfig config;
    if (!eglChooseConfig(eglDisplay_, configAttribs, &config, 1, &numConfigs) || numConfigs < 1) {
      *error = "eglChooseConfig failed";
      Detach();
      return false;
    }

    eglSurface_ = eglCreateWindowSurface(eglDisplay_, config, (EGLNativeWindowType)child_, nullptr);
    if (eglSurface_ == EGL_NO_SURFACE) {
      *error = "eglCreateWindowSurface failed";
      Detach();
      return false;
    }

    const EGLint contextAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    eglContext_ = eglCreateContext(eglDisplay_, config, EGL_NO_CONTEXT, contextAttribs);
    if (eglContext_ == EGL_NO_CONTEXT) {
      *error = "eglCreateContext failed";
      Detach();
      return false;
    }

    if (!eglMakeCurrent(eglDisplay_, eglSurface_, eglSurface_, eglContext_)) {
      *error = "eglMakeCurrent failed";
      Detach();
      return false;
    }

    eglCreateImageKHR_ = (PFNEGLCREATEIMAGEKHRPROC)eglGetProcAddress("eglCreateImageKHR");
    eglDestroyImageKHR_ = (PFNEGLDESTROYIMAGEKHRPROC)eglGetProcAddress("eglDestroyImageKHR");
    glEGLImageTargetTexture2DOES_ = (PFNGLEGLIMAGETARGETTEXTURE2DOESPROC)eglGetProcAddress(
        "glEGLImageTargetTexture2DOES");
    if (!eglCreateImageKHR_ || !eglDestroyImageKHR_ || !glEGLImageTargetTexture2DOES_) {
      *error = "EGL_EXT_image_dma_buf_import / GL_OES_EGL_image not available";
      Detach();
      return false;
    }

    if (!BuildProgram(error)) {
      Detach();
      return false;
    }

    rect_ = rect;
    attached_ = true;
    error->clear();
    return true;
  }

  void Update(const Rect& rect) {
    if (!attached_) return;
    rect_ = rect;
    XMoveResizeWindow(display_, child_, rect.x, rect.y, rect.width, rect.height);
    XSync(display_, False);
  }

  bool ImportDmaBuf(int fd, uint32_t width, uint32_t height, uint32_t stride, uint32_t offset,
                     std::string* error) {
    if (!attached_) {
      *error = "not attached";
      return false;
    }

    const EGLint imageAttribs[] = {
        EGL_WIDTH, (EGLint)width,
        EGL_HEIGHT, (EGLint)height,
        EGL_LINUX_DRM_FOURCC_EXT, (EGLint)kDrmFormatArgb8888,
        EGL_DMA_BUF_PLANE0_FD_EXT, fd,
        EGL_DMA_BUF_PLANE0_OFFSET_EXT, (EGLint)offset,
        EGL_DMA_BUF_PLANE0_PITCH_EXT, (EGLint)stride,
        EGL_NONE,
    };
    EGLImageKHR image = eglCreateImageKHR_(eglDisplay_, EGL_NO_CONTEXT, EGL_LINUX_DMA_BUF_EXT,
                                            (EGLClientBuffer)nullptr, imageAttribs);
    // The dma-buf fd is only needed for the duration of this call — the
    // driver either dup's it or maps the underlying memory internally.
    // Close our copy either way, matching the SCM_RIGHTS receive contract.
    close(fd);
    if (image == EGL_NO_IMAGE_KHR) {
      *error = "eglCreateImageKHR failed";
      return false;
    }

    if (eglImage_ != EGL_NO_IMAGE_KHR) {
      eglDestroyImageKHR_(eglDisplay_, eglImage_);
    }
    eglImage_ = image;

    if (texture_ == 0) glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glEGLImageTargetTexture2DOES_(GL_TEXTURE_2D, eglImage_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    textureWidth_ = width;
    textureHeight_ = height;
    error->clear();
    return true;
  }

  bool Present(std::string* error) {
    if (!attached_ || texture_ == 0) {
      *error = "nothing imported yet";
      return false;
    }
    eglMakeCurrent(eglDisplay_, eglSurface_, eglSurface_, eglContext_);
    glViewport(0, 0, rect_.width, rect_.height);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    glUseProgram(program_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glUniform1i(uTexLoc_, 0);
    glEnableVertexAttribArray(aPosLoc_);
    glEnableVertexAttribArray(aUvLoc_);
    glVertexAttribPointer(aPosLoc_, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), kQuadVertices);
    glVertexAttribPointer(aUvLoc_, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), kQuadVertices + 2);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

    eglSwapBuffers(eglDisplay_, eglSurface_);
    framesPresented_++;
    error->clear();
    return true;
  }

  void Detach() {
    if (eglDisplay_ != EGL_NO_DISPLAY) {
      eglMakeCurrent(eglDisplay_, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
      if (eglImage_ != EGL_NO_IMAGE_KHR && eglDestroyImageKHR_) {
        eglDestroyImageKHR_(eglDisplay_, eglImage_);
      }
      if (texture_) glDeleteTextures(1, &texture_);
      if (program_) glDeleteProgram(program_);
      if (eglContext_ != EGL_NO_CONTEXT) eglDestroyContext(eglDisplay_, eglContext_);
      if (eglSurface_ != EGL_NO_SURFACE) eglDestroySurface(eglDisplay_, eglSurface_);
      eglTerminate(eglDisplay_);
    }
    if (display_ && child_) {
      XDestroyWindow(display_, child_);
    }
    if (display_) {
      XCloseDisplay(display_);
    }
    display_ = nullptr;
    child_ = 0;
    eglDisplay_ = EGL_NO_DISPLAY;
    eglSurface_ = EGL_NO_SURFACE;
    eglContext_ = EGL_NO_CONTEXT;
    eglImage_ = EGL_NO_IMAGE_KHR;
    texture_ = 0;
    program_ = 0;
    attached_ = false;
    framesPresented_ = 0;
    textureWidth_ = 0;
    textureHeight_ = 0;
  }

  bool attached() const { return attached_; }
  uint64_t framesPresented() const { return framesPresented_; }
  const Rect& rect() const { return rect_; }
  uint32_t textureWidth() const { return textureWidth_; }
  uint32_t textureHeight() const { return textureHeight_; }

 private:
  bool BuildProgram(std::string* error) {
    GLuint vs = CompileShader(GL_VERTEX_SHADER, kVertexShaderSrc);
    GLuint fs = CompileShader(GL_FRAGMENT_SHADER, kSimpleFragmentShaderSrc);
    if (!vs || !fs) {
      *error = "shader compile failed";
      return false;
    }
    program_ = glCreateProgram();
    glAttachShader(program_, vs);
    glAttachShader(program_, fs);
    glLinkProgram(program_);
    glDeleteShader(vs);
    glDeleteShader(fs);
    GLint ok = 0;
    glGetProgramiv(program_, GL_LINK_STATUS, &ok);
    if (!ok) {
      *error = "shader link failed";
      return false;
    }
    aPosLoc_ = glGetAttribLocation(program_, "aPos");
    aUvLoc_ = glGetAttribLocation(program_, "aUv");
    uTexLoc_ = glGetUniformLocation(program_, "uTex");
    return true;
  }

  static constexpr char kSimpleFragmentShaderSrc[] =
      "precision mediump float;\n"
      "varying vec2 vUv;\n"
      "uniform sampler2D uTex;\n"
      "void main() { gl_FragColor = texture2D(uTex, vUv); }\n";

  Display* display_ = nullptr;
  Window child_ = 0;
  EGLDisplay eglDisplay_ = EGL_NO_DISPLAY;
  EGLSurface eglSurface_ = EGL_NO_SURFACE;
  EGLContext eglContext_ = EGL_NO_CONTEXT;
  EGLImageKHR eglImage_ = EGL_NO_IMAGE_KHR;
  PFNEGLCREATEIMAGEKHRPROC eglCreateImageKHR_ = nullptr;
  PFNEGLDESTROYIMAGEKHRPROC eglDestroyImageKHR_ = nullptr;
  PFNGLEGLIMAGETARGETTEXTURE2DOESPROC glEGLImageTargetTexture2DOES_ = nullptr;
  GLuint texture_ = 0;
  GLuint program_ = 0;
  GLint aPosLoc_ = -1;
  GLint aUvLoc_ = -1;
  GLint uTexLoc_ = -1;
  Rect rect_;
  bool attached_ = false;
  uint64_t framesPresented_ = 0;
  uint32_t textureWidth_ = 0;
  uint32_t textureHeight_ = 0;
};

constexpr char PreviewSurface::kSimpleFragmentShaderSrc[];

PreviewSurface g_primary;
std::string g_lastError;

Napi::Object StatusObject(Napi::Env env) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("attached", Napi::Boolean::New(env, g_primary.attached()));
  out.Set("platform", Napi::String::New(env, "linux"));
  out.Set("transport", Napi::String::New(env, "dma-buf"));
  out.Set("mode", Napi::String::New(env, g_primary.attached() ? "shared-texture-import-blit" : "unavailable"));
  out.Set("presentation", Napi::String::New(env, g_primary.attached() ? "child-x11-window-egl" : "unavailable"));
  out.Set("framesPresented", Napi::Number::New(env, (double)g_primary.framesPresented()));
  out.Set("width", Napi::Number::New(env, g_primary.textureWidth()));
  out.Set("height", Napi::Number::New(env, g_primary.textureHeight()));
  out.Set("x", Napi::Number::New(env, g_primary.rect().x));
  out.Set("y", Napi::Number::New(env, g_primary.rect().y));
  out.Set("rectWidth", Napi::Number::New(env, g_primary.rect().width));
  out.Set("rectHeight", Napi::Number::New(env, g_primary.rect().height));
  if (!g_lastError.empty()) out.Set("error", Napi::String::New(env, g_lastError));
  return out;
}

Napi::Value Attach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Window host = 0;
  Rect rect;
  for (size_t i = 0; i < info.Length(); i++) {
    if (info[i].IsBuffer()) {
      if (!host) host = WindowFromBuffer(info[i]);
    } else if (info[i].IsObject()) {
      Napi::Object candidate = info[i].As<Napi::Object>();
      if (candidate.Has("width") && candidate.Has("height")) rect = RectFromObject(candidate);
    }
  }
  std::string error;
  if (!host) {
    g_lastError = "main window native handle was not a usable X11 Window buffer";
  } else if (!g_primary.Attach(host, rect, &error)) {
    g_lastError = error;
  } else {
    g_lastError.clear();
  }
  return StatusObject(env);
}

Napi::Value Update(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  for (size_t i = 0; i < info.Length(); i++) {
    if (!info[i].IsObject() || info[i].IsBuffer()) continue;
    Napi::Object candidate = info[i].As<Napi::Object>();
    if (!candidate.Has("width") || !candidate.Has("height")) continue;
    g_primary.Update(RectFromObject(candidate));
    break;
  }
  return StatusObject(env);
}

Napi::Value Detach(const Napi::CallbackInfo& info) {
  g_primary.Detach();
  return Napi::Boolean::New(info.Env(), true);
}

// importDmaBuf(fd, width, height, stride, offset)
Napi::Value ImportDmaBuf(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5) return Napi::Boolean::New(env, false);
  int fd = info[0].As<Napi::Number>().Int32Value();
  uint32_t width = info[1].As<Napi::Number>().Uint32Value();
  uint32_t height = info[2].As<Napi::Number>().Uint32Value();
  uint32_t stride = info[3].As<Napi::Number>().Uint32Value();
  uint32_t offset = info[4].As<Napi::Number>().Uint32Value();
  std::string error;
  if (!g_primary.ImportDmaBuf(fd, width, height, stride, offset, &error)) {
    g_lastError = error;
    return Napi::Boolean::New(env, false);
  }
  g_lastError.clear();
  return Napi::Boolean::New(env, true);
}

Napi::Value Present(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string error;
  if (!g_primary.Present(&error)) {
    g_lastError = error;
    return Napi::Boolean::New(env, false);
  }
  g_lastError.clear();
  return Napi::Boolean::New(env, true);
}

// Named GetStatus, not Status — X11/Xlib.h defines a `Status` macro.
Napi::Value GetStatus(const Napi::CallbackInfo& info) {
  return StatusObject(info.Env());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, Attach));
  exports.Set("update", Napi::Function::New(env, Update));
  exports.Set("detach", Napi::Function::New(env, Detach));
  exports.Set("importDmaBuf", Napi::Function::New(env, ImportDmaBuf));
  exports.Set("present", Napi::Function::New(env, Present));
  exports.Set("status", Napi::Function::New(env, GetStatus));
  exports.Set("platform", Napi::String::New(env, "linux"));
  return exports;
}

}  // namespace

NODE_API_MODULE(linux_preview_addon, Init)
