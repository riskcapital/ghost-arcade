# Controlling Ghost Arcade from an AI client

Ghost Arcade can host an MCP server, so an AI client such as Claude Desktop can
operate it: fire clips, move faders, launch columns, set tempo, and look at the
output to check the result.

## Turning it on

Settings, OSC section, **AI control (MCP)**. It is off by default and never
enables itself.

You get a URL and a token:

```
http://127.0.0.1:7420/
Authorization: Bearer <token>
```

The token is regenerated every time the server starts, so switching the toggle
off and on again revokes whatever a client is holding.

## Connecting a client

Point an MCP client at that URL with the bearer token as a header. In Claude
Desktop's config that looks like:

```json
{
  "mcpServers": {
    "ghost-arcade": {
      "url": "http://127.0.0.1:7420/",
      "headers": { "Authorization": "Bearer PASTE_TOKEN_HERE" }
    }
  }
}
```

Ghost Arcade has to be running. The server lives in the app, not the other way
round.

## Tools

| Tool | Does |
| --- | --- |
| `get_state` | Both decks: layer opacity, blend, solo/mute, what is playing, what is in each cell |
| `list_controls` | The control-path vocabulary and its ranges |
| `set_control` | Set any control path. This is the main way to operate the app |
| `read_control` | Read one path back |
| `get_output_frame` | A PNG of what is on the output right now |

`set_control` is deliberately the whole instrument rather than a tool per
action. Ghost Arcade addresses everything through paths like `vj:0:opacity` or
`vj:column:2`, and MIDI and OSC dispatch through the same router, so a model
reaches whatever a hardware controller reaches. Anything added later for a
controller shows up here without new tools.

Note that control paths are **zero-based** (`vj:0:opacity` is the first layer),
unlike the OSC addresses in `docs/osc.md`, which are one-based for humans.

`get_output_frame` needs an active output surface: an output window, or a
Syphon/NDI/Spout sender. With nothing being output there is no frame to read
and the tool says so.

## Security

The server binds to `127.0.0.1` only, so nothing off this machine can reach it,
and every request must carry the bearer token, which keeps other local
processes out. Neither substitutes for the other.

Worth being clear about what this grants: a client that can reach the server can
black out your output, stop every clip, and change anything mid-show. Turn it
off when you are not using it, and do not paste the token anywhere you would not
paste a password.
