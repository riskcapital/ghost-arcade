# Runs the Ghost Arcade Live script against a fake Live and a fake socket,
# hands it requests, and prints what it did to Live as JSON.
#
#   python3 liveScriptHarness.py <path to GhostArcade.py> '<json list of requests>' [--live10] [--stopped] [--cues '<json [[name, beat]]>']
#
# --live10: a Live whose fire() and stop_all_clips() take no arguments.
# --stopped: Live's transport is stopped (locators can only be set then).
# --cues: the set's arrangement locators to start with. The result also
# lists the locators at the end ("cues") and every reply the script sent
# that isn't a heartbeat or the set ("replies").
#
# Requests are what the app sends (fire_clip, stop_track, stop_all ...). A
# request {"t": "_tick"} marks every fired clip as playing and runs the
# script's pending launches (protocol 5 jumps), as Live's next display tick
# would. No real socket is opened, so this never talks to a real Live.

import errno
import importlib.util
import json
import sys
import types

calls = []
replies = []
LIVE10 = "--live10" in sys.argv[3:]
STOPPED = "--stopped" in sys.argv[3:]
CUES = []
if "--cues" in sys.argv[3:]:
    CUES = json.loads(sys.argv[sys.argv.index("--cues") + 1])


def record(*entry):
    calls.append(list(entry))


class Listeners(object):
    """Accepts add_*_listener / remove_*_listener for anything."""

    def __getattr__(self, name):
        if name.startswith("add_") or name.startswith("remove_"):
            return lambda *args, **kwargs: None
        raise AttributeError(name)


class FakeClip(Listeners):
    def __init__(self, track, slot):
        self.track, self.slot = track, slot
        self.name = "clip %d.%d" % (track, slot)
        self.color = 0
        self.length = 4.0
        self.loop_start = 0.0
        self.loop_end = 4.0
        self.is_midi_clip = False
        self.is_playing = False
        self.is_triggered = False
        self.playing_position = 0.0

    def jump(self, beats):
        record("jump", self.track, self.slot, beats, song.clip_trigger_quantization)


class FakeSlot(Listeners):
    def __init__(self, track, index):
        self.track, self.index = track, index
        self.clip = FakeClip(track, index)
        self.has_clip = True

    def fire(self, *args, **kwargs):
        if LIVE10 and (args or kwargs):
            raise TypeError("fire() takes no arguments")
        record("fire", self.track, self.index, list(args), kwargs, song.clip_trigger_quantization)
        self.clip.is_triggered = True


class FakeTrack(Listeners):
    def __init__(self, index):
        self.index = index
        self.name = "Track %d" % index
        self.color = 0
        self.has_midi_input = False
        self.clip_slots = [FakeSlot(index, s) for s in range(4)]
        self.playing_slot_index = -1
        self.fired_slot_index = -1
        self.devices = []
        self.mixer_device = types.SimpleNamespace(crossfade_assign=1)

    def stop_all_clips(self, *args):
        if LIVE10 and args:
            raise TypeError("stop_all_clips() takes no arguments")
        record("stop_track", self.index, list(args), song.clip_trigger_quantization)


class FakeCue(Listeners):
    def __init__(self, name, time):
        self.name = name
        self._time = float(time)

    @property
    def time(self):
        return self._time


class FakeScene(Listeners):
    def __init__(self, index):
        self.index = index
        self.name = "Scene %d" % (index + 1)
        self.color = 0

    def fire(self, *args, **kwargs):
        record("fire_scene", self.index, list(args), song.clip_trigger_quantization)


class FakeSong(Listeners):
    def __init__(self):
        self.tracks = [FakeTrack(i) for i in range(3)]
        self.scenes = [FakeScene(i) for i in range(4)]
        self.cue_points = [FakeCue(name, beat) for name, beat in CUES]
        self.tempo = 120.0
        self.signature_numerator = 4
        self.signature_denominator = 4
        self.is_playing = not STOPPED
        self.current_song_time = 0.0
        self._q = 4
        fader = Listeners()
        fader.min, fader.max, fader.value = 0.0, 1.0, 0.5
        self.master_track = types.SimpleNamespace(mixer_device=types.SimpleNamespace(crossfader=fader))

    @property
    def clip_trigger_quantization(self):
        return self._q

    @clip_trigger_quantization.setter
    def clip_trigger_quantization(self, value):
        record("set_quantize", int(value))
        self._q = int(value)

    def stop_all_clips(self, *args):
        if LIVE10 and args:
            raise TypeError("stop_all_clips() takes no arguments")
        record("stop_all", list(args), self._q)

    def set_or_delete_cue(self):
        """Live's own: a locator at the playhead goes, else one is added there."""
        for cue in self.cue_points:
            if abs(cue.time - self.current_song_time) < 1e-6:
                self.cue_points.remove(cue)
                record("delete_cue", cue.time)
                return
        self.cue_points.append(FakeCue("", self.current_song_time))
        self.cue_points.sort(key=lambda cue: cue.time)
        record("add_cue", self.current_song_time)


song = FakeSong()

live = types.ModuleType("Live")
live.Application = types.SimpleNamespace(get_application=lambda: types.SimpleNamespace(get_document=lambda: song))
live.Song = types.SimpleNamespace(Quantization=types.SimpleNamespace(values=list(range(14))))
sys.modules["Live"] = live

framework = types.ModuleType("_Framework")
control_surface = types.ModuleType("_Framework.ControlSurface")


class ControlSurface(object):
    def __init__(self, c_instance):
        pass

    def update_display(self):
        pass

    def disconnect(self):
        pass

    def show_message(self, text):
        pass

    def log_message(self, text):
        record("log", text)


control_surface.ControlSurface = ControlSurface
sys.modules["_Framework"] = framework
sys.modules["_Framework.ControlSurface"] = control_surface


class FakeSocket(object):
    def __init__(self, *args):
        pass

    def setsockopt(self, *args):
        pass

    def bind(self, address):
        pass

    def setblocking(self, flag):
        pass

    def sendto(self, data, address):
        message = json.loads(data.decode("utf-8"))
        record("sent", message.get("t"))
        if message.get("t") not in ("hello", "set", "scenes", "track", "slots", "pos"):
            replies.append(message)

    def recvfrom(self, size):
        raise fake_socket.error(errno.EAGAIN, "nothing")

    def close(self):
        pass


fake_socket = types.ModuleType("socket")
fake_socket.socket = FakeSocket
fake_socket.error = OSError
fake_socket.AF_INET = 2
fake_socket.SOCK_DGRAM = 2
fake_socket.SOL_SOCKET = 1
fake_socket.SO_SNDBUF = 7
sys.modules["socket"] = fake_socket

spec = importlib.util.spec_from_file_location("GhostArcadeUnderTest", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
surface = module.GhostArcade(None)
del calls[:]
del replies[:]

for request in json.loads(sys.argv[2]):
    if request.get("t") == "_tick":
        for track in song.tracks:
            for slot in track.clip_slots:
                if slot.clip.is_triggered:
                    slot.clip.is_triggered = False
                    slot.clip.is_playing = True
        run = getattr(surface, "_run_jumps", None)
        if run is not None and getattr(surface, "_pending_jumps", None):
            run()
        continue
    try:
        surface._handle(request)
    except Exception as error:
        record("error", str(error))

print(json.dumps({
    "protocol": module.PROTOCOL,
    "calls": [c for c in calls if c[0] != "sent"],
    "cues": [[cue.name, cue.time] for cue in song.cue_points],
    "replies": replies,
    "song_time": song.current_song_time,
}))
