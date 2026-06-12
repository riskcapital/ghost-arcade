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
#include <map>
#include <memory>

@interface SyphonServerDirectory (GhostArcadeRefresh)
- (void)requestServerAnnounce;
@end

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

static NSArray* GetSyphonServers(bool activelyRefresh) {
  SyphonServerDirectory* directory = [SyphonServerDirectory sharedDirectory];
  NSArray* servers = [directory servers];
  if (!activelyRefresh || [servers count] > 0) return servers;

  static CFAbsoluteTime lastAnnounce = 0;
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (now - lastAnnounce > 0.75) {
    lastAnnounce = now;
    [directory requestServerAnnounce];
  }

  // Syphon discovery is NSDistributedNotificationCenter-driven. Give Cocoa a
  // brief chance to receive announce responses so a cold source picker does
  // not report "no sources" while other Syphon clients already see them.
  NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:0.05];
  [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:deadline];
  return [directory servers];
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
  int zeroCopyLogCount_ = 0;

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
    zeroCopyLogCount_ = 0;
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
    lastIOSurfaceID_ = 0;
    zeroCopyLogCount_ = 0;
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

  // Zero-copy publish core. Wraps the IOSurface as a GL_TEXTURE_RECTANGLE via
  // CGLTexImageIOSurface2D and hands the rect texture to SyphonServer. No pixel
  // data crosses the CPU boundary; downstream Syphon clients sample directly
  // from the IOSurface-backed GPU memory. Caller must hold mutex_.
  bool publishIOSurfaceRefLocked(IOSurfaceRef surface, int w, int h, bool flipped, bool releaseSurface) {
    if (!surface) return false;
    if (!ensureContextAndServer()) {
      if (releaseSurface) CFRelease(surface);
      return false;
    }

    IOSurfaceID surfaceID = IOSurfaceGetID(surface);

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
    if (releaseSurface) CFRelease(surface);

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

    // Confirmation that zero-copy publish is live. Chromium rotates through a
    // small IOSurface pool, so do not log every surface-id change at frame rate.
    // Emit the first few successes and any real size change.
    bool sizeChanged = width_ != w || height_ != h;
    if (zeroCopyLogCount_ < 3 || sizeChanged) {
      NSLog(@"[SyphonOutput] zero-copy ACTIVE — IOSurfaceID=%u %dx%d (publishing via CGLTexImageIOSurface2D)",
            surfaceID, w, h);
      zeroCopyLogCount_++;
    }

    width_ = w;
    height_ = h;
    lastIOSurfaceID_ = surfaceID;
    return true;
  }

  // Compatibility path for older Electron builds that provide a 4-byte
  // IOSurfaceID instead of the current IOSurfaceRef pointer.
  bool publishIOSurfaceLocked(IOSurfaceID surfaceID, int w, int h, bool flipped) {
    IOSurfaceRef surface = IOSurfaceLookup(surfaceID);
    if (!surface) {
      static int missCount = 0;
      if (missCount++ < 5) {
        NSLog(@"[SyphonOutput] IOSurfaceLookup(%u) returned NULL — wrong id encoding?", surfaceID);
      }
      return false;
    }
    return publishIOSurfaceRefLocked(surface, w, h, flipped, /*releaseSurface=*/true);
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
  // On current Electron, textureInfo.handle.ioSurface is an IOSurfaceRef
  // pointer serialized as a Buffer. Older Electron builds exposed a 4-byte
  // IOSurfaceID in sharedTextureHandle. The first-frame NSLog below dumps the
  // buffer shape so we can catch future Electron serialization changes.
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

    std::lock_guard<std::mutex> lock(mutex_);

    if (handleBuffer.Length() >= sizeof(IOSurfaceRef)) {
      IOSurfaceRef surface = *reinterpret_cast<IOSurfaceRef const*>(handleBuffer.Data());
      if (surface) {
        CFRetain(surface);
        return Napi::Boolean::New(env, publishIOSurfaceRefLocked(surface, w, h, /*flipped=*/YES, /*releaseSurface=*/true));
      }
    }

    IOSurfaceID surfaceID = *reinterpret_cast<const IOSurfaceID*>(handleBuffer.Data());
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
// SyphonAtlasOutput — multi-slice zero-copy fan-out (Phase 3).
//
// Mirrors SpoutAtlasOutput. One hidden OSR window renders ALL sender
// slices into a single atlas IOSurface. Each paint we:
//   1. CGLTexImageIOSurface2D the atlas IOSurface into a shared
//      GL_TEXTURE_RECTANGLE_ARB (one wrap per paint).
//   2. For each configured region, blit the sub-rect from the atlas
//      rect texture into the sender's own GL_TEXTURE_2D via a FBO +
//      fixed-function textured quad. publishFrameTexture sends each
//      sender independently.
//
// Cost is one IOSurface bind + N GPU sub-blits per paint — flat per
// sender, no CPU pixels.
//
// Orientation: Chromium OSR fills the atlas IOSurface top-down (row 0
// = top of the page). The blit copies the slice into the FBO 2D
// texture with row 0 = top of the slice (matching the single-output
// SendTexture convention), so publishFrameTexture is flipped:YES like
// the single-output path. Consumers that respect Syphon's `flipped`
// flag (Simple Client, MadMapper, Resolume) display right-side-up
// without an extra toggle.
// ============================================================

class SyphonAtlasOutput : public Napi::ObjectWrap<SyphonAtlasOutput> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "SyphonAtlasOutput", {
      InstanceMethod("configure", &SyphonAtlasOutput::Configure),
      InstanceMethod("sendAtlas", &SyphonAtlasOutput::SendAtlas),
      InstanceMethod("release", &SyphonAtlasOutput::Release),
      InstanceMethod("isInitialized", &SyphonAtlasOutput::IsInitialized),
      InstanceMethod("getSenderNames", &SyphonAtlasOutput::GetSenderNames),
      InstanceMethod("getAdapterIndex", &SyphonAtlasOutput::GetAdapterIndex),
    });
    exports.Set("SyphonAtlasOutput", func);
    return exports;
  }

  SyphonAtlasOutput(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<SyphonAtlasOutput>(info) {
    context_ = CreateLegacyContext();
    if (!context_) {
      NSLog(@"[SyphonAtlasOutput] CreateLegacyContext failed — atlas fan-out unavailable");
      return;
    }
    initialized_ = true;
    NSLog(@"[SyphonAtlasOutput] context ready");
  }

  ~SyphonAtlasOutput() { cleanup(); }

private:
  struct AtlasSender {
    SyphonServer* server = nil;
    GLuint tex2D = 0;     // sender-owned GL_TEXTURE_2D (the published texture)
    GLuint fbo = 0;       // FBO with tex2D as color attachment
    GLuint w = 0;
    GLuint h = 0;
    GLuint x = 0;         // top-left within the atlas IOSurface (pixels)
    GLuint y = 0;
  };

  NSOpenGLContext* context_ = nil;
  GLuint atlasRectTex_ = 0;        // GL_TEXTURE_RECTANGLE_ARB wrapping the atlas IOSurface
  IOSurfaceID lastAtlasSurfaceID_ = 0;
  int lastAtlasW_ = 0;
  int lastAtlasH_ = 0;
  bool initialized_ = false;
  int diagCount_ = 0;
  std::map<std::string, std::unique_ptr<AtlasSender>> senders_;
  std::mutex mutex_;

  void releaseSenderEntry(AtlasSender& s) {
    if (s.server) { [s.server stop]; s.server = nil; }
    if (s.fbo)   { glDeleteFramebuffers(1, &s.fbo); s.fbo = 0; }
    if (s.tex2D) { glDeleteTextures(1, &s.tex2D); s.tex2D = 0; }
    s.w = s.h = s.x = s.y = 0;
  }

  void cleanup() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (context_) {
      [context_ makeCurrentContext];
      for (auto& [name, sp] : senders_) {
        releaseSenderEntry(*sp);
      }
      if (atlasRectTex_) { glDeleteTextures(1, &atlasRectTex_); atlasRectTex_ = 0; }
    } else {
      for (auto& [name, sp] : senders_) {
        if (sp->server) { [sp->server stop]; sp->server = nil; }
      }
    }
    if (!senders_.empty()) {
      NSLog(@"[SyphonAtlasOutput] released %zu sender(s)", senders_.size());
    }
    senders_.clear();
    context_ = nil;
    initialized_ = false;
    lastAtlasSurfaceID_ = 0;
    lastAtlasW_ = lastAtlasH_ = 0;
  }

  // Resize / create sender-owned tex2D + FBO. Caller must have context current.
  bool ensureSenderTarget(AtlasSender& s, GLuint w, GLuint h) {
    if (s.tex2D && s.fbo && s.w == w && s.h == h) return true;

    if (s.fbo)   { glDeleteFramebuffers(1, &s.fbo); s.fbo = 0; }
    if (s.tex2D) { glDeleteTextures(1, &s.tex2D); s.tex2D = 0; }

    glGenTextures(1, &s.tex2D);
    glBindTexture(GL_TEXTURE_2D, s.tex2D);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glBindTexture(GL_TEXTURE_2D, 0);

    glGenFramebuffers(1, &s.fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, s.fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, s.tex2D, 0);
    GLenum fbStatus = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    if (fbStatus != GL_FRAMEBUFFER_COMPLETE) {
      NSLog(@"[SyphonAtlasOutput] FBO incomplete (status=0x%x) for %ux%u", fbStatus, w, h);
      glDeleteFramebuffers(1, &s.fbo); s.fbo = 0;
      glDeleteTextures(1, &s.tex2D); s.tex2D = 0;
      return false;
    }

    s.w = w;
    s.h = h;
    return true;
  }

  // Blit sub-rect of the atlas rect texture into the sender's 2D texture
  // via FBO + fixed-function textured quad. Vertex/texcoord mapping puts
  // atlas row y at the FBO's bottom (texel row 0), so the published 2D
  // texture has row 0 = top of slice content — published flipped:YES.
  void blitSubRectToSender(const AtlasSender& s) {
    glBindFramebuffer(GL_FRAMEBUFFER, s.fbo);
    glViewport(0, 0, s.w, s.h);

    glMatrixMode(GL_PROJECTION);
    glPushMatrix();
    glLoadIdentity();
    glOrtho(0, s.w, 0, s.h, -1, 1);
    glMatrixMode(GL_MODELVIEW);
    glPushMatrix();
    glLoadIdentity();

    glDisable(GL_DEPTH_TEST);
    glDisable(GL_BLEND);
    glEnable(GL_TEXTURE_RECTANGLE_ARB);
    glBindTexture(GL_TEXTURE_RECTANGLE_ARB, atlasRectTex_);

    const GLfloat x0 = (GLfloat)s.x;
    const GLfloat y0 = (GLfloat)s.y;
    const GLfloat x1 = (GLfloat)(s.x + s.w);
    const GLfloat y1 = (GLfloat)(s.y + s.h);

    glColor4f(1, 1, 1, 1);
    glBegin(GL_QUADS);
      glTexCoord2f(x0, y0); glVertex2f(0,    0);
      glTexCoord2f(x1, y0); glVertex2f(s.w,  0);
      glTexCoord2f(x1, y1); glVertex2f(s.w,  s.h);
      glTexCoord2f(x0, y1); glVertex2f(0,    s.h);
    glEnd();

    glBindTexture(GL_TEXTURE_RECTANGLE_ARB, 0);
    glDisable(GL_TEXTURE_RECTANGLE_ARB);

    glMatrixMode(GL_PROJECTION);
    glPopMatrix();
    glMatrixMode(GL_MODELVIEW);
    glPopMatrix();

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
  }

  Napi::Value Configure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!initialized_) return Napi::Boolean::New(env, false);
    if (info.Length() < 1 || !info[0].IsArray()) {
      Napi::TypeError::New(env, "Array of regions expected").ThrowAsJavaScriptException();
      return Napi::Boolean::New(env, false);
    }

    Napi::Array regions = info[0].As<Napi::Array>();
    std::lock_guard<std::mutex> lock(mutex_);
    [context_ makeCurrentContext];

    std::map<std::string, bool> wanted;
    for (uint32_t i = 0; i < regions.Length(); i++) {
      Napi::Value v = regions.Get(i);
      if (!v.IsObject()) continue;
      Napi::Object r = v.As<Napi::Object>();
      std::string name = r.Get("name").ToString().Utf8Value();
      GLuint x = r.Get("x").ToNumber().Uint32Value();
      GLuint y = r.Get("y").ToNumber().Uint32Value();
      GLuint w = r.Get("w").ToNumber().Uint32Value();
      GLuint h = r.Get("h").ToNumber().Uint32Value();
      if (name.empty() || w == 0 || h == 0) continue;
      if (wanted.count(name)) {
        NSLog(@"[SyphonAtlasOutput] duplicate sender name '%s' — skipping", name.c_str());
        continue;
      }
      wanted[name] = true;

      auto it = senders_.find(name);
      if (it == senders_.end()) {
        auto s = std::make_unique<AtlasSender>();
        NSString* nsName = [NSString stringWithUTF8String:name.c_str()];
        s->server = [[SyphonServer alloc] initWithName:nsName
                                               context:context_.CGLContextObj
                                               options:nil];
        if (!s->server) {
          NSLog(@"[SyphonAtlasOutput] SyphonServer init failed for '%s'", name.c_str());
        }
        it = senders_.emplace(name, std::move(s)).first;
        NSLog(@"[SyphonAtlasOutput] sender '%s' created (%ux%u @ %u,%u)", name.c_str(), w, h, x, y);
      }

      AtlasSender& s = *it->second;
      ensureSenderTarget(s, w, h);
      s.x = x;
      s.y = y;
    }

    // Drop senders no longer in the layout.
    for (auto it = senders_.begin(); it != senders_.end(); ) {
      if (!wanted.count(it->first)) {
        NSLog(@"[SyphonAtlasOutput] sender '%s' removed", it->first.c_str());
        releaseSenderEntry(*it->second);
        it = senders_.erase(it);
      } else {
        ++it;
      }
    }

    return Napi::Boolean::New(env, true);
  }

  Napi::Value SendAtlas(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!initialized_ || senders_.empty()) return Napi::Number::New(env, 0);
    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "Buffer argument expected (IOSurface handle)").ThrowAsJavaScriptException();
      return Napi::Number::New(env, 0);
    }
    auto handleBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    if (handleBuffer.Length() < sizeof(IOSurfaceID)) {
      return Napi::Number::New(env, 0);
    }

    // Resolve IOSurfaceRef from either the modern pointer-buffer or the
    // legacy 4-byte IOSurfaceID encoding (mirrors SyphonOutput::SendTexture).
    IOSurfaceRef surface = nullptr;
    bool releaseSurface = false;
    if (handleBuffer.Length() >= sizeof(IOSurfaceRef)) {
      surface = *reinterpret_cast<IOSurfaceRef const*>(handleBuffer.Data());
      if (surface) {
        CFRetain(surface);
        releaseSurface = true;
      }
    }
    if (!surface) {
      IOSurfaceID sid = *reinterpret_cast<const IOSurfaceID*>(handleBuffer.Data());
      surface = IOSurfaceLookup(sid);
      releaseSurface = (surface != nullptr);
      if (!surface) {
        static int missCount = 0;
        if (missCount++ < 5) {
          NSLog(@"[SyphonAtlasOutput] IOSurfaceLookup(%u) returned NULL", sid);
        }
        return Napi::Number::New(env, 0);
      }
    }

    std::lock_guard<std::mutex> lock(mutex_);

    IOSurfaceID surfaceID = IOSurfaceGetID(surface);
    int atlasW = (int)IOSurfaceGetWidth(surface);
    int atlasH = (int)IOSurfaceGetHeight(surface);
    if (atlasW <= 0 || atlasH <= 0) {
      if (releaseSurface) CFRelease(surface);
      return Napi::Number::New(env, 0);
    }

    [context_ makeCurrentContext];

    if (!atlasRectTex_) glGenTextures(1, &atlasRectTex_);
    glBindTexture(GL_TEXTURE_RECTANGLE_ARB, atlasRectTex_);
    CGLError cglErr = CGLTexImageIOSurface2D(
        CGLGetCurrentContext(),
        GL_TEXTURE_RECTANGLE_ARB,
        GL_RGBA,
        atlasW, atlasH,
        GL_BGRA,
        GL_UNSIGNED_INT_8_8_8_8_REV,
        surface,
        0);
    if (releaseSurface) CFRelease(surface);
    if (cglErr != kCGLNoError) {
      glBindTexture(GL_TEXTURE_RECTANGLE_ARB, 0);
      NSLog(@"[SyphonAtlasOutput] CGLTexImageIOSurface2D failed: %d", cglErr);
      return Napi::Number::New(env, 0);
    }

    if (diagCount_ < 3) {
      NSLog(@"[SyphonAtlasOutput] sendAtlas IOSurfaceID=%u atlas=%dx%d sender(s)=%zu",
            surfaceID, atlasW, atlasH, senders_.size());
      diagCount_++;
    }

    int sent = 0;
    for (auto& [name, sp] : senders_) {
      AtlasSender& s = *sp;
      if (!s.server || !s.tex2D || !s.fbo) continue;

      // Out-of-bounds during a layout/resize race — skip a frame rather
      // than sample garbage (matches SpoutAtlasOutput::SendAtlas).
      if ((int)(s.x + s.w) > atlasW || (int)(s.y + s.h) > atlasH) {
        static int skipCount = 0;
        if (skipCount++ < 5) {
          NSLog(@"[SyphonAtlasOutput] region '%s' %u,%u %ux%u outside atlas %dx%d — skipped",
                name.c_str(), s.x, s.y, s.w, s.h, atlasW, atlasH);
        }
        continue;
      }

      blitSubRectToSender(s);

      [s.server publishFrameTexture:s.tex2D
                      textureTarget:GL_TEXTURE_2D
                        imageRegion:NSMakeRect(0, 0, s.w, s.h)
                  textureDimensions:NSMakeSize(s.w, s.h)
                            flipped:YES];
      sent++;
    }
    glFlush();

    lastAtlasSurfaceID_ = surfaceID;
    lastAtlasW_ = atlasW;
    lastAtlasH_ = atlasH;
    return Napi::Number::New(env, sent);
  }

  Napi::Value Release(const Napi::CallbackInfo& info) {
    cleanup();
    return info.Env().Undefined();
  }

  Napi::Value IsInitialized(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), initialized_);
  }

  Napi::Value GetSenderNames(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array result = Napi::Array::New(env, senders_.size());
    uint32_t i = 0;
    for (auto& [name, sp] : senders_) {
      result.Set(i++, Napi::String::New(env, name));
    }
    return result;
  }

  Napi::Value GetAdapterIndex(const Napi::CallbackInfo& info) {
    // macOS IOSurface crosses GPU boundaries transparently — no adapter pick.
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
    NSArray* servers = GetSyphonServers(true);
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
        NSArray* servers = GetSyphonServers(false);
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
  NSArray* servers = GetSyphonServers(true);
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
  (void)GetSyphonServers(true);

  SyphonOutput::Init(env, exports);
  SyphonAtlasOutput::Init(env, exports);
  SyphonReceiver::Init(env, exports);
  exports.Set("listSenders", Napi::Function::New(env, ListSenders));
  exports.Set("getGpuInfo", Napi::Function::New(env, GetGpuInfo));
  exports.Set("platform", Napi::String::New(env, "syphon"));
  return exports;
}

NODE_API_MODULE(syphon_addon, Init)
