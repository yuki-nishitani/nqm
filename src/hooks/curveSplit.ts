/**
 * curveSplit.ts
 *
 * 曲線メンバー（arc / bezier）を任意の点で2分割するユーティリティ。
 *
 * 用語:
 *   bulge = tan(中心角 / 4)  ← AutoCAD/DXF 方式
 *   t     = 0〜1 のパラメータ（曲線上の位置）
 */

import { Node2D, Member, MemberCurve } from "../types";

// ─────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────

/** 分割結果：新ノードと 2 本の新メンバー */
export type SplitResult = {
  newNode: Omit<Node2D, "id">;          // 座標のみ（id は呼び出し側で付与）
  memberA: Omit<Member, "id">;          // 元の a 端 → 新ノード
  memberB: Omit<Member, "id">;          // 新ノード → 元の b 端
};

/** Canvas が mouseMove のたびに更新するホバー情報 */
export type CurveSplitCandidate = {
  memberId: string;
  t: number;          // 曲線パラメータ 0〜1
  worldX: number;
  worldY: number;
};

// ─────────────────────────────────────────────
// Arc ユーティリティ
// ─────────────────────────────────────────────

/**
 * bulge から円弧の幾何情報を求める。
 * 返り値: { cx, cy, r, startAngle, endAngle, sweepAngle }
 * sweepAngle は符号付き（bulge > 0 で反時計回り）
 */
function arcGeometry(ax: number, ay: number, bx: number, by: number, bulge: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const chord = Math.hypot(dx, dy);

  // bulge = tan(θ/4)  →  θ = 4*atan(bulge)
  const halfSweep = 2 * Math.atan(bulge);       // = θ/2 (符号付き)
  const r = chord / (2 * Math.abs(Math.sin(halfSweep)));

  // 弦の中点
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  // 弦の法線方向（bulge の符号で左右を選ぶ）
  const perpLen = r * Math.cos(halfSweep);      // 中点→中心の距離（符号付き）
  const nx = -dy / chord;
  const ny =  dx / chord;

  const cx = mx - perpLen * nx;
  const cy = my - perpLen * ny;

  const startAngle = Math.atan2(ay - cy, ax - cx);
  const endAngle   = Math.atan2(by - cy, bx - cx);

  // sweepAngle を bulge の符号に合わせる
  let sweep = endAngle - startAngle;
  if (bulge > 0 && sweep <= 0) sweep += 2 * Math.PI;
  if (bulge < 0 && sweep >= 0) sweep -= 2 * Math.PI;

  return { cx, cy, r, startAngle, endAngle: startAngle + sweep, sweepAngle: sweep };
}

/**
 * Arc 上のパラメータ t (0〜1) に対応するワールド座標を返す。
 */
export function arcPointAt(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
  t: number,
): { x: number; y: number } {
  const { cx, cy, r, startAngle, sweepAngle } = arcGeometry(ax, ay, bx, by, bulge);
  const angle = startAngle + sweepAngle * t;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/**
 * Arc をパラメータ t で分割し、2 本分の bulge を返す。
 * A→P の bulge = tan(sweep*t / 4)
 * P→B の bulge = tan(sweep*(1-t) / 4)
 */
function splitArcBulge(bulge: number, t: number): { bulgeAP: number; bulgePB: number } {
  // bulge = tan(sweep/4)  →  sweep = 4*atan(bulge)
  const totalSweep = 4 * Math.atan(bulge);
  const bulgeAP = Math.tan((totalSweep * t)       / 4);
  const bulgePB = Math.tan((totalSweep * (1 - t)) / 4);
  return { bulgeAP, bulgePB };
}

/**
 * Arc メンバーを t で分割。
 */
export function splitArc(
  nodeA: Node2D, nodeB: Node2D,
  bulge: number,
  t: number,
): SplitResult {
  const p = arcPointAt(nodeA.x, nodeA.y, nodeB.x, nodeB.y, bulge, t);
  const { bulgeAP, bulgePB } = splitArcBulge(bulge, t);

  const curveA: MemberCurve | undefined =
    Math.abs(bulgeAP) > 1e-9 ? { type: "arc", bulge: bulgeAP } : undefined;
  const curveB: MemberCurve | undefined =
    Math.abs(bulgePB) > 1e-9 ? { type: "arc", bulge: bulgePB } : undefined;

  return {
    newNode: { x: p.x, y: p.y },
    memberA: { a: nodeA.id, b: "__new__", curve: curveA },
    memberB: { a: "__new__", b: nodeB.id, curve: curveB },
  };
}

// ─────────────────────────────────────────────
// Bezier ユーティリティ（de Casteljau）
// ─────────────────────────────────────────────

type Vec2 = { x: number; y: number };

function lerp(p: Vec2, q: Vec2, t: number): Vec2 {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/**
 * 3 次ベジェを de Casteljau で t 分割。
 * 返り値: [ [P0,P01,P012,P0123], [P0123,P123,P23,P3] ]
 */
function casteljau(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number,
): [Vec2[], Vec2[]] {
  const p01  = lerp(p0, p1, t);
  const p12  = lerp(p1, p2, t);
  const p23  = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p0123 = lerp(p012, p123, t);
  return [
    [p0, p01, p012, p0123],
    [p0123, p123, p23, p3],
  ];
}

/**
 * Bezier 上のパラメータ t に対応するワールド座標を返す。
 */
export function bezierPointAt(
  ax: number, ay: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  bx: number, by: number,
  t: number,
): { x: number; y: number } {
  const [seg] = casteljau(
    { x: ax, y: ay }, { x: cp1x, y: cp1y },
    { x: cp2x, y: cp2y }, { x: bx, y: by }, t,
  );
  return seg[3]; // = p0123
}

/**
 * Bezier メンバーを t で分割。
 */
export function splitBezier(
  nodeA: Node2D, nodeB: Node2D,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  t: number,
): SplitResult {
  const p0: Vec2 = { x: nodeA.x, y: nodeA.y };
  const p1: Vec2 = { x: cp1x,   y: cp1y   };
  const p2: Vec2 = { x: cp2x,   y: cp2y   };
  const p3: Vec2 = { x: nodeB.x, y: nodeB.y };

  const [segA, segB] = casteljau(p0, p1, p2, p3, t);
  const newPt = segA[3];

  const curveA: MemberCurve = {
    type: "bezier",
    cp1x: segA[1].x, cp1y: segA[1].y,
    cp2x: segA[2].x, cp2y: segA[2].y,
  };
  const curveB: MemberCurve = {
    type: "bezier",
    cp1x: segB[1].x, cp1y: segB[1].y,
    cp2x: segB[2].x, cp2y: segB[2].y,
  };

  return {
    newNode: { x: newPt.x, y: newPt.y },
    memberA: { a: nodeA.id, b: "__new__", curve: curveA },
    memberB: { a: "__new__", b: nodeB.id, curve: curveB },
  };
}

// ─────────────────────────────────────────────
// 最近傍点の検索（Canvas の mouseMove で使う）
// ─────────────────────────────────────────────

const NEAREST_SAMPLES = 64; // サンプリング数（粗い探索）
const NEAREST_REFINE  = 20; // 二分探索の反復回数

/**
 * 曲線上でポインタに最も近い点を二段階で探す。
 *  1. 等間隔サンプリングで最近傍区間を特定
 *  2. その区間を二分探索で精密化
 * 返り値: { t, x, y, dist }
 */
export function nearestOnCurve(
  ax: number, ay: number,
  bx: number, by: number,
  curve: MemberCurve,
  px: number, py: number,
): { t: number; x: number; y: number; dist: number } {
  /** パラメータ t → 座標 */
  const ptAt = (t: number): Vec2 => {
    if (curve.type === "arc") {
      return arcPointAt(ax, ay, bx, by, curve.bulge, t);
    } else {
      const { cp1x, cp1y, cp2x, cp2y } = curve;
      return bezierPointAt(ax, ay, cp1x, cp1y, cp2x, cp2y, bx, by, t);
    }
  };

  const dist2 = (p: Vec2) => (p.x - px) ** 2 + (p.y - py) ** 2;

  // ── 粗い探索 ──
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= NEAREST_SAMPLES; i++) {
    const t = i / NEAREST_SAMPLES;
    const d = dist2(ptAt(t));
    if (d < bestD) { bestD = d; bestT = t; }
  }

  // ── 二分探索で精密化 ──
  let lo = Math.max(0, bestT - 1 / NEAREST_SAMPLES);
  let hi = Math.min(1, bestT + 1 / NEAREST_SAMPLES);
  for (let i = 0; i < NEAREST_REFINE; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist2(ptAt(m1)) < dist2(ptAt(m2))) hi = m2;
    else lo = m1;
  }
  bestT = (lo + hi) / 2;
  const best = ptAt(bestT);

  return { t: bestT, x: best.x, y: best.y, dist: Math.sqrt(dist2(best)) };
}

// ─────────────────────────────────────────────
// メンバーを分割するメイン関数（呼び出し側から使う）
// ─────────────────────────────────────────────

/**
 * member を t (0〜1) の位置で分割する。
 * newNodeId: 新しく生成するノードの id（呼び出し側で uuid 等を渡す）
 * 返り値: 新ノード、2 本の新メンバー（id は "__new__" を newNodeId で置換済み）
 */
export function splitMemberAtT(
  member: Member,
  nodeA: Node2D,
  nodeB: Node2D,
  t: number,
  newNodeId: string,
): { newNode: Node2D; memberA: Omit<Member, "id">; memberB: Omit<Member, "id"> } {
  if (!member.curve) {
    throw new Error("splitMemberAtT: member has no curve");
  }

  let result: SplitResult;
  if (member.curve.type === "arc") {
    result = splitArc(nodeA, nodeB, member.curve.bulge, t);
  } else {
    const { cp1x, cp1y, cp2x, cp2y } = member.curve;
    result = splitBezier(nodeA, nodeB, cp1x, cp1y, cp2x, cp2y, t);
  }

  // "__new__" を実際の id で置換
  const newNode: Node2D = { id: newNodeId, ...result.newNode };
  const memberA = {
    ...result.memberA,
    b: result.memberA.b === "__new__" ? newNodeId : result.memberA.b,
  };
  const memberB = {
    ...result.memberB,
    a: result.memberB.a === "__new__" ? newNodeId : result.memberB.a,
  };

  return { newNode, memberA, memberB };
}