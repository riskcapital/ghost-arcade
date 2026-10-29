/**
 * What someone pasted into the importer: a p5.js Web Editor username, a link
 * to their sketches, or a link to one sketch.
 */

export type EditorTarget =
  | { kind: 'user'; username: string }
  | { kind: 'sketch'; username: string; id: string }
  | { kind: 'invalid'; reason: string };

export const EDITOR_USERNAME = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,64}$/;
export const EDITOR_SKETCH_ID = /^[A-Za-z0-9_-]{1,64}$/;

const EDITOR_HOSTS = new Set(['editor.p5js.org', 'preview.p5js.org']);
// Views of one sketch: the editor, full screen, embedded, and presented.
const SKETCH_VIEWS = new Set(['sketches', 'full', 'embed', 'present']);
const PROFILE_VIEWS = new Set(['sketches', 'collections', 'assets']);

const NOT_A_LINK = "That isn't a p5.js Web Editor username, profile link or sketch link.";

export function parseEditorInput(input: string): EditorTarget {
  const text = input.trim();
  if (!text) return { kind: 'invalid', reason: 'Enter a username or paste a sketch link.' };
  const bare = text.replace(/^@/, '');
  if (EDITOR_USERNAME.test(bare) && !/\.p5js\.org$/i.test(bare)) return { kind: 'user', username: bare };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { kind: 'invalid', reason: NOT_A_LINK };
  }
  if (!EDITOR_HOSTS.has(url.hostname.toLowerCase())) {
    return { kind: 'invalid', reason: 'Only links to editor.p5js.org can be imported. Other sketches import from a downloaded zip.' };
  }
  const segments = url.pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  // The editor's own API paths: /editor/<user>/projects[/<id>].
  if (segments[0] === 'editor' && segments[2] === 'projects') segments.splice(0, 3, segments[1], 'sketches');
  const [username, view, id] = segments;
  if (!username || !EDITOR_USERNAME.test(username)) return { kind: 'invalid', reason: NOT_A_LINK };
  if (id && view && SKETCH_VIEWS.has(view)) {
    return EDITOR_SKETCH_ID.test(id) ? { kind: 'sketch', username, id } : { kind: 'invalid', reason: NOT_A_LINK };
  }
  if (!view || (PROFILE_VIEWS.has(view) && !id) || view === 'collections') return { kind: 'user', username };
  return { kind: 'invalid', reason: NOT_A_LINK };
}
