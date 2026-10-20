# Ghost Arcade control surface.
#
# Reports the Live set (tracks, scenes, clip names and colours) and every
# clip and scene launch to Ghost Arcade as JSON over UDP on this machine, so
# visuals can be linked to the set by name and fire on the same bar.
#
# Ghost Arcade listens on 127.0.0.1:11050; this script listens on
# 127.0.0.1:11051 for requests (resync, launch a clip or scene).

import json
import socket

import Live

try:
    from _Framework.ControlSurface import ControlSurface
except ImportError:
    from ableton.v2.control_surface import ControlSurface

APP_ADDRESS = ("127.0.0.1", 11050)
SCRIPT_ADDRESS = ("127.0.0.1", 11051)
PROTOCOL = 1
NAME_LIMIT = 64
# update_display runs roughly ten times a second.
HEARTBEAT_TICKS = 10
STRUCTURE_TICKS = 5


def _name(value):
    return (value or "")[:NAME_LIMIT]


class GhostArcade(ControlSurface):

    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._socket = None
        self._ticks = 0
        self._signature = None
        self._revision = 0
        self._listeners = []
        self._rebuild = True
        self._song = Live.Application.get_application().get_document()
        self._open_socket()
        self._song.add_tracks_listener(self._structure_changed)
        self._song.add_scenes_listener(self._structure_changed)
        self._notify("Ghost Arcade connected")

    # Live lifecycle

    def disconnect(self):
        self._send({"t": "bye"})
        self._remove_listeners()
        for remove, callback in (
            (self._song.remove_tracks_listener, self._structure_changed),
            (self._song.remove_scenes_listener, self._structure_changed),
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
            self._add_listeners()
            self._send_structure(force=True)
        self._ticks += 1
        if self._ticks % STRUCTURE_TICKS == 0:
            self._send_structure()
        if self._ticks % HEARTBEAT_TICKS == 0:
            self._send_hello()

    # Transport

    def _open_socket(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
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
            self._socket.sendto(json.dumps(message, separators=(",", ":")).encode("utf-8"), APP_ADDRESS)
        except Exception:
            # Ghost Arcade isn't listening yet; the next heartbeat retries.
            pass

    def _receive(self):
        if self._socket is None:
            return
        for _ in range(64):
            try:
                data, _address = self._socket.recvfrom(65536)
            except Exception:
                return
            try:
                self._handle(json.loads(data.decode("utf-8")))
            except Exception as error:
                self._log("Ghost Arcade: bad request (%s)" % error)

    def _handle(self, message):
        kind = message.get("t")
        if kind == "sync":
            self._send_hello()
            self._send_structure(force=True)
        elif kind == "fire_scene":
            scenes = self._song.scenes
            index = int(message.get("s", -1))
            if 0 <= index < len(scenes):
                scenes[index].fire()
        elif kind == "fire_clip":
            tracks = self._song.tracks
            track = int(message.get("i", -1))
            slot = int(message.get("s", -1))
            if 0 <= track < len(tracks) and 0 <= slot < len(tracks[track].clip_slots):
                tracks[track].clip_slots[slot].fire()
        elif kind == "stop_all":
            self._song.stop_all_clips()

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
            "rev": self._revision,
        })

    def _track_state(self, track):
        slots = []
        for slot in track.clip_slots:
            if slot.has_clip:
                clip = slot.clip
                slots.append([_name(clip.name), clip.color])
            else:
                slots.append(None)
        return {"n": _name(track.name), "c": track.color, "slots": slots}

    def _send_structure(self, force=False):
        scenes = [{"n": _name(scene.name), "c": getattr(scene, "color", 0)} for scene in self._song.scenes]
        tracks = [self._track_state(track) for track in self._song.tracks]
        signature = json.dumps([scenes, tracks])
        if not force and signature == self._signature:
            return
        self._signature = signature
        self._revision += 1
        # One datagram per track keeps every message well under the UDP limit.
        self._send({"t": "set", "rev": self._revision, "scenes": scenes, "tracks": len(tracks)})
        for index, (state, track) in enumerate(zip(tracks, self._song.tracks)):
            state.update({"t": "track", "rev": self._revision, "i": index,
                          "play": track.playing_slot_index, "fired": track.fired_slot_index})
            self._send(state)

    # Launch events

    def _structure_changed(self):
        self._rebuild = True

    def _listen(self, subject, prop, callback):
        getattr(subject, "add_%s_listener" % prop)(callback)
        self._listeners.append((subject, prop, callback))

    def _add_listeners(self):
        self._remove_listeners()
        for index, track in enumerate(self._song.tracks):
            self._listen(track, "playing_slot_index", self._make_track_callback(index, track, "play"))
            self._listen(track, "fired_slot_index", self._make_track_callback(index, track, "fired"))
        for index, scene in enumerate(self._song.scenes):
            self._listen(scene, "is_triggered", self._make_scene_callback(index, scene))

    def _remove_listeners(self):
        for subject, prop, callback in self._listeners:
            try:
                getattr(subject, "remove_%s_listener" % prop)(callback)
            except Exception:
                pass
        self._listeners = []

    def _make_track_callback(self, index, track, kind):
        attribute = "playing_slot_index" if kind == "play" else "fired_slot_index"

        def callback():
            self._send({"t": kind, "i": index, "s": getattr(track, attribute), "beat": self._song.current_song_time})
        return callback

    def _make_scene_callback(self, index, scene):
        def callback():
            self._send({"t": "scene", "s": index, "trig": bool(scene.is_triggered), "beat": self._song.current_song_time})
        return callback

    # Messages

    def _log(self, text):
        if hasattr(self, "log_message"):
            self.log_message(text)

    def _notify(self, text):
        if hasattr(self, "show_message"):
            self.show_message(text)
