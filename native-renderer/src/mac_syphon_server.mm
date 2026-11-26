// Syphon publishing from inside the render core (macOS).
//
// The core renders the program into an IOSurface-backed Metal texture. Here
// that surface is handed to a Syphon server directly, in the same process,
// so no frame metadata crosses a pipe and the Electron main process does no
// per-frame work. Syphon's server API is OpenGL: each slot surface is bound
// once as a GL_TEXTURE_RECTANGLE (CGLTexImageIOSurface2D, no pixel copy) and
// published with publishFrameTexture, which draws it into Syphon's own shared
// surface on the GPU.
//
// Syphon.framework is opened at run time (NSBundle) instead of being linked:
// the core binary must start on machines and builds that lack it, and the
// framework ships inside the app bundle next to the Electron addon's copy.
// The class and its methods are therefore reached through the Objective-C
// runtime with a local protocol, not the framework's headers.

#define GL_SILENCE_DEPRECATION 1
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <unistd.h>
#import <IOSurface/IOSurface.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl.h>
#import <OpenGL/glext.h>
#import <OpenGL/CGLIOSurface.h>

#include <string.h>
#include <vector>

#include "mac_syphon_server.h"

@protocol GhostSyphonServerMethods
- (id)initWithName:(NSString *)serverName context:(CGLContextObj)context options:(NSDictionary *)options;
- (void)publishFrameTexture:(GLuint)texID
              textureTarget:(GLenum)target
                imageRegion:(NSRect)region
          textureDimensions:(NSSize)size
                    flipped:(BOOL)isFlipped;
- (BOOL)hasClients;
- (void)stop;
@end

namespace {

void write_error(char *error, size_t capacity, NSString *message) {
  if (!error || capacity == 0) return;
  const char *text = message.UTF8String ?: "unknown error";
  strlcpy(error, text, capacity);
}

struct Slot {
  GLuint texture = 0;
  GLuint fence = 0;
  bool fenced = false;
  uint32_t width = 0;
  uint32_t height = 0;
  IOSurfaceRef surface = nullptr;
};

}  // namespace

struct GhostSyphonServer {
  id<GhostSyphonServerMethods> server = nil;
  CGLContextObj context = nullptr;
  std::vector<Slot> slots;
};

static Class SyphonServerClass() { return NSClassFromString(@"SyphonServer"); }

extern "C" int ghost_syphon_load(const char *framework_path, char *error, size_t error_capacity) {
  @autoreleasepool {
    if (SyphonServerClass()) return 1;
    if (!framework_path || !*framework_path) {
      write_error(error, error_capacity, @"no Syphon.framework path");
      return 0;
    }
    NSString *path = [NSString stringWithUTF8String:framework_path];
    NSBundle *bundle = [NSBundle bundleWithPath:path];
    if (!bundle) {
      write_error(error, error_capacity, [NSString stringWithFormat:@"no bundle at %@", path]);
      return 0;
    }
    NSError *loadError = nil;
    if (![bundle loadAndReturnError:&loadError]) {
      write_error(error, error_capacity,
                  [NSString stringWithFormat:@"could not load %@: %@", path,
                                             loadError.localizedDescription ?: @"unknown"]);
      return 0;
    }
    if (!SyphonServerClass()) {
      write_error(error, error_capacity,
                  [NSString stringWithFormat:@"%@ has no SyphonServer class", path]);
      return 0;
    }
    return 1;
  }
}

// Syphon names the publishing app from NSRunningApplication's localizedName
// (falling back to the process name). The core is a plain executable whose
// localized name is its file name, so for this process only that answer is
// replaced with the app's own name: receivers keep finding the sender under
// the name they saved it with.
static NSString *gAppName = nil;
static IMP gOriginalLocalizedName = nullptr;

static NSString *GhostLocalizedName(id self, SEL cmd) {
  if (gAppName && [self isKindOfClass:[NSRunningApplication class]] &&
      [(NSRunningApplication *)self processIdentifier] == getpid()) {
    return gAppName;
  }
  return gOriginalLocalizedName ? ((NSString * (*)(id, SEL))gOriginalLocalizedName)(self, cmd) : nil;
}

extern "C" void ghost_syphon_set_app_name(const char *name) {
  @autoreleasepool {
    if (!name || !*name) return;
    NSString *value = [NSString stringWithUTF8String:name];
    if (!value.length) return;
    gAppName = [value copy];
    [[NSProcessInfo processInfo] setProcessName:value];
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      Method method = class_getInstanceMethod([NSRunningApplication class], @selector(localizedName));
      if (method) gOriginalLocalizedName = method_setImplementation(method, (IMP)GhostLocalizedName);
    });
  }
}

extern "C" GhostSyphonServer *ghost_syphon_server_create(const char *name, char *error,
                                                         size_t error_capacity) {
  @autoreleasepool {
    Class cls = SyphonServerClass();
    if (!cls) {
      write_error(error, error_capacity, @"Syphon.framework is not loaded");
      return nullptr;
    }
    // A legacy (compatibility) context: Syphon's publish path draws the
    // texture with fixed-function calls the 3.2 core profile removes.
    CGLPixelFormatAttribute attrs[] = {
        kCGLPFAAccelerated, kCGLPFAAllowOfflineRenderers, kCGLPFAColorSize,
        (CGLPixelFormatAttribute)24, kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
        (CGLPixelFormatAttribute)0,
    };
    CGLPixelFormatObj format = nullptr;
    GLint count = 0;
    if (CGLChoosePixelFormat(attrs, &format, &count) != kCGLNoError || !format) {
      write_error(error, error_capacity, @"CGLChoosePixelFormat failed");
      return nullptr;
    }
    CGLContextObj context = nullptr;
    CGLError err = CGLCreateContext(format, nullptr, &context);
    CGLReleasePixelFormat(format);
    if (err != kCGLNoError || !context) {
      write_error(error, error_capacity,
                  [NSString stringWithFormat:@"CGLCreateContext failed: %d", err]);
      return nullptr;
    }
    NSString *serverName = [NSString stringWithUTF8String:name ?: ""] ?: @"";
    id<GhostSyphonServerMethods> server =
        [(id<GhostSyphonServerMethods>)[cls alloc] initWithName:serverName
                                                        context:context
                                                        options:nil];
    if (!server) {
      CGLReleaseContext(context);
      write_error(error, error_capacity, @"SyphonServer init failed");
      return nullptr;
    }
    auto *result = new GhostSyphonServer();
    result->server = server;
    result->context = context;
    return result;
  }
}

extern "C" int ghost_syphon_server_set_slot(GhostSyphonServer *server, uint32_t slot,
                                            void *surface, uint32_t width, uint32_t height,
                                            char *error, size_t error_capacity) {
  if (!server || !surface || width == 0 || height == 0) {
    write_error(error, error_capacity, @"invalid Syphon slot");
    return 0;
  }
  if (server->slots.size() <= slot) server->slots.resize(slot + 1);
  Slot &entry = server->slots[slot];
  CGLContextObj previous = CGLGetCurrentContext();
  CGLSetCurrentContext(server->context);
  if (!entry.texture) glGenTextures(1, &entry.texture);
  if (!entry.fence) glGenFencesAPPLE(1, &entry.fence);
  glBindTexture(GL_TEXTURE_RECTANGLE_ARB, entry.texture);
  CGLError err = CGLTexImageIOSurface2D(server->context, GL_TEXTURE_RECTANGLE_ARB, GL_RGBA,
                                        (GLsizei)width, (GLsizei)height, GL_BGRA,
                                        GL_UNSIGNED_INT_8_8_8_8_REV, (IOSurfaceRef)surface, 0);
  glBindTexture(GL_TEXTURE_RECTANGLE_ARB, 0);
  CGLSetCurrentContext(previous);
  if (err != kCGLNoError) {
    write_error(error, error_capacity,
                [NSString stringWithFormat:@"CGLTexImageIOSurface2D failed: %d", err]);
    return 0;
  }
  if (entry.surface) CFRelease(entry.surface);
  entry.surface = (IOSurfaceRef)CFRetain((IOSurfaceRef)surface);
  entry.width = width;
  entry.height = height;
  entry.fenced = false;
  return 1;
}

extern "C" int ghost_syphon_server_slot_free(GhostSyphonServer *server, uint32_t slot) {
  if (!server || slot >= server->slots.size()) return 0;
  Slot &entry = server->slots[slot];
  if (!entry.fenced) return 1;
  CGLContextObj previous = CGLGetCurrentContext();
  CGLSetCurrentContext(server->context);
  const bool done = glTestFenceAPPLE(entry.fence);
  CGLSetCurrentContext(previous);
  if (done) entry.fenced = false;
  return done ? 1 : 0;
}

extern "C" int ghost_syphon_server_publish(GhostSyphonServer *server, uint32_t slot, int flipped) {
  if (!server || slot >= server->slots.size()) return 0;
  Slot &entry = server->slots[slot];
  if (!entry.texture || !entry.surface) return 0;
  @autoreleasepool {
    CGLContextObj previous = CGLGetCurrentContext();
    CGLSetCurrentContext(server->context);
    [server->server publishFrameTexture:entry.texture
                          textureTarget:GL_TEXTURE_RECTANGLE_ARB
                            imageRegion:NSMakeRect(0, 0, entry.width, entry.height)
                      textureDimensions:NSMakeSize(entry.width, entry.height)
                                flipped:flipped ? YES : NO];
    // The core writes this slot again only after OpenGL has read it.
    glSetFenceAPPLE(entry.fence);
    entry.fenced = true;
    glFlush();
    CGLSetCurrentContext(previous);
  }
  return 1;
}

extern "C" int ghost_syphon_server_has_clients(GhostSyphonServer *server) {
  if (!server || !server->server) return 0;
  return [server->server hasClients] ? 1 : 0;
}

extern "C" void ghost_syphon_server_free(GhostSyphonServer *server) {
  if (!server) return;
  @autoreleasepool {
    CGLContextObj previous = CGLGetCurrentContext();
    CGLSetCurrentContext(server->context);
    for (Slot &entry : server->slots) {
      if (entry.fence) {
        glFinishFenceAPPLE(entry.fence);
        glDeleteFencesAPPLE(1, &entry.fence);
      }
      if (entry.texture) glDeleteTextures(1, &entry.texture);
      if (entry.surface) CFRelease(entry.surface);
    }
    server->slots.clear();
    CGLSetCurrentContext(previous == server->context ? nullptr : previous);
    [server->server stop];
    server->server = nil;
    if (server->context) CGLReleaseContext(server->context);
  }
  delete server;
}
