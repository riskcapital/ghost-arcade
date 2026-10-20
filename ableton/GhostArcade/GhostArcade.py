# Ghost Arcade control surface.
#
# Reports the Live set (tracks, scenes, clip names and colours, locators)
# and every clip and scene launch to Ghost Arcade as JSON over UDP on this
# machine, so visuals can be linked to the set by name and fire on the same
# bar. On request it also streams device knobs, track levels and the notes
# of visual score tracks.
#
# Ghost Arcade listens on 127.0.0.1:11050; this script listens on
# 127.0.0.1:11051 for requests (resync, launch, transport, what to watch).
#
# Works with Live 10 (Python 2.7) through Live 12 (Python 3.11).

import errno
import json
import socket
import time

import Live

try:
    from _Framework.ControlSurface import ControlSurface
except ImportError:
    from ableton.v2.control_surface import ControlSurface

APP_ADDRESS = ("127.0.0.1", 11050)
SCRIPT_ADDRESS = ("127.0.0.1", 11051)
PROTOCOL = 3
NAME_LIMIT = 64
# update_display runs roughly ten times a second.
HEARTBEAT_TICKS = 10
SCENE_TICKS = 5
# Tracks compared for changes each tick, round-robin, so a big set never
# stalls Live's UI thread.
TRACKS_PER_TICK = 4
# Track levels go out at most this often per track (seconds).
LEVEL_INTERVAL = 0.02
# Notes beyond this many per clip are left out of a score.
NOTE_LIMIT = 512
# Every datagram stays under this size: macOS drops UDP sends over 9216
# bytes by default.
CHUNK_BYTES = 8000
# Windows reports an earlier send to a closed port as a reset on recvfrom.
RESET_ERRORS = (errno.ECONNRESET, 10054)


def _name(value):
    return (value or "")[:NAME_LIMIT]


def _dumps(value):
    return json.dumps(value, separators=(",", ":"))


def _normalized(parameter):
    span = parameter.max - parameter.min
    return (parameter.value - parameter.min) / span if span else 0.0


def _chunks(items):
    """Split items into runs whose JSON stays under CHUNK_BYTES."""
    chunk, size = [], 0
    for item in items:
        length = len(_dumps(item)) + 1
        if chunk and size + length > CHUNK_BYTES:
            yield chunk
            chunk, size = [], 0
        chunk.append(item)
        size += length
    yield chunk


def _clip_notes(clip):
    """The clip's loop as [pitch, start, duration, velocity], start from the loop start."""
    start = clip.loop_start
    span = clip.loop_end - clip.loop_start
    notes = []
    if hasattr(clip, "get_notes_extended"):
        for note in clip.get_notes_extended(0, 128, start, span):
            if not note.mute:
                notes.append([note.pitch, note.start_time - start, note.duration, int(note.velocity)])
    else:
        for pitch, at, duration, velocity, mute in clip.get_notes(start, 0, span, 128):
            if not mute:
                notes.append([pitch, at - start, duration, int(velocity)])
    notes.sort(key=lambda note: note[1])
    return notes[:NOTE_LIMIT]


def _level(track):
    """Live's current level; output_meter_level holds its peak for a second."""
    try:
        return max(track.output_meter_left, track.output_meter_right)
    except AttributeError:
        return track.output_meter_level


class GhostArcade(ControlSurface):

    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._socket = None
        self._send_failed = False
        self._ticks = 0
        self._scene_signature = None
        self._track_signatures = {}
        self._scan = 0
        self._revision = 0
        self._listeners = []
        self._watchers = []
        self._watch = {"params": [], "levels": [], "score": []}
        self._level_sent = {}
        self._level_pending = {}
        # Score clip notes, read once and refreshed when Live reports a
        # change: (track, slot) -> (clip, fingerprint, notes), and the
        # listener.
        self._notes_cache = {}
        self._note_listeners = {}
        self._rebuild = True
        self._song = Live.Application.get_application().get_document()
        self._open_socket()
        self._song.add_tracks_listener(self._structure_changed)
        self._song.add_scenes_listener(self._structure_changed)
        self._song.add_cue_points_listener(self._structure_changed)
        # Transport and tempo changes go out at once so Ghost Arcade's
        # song position never runs on a stale tempo.
        self._song.add_is_playing_listener(self._send_hello)
        self._song.add_tempo_listener(self._send_hello)
        self._crossfader().add_value_listener(self._send_crossfader)
        self._notify("Ghost Arcade connected")

    # Live lifecycle

    def disconnect(self):
        self._send({"t": "bye"})
        self._remove_listeners()
        self._remove_watchers()
        self._forget_notes()
        for remove, callback in (
            (self._song.remove_tracks_listener, self._structure_changed),
            (self._song.remove_scenes_listener, self._structure_changed),
            (self._song.remove_cue_points_listener, self._structure_changed),
            (self._song.remove_is_playing_listener, self._send_hello),
            (self._song.remove_tempo_listener, self._send_hello),
            (self._crossfader().remove_value_listener, self._send_crossfader),
        ):
            try:
                remove(callback)
            except Exception:
                pass
        if self._socket is not None:
            self._socket.close()
            self._socket = None
        ControlSurface.disconnect(self)

    def update_display(self):
        ControlSurface.update_display(self)
        self._receive()
        if self._rebuild:
            self._rebuild = False
            # Track and slot indices may have moved.
            self._forget_notes()
            self._add_listeners()
            self._apply_watch()
            self._send_structure(force=True)
        self._ticks += 1
        if self._song.is_playing:
            # The song position, so jumps and loop wraps reach Ghost
            # Arcade within a tick.
            self._send({"t": "pos", "beat": self._song.current_song_time})
        if self._ticks % SCENE_TICKS == 0:
            self._send_scenes()
        self._scan_tracks()
        if self._ticks % HEARTBEAT_TICKS == 0:
            self._send_hello()
        self._flush_levels()

    # Transport

    def _open_socket(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1 << 16)
            except Exception:
                pass
            sock.bind(SCRIPT_ADDRESS)
            sock.setblocking(False)
            self._socket = sock
        except Exception as error:
            self._socket = None
            self._log("Ghost Arcade: could not open port %d (%s)" % (SCRIPT_ADDRESS[1], error))
            self._notify("Ghost Arcade: port %d is busy" % SCRIPT_ADDRESS[1])

    def _send(self, message):
        if self._socket is None:
            return
        try:
            self._socket.sendto(_dumps(message).encode("utf-8"), APP_ADDRESS)
        except Exception as error:
            # Usually Ghost Arcade isn't listening yet and the next heartbeat
            # retries; log the first failure in case it's something else.
            if not self._send_failed:
                self._send_failed = True
                self._log("Ghost Arcade: send failed (%s)" % error)

    def _receive(self):
        if self._socket is None:
            return
        for _ in range(64):
            try:
                data, _address = self._socket.recvfrom(65536)
            except socket.error as error:
                if getattr(error, "errno", None) in RESET_ERRORS:
                    continue
                return
            try:
                self._handle(json.loads(data.decode("utf-8")))
            except Exception as error:
                self._log("Ghost Arcade: bad request (%s)" % error)

    def _track(self, index):
        """A track by index; -1 is the master track."""
        if index == -1:
            return self._song.master_track
        tracks = self._song.tracks
        return tracks[index] if 0 <= index < len(tracks) else None

    def _handle(self, message):
        kind = message.get("t")
        song = self._song
        if kind == "sync":
            self._send_hello()
            self._send_structure(force=True)
        elif kind == "fire_scene":
            index = int(message.get("s", -1))
            if 0 <= index < len(song.scenes):
                song.scenes[index].fire()
        elif kind == "fire_clip":
            track = self._track(int(message.get("i", -2)))
            slot = int(message.get("s", -1))
            if track is not None and 0 <= slot < len(track.clip_slots):
                track.clip_slots[slot].fire()
        elif kind == "stop_all":
            song.stop_all_clips()
        elif kind == "play":
            song.start_playing()
        elif kind == "continue":
            song.continue_playing()
        elif kind == "stop":
            song.stop_playing()
        elif kind == "stop_track":
            track = self._track(int(message.get("i", -2)))
            if track is not None and track != song.master_track:
                track.stop_all_clips()
        elif kind == "jump":
            song.current_song_time = max(0.0, float(message.get("time", 0)))
        elif kind == "crossfader":
            fader = self._crossfader()
            fader.value = fader.min + max(0.0, min(1.0, float(message.get("v", 0)))) * (fader.max - fader.min)
        elif kind == "assign":
            # Crossfader side for a track: 0 = A, 1 = none, 2 = B.
            track = self._track(int(message.get("i", -2)))
            side = int(message.get("x", 1))
            if track is not None and track != song.master_track and side in (0, 1, 2):
                track.mixer_device.crossfade_assign = side
        elif kind == "toggle_cue":
            song.set_or_delete_cue()
        elif kind == "create_score_track":
            try:
                song.create_midi_track(len(song.tracks))
                song.tracks[len(song.tracks) - 1].name = "Ghost Arcade"
            except Exception as error:
                # Live Intro and Lite cap the number of tracks.
                self._send({"t": "error", "what": "create_score_track", "detail": str(error)})
        elif kind == "devices":
            self._send_devices(int(message.get("i", -2)))
        elif kind == "watch":
            self._watch = {
                "params": [list(p) for p in message.get("params", []) if len(p) == 3],
                "levels": [int(i) for i in message.get("levels", [])],
                "score": [int(i) for i in message.get("score", [])],
            }
            self._forget_notes()
            self._apply_watch()
            self._send_structure(force=True)

    # State

    def _send_hello(self):
        song = self._song
        self._send({
            "t": "hello",
            "v": PROTOCOL,
            "tempo": song.tempo,
            "num": song.signature_numerator,
            "den": song.signature_denominator,
            "playing": bool(song.is_playing),
            "quantize": int(song.clip_trigger_quantization),
            "beat": song.current_song_time,
            "xf": _normalized(self._crossfader()),
            "rev": self._revision,
        })

    def _crossfader(self):
        return self._song.master_track.mixer_device.crossfader

    def _send_crossfader(self):
        self._send({"t": "xf", "v": _normalized(self._crossfader())})

    def _track_state(self, index, track):
        score = index in self._watch["score"]
        slots = []
        for slot in track.clip_slots:
            if slot.has_clip:
                clip = slot.clip
                entry = [_name(clip.name), clip.color, clip.length]
                if score and clip.is_midi_clip:
                    entry.append(self._score_notes(index, len(slots), clip))
                slots.append(entry)
            else:
                slots.append(None)
        return {"n": _name(track.name), "c": track.color, "midi": bool(track.has_midi_input),
                "x": int(track.mixer_device.crossfade_assign), "slots": slots}

    def _score_notes(self, track_index, slot_index, clip):
        """A score clip's notes, from the cache unless the clip changed."""
        key = (track_index, slot_index)
        fingerprint = (clip.name, clip.length, clip.loop_start, clip.loop_end)
        cached = self._notes_cache.get(key)
        if cached is not None and cached[0] == clip and cached[1] == fingerprint:
            return cached[2]
        notes = _clip_notes(clip)
        self._notes_cache[key] = (clip, fingerprint, notes)
        self._listen_notes(key, clip)
        return notes

    def _listen_notes(self, key, clip):
        previous = self._note_listeners.pop(key, None)
        if previous is not None:
            try:
                previous[0].remove_notes_listener(previous[1])
            except Exception:
                pass

        def changed():
            self._notes_cache.pop(key, None)
        try:
            clip.add_notes_listener(changed)
            self._note_listeners[key] = (clip, changed)
        except Exception:
            # Without the listener the clip is still re-read whenever its
            # name, length or loop changes.
            pass

    def _forget_notes(self):
        for clip, callback in self._note_listeners.values():
            try:
                clip.remove_notes_listener(callback)
            except Exception:
                pass
        self._note_listeners = {}
        self._notes_cache = {}

    def _send_track(self, index, track, state):
        """One track, split so every datagram stays small."""
        playing = track.playing_slot_index
        position = None
        if playing >= 0:
            clip = track.clip_slots[playing].clip
            if clip is not None:
                # How far into its loop the playing clip is, so a clip that
                # was already playing lines up with the song position.
                position = clip.playing_position - clip.loop_start
        parts = list(_chunks(state["slots"]))
        offset = 0
        for number, part in enumerate(parts):
            if number == 0:
                message = dict(state)
                message.update({"t": "track", "rev": self._revision, "i": index, "count": len(state["slots"]),
                                "slots": part, "play": playing, "fired": track.fired_slot_index, "pos": position})
            else:
                message = {"t": "slots", "i": index, "o": offset, "slots": part}
            self._send(message)
            offset += len(part)

    def _scene_state(self):
        song = self._song
        scenes = [{"n": _name(scene.name), "c": getattr(scene, "color", 0)} for scene in song.scenes]
        cues = sorted([[_name(cue.name), cue.time] for cue in song.cue_points], key=lambda cue: cue[1])
        return scenes, cues

    def _send_scenes(self, force=False):
        scenes, cues = self._scene_state()
        signature = _dumps([scenes, cues, len(self._song.tracks)])
        if not force and signature == self._scene_signature:
            return
        self._scene_signature = signature
        self._revision += 1
        parts = list(_chunks(scenes))
        self._send({"t": "set", "rev": self._revision, "scenes": parts[0], "count": len(scenes),
                    "tracks": len(self._song.tracks), "cues": cues})
        offset = len(parts[0])
        for part in parts[1:]:
            self._send({"t": "scenes", "o": offset, "scenes": part})
            offset += len(part)

    def _scan_tracks(self):
        """Compare a few tracks per tick and send any that changed."""
        tracks = self._song.tracks
        if not tracks:
            return
        for _ in range(min(TRACKS_PER_TICK, len(tracks))):
            index = self._scan % len(tracks)
            self._scan += 1
            track = tracks[index]
            state = self._track_state(index, track)
            signature = _dumps(state)
            if signature != self._track_signatures.get(index):
                self._track_signatures[index] = signature
                self._send_track(index, track, state)

    def _send_structure(self, force=False):
        """The whole set: scenes, locators and every track."""
        self._send_scenes(force=force)
        self._track_signatures = {}
        for index, track in enumerate(self._song.tracks):
            state = self._track_state(index, track)
            self._track_signatures[index] = _dumps(state)
            self._send_track(index, track, state)

    def _send_devices(self, index):
        track = self._track(index)
        if track is None:
            return
        devices = []
        for device in track.devices:
            devices.append({
                "n": _name(device.name),
                "p": [[_name(parameter.name), _normalized(parameter)] for parameter in device.parameters],
            })
        self._send({"t": "devices", "i": index, "devices": devices})

    # Launch events

    def _structure_changed(self):
        self._rebuild = True

    def _listen(self, subject, prop, callback, into=None):
        getattr(subject, "add_%s_listener" % prop)(callback)
        (self._listeners if into is None else into).append((subject, prop, callback))

    def _add_listeners(self):
        self._remove_listeners()
        for index, track in enumerate(self._song.tracks):
            self._listen(track, "playing_slot_index", self._make_track_callback(index, track, "play"))
            self._listen(track, "fired_slot_index", self._make_track_callback(index, track, "fired"))
        for index, scene in enumerate(self._song.scenes):
            self._listen(scene, "is_triggered", self._make_scene_callback(index, scene))

    def _remove_listeners(self, listeners=None):
        listeners = self._listeners if listeners is None else listeners
        for subject, prop, callback in listeners:
            try:
                getattr(subject, "remove_%s_listener" % prop)(callback)
            except Exception:
                pass
        del listeners[:]

    def _make_track_callback(self, index, track, kind):
        attribute = "playing_slot_index" if kind == "play" else "fired_slot_index"

        def callback():
            self._send({"t": kind, "i": index, "s": getattr(track, attribute), "beat": self._song.current_song_time})
        return callback

    def _make_scene_callback(self, index, scene):
        def callback():
            self._send({"t": "scene", "s": index, "trig": bool(scene.is_triggered), "beat": self._song.current_song_time})
        return callback

    # Knobs and levels

    def _remove_watchers(self):
        self._remove_listeners(self._watchers)

    def _apply_watch(self):
        self._remove_watchers()
        for i, j, k in self._watch["params"]:
            track = self._track(i)
            if track is None or not 0 <= j < len(track.devices):
                continue
            parameters = track.devices[j].parameters
            if not 0 <= k < len(parameters):
                continue
            callback = self._make_param_callback(i, j, k, parameters[k])
            self._listen(parameters[k], "value", callback, self._watchers)
            callback()
        for i in self._watch["levels"]:
            track = self._track(i)
            if track is not None:
                self._listen(track, "output_meter_level", self._make_level_callback(i, track), self._watchers)

    def _make_param_callback(self, i, j, k, parameter):
        def callback():
            self._send({"t": "param", "i": i, "j": j, "k": k, "v": _normalized(parameter)})
        return callback

    def _make_level_callback(self, i, track):
        def callback():
            now = time.time()
            if now - self._level_sent.get(i, 0) >= LEVEL_INTERVAL:
                self._level_sent[i] = now
                self._level_pending.pop(i, None)
                self._send({"t": "lvl", "i": i, "v": _level(track)})
            else:
                self._level_pending[i] = track
        return callback

    def _flush_levels(self):
        # A level held back by the rate limit still goes out, so meters
        # settle on their real value.
        for i, track in list(self._level_pending.items()):
            self._send({"t": "lvl", "i": i, "v": _level(track)})
        self._level_pending = {}

    # Messages

    def _log(self, text):
        if hasattr(self, "log_message"):
            self.log_message(text)

    def _notify(self, text):
        if hasattr(self, "show_message"):
            self.show_message(text)
