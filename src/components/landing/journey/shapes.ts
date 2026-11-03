/**
 * Particle shapes for the journey. Each returns N xyz positions (Float32Array, length N*3) in world space.
 * Deterministic (seeded) so every visit looks the same and SSR/CSR never disagree.
 */

export function rng(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type V3 = [number, number, number];

/** Particles packed inside each ice block: the four things Vantage makes. */
export function clusters(n: number, centers: V3[], size = 0.5, seed = 1) {
  const r = rng(seed);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = centers[i % centers.length];
    out[i * 3] = c[0] + (r() - 0.5) * size;
    out[i * 3 + 1] = c[1] + (r() - 0.5) * size;
    out[i * 3 + 2] = c[2] + (r() - 0.5) * size;
  }
  return out;
}

/** Land of the world, from the bundled lat/lon list, wrapped on a sphere. */
export function globe(n: number, land: number[], center: V3, radius = 2.2, seed = 2) {
  const r = rng(seed);
  const out = new Float32Array(n * 3);
  const count = land.length / 2;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(r() * count);
    const lat = ((land[k * 2] + (r() - 0.5) * 1.6) * Math.PI) / 180;
    const lon = ((land[k * 2 + 1] + (r() - 0.5) * 1.6) * Math.PI) / 180;
    const rr = radius * (1 + (r() - 0.5) * 0.015);
    out[i * 3] = center[0] + rr * Math.cos(lat) * Math.cos(lon);
    out[i * 3 + 1] = center[1] + rr * Math.sin(lat);
    out[i * 3 + 2] = center[2] - rr * Math.cos(lat) * Math.sin(lon);
  }
  return out;
}

/** Points along a polyline (with a little thickness and depth). */
function alongPath(pts: [number, number][], n: number, r: () => number, thick: number) {
  const segs: { a: [number, number]; b: [number, number]; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push({ a: pts[i], b: pts[i + 1], len });
    total += len;
  }
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    let d = r() * total;
    let s = segs[0];
    for (const x of segs) {
      if (d <= x.len) {
        s = x;
        break;
      }
      d -= x.len;
    }
    const t = s.len ? d / s.len : 0;
    out.push([s.a[0] + (s.b[0] - s.a[0]) * t + (r() - 0.5) * thick, s.a[1] + (s.b[1] - s.a[1]) * t + (r() - 0.5) * thick, (r() - 0.5) * thick * 1.4]);
  }
  return out;
}

/** A shield with a check mark: every line checked. */
export function shield(n: number, center: V3, seed = 3) {
  const r = rng(seed);
  const outline: [number, number][] = [];
  // Top edge, sides, and a curved point at the bottom.
  outline.push([-1.35, 1.35], [0, 1.6], [1.35, 1.35], [1.35, 0.2]);
  for (let a = 0; a <= 1.0001; a += 0.05) outline.push([1.35 * Math.cos((a * Math.PI) / 2), 0.2 - 1.85 * Math.sin((a * Math.PI) / 2)]);
  for (let a = 1; a >= -0.0001; a -= 0.05) outline.push([-1.35 * Math.cos((a * Math.PI) / 2), 0.2 - 1.85 * Math.sin((a * Math.PI) / 2)]);
  outline.push([-1.35, 1.35]);
  const check: [number, number][] = [[-0.62, 0.05], [-0.15, -0.45], [0.7, 0.62]];
  const a = alongPath(outline, Math.floor(n * 0.62), r, 0.09);
  const b = alongPath(check, n - a.length, r, 0.16);
  return place([...a, ...b], center);
}

/** The Vantage "V". */
export function vee(n: number, center: V3, seed = 4) {
  const r = rng(seed);
  const pts = [
    ...alongPath([[-1.45, 1.45], [0, -1.45]], Math.floor(n * 0.5), r, 0.34),
    ...alongPath([[0, -1.45], [1.45, 1.45]], n - Math.floor(n * 0.5), r, 0.34),
  ];
  return place(pts, center);
}

function place(pts: V3[], c: V3) {
  const out = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    out[i * 3] = c[0] + p[0];
    out[i * 3 + 1] = c[1] + p[1];
    out[i * 3 + 2] = c[2] + p[2];
  });
  return out;
}
