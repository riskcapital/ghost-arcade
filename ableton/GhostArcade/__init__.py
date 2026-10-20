# Ghost Arcade control surface for Ableton Live.
#
# Install by copying this folder into your User Library's "Remote Scripts"
# folder (Ghost Arcade does this for you), then pick "GhostArcade" as a
# Control Surface in Live's Settings > Link, Tempo & MIDI.

from .GhostArcade import GhostArcade


def create_instance(c_instance):
    return GhostArcade(c_instance)
