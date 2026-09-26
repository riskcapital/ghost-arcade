/**
 * Small dense linear algebra for the projector calibration solver.
 *
 * Everything here is plain double-precision arrays: the problems are tiny
 * (a 2n x 12 DLT system, a 9 x 9 normal matrix), so clarity and numerical
 * care matter more than speed. The SVD is one-sided Jacobi (Hestenes),
 * which is slow for big matrices but accurate to working precision and has
 * no convergence surprises on the rank-deficient systems DLT produces.
 */

export type Vec3 = [number, number, number];
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

export interface SvdResult {
  /** Left singular vectors as columns (m x n). */
  U: number[][];
  /** Singular values, sorted descending. */
  S: number[];
  /** Right singular vectors as columns (n x n). */
  V: number[][];
}

/** Thin SVD of an m x n matrix with m >= n. */
export function svd(input: number[][]): SvdResult {
  const m = input.length;
  const n = input[0]?.length ?? 0;
  if (m < n) throw new Error(`svd needs rows >= cols (got ${m}x${n})`);
  const A = input.map((row) => row.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  const eps = 1e-15;
  for (let sweep = 0; sweep < 80; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          const ap = A[i][p];
          const aq = A[i][q];
          alpha += ap * ap;
          beta += aq * aq;
          gamma += ap * aq;
        }
        if (gamma === 0 || Math.abs(gamma) <= eps * Math.sqrt(alpha * beta)) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const ap = A[i][p];
          const aq = A[i][q];
          A[i][p] = c * ap - s * aq;
          A[i][q] = s * ap + c * aq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i][p];
          const vq = V[i][q];
          V[i][p] = c * vp - s * vq;
          V[i][q] = s * vp + c * vq;
        }
      }
    }
    if (!rotated) break;
  }

  const norms = Array.from({ length: n }, (_, j) => {
    let sum = 0;
    for (let i = 0; i < m; i++) sum += A[i][j] * A[i][j];
    return Math.sqrt(sum);
  });
  const order = norms.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const S = order.map((entry) => entry.value);
  const U = Array.from({ length: m }, (_, i) => order.map(({ value, index }) => (value > 0 ? A[i][index] / value : 0)));
  const Vs = Array.from({ length: n }, (_, i) => order.map(({ index }) => V[i][index]));
  return { U, S, V: Vs };
}

/** Right singular vector of the smallest singular value (the least-squares
 *  null vector of A), plus the two smallest singular values so callers can
 *  judge whether that null space is one-dimensional. */
export function nullVector(A: number[][]): { vector: number[]; smallest: number; secondSmallest: number; largest: number } {
  const { S, V } = svd(A);
  const n = S.length;
  return {
    vector: V.map((row) => row[n - 1]),
    smallest: S[n - 1],
    secondSmallest: S[n - 2] ?? S[n - 1],
    largest: S[0],
  };
}

/** Solve A x = b with Gaussian elimination and partial pivoting. Returns
 *  null when A is singular to working precision. */
export function solveLinear(Ain: number[][], bin: number[]): number[] | null {
  const n = bin.length;
  const A = Ain.map((row) => row.slice());
  const b = bin.slice();
  let scale = 0;
  for (const row of A) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const tiny = Math.max(scale, 1e-300) * 1e-14;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (Math.abs(A[pivot][col]) <= tiny) return null;
    if (pivot !== col) {
      [A[pivot], A[col]] = [A[col], A[pivot]];
      [b[pivot], b[col]] = [b[col], b[pivot]];
    }
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col];
      if (factor === 0) continue;
      for (let k = col; k < n; k++) A[row][k] -= factor * A[col][k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= A[row][k] * x[k];
    x[row] = sum / A[row][row];
  }
  return x.every(Number.isFinite) ? x : null;
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function norm3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize3(a: Vec3): Vec3 {
  const length = norm3(a);
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
}

export function mat3MulVec(M: Mat3, v: Vec3): Vec3 {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

export function mat3Mul(A: Mat3, B: Mat3): Mat3 {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return out;
}

export function mat3Transpose(A: Mat3): Mat3 {
  return [
    [A[0][0], A[1][0], A[2][0]],
    [A[0][1], A[1][1], A[2][1]],
    [A[0][2], A[1][2], A[2][2]],
  ];
}

export function mat3Det(A: Mat3): number {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
    - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
    + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}

/** Rotation matrix for a rotation vector (axis * angle, radians). */
export function rodrigues(r: Vec3): Mat3 {
  const theta = norm3(r);
  if (theta < 1e-12) {
    // First-order expansion keeps tiny Jacobian steps exact to O(theta^2).
    return [
      [1, -r[2], r[1]],
      [r[2], 1, -r[0]],
      [-r[1], r[0], 1],
    ];
  }
  const [x, y, z] = [r[0] / theta, r[1] / theta, r[2] / theta];
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}

/** Nearest rotation (polar factor) of a 3x3 matrix, det forced to +1. */
export function orthonormalize(M: Mat3): Mat3 {
  const { U, V } = svd(M.map((row) => row.slice()));
  let R = mat3Mul(U as Mat3, mat3Transpose(V as Mat3));
  if (mat3Det(R) < 0) {
    const Uf = U.map((row) => [row[0], row[1], -row[2]]) as Mat3;
    R = mat3Mul(Uf, mat3Transpose(V as Mat3));
  }
  return R;
}

/** Angle (radians) of the relative rotation between two rotation matrices. */
export function rotationAngleBetween(A: Mat3, B: Mat3): number {
  const D = mat3Mul(A, mat3Transpose(B));
  const cos = (D[0][0] + D[1][1] + D[2][2] - 1) / 2;
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** RQ decomposition of a 3x3 matrix, M = K R, with K upper triangular and a
 *  positive diagonal and R orthonormal (det R = sign(det M)). */
export function rq3(M: Mat3): { K: Mat3; R: Mat3 } | null {
  const m1: Vec3 = [M[0][0], M[0][1], M[0][2]];
  const m2: Vec3 = [M[1][0], M[1][1], M[1][2]];
  const m3: Vec3 = [M[2][0], M[2][1], M[2][2]];
  const k33 = norm3(m3);
  if (!(k33 > 0)) return null;
  const r3 = scale3(m3, 1 / k33);
  const k23 = dot3(m2, r3);
  const m2p = sub3(m2, scale3(r3, k23));
  const k22 = norm3(m2p);
  if (!(k22 > 0)) return null;
  const r2 = scale3(m2p, 1 / k22);
  const k13 = dot3(m1, r3);
  const k12 = dot3(m1, r2);
  const m1p = sub3(sub3(m1, scale3(r2, k12)), scale3(r3, k13));
  const k11 = norm3(m1p);
  if (!(k11 > 0)) return null;
  const r1 = scale3(m1p, 1 / k11);
  return {
    K: [[k11, k12, k13], [0, k22, k23], [0, 0, k33]],
    R: [r1, r2, r3] as Mat3,
  };
}
