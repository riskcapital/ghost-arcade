/** Original genre expansions; four-bar jungle chops and matched musical parts. */
import type { FloorCollection } from './floorLibrary';
export const EXTRA_COLLECTIONS: FloorCollection[] = [
  {
    "id": "oxide",
    "name": "Oxide Breaks",
    "style": "jungle",
    "bpm": 170,
    "kit": "kit.chopped-room",
    "roots": [
      0,
      0,
      5,
      4
    ],
    "bassTone": "bass.roller-reese",
    "keysTone": "keys.liquid-tines",
    "leadTone": "lead.hollow",
    "bass": [
      [
        0,
        1.2,
        0,
        0.95
      ],
      [
        1.75,
        0.3,
        0,
        0.6
      ],
      [
        2.5,
        0.7,
        4,
        0.85
      ],
      [
        3.5,
        0.3,
        2,
        0.65
      ]
    ],
    "hook": [
      [
        0,
        1.2,
        4,
        0.8
      ],
      [
        2.5,
        0.6,
        6,
        0.65
      ]
    ],
    "answer": [
      [
        0,
        1.2,
        4,
        0.8
      ],
      [
        2,
        0.5,
        7,
        0.75
      ],
      [
        3,
        0.6,
        6,
        0.6
      ]
    ],
    "chords": [
      [
        0,
        2.8,
        0.6
      ]
    ],
    "drums": {
      "kick": "x.x.......x.....x......x..x..o..x.x.......x...o.x.....x...x.....",
      "snare": "....x..o.o..x.o.....x.o..o..x.ox....x..o....x..o....x.oo.o.xx.ox",
      "hatClosed": "x.o.x.x.o.x.x.o.x.x.o.x.x.o.x.oxx.o.x.x.o.x.x.o.x.x.o.x.o.x.ox.o",
      "tom": "...............................o..........................o..o.."
    },
    "swing": 0.06
  },
  {
    "id": "concrete",
    "name": "Concrete Ghosts",
    "style": "jungle",
    "bpm": 164,
    "kit": "kit.chopped-room",
    "roots": [
      0,
      6,
      0,
      3
    ],
    "bassTone": "bass.liquid-sub",
    "keysTone": "keys.rave-chop",
    "leadTone": "lead.hollow",
    "bass": [
      [
        0,
        0.8,
        0,
        0.9
      ],
      [
        1.5,
        0.35,
        7,
        0.65
      ],
      [
        2.25,
        0.8,
        0,
        0.85
      ],
      [
        3.5,
        0.3,
        4,
        0.7
      ]
    ],
    "hook": [
      [
        0.75,
        0.3,
        7,
        0.8
      ],
      [
        2,
        0.5,
        4,
        0.7
      ],
      [
        3,
        0.5,
        2,
        0.6
      ]
    ],
    "answer": [
      [
        0.75,
        0.3,
        7,
        0.8
      ],
      [
        1.5,
        0.3,
        6,
        0.65
      ],
      [
        2.5,
        0.7,
        4,
        0.75
      ]
    ],
    "chords": [
      [
        1.5,
        0.2,
        0.7
      ],
      [
        3.5,
        0.2,
        0.5
      ]
    ],
    "drums": {
      "kick": "x.....x...x.....x..x......x.....x.....x...x..o..x......x.x......",
      "snare": "....x.o.....x..o....x..o.o..x.o.....x.o.....x..o....x..ox..ox.ox",
      "hatClosed": "x.x.o.x.x.x.o.x.x.o.x.o.x.x.o.x.x.x.o.x.x.x.o.x.x.o.x.o.x.o.x.ox",
      "hatOpen": "..............o.......o.......................o................."
    },
    "swing": 0.1
  },
  {
    "id": "razor",
    "name": "Razor Splice",
    "style": "jungle",
    "bpm": 176,
    "kit": "kit.chopped-room",
    "roots": [
      0,
      0,
      3,
      4
    ],
    "bassTone": "bass.roller-reese",
    "keysTone": "keys.rave-chop",
    "leadTone": "lead.signal-pluck",
    "bass": [
      [
        0,
        0.3,
        0,
        1
      ],
      [
        0.75,
        0.3,
        7,
        0.75
      ],
      [
        1.5,
        0.3,
        0,
        0.85
      ],
      [
        2.75,
        0.5,
        4,
        0.8
      ],
      [
        3.5,
        0.3,
        2,
        0.65
      ]
    ],
    "hook": [
      [
        0,
        0.25,
        7,
        0.85
      ],
      [
        0.75,
        0.25,
        7,
        0.65
      ],
      [
        2,
        0.5,
        4,
        0.8
      ]
    ],
    "answer": [
      [
        0,
        0.25,
        7,
        0.85
      ],
      [
        0.75,
        0.25,
        9,
        0.65
      ],
      [
        2,
        0.5,
        7,
        0.8
      ],
      [
        3,
        0.5,
        4,
        0.6
      ]
    ],
    "chords": [
      [
        0.75,
        0.18,
        0.7
      ],
      [
        2.75,
        0.18,
        0.55
      ]
    ],
    "drums": {
      "kick": "x.x.......xx....x......x..x.....x.x.......x.....x.....x..x......",
      "snare": "....x..x.o..x..o....x.o..o..x.ox....x..o.o..x..o....x.ox..ox.xox",
      "hatClosed": "x.o.x.o.x.o.x.o.x.x.o.x.o.x.x.o.x.o.x.o.x.o.x.o.x.x.o.x.o.x.o.x.",
      "tom": "..............................o..........................o......"
    },
    "swing": 0.03
  },
  {
    "id": "chrome",
    "name": "Chrome Carousel",
    "style": "french",
    "bpm": 124,
    "kit": "kit.club-pocket",
    "roots": [
      0,
      5,
      3,
      4
    ],
    "bassTone": "bass.club-finger",
    "keysTone": "keys.filter-disco",
    "leadTone": "lead.robot-reed",
    "bass": [
      [
        0.5,
        0.3,
        0,
        0.9
      ],
      [
        1,
        0.2,
        7,
        0.7
      ],
      [
        1.75,
        0.2,
        4,
        0.55
      ],
      [
        2.5,
        0.3,
        0,
        0.85
      ],
      [
        3.25,
        0.2,
        2,
        0.6
      ]
    ],
    "hook": [
      [
        0.5,
        0.3,
        4,
        0.8
      ],
      [
        1.25,
        0.2,
        4,
        0.6
      ],
      [
        1.75,
        0.5,
        7,
        0.85
      ],
      [
        3,
        0.5,
        6,
        0.65
      ]
    ],
    "answer": [
      [
        0.5,
        0.3,
        4,
        0.8
      ],
      [
        1.25,
        0.2,
        4,
        0.6
      ],
      [
        1.75,
        0.5,
        9,
        0.85
      ],
      [
        3,
        0.5,
        7,
        0.65
      ]
    ],
    "chords": [
      [
        0,
        0.25,
        0.8
      ],
      [
        0.75,
        0.18,
        0.5
      ],
      [
        1.5,
        0.25,
        0.7
      ],
      [
        2.5,
        0.25,
        0.75
      ],
      [
        3.25,
        0.18,
        0.55
      ]
    ],
    "drums": {
      "kick": "x...x...x...x...x...x...x...x..o",
      "clap": "....x.......x.......x.......x...",
      "hatClosed": "o..o..o.o..o..o.o..o..o.o..o.o..",
      "hatOpen": "..x...x...x...x...x...x...x...x.",
      "rim": ".......o.......o...o.......o...."
    },
    "swing": 0.14
  },
  {
    "id": "mirrorball",
    "name": "Mirrorball Relay",
    "style": "french",
    "bpm": 118,
    "kit": "kit.club-pocket",
    "roots": [
      0,
      3,
      0,
      4
    ],
    "bassTone": "bass.envelope-funk",
    "keysTone": "keys.filter-disco",
    "leadTone": "lead.robot-reed",
    "bass": [
      [
        0,
        0.25,
        0,
        0.95
      ],
      [
        0.75,
        0.2,
        4,
        0.65
      ],
      [
        1.5,
        0.25,
        7,
        0.85
      ],
      [
        2.25,
        0.2,
        0,
        0.5
      ],
      [
        2.75,
        0.25,
        4,
        0.8
      ],
      [
        3.5,
        0.3,
        6,
        0.7
      ]
    ],
    "hook": [
      [
        0,
        0.4,
        0,
        0.85
      ],
      [
        1,
        0.3,
        2,
        0.65
      ],
      [
        1.75,
        0.5,
        4,
        0.8
      ],
      [
        3,
        0.6,
        7,
        0.7
      ]
    ],
    "answer": [
      [
        0,
        0.4,
        0,
        0.85
      ],
      [
        1,
        0.3,
        2,
        0.65
      ],
      [
        1.75,
        0.5,
        6,
        0.8
      ],
      [
        3,
        0.6,
        4,
        0.7
      ]
    ],
    "chords": [
      [
        0.5,
        0.3,
        0.75
      ],
      [
        1.5,
        0.2,
        0.6
      ],
      [
        2.75,
        0.3,
        0.8
      ]
    ],
    "drums": {
      "kick": "x...x...x...x...x...x...x...x..o",
      "clap": "....x.......x.......x.......x...",
      "hatClosed": "o..o..o.o..o..o.o..o..o.o..o.o..",
      "hatOpen": "..x...x...x...x...x...x...x...x.",
      "rim": ".......o.......o...o.......o...."
    },
    "swing": 0.18
  },
  {
    "id": "blacksteel",
    "name": "Black Steel",
    "style": "industrial",
    "bpm": 92,
    "kit": "kit.black-steel",
    "roots": [
      0,
      0,
      5,
      4
    ],
    "bassTone": "bass.furnace",
    "keysTone": "keys.rave-chop",
    "leadTone": "lead.robot-reed",
    "bass": [
      [
        0,
        0.7,
        0,
        1
      ],
      [
        1.75,
        0.2,
        0,
        0.55
      ],
      [
        2.5,
        0.5,
        7,
        0.9
      ],
      [
        3.5,
        0.3,
        4,
        0.7
      ]
    ],
    "hook": [
      [
        0,
        1.3,
        0,
        0.85
      ],
      [
        2.75,
        0.7,
        4,
        0.7
      ]
    ],
    "answer": [
      [
        0,
        1.3,
        0,
        0.85
      ],
      [
        2,
        0.4,
        2,
        0.65
      ],
      [
        3,
        0.6,
        4,
        0.75
      ]
    ],
    "chords": [
      [
        0,
        0.4,
        0.8
      ],
      [
        2.75,
        0.25,
        0.55
      ]
    ],
    "drums": {
      "kick": "x..x......x.....x......x.....x..",
      "snare": "........x...............x...o..o",
      "hatClosed": "x.....o...x..o..x..o......x...ox",
      "tom": "......o..............o........o.",
      "crash": "x..............................."
    },
    "swing": 0.04
  },
  {
    "id": "fracture",
    "name": "Fracture Choir",
    "style": "industrial",
    "bpm": 86,
    "kit": "kit.black-steel",
    "roots": [
      0,
      5,
      3,
      4
    ],
    "bassTone": "bass.furnace",
    "keysTone": "pad.dark-drone",
    "leadTone": "lead.robot-reed",
    "bass": [
      [
        0,
        1.4,
        0,
        0.95
      ],
      [
        2.75,
        0.45,
        0,
        0.8
      ],
      [
        3.5,
        0.25,
        7,
        0.65
      ]
    ],
    "hook": [
      [
        0.5,
        1.2,
        4,
        0.8
      ],
      [
        2.5,
        0.8,
        2,
        0.6
      ]
    ],
    "answer": [
      [
        0.5,
        1.2,
        4,
        0.8
      ],
      [
        2.5,
        0.4,
        6,
        0.7
      ],
      [
        3.25,
        0.5,
        4,
        0.6
      ]
    ],
    "chords": [
      [
        0,
        2.8,
        0.6
      ]
    ],
    "drums": {
      "kick": "x.........x.....x..x.........x..",
      "snare": "........x...............x.....o.",
      "hatClosed": "x...o.x...o...x.x...o.x..o..x.ox",
      "rim": "......o............o.........o..",
      "crash": "x..............................o"
    },
    "swing": 0.08
  },
  {
    "id": "aurora",
    "name": "Aurora Climb",
    "style": "jamtronica",
    "bpm": 132,
    "kit": "kit.club-pocket",
    "roots": [
      0,
      3,
      5,
      4
    ],
    "bassTone": "bass.octave-pluck",
    "keysTone": "keys.liquid-tines",
    "leadTone": "lead.summit",
    "bass": [
      [
        0,
        0.3,
        0,
        0.95
      ],
      [
        0.5,
        0.25,
        4,
        0.6
      ],
      [
        1,
        0.3,
        7,
        0.8
      ],
      [
        1.5,
        0.25,
        4,
        0.55
      ],
      [
        2,
        0.3,
        0,
        0.85
      ],
      [
        2.5,
        0.25,
        2,
        0.6
      ],
      [
        3,
        0.4,
        4,
        0.8
      ]
    ],
    "hook": [
      [
        0,
        1.4,
        4,
        0.85
      ],
      [
        1.5,
        0.4,
        6,
        0.7
      ],
      [
        2,
        1.5,
        7,
        0.9
      ]
    ],
    "answer": [
      [
        0,
        0.4,
        4,
        0.8
      ],
      [
        0.5,
        0.4,
        6,
        0.65
      ],
      [
        1,
        1.4,
        9,
        0.9
      ],
      [
        2.5,
        0.4,
        7,
        0.75
      ],
      [
        3,
        0.65,
        6,
        0.7
      ]
    ],
    "chords": [
      [
        0,
        1.4,
        0.65
      ],
      [
        2.5,
        1.2,
        0.55
      ]
    ],
    "drums": {
      "kick": "x...x...x..xx...x...x...x...x...",
      "snare": "....x.......x.......x..o....x..o",
      "hatClosed": "x.oxx.oxx.oxx.oxx.oxx.oxx.oxx.o.",
      "hatOpen": "......o.......o.......o.......o."
    },
    "swing": 0.02
  },
  {
    "id": "solar",
    "name": "Solar Overpass",
    "style": "jamtronica",
    "bpm": 126,
    "kit": "kit.club-pocket",
    "roots": [
      0,
      5,
      3,
      4
    ],
    "bassTone": "bass.club-finger",
    "keysTone": "keys.filter-disco",
    "leadTone": "lead.summit",
    "bass": [
      [
        0.5,
        0.4,
        0,
        0.9
      ],
      [
        1.25,
        0.2,
        4,
        0.55
      ],
      [
        1.75,
        0.3,
        7,
        0.8
      ],
      [
        2.5,
        0.4,
        0,
        0.85
      ],
      [
        3.5,
        0.3,
        2,
        0.65
      ]
    ],
    "hook": [
      [
        0.5,
        0.4,
        2,
        0.7
      ],
      [
        1,
        1.25,
        4,
        0.85
      ],
      [
        2.5,
        0.4,
        7,
        0.8
      ],
      [
        3,
        0.65,
        6,
        0.65
      ]
    ],
    "answer": [
      [
        0.5,
        0.4,
        2,
        0.7
      ],
      [
        1,
        1.25,
        6,
        0.85
      ],
      [
        2.5,
        0.4,
        9,
        0.9
      ],
      [
        3,
        0.65,
        7,
        0.75
      ]
    ],
    "chords": [
      [
        0.5,
        0.5,
        0.7
      ],
      [
        2,
        0.8,
        0.6
      ]
    ],
    "drums": {
      "kick": "x...x...x..xx...x...x...x...x...",
      "snare": "....x.......x.......x..o....x..o",
      "hatClosed": "x.oxx.oxx.oxx.oxx.oxx.oxx.oxx.o.",
      "hatOpen": "......o.......o.......o.......o."
    },
    "swing": 0.06
  },
  {
    "id": "cobalt",
    "name": "Cobalt Citadel",
    "style": "chiptune",
    "bpm": 152,
    "kit": "kit.pixel-console",
    "roots": [
      0,
      5,
      3,
      4
    ],
    "bassTone": "bass.chip-triangle",
    "keysTone": "keys.chip-arp",
    "leadTone": "lead.chip-pulse",
    "bass": [
      [
        0,
        0.4,
        0,
        0.9
      ],
      [
        0.5,
        0.4,
        0,
        0.65
      ],
      [
        1,
        0.4,
        4,
        0.8
      ],
      [
        1.5,
        0.4,
        7,
        0.7
      ],
      [
        2,
        0.4,
        0,
        0.85
      ],
      [
        2.5,
        0.4,
        4,
        0.65
      ],
      [
        3,
        0.4,
        2,
        0.75
      ]
    ],
    "hook": [
      [
        0,
        0.4,
        7,
        0.9
      ],
      [
        0.5,
        0.2,
        6,
        0.65
      ],
      [
        0.75,
        0.2,
        4,
        0.7
      ],
      [
        1,
        0.4,
        2,
        0.8
      ],
      [
        1.5,
        0.4,
        4,
        0.75
      ],
      [
        2,
        1.2,
        7,
        0.9
      ]
    ],
    "answer": [
      [
        0,
        0.4,
        7,
        0.9
      ],
      [
        0.5,
        0.2,
        9,
        0.7
      ],
      [
        0.75,
        0.2,
        7,
        0.65
      ],
      [
        1,
        0.4,
        6,
        0.8
      ],
      [
        1.5,
        0.4,
        4,
        0.7
      ],
      [
        2,
        1.2,
        2,
        0.85
      ]
    ],
    "chords": [
      [
        0,
        0.4,
        0.7
      ],
      [
        1,
        0.4,
        0.55
      ],
      [
        2,
        0.4,
        0.65
      ],
      [
        3,
        0.4,
        0.6
      ]
    ],
    "drums": {
      "kick": "x.......x.x.....x.....x.x.......",
      "snare": "....x.......x.......x.......x..o",
      "hatClosed": "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.xx",
      "tom": ".............................o.o"
    },
    "swing": 0
  },
  {
    "id": "ion",
    "name": "Ion Foundry",
    "style": "chiptune",
    "bpm": 160,
    "kit": "kit.pixel-console",
    "roots": [
      0,
      3,
      6,
      4
    ],
    "bassTone": "bass.chip-triangle",
    "keysTone": "keys.chip-arp",
    "leadTone": "lead.chip-pulse",
    "bass": [
      [
        0,
        0.2,
        0,
        0.95
      ],
      [
        0.25,
        0.2,
        0,
        0.6
      ],
      [
        1,
        0.4,
        7,
        0.8
      ],
      [
        1.5,
        0.4,
        4,
        0.7
      ],
      [
        2,
        0.4,
        0,
        0.9
      ],
      [
        3,
        0.4,
        4,
        0.75
      ]
    ],
    "hook": [
      [
        0,
        0.2,
        0,
        0.85
      ],
      [
        0.25,
        0.2,
        2,
        0.65
      ],
      [
        0.5,
        0.4,
        4,
        0.8
      ],
      [
        1,
        0.8,
        7,
        0.9
      ],
      [
        2,
        0.4,
        6,
        0.75
      ],
      [
        2.5,
        0.4,
        4,
        0.65
      ]
    ],
    "answer": [
      [
        0,
        0.2,
        0,
        0.85
      ],
      [
        0.25,
        0.2,
        2,
        0.65
      ],
      [
        0.5,
        0.4,
        4,
        0.8
      ],
      [
        1,
        0.8,
        9,
        0.9
      ],
      [
        2,
        0.4,
        7,
        0.75
      ],
      [
        2.5,
        0.4,
        6,
        0.65
      ]
    ],
    "chords": [
      [
        0,
        0.4,
        0.75
      ],
      [
        1.5,
        0.4,
        0.6
      ],
      [
        2.5,
        0.4,
        0.65
      ]
    ],
    "drums": {
      "kick": "x.......x.x.....x.....x.x.......",
      "snare": "....x.......x.......x.......x..o",
      "hatClosed": "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.xx",
      "tom": ".............................o.o"
    },
    "swing": 0
  },
  {
    "id": "starlift",
    "name": "Starlift Run",
    "style": "chiptune",
    "bpm": 144,
    "kit": "kit.pixel-console",
    "roots": [
      0,
      4,
      5,
      3
    ],
    "bassTone": "bass.chip-triangle",
    "keysTone": "keys.chip-arp",
    "leadTone": "lead.chip-pulse",
    "bass": [
      [
        0,
        0.4,
        0,
        0.9
      ],
      [
        1,
        0.4,
        4,
        0.7
      ],
      [
        1.5,
        0.4,
        7,
        0.8
      ],
      [
        2,
        0.4,
        0,
        0.85
      ],
      [
        2.5,
        0.4,
        2,
        0.6
      ],
      [
        3,
        0.4,
        4,
        0.75
      ]
    ],
    "hook": [
      [
        0,
        0.7,
        4,
        0.85
      ],
      [
        0.75,
        0.2,
        2,
        0.65
      ],
      [
        1,
        0.4,
        0,
        0.75
      ],
      [
        1.5,
        0.4,
        2,
        0.7
      ],
      [
        2,
        1.3,
        7,
        0.9
      ]
    ],
    "answer": [
      [
        0,
        0.7,
        4,
        0.85
      ],
      [
        0.75,
        0.2,
        6,
        0.65
      ],
      [
        1,
        0.4,
        7,
        0.8
      ],
      [
        1.5,
        0.4,
        9,
        0.75
      ],
      [
        2,
        1.3,
        7,
        0.9
      ]
    ],
    "chords": [
      [
        0,
        0.45,
        0.7
      ],
      [
        1,
        0.45,
        0.55
      ],
      [
        2,
        0.45,
        0.65
      ],
      [
        3,
        0.45,
        0.6
      ]
    ],
    "drums": {
      "kick": "x.......x.x.....x.....x.x.......",
      "snare": "....x.......x.......x.......x..o",
      "hatClosed": "x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.xx",
      "tom": ".............................o.o"
    },
    "swing": 0
  }
];
