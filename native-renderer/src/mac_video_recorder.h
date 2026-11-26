#ifndef GHOST_MAC_VIDEO_RECORDER_H
#define GHOST_MAC_VIDEO_RECORDER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GhostMacVideoRecorder GhostMacVideoRecorder;

// Open an H.264 MP4 writer for `width`x`height` at `fps`. `quality` is one of
// "web", "high", "archive" and picks the bitrate, matching the tiers the
// Electron recorder used so a take does not change character.
GhostMacVideoRecorder *ghost_mac_recorder_open(const char *path, uint32_t width,
                                               uint32_t height, uint32_t fps,
                                               const char *quality, char *error,
                                               size_t error_capacity);

// Claim the recording slot *now* belongs to. Returns the frame index to
// capture, or -1 when this render landed inside a slot already claimed (the
// core renders faster than the recording rate) or the recorder is stopped.
int64_t ghost_mac_recorder_claim(GhostMacVideoRecorder *recorder);

// Append a captured frame, addressed by IOSurface id, at a claimed index.
// The caller must only append once the GPU work that filled the surface has
// completed, and must not write the surface again while it is in use.
// Returns 1 when the frame was written, 0 when the writer was not ready (the
// frame is dropped rather than stalling the render thread), -1 on error.
int ghost_mac_recorder_append(GhostMacVideoRecorder *recorder, uint32_t iosurface_id,
                              int64_t index, char *error, size_t error_capacity);

// Finish the file. `frames` and `duration_seconds` are optional out params.
int ghost_mac_recorder_finish(GhostMacVideoRecorder *recorder, uint64_t *frames,
                              double *duration_seconds, char *error,
                              size_t error_capacity);

uint64_t ghost_mac_recorder_frames(const GhostMacVideoRecorder *recorder);
double ghost_mac_recorder_duration(const GhostMacVideoRecorder *recorder);

void ghost_mac_recorder_free(GhostMacVideoRecorder *recorder);

#ifdef __cplusplus
}
#endif

#endif
