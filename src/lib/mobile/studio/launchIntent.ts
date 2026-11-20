// Where the welcome screen sends the studio when it opens.
//
// The welcome screen sits in front of the studio and picks one of three paths. The studio
// reads the choice once, as it starts, so it opens on that workspace instead of its usual one;
// nothing is kept, and a later start without a choice opens as it always has.

export type LaunchPath = 'vj' | 'mapping' | 'control';

let next: LaunchPath | null = null;

export function setLaunchPath(path: LaunchPath): void {
  next = path;
}

/** The chosen path, once. Later calls return null until another choice is made. */
export function takeLaunchPath(): LaunchPath | null {
  const path = next;
  next = null;
  return path;
}
