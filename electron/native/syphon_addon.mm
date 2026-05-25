/**
 * Syphon Native Addon for macOS — Syphon-native rewrite.
 *
 * Design notes:
 * - Does NOT try to mimic the SpoutDX (Windows) addon. main.js dispatches
 *   platform-specifically. Class names here are SyphonOutput / SyphonReceiver.
 * - Uses the legacy (compat) NSOpenGL profile. Core 3.2 removes immediate-mode
 *   helpers (glBegin/glEnd, glTexCoord) that we rely on for the blit pass, and
 *   disables glGetTexImage which samples need on IOSurface-backed textures.
 * - The receiver uses the canonical Syphon pattern from SimpleClient: render
 *   the IOSurface-backed GL_TEXTURE_RECTANGLE_EXT into an owned GL_TEXTURE_2D
 *   via a textured quad, THEN glReadPixels. Reading directly from the rect
 *   texture returns zeros on Intel Iris drivers — IOSurface shared memory
 *   hasn't been synced into a form readPixels can fetch.
 * - The sender exposes both sendImage (CPU-uploaded pixels, compatibility
 *   fallback) and sendTexture / publishIOSurface (zero-copy: wraps an
 *   IOSurfaceID from the Electron OSR paint event into a rectangle texture
 *   via CGLTexImageIOSurface2D, then publishFrameTexture). sendTexture is
 *   the primary path — sendImage is only used when OSR fails to start or
 *   the main-process watchdog drops zero-copy after 3s of no frames.
 */

#define GL_SILENCE_DEPRECATION 1
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <IOSurface/IOSurface.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl.h>
#import <OpenGL/glext.h>
#import <OpenGL/CGLIOSurface.h>
#import <Syphon/Syphon.h>
#include <napi.h>
#include <vector>
#include <string>
#include <mutex>

// ============================================================
// Shared context helpers
// ============================================================

static NSOpenGLContext* CreateLegacyContext() {
  NSOpenGLPixelFormatAttribute attrs[] = {
    NSOpenGLPFAAccelerated,
    NSOpenGLPFAColorSize, 32,
    NSOpenGLPFADepthSize, 0,
    0
  };
  NSOpenGLPixelFormat* fmt = [[NSOpenGLPixelFormat alloc] initWithAttributes:attrs];
  if (!fmt) return nil;
  return [[NSOpenGLContext alloc] initWithFormat:fmt shareContext:nil];
}

// ============================================================
// SyphonOutput — Sender
// ============================================================

class SyphonOutput : public Napi::ObjectWrap<SyphonOutput> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "SyphonOutput", {
      InstanceMethod("setSenderName", &SyphonOutput::SetSenderName),
      InstanceMethod("sendImage", &SyphonOutput::SendImage),
      InstanceMethod("sendTexture", &SyphonOutput::SendTexture),
      InstanceMethod("publishIOSurface", &SyphonOutput::PublishIOSurface),
      InstanceMethod("release", &SyphonOutput::Release),
      InstanceMethod("isInitialized", &SyphonOutput::IsInitialized),
      InstanceMethod("getSenderName", &SyphonOutput::GetSenderName),
      InstanceMethod("getWidth", &SyphonOutput::GetWidth),
      InstanceMethod("getHeight", &SyphonOutput::GetHeight),
      InstanceMethod("getAdapterIndex", &SyphonOutput::GetAdapterIndex),
    });
    exports.Set("SyphonOutput", func);
    return exports;
  }

  SyphonOutput(const Napi::CallbackInfo& info) : Napi::ObjectWrap<SyphonOutput>(info) {}

  ~SyphonOutput() { cleanup(); }

private:
  SyphonServer* server_ = nil;
  NSOpenGLContext* context_ = nil;
  std::string senderName_;

  // CPU-upload texture (used by sendImage)
  GLuint uploadTex_ = 0;

  // IOSurface-wrap rectangle texture (used by publishIOSurface)
  GLuint ioSurfaceTex_ = 0;
  IOSurfaceID lastIOSurfaceID_ = 0;

  int width_ = 0;
  int height_ = 0;
  std::mutex mutex_;

  void cleanup() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (context_) {
      [context_ makeCurrentContext];
      if (uploadTex_) { glDeleteTextures(1, &uploadTex_); uploadTex_ = 0; }
      if (ioSurfaceTex_) { glDeleteTextures(1, &ioSurfaceTex_); ioSurfaceTex_ = 0; }
    }
    if (server_) { [server_ stop]; server_ = nil; }
    context_ = nil;
    width_ = 0;
    height_ = 0;
    lastIOSurfaceID_ = 0;
  }

  bool ensureContextAndServer() {
    if (server_ && context_) return true;
    if (!context_) {
      context_ = CreateLegacyContext();
      if (!context_) return false;
    }
    if (!server_) {
      NSString* nsName = [NSString stringWithUTF8String:senderName_.c_str()];
      server_ = [[SyphonServer alloc] initWithName:nsName
                                           context:context_.CGLContextObj
                                           options:nil];
      if (!server_) return false;
    }
    return true;
  }

  Napi::Value SetSenderName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "Sender name required").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    std::lock_guard<std::mutex> lock(mutex_);
    senderName_ = info[0].As<Napi::String>().Utf8Value();
    if (server_) { [server_ stop]; server_ = nil; }
    if (!ensureContextAndServer()) {
      Napi::Error::New(env, "Failed to create Syphon server").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Boolean::New(env, true);
  }

  Napi::Value SendImage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3) return Napi::Boolean::New(env, false);

    std::lock_guard<std::mutex> lock(mutex_);
    if (!ensureContextAndServer()) return Napi::Boolean::New(env, false);

    Napi::Uint8Array pixels = info[0].As<Napi::Uint8Array>();
    int w = info[1].As<Napi::Number>().Int32Value();
    int h = info[2].As<Napi::Number>().Int32Value();

    // One-shot warning: sendImage is the CPU compatibility fallback. If it
    // fires at all, we are NOT on the IOSurface zero-copy path and the
    // renderer is doing a full-frame getImageData every other frame (~8 MB at
    // 1080p, ~33 MB at 4K). Logged once per process so the operator notices
    // without flooding the log at frame rate.
    static bool fallbackWarned = false;
    if (!fallbackWarned) {
      fallbackWarned = true;
      NSLog(@"[SyphonOutput] zero-copy NOT active — falling back to CPU sendImage path (%dx%d, ~%zu MB/frame). Check that the OSR window started and is producing paint events.",
            w, h, (size_t)(w * h * 4) / (1024 * 1024));
    }

    [context_ makeCurrentContext];

    if (!uploadTex_ || width_ != w || height_ != h) {
      if (uploadTex_) glDeleteTextures(1, &uploadTex_);
      glGenTextures(1, &uploadTex_);
      glBindTexture(GL_TEXTURE_2D, uploadTex_);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
      glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
      width_ = w;
      height_ = h;
    } else {
      glBindTexture(GL_TEXTURE_2D, uploadTex_);
    }

    // Pixel bytes arrive GL-native (bottom-up): the renderer pre-flips the
    // WebGL canvas via a 2D scale(1,-1)/drawImage trick before handing off,
    // which converts WebGL's bottom-up output to bottom-up rows in memory as
    // OpenGL's texel upload expects. glTexSubImage2D puts row 0 at texel row
    // 0 = UV.y=0 = the bottom of the texture, i.e. the stored texture is in
    // OpenGL's canonical orientation. publishFrameTexture with flipped:NO
    // matches — Syphon's `flipped` flag means "flipped *relative to the GL
    // coordinate system*", which we are not. Publishing flipped:YES (the
    // earlier value) made MadMapper flip again on display, which is why the
    // receiver saw everything upside-down and users had to toggle the flip in
    // MadMapper to compensate.
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, pixels.Data());
    glFlush();

    [server_ publishFrameTexture:uploadTex_
                   textureTarget:GL_TEXTURE_2D
                     imageRegion:NSMakeRect(0, 0, w, h)
                   textureDimensions:NSMakeSize(w, h)
                         flipped:NO];
    return Napi::Boolean::New(env, true);
  }

  // Zero-copy publish core. Looks up the IOSurface, wraps it as a
  // GL_TEXTURE_RECTANGLE via CGLTexImageIOSurface2D, and hands the rect
  // texture to SyphonServer. No pixel data crosses the CPU boundary —
  // samplers in downstream Syphon clients read straight from the
  // IOSurface's GPU memory. Caller must hold mutex_.
  bool publishIOSurfaceLocked(IOSurfaceID surfaceID, int w, int h, bool flipped) {
    if (!ensureContextAndServer()) return false;

    IOSurfaceRef surface = IOSurfaceLookup(surfaceID);
    if (!surface) {
      static int missCount = 0;
      if (missCount++ < 5) {
        NSLog(@"[SyphonOutput] IOSurfaceLookup(%u) returned NULL — wrong id encoding?", surfaceID);
      }
      return false;
    }

    [context_ makeCurrentContext];

    if (!ioSurfaceTex_) glGenTextures(1, &ioSurfaceTex_);
    glBindTexture(GL_TEXTURE_RECTANGLE_ARB, ioSurfaceTex_);

    CGLError cglErr = CGLTexImageIOSurface2D(
        CGLGetCurrentContext(),
        GL_TEXTURE_RECTANGLE_ARB,
        GL_RGBA,
        w, h,
        GL_BGRA,
        GL_UNSIGNED_INT_8_8_8_8_REV,
        surface,
        0);
    CFRelease(surface);

    if (cglErr != kCGLNoError) {
      NSLog(@"[SyphonOutput] CGLTexImageIOSurface2D failed: %d", cglErr);
      return false;
    }

    glFlush();

    [server_ publishFrameTexture:ioSurfaceTex_
                   textureTarget:GL_TEXTURE_RECTANGLE_ARB
                     imageRegion:NSMakeRect(0, 0, w, h)
                   textureDimensions:NSMakeSize(w, h)
                         flipped:flipped];

    // One-shot confirmation that zero-copy publish is live. Logs once on the
    // first success and then again whenever the IOSurface changes (resize /
    // sender restart). Lets ops confirm from main-process logs that we're
    // truly on the IOSurface path and not the silent sendImage compatibility
    // fallback — which historically was indistinguishable in logs and burned
    // ~8 MB/frame at 1080p for no good reason.
    if (lastIOSurfaceID_ != surfaceID) {
      NSLog(@"[SyphonOutput] zero-copy ACTIVE — IOSurfaceID=%u %dx%d (publishing via CGLTexImageIOSurface2D)",
            surfaceID, w, h);
    }

    width_ = w;
    height_ = h;
    lastIOSurfaceID_ = surfaceID;
    return true;
  }

  // Lower-level entry: caller passes an IOSurfaceID as a plain JS Number.
  Napi::Value PublishIOSurface(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3) return Napi::Boolean::New(env, false);
    uint32_t surfaceID = info[0].As<Napi::Number>().Uint32Value();
    int w = info[1].As<Napi::Number>().Int32Value();
    int h = info[2].As<Napi::Number>().Int32Value();
    bool flipped = info.Length() >= 4 ? info[3].As<Napi::Boolean>().Value() : YES;

    std::lock_guard<std::mutex> lock(mutex_);
    return Napi::Boolean::New(env, publishIOSurfaceLocked((IOSurfaceID)surfaceID, w, h, flipped));
  }

  // API-parity entry for the Electron OSR paint path. Mirrors the Windows
  // SpoutOutput::SendTexture signature: takes the opaque sharedTextureHandle
  // Buffer from event.texture.textureInfo and width/height from codedSize.
  //
  // On macOS, Electron's shared-texture handle is a 4-byte little-endian
  // IOSurfaceID (io_surface_id_t). The first-frame NSLog below dumps the
  // buffer size + bytes so we can catch a format mismatch if a future
  // Electron version changes the serialization — IOSurfaceLookup returning
  // NULL with the expected 4-byte size means the id is valid-shaped but
  // referring to a surface not in this process's IOSurface table (rare).
  //
  // flipped: Chromium OSR composites with image origin at top-left of the
  // IOSurface (page-top at pixel (0,0)), which is "flipped" relative to
  // OpenGL's bottom-left-origin convention, so we publish flipped:YES.
  // If a downstream consumer ignores the flag and shows upside-down, we'd
  // need to add a GPU blit-to-2D pass here to normalize — for now the
  // zero-copy rect-texture path is preferred.
  Napi::Value SendTexture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsBuffer()) {
      return Napi::Boolean::New(env, false);
    }
    auto handleBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    int w = info[1].As<Napi::Number>().Int32Value();
    int h = info[2].As<Napi::Number>().Int32Value();

    static int diagCount = 0;
    if (diagCount < 3) {
      size_t len = handleBuffer.Length();
      const uint8_t* bytes = handleBuffer.Data();
      NSMutableString* hex = [NSMutableString string];
      for (size_t i = 0; i < len && i < 16; i++) {
        [hex appendFormat:@"%02x ", bytes[i]];
      }
      NSLog(@"[SyphonOutput] SendTexture #%d: handle=%zu bytes [%@] size=%dx%d",
            diagCount, len, hex, w, h);
      diagCount++;
    }

    if (handleBuffer.Length() < sizeof(IOSurfaceID)) {
      return Napi::Boolean::New(env, false);
    }
    IOSurfaceID surfaceID = *reinterpret_cast<const IOSurfaceID*>(handleBuffer.Data());

    std::lock_guard<std::mutex> lock(mutex_);
    return Napi::Boolean::New(env, publishIOSurfaceLocked(surfaceID, w, h, /*flipped=*/YES));
  }

  Napi::Value Release(const Napi::CallbackInfo& info) {
    cleanup();
    return info.Env().Undefined();
  }

  Napi::Value IsInitialized(const Napi::CallbackInfo& info) {
    // "Initialized" means we have a live context and a published server.
    // Matches the Spout addon's semantic on Windows.
    return Napi::Boolean::New(info.Env(), server_ != nil && context_ != nil);
  }

  Napi::Value GetSenderName(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), senderName_);
  }

  Napi::Value GetWidth(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), width_);
  }

  Napi::Value GetHeight(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), height_);
  }

  Napi::Value GetAdapterIndex(const Napi::CallbackInfo& info) {
    // macOS IOSurface crosses GPU boundaries; no adapter selection.
    return Napi::Number::New(info.Env(), 0);
  }
};

// ============================================================
// SyphonReceiver — Receiver with blit-to-2D-then-readPixels
// ============================================================

class SyphonReceiver : public Napi::ObjectWrap<SyphonReceiver> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "SyphonReceiver", {
      InstanceMethod("connect", &SyphonReceiver::Connect),
      InstanceMethod("receiveImage", &SyphonReceiver::ReceiveImage),
      InstanceMethod("isConnected", &SyphonReceiver::IsConnected),
      InstanceMethod("isUpdated", &SyphonReceiver::IsUpdated),
      InstanceMethod("getWidth", &SyphonReceiver::GetWidth),
      InstanceMethod("getHeight", &SyphonReceiver::GetHeight),
      InstanceMethod("release", &SyphonReceiver::Release),
    });
    exports.Set("SyphonReceiver", func);
    return exports;
  }

  SyphonReceiver(const Napi::CallbackInfo& info) : Napi::ObjectWrap<SyphonReceiver>(info) {}

  ~SyphonReceiver() { cleanup(); }

private:
  SyphonClient* client_ = nil;
  NSOpenGLContext* context_ = nil;

  GLuint landingTex_ = 0;      // GL_TEXTURE_2D we blit the rect texture into
  GLuint landingFbo_ = 0;      // FBO with landingTex_ as color attachment
  int landingW_ = 0;
  int landingH_ = 0;

  int lastW_ = 0;
  int lastH_ = 0;
  bool updatedSinceLastQuery_ = false;
  std::mutex mutex_;

  void cleanup() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (context_) {
      [context_ makeCurrentContext];
      if (landingFbo_) { glDeleteFramebuffers(1, &landingFbo_); landingFbo_ = 0; }
      if (landingTex_) { glDeleteTextures(1, &landingTex_); landingTex_ = 0; }
    }
    if (client_) { [client_ stop]; client_ = nil; }
    context_ = nil;
    landingW_ = 0;
    landingH_ = 0;
    lastW_ = 0;
    lastH_ = 0;
    updatedSinceLastQuery_ = false;
  }

  void ensureLanding(int w, int h) {
    if (landingW_ == w && landingH_ == h && landingTex_ && landingFbo_) return;

    if (!landingTex_) glGenTextures(1, &landingTex_);
    glBindTexture(GL_TEXTURE_2D, landingTex_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glBindTexture(GL_TEXTURE_2D, 0);

    if (!landingFbo_) glGenFramebuffers(1, &landingFbo_);
    glBindFramebuffer(GL_FRAMEBUFFER, landingFbo_);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, landingTex_, 0);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    landingW_ = w;
    landingH_ = h;
  }

  // Render the IOSurface-backed rectangle texture into our owned 2D texture
  // using fixed-function (immediate-mode, legacy profile) — no shader. This
  // is the only reliable way to materialize IOSurface pixels into a form
  // glReadPixels can fetch on Intel Iris drivers. Apple's Syphon SimpleClient
  // uses the same pattern (shader-based in its case).
  void blitRectToLanding(GLuint rectTex, int w, int h) {
    glBindFramebuffer(GL_FRAMEBUFFER, landingFbo_);
    glViewport(0, 0, w, h);

    glMatrixMode(GL_PROJECTION);
    glPushMatrix();
    glLoadIdentity();
    glOrtho(0, w, 0, h, -1, 1);
    glMatrixMode(GL_MODELVIEW);
    glPushMatrix();
    glLoadIdentity();

    glDisable(GL_DEPTH_TEST);
    glDisable(GL_BLEND);
    glEnable(GL_TEXTURE_RECTANGLE_ARB);
    glBindTexture(GL_TEXTURE_RECTANGLE_ARB, rectTex);

    glColor4f(1, 1, 1, 1);
    glBegin(GL_QUADS);
      glTexCoord2f(0, 0); glVertex2f(0, 0);
      glTexCoord2f(w, 0); glVertex2f(w, 0);
      glTexCoord2f(w, h); glVertex2f(w, h);
      glTexCoord2f(0, h); glVertex2f(0, h);
    glEnd();

    glBindTexture(GL_TEXTURE_RECTANGLE_ARB, 0);
    glDisable(GL_TEXTURE_RECTANGLE_ARB);

    glMatrixMode(GL_PROJECTION);
    glPopMatrix();
    glMatrixMode(GL_MODELVIEW);
    glPopMatrix();

    glFlush();
  }

  Napi::Value Connect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "Sender name required").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    std::string senderName = info[0].As<Napi::String>().Utf8Value();

    std::lock_guard<std::mutex> lock(mutex_);

    if (!context_) {
      context_ = CreateLegacyContext();
      if (!context_) return Napi::Boolean::New(env, false);
    }

    // Match against "AppName - ServerName" (the listSenders display form) and
    // fall back to the raw ServerName alone.
    NSString* nsName = [NSString stringWithUTF8String:senderName.c_str()];
    NSDictionary* serverDesc = nil;
    NSArray* servers = [[SyphonServerDirectory sharedDirectory] servers];
    for (NSDictionary* desc in servers) {
      NSString* name = [desc objectForKey:SyphonServerDescriptionNameKey];
      NSString* appName = [desc objectForKey:SyphonServerDescriptionAppNameKey];
      NSString* display = (appName && [appName length] > 0)
          ? [NSString stringWithFormat:@"%@ - %@", appName, name]
          : name;
      if ([display isEqualToString:nsName] || [name isEqualToString:nsName]) {
        serverDesc = desc;
        break;
      }
    }
    if (!serverDesc) return Napi::Boolean::New(env, false);

    if (client_) { [client_ stop]; client_ = nil; }
    client_ = [[SyphonClient alloc] initWithServerDescription:serverDesc
                                                      context:context_.CGLContextObj
                                                      options:nil
                                               newFrameHandler:nil];
    return Napi::Boolean::New(env, client_ != nil);
  }

  Napi::Value ReceiveImage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::lock_guard<std::mutex> lock(mutex_);

    if (!client_ || !context_) {
      static int nilCtxLogged = 0;
      if (nilCtxLogged < 3) {
        NSLog(@"[SyphonReceiver] receiveImage — client_=%@ context_=%@ (never entered receive path)",
              client_, context_);
        nilCtxLogged++;
      }
      return env.Null();
    }

    [context_ makeCurrentContext];

    SyphonImage* frame = [client_ newFrameImage];
    if (!frame) {
      // newFrameImage returns nil when no new frame has arrived since the
      // last call. Expected between frames but NOT on every call — if it's
      // nil every single time, the SyphonClient isn't actually subscribed
      // to the server. Log the first 5 nils to surface the failure.
      static int nilFrameLogged = 0;
      if (nilFrameLogged < 5) {
        NSArray* servers = [[SyphonServerDirectory sharedDirectory] servers];
        NSLog(@"[SyphonReceiver] newFrameImage=nil (#%d), directory has %lu servers",
              nilFrameLogged, (unsigned long)[servers count]);
        nilFrameLogged++;
      }
      return env.Null();
    }

    static int okFrameLogged = 0;
    if (okFrameLogged < 3) {
      NSLog(@"[SyphonReceiver] newFrameImage OK #%d — texName=%u size=%.0fx%.0f",
            okFrameLogged, [frame textureName],
            [frame textureSize].width, [frame textureSize].height);
      okFrameLogged++;
    }

    NSSize size = [frame textureSize];
    int w = (int)size.width;
    int h = (int)size.height;
    GLuint rectTex = [frame textureName];
    if (w <= 0 || h <= 0 || rectTex == 0) return env.Null();

    ensureLanding(w, h);
    blitRectToLanding(rectTex, w, h);

    size_t bytes = (size_t)w * (size_t)h * 4;

    // Allocate the N-API-owned ArrayBuffer up-front and readPixels straight
    // into it. Previously this path did a 3-copy dance: glReadPixels into a
    // C++ std::vector<uint8_t> readBuf_, then a row-by-row memcpy into a
    // second std::vector<uint8_t> flipped (the CPU Y-flip), then a final
    // memcpy into the NAPI buffer. For 1080p that was ~24 MB of CPU-side
    // copying per frame — ~15-20 ms of wall time on a MacBook, which capped
    // the receiver well below 30 fps.
    //
    // We drop the CPU flip entirely (see comment block below) and have
    // glReadPixels write directly into the NAPI buffer, collapsing three
    // copies into one GPU→CPU readback + zero CPU copies.
    //
    // Orientation: glReadPixels returns OpenGL-native bottom-up rows (row 0
    // = bottom of the framebuffer). The sender also publishes GL-native
    // bottom-up (SendImage writes flipped:NO, documented up top). The
    // renderer wraps this in a THREE.DataTexture with the default flipY =
    // false, which uploads row 0 to texel row 0 (UV.y = 0 = bottom of the
    // texture). Sampled onto a standard THREE plane (UV origin bottom-left)
    // the image lands right-side-up. The earlier code did an extra
    // CPU row-flip here and the receiver displayed upside-down; removing
    // that flip is the whole fix for the IN-from-MadMapper orientation bug.
    Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, bytes);

    glBindFramebuffer(GL_FRAMEBUFFER, landingFbo_);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, buf.Data());
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    lastW_ = w;
    lastH_ = h;
    updatedSinceLastQuery_ = true;

    // Return a raw Uint8Array of pixel bytes. The Windows addon's ReceiveImage
    // returns Napi::Buffer (bytes only), and main.js's spout_receive_frame
    // handler wraps either one in { data, width, height } before IPC. If we
    // returned an object from here, main.js would double-wrap it and the
    // renderer's `new Uint8Array(frame.data)` would see a plain object with
    // no length/iterator, produce a length-0 typed array, fail the size
    // check, and silently drop every frame. Width/height are fetched from
    // getWidth()/getHeight() in the main.js handler.
    return Napi::Uint8Array::New(env, bytes, buf, 0);
  }

  Napi::Value IsConnected(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), client_ != nil);
  }

  Napi::Value IsUpdated(const Napi::CallbackInfo& info) {
    bool v = updatedSinceLastQuery_;
    updatedSinceLastQuery_ = false;
    return Napi::Boolean::New(info.Env(), v);
  }

  Napi::Value GetWidth(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), lastW_);
  }

  Napi::Value GetHeight(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), lastH_);
  }

  Napi::Value Release(const Napi::CallbackInfo& info) {
    cleanup();
    return info.Env().Undefined();
  }
};

// ============================================================
// Top-level: listSenders, getGpuInfo (match Spout addon shape)
// ============================================================

static Napi::Value ListSenders(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);
  NSArray* servers = [[SyphonServerDirectory sharedDirectory] servers];
  uint32_t idx = 0;
  for (NSDictionary* desc in servers) {
    NSString* name = [desc objectForKey:SyphonServerDescriptionNameKey];
    NSString* appName = [desc objectForKey:SyphonServerDescriptionAppNameKey];
    if (!name) continue;
    NSString* display = (appName && [appName length] > 0)
        ? [NSString stringWithFormat:@"%@ - %@", appName, name]
        : name;
    result.Set(idx++, Napi::String::New(env, [display UTF8String]));
  }
  return result;
}

static Napi::Value GetGpuInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  NSString* rendererStr = nil;
  NSOpenGLContext* ctx = CreateLegacyContext();
  if (ctx) {
    [ctx makeCurrentContext];
    const GLubyte* r = glGetString(GL_RENDERER);
    if (r) rendererStr = [NSString stringWithUTF8String:(const char*)r];
  }

  Napi::Array adapters = Napi::Array::New(env);
  adapters.Set((uint32_t)0, Napi::String::New(env, rendererStr ? [rendererStr UTF8String] : "macOS GPU"));

  Napi::Object result = Napi::Object::New(env);
  result.Set("adapters", adapters);
  result.Set("selectedAdapter", Napi::Number::New(env, 0));
  return result;
}

// ============================================================
// Module init
// ============================================================

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // Prime the SyphonServerDirectory early so remote servers are discovered
  // before the first listSenders() call. The directory populates async via
  // Apple distributed notifications; lazy instantiation returns an empty
  // list on the first call.
  (void)[SyphonServerDirectory sharedDirectory];

  SyphonOutput::Init(env, exports);
  SyphonReceiver::Init(env, exports);
  exports.Set("listSenders", Napi::Function::New(env, ListSenders));
  exports.Set("getGpuInfo", Napi::Function::New(env, GetGpuInfo));
  exports.Set("platform", Napi::String::New(env, "syphon"));
  return exports;
}

NODE_API_MODULE(syphon_addon, Init)
