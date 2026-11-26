#ifndef GHOST_MAC_SYPHON_SERVER_H
#define GHOST_MAC_SYPHON_SERVER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GhostSyphonServer GhostSyphonServer;

// Load Syphon.framework from `framework_path` (a .framework directory). The
// framework is opened at run time rather than linked, so a core without it
// still starts and simply reports that it cannot publish. Returns 1 once the
// SyphonServer class is available (also when an earlier call loaded it).
int ghost_syphon_load(const char *framework_path, char *error, size_t error_capacity);

// The application name Syphon clients list beside each server name. Syphon
// reads the process name when the process has no application bundle name,
// and the core's executable name is not the name the app is known by.
void ghost_syphon_set_app_name(const char *name);

// A server named `name`, with its own OpenGL context (Syphon's server API is
// OpenGL). Must be used from one thread at a time: the core's render thread.
GhostSyphonServer *ghost_syphon_server_create(const char *name, char *error,
                                              size_t error_capacity);

// Bind `surface` (an IOSurfaceRef the core renders into) as publish slot
// `slot`. Slots are bound once; publishing a slot reads the surface as it is.
int ghost_syphon_server_set_slot(GhostSyphonServer *server, uint32_t slot, void *surface,
                                 uint32_t width, uint32_t height, char *error,
                                 size_t error_capacity);

// Whether OpenGL has finished reading `slot` since it was last published, so
// the core may write it again.
int ghost_syphon_server_slot_free(GhostSyphonServer *server, uint32_t slot);

// Publish `slot` as the server's next frame. The caller must only publish a
// slot whose GPU writes have completed. `flipped`: the slot's rows run top
// down (Metal / IOSurface order) rather than OpenGL's bottom up.
int ghost_syphon_server_publish(GhostSyphonServer *server, uint32_t slot, int flipped);

int ghost_syphon_server_has_clients(GhostSyphonServer *server);

// Stop the server and free its context and textures.
void ghost_syphon_server_free(GhostSyphonServer *server);

#ifdef __cplusplus
}
#endif

#endif
