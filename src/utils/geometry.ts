import { GRID } from "../types";

// ===== 汎用ユーティリティ =====
export const snap = (v: number, g = GRID) => Math.round(v / g) * g;
export const uid  = (p: string) => `${p}_${Math.random().toString(16).slice(2)}`;

export function dist2(ax: number, ay: number, bx: number, by: number) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

// ===== 幾何：線分と矩形の交差判定 =====
type Rect = { x1: number; y1: number; x2: number; y2: number };

export function pointInRect(px: number, py: number, r: Rect) {
  return px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  return Math.min(ax, bx) <= px && px <= Math.max(ax, bx)
      && Math.min(ay, by) <= py && py <= Math.max(ay, by);
}

export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
) {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * 点 (px,py) から線分 A-B への垂線の足を返す。
 * t は線分上の位置パラメータ（0=A端, 1=B端）。
 * t が 0〜1 の範囲内なら線分内に足がある。
 */
export function projectPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { x: number; y: number; t: number; dist: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: ax, y: ay, t: 0, dist: Math.hypot(px - ax, py - ay) };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const fx = ax + t * dx, fy = ay + t * dy;
  return { x: fx, y: fy, t, dist: Math.hypot(px - fx, py - fy) };
}

/**
 * 線分 A-B 上で、グリッド線（縦・横）との交点を全列挙し、
 * クリック点 (px, py) に最も近い交点を返す。
 * 端点（t=0, t=1）は除外する（既存ノードと重複しないため）。
 * 交点が見つからない場合は null を返す。
 */
export function nearestGridIntersectionOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  grid = GRID,
  eps = 1e-9,
): { x: number; y: number } | null {
  const dx = bx - ax, dy = by - ay;
  const candidates: { x: number; y: number }[] = [];

  // 縦グリッド線 x = gx との交点: ax + t*dx = gx → t = (gx - ax) / dx
  if (Math.abs(dx) > eps) {
    const xMin = Math.ceil(Math.min(ax, bx) / grid) * grid;
    const xMax = Math.floor(Math.max(ax, bx) / grid) * grid;
    for (let gx = xMin; gx <= xMax; gx += grid) {
      const t = (gx - ax) / dx;
      if (t <= eps || t >= 1 - eps) continue; // 端点除外
      const gy = ay + t * dy;
      candidates.push({ x: gx, y: gy });
    }
  }

  // 横グリッド線 y = gy との交点: ay + t*dy = gy → t = (gy - ay) / dy
  if (Math.abs(dy) > eps) {
    const yMin = Math.ceil(Math.min(ay, by) / grid) * grid;
    const yMax = Math.floor(Math.max(ay, by) / grid) * grid;
    for (let gy = yMin; gy <= yMax; gy += grid) {
      const t = (gy - ay) / dy;
      if (t <= eps || t >= 1 - eps) continue; // 端点除外
      const gx = ax + t * dx;
      candidates.push({ x: gx, y: gy });
    }
  }

  if (candidates.length === 0) return null;

  // クリック点に最も近い候補を返す
  let best = candidates[0];
  let bestD2 = (px - best.x) ** 2 + (py - best.y) ** 2;
  for (const c of candidates.slice(1)) {
    const d2 = (px - c.x) ** 2 + (py - c.y) ** 2;
    if (d2 < bestD2) { best = c; bestD2 = d2; }
  }
  return best;
}

export function segmentHitsRect(
  ax: number, ay: number, bx: number, by: number,
  r: Rect,
) {
  if (pointInRect(ax, ay, r) || pointInRect(bx, by, r)) return true;
  const { x1, y1, x2, y2 } = r;
  return segmentsIntersect(ax, ay, bx, by, x1, y1, x2, y1)
      || segmentsIntersect(ax, ay, bx, by, x1, y2, x2, y2)
      || segmentsIntersect(ax, ay, bx, by, x1, y1, x1, y2)
      || segmentsIntersect(ax, ay, bx, by, x2, y1, x2, y2);
}