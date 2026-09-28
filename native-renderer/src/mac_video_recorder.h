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

// Append the composite, addressed by the IOSurface id the core already
// exports. Returns 1 when a frame was written, 0 when this render landed
// inside a slot already written (the core renders faster than the recording
// rate), and -1 on error.
int ghost_mac_recorder_append(GhostMacVideoRecorder *recorder, uint32_t iosurface_id,
                              char *error, size_t error_capacity);

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
