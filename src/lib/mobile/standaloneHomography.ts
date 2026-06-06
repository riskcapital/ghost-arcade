// 4-point perspective warp for the standalone projection-mapping overlay.
// Solves the 3x3 homography that maps a source rectangle (0,0 → W,H) onto
// a destination quadrilateral (the four corners the user dragged) and
// returns it expanded into a 4x4 column-major matrix suitable for the CSS
// `transform: matrix3d(...)` property.
//
// Standard 8-coefficient projective solve via Gaussian elimination on the
// 8x8 system. Compact and dependency-free.

export type Pt = { x: number; y: number };

/** Identity corners for a `w × h` rect — top-left, top-right, bot-right, bot-left. */
export function identityCorners(w: number, h: number): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

/** Build the CSS `matrix3d(...)` string that warps a `srcW × srcH` rect
 *  whose top-left sits at (0,0) into the given destination quad. Returns
 *  the identity matrix if the solve fails (degenerate inputs). */
export function cornersToMatrix3d(srcW: number, srcH: number, dst: Pt[]): string {
  if (srcW <= 0 || srcH <= 0 || dst.length !== 4) return identityMatrix();
  const src: Pt[] = [
    { x: 0, y: 0 },
    { x: srcW, y: 0 },
    { x: srcW, y: srcH },
    { x: 0, y: srcH },
  ];
  const h = solveHomography(src, dst);
  if (!h) return identityMatrix();
  return matrix3dCSS(homography3x3To4x4(h));
}

function identityMatrix(): string {
  return 'matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)';
}

/** Solve for the 8 unknowns of the projective transform h11..h32 (with
 *  h33=1) given 4 source→destination point correspondences. Returns null
 *  if the system is singular. */
function solveHomography(s: Pt[], d: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = s[i];
    const { x: dx, y: dy } = d[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dx);
    b.push(dy);
  }
  return solve8(A, b);
}

function solve8(A: number[][], b: number[]): number[] | null {
  // Augment with b column.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 8; i++) {
    // Partial pivot on |M[k][i]|.
    let pivot = i;
    for (let k = i + 1; k < 8; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    }
    if (Math.abs(M[pivot][i]) < 1e-10) return null;
    if (pivot !== i) [M[i], M[pivot]] = [M[pivot], M[i]];
    for (let k = i + 1; k < 8; k++) {
      const f = M[k][i] / M[i][i];
      if (f === 0) continue;
      for (let j = i; j <= 8; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(8).fill(0);
  for (let i = 7; i >= 0; i--) {
    let s = M[i][8];
    for (let j = i + 1; j < 8; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Expand the 8-coefficient projective transform into a 4x4 matrix in
 *  row-major form. The CSS expects column-major — that conversion happens
 *  in `matrix3dCSS`. */
function homography3x3To4x4(h: number[]): number[][] {
  return [
    [h[0], h[1], 0, h[2]],
    [h[3], h[4], 0, h[5]],
    [0,    0,    1, 0   ],
    [h[6], h[7], 0, 1   ],
  ];
}

function matrix3dCSS(m: number[][]): string {
  const cols: number[] = [];
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) cols.push(m[r][c]);
  return `matrix3d(${cols.map(n => Number.isFinite(n) ? n : 0).join(',')})`;
}
