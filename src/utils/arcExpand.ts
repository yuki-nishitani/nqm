/**
 * arcExpand.ts — 円弧部材をポリライン（直線サブ要素）に展開するユーティリティ
 */

import type { FemInput } from "./femTypes";

export const ARC_SUBDIVISIONS = 16;

let _counter = 0;
function resetCounter() { _counter = 0; }
function nextId(prefix: string) { return `__${prefix}_${_counter++}`; }

type ArcGeom = {
  cx: number; cy: number;
  r: number;
  startAngle: number;
  angleSpan: number;
};

/**
 * bulge と端点座標から円弧の中心・半径・角度情報を求める。
 *
 *   bulge > 0（反時計）→ 円弧は左手側に膨らむ → 中心も左手側 (sign = +1)
 *   bulge < 0（時計）  → 円弧は右手側に膨らむ → 中心も右手側 (sign = -1)
 *
 * 作図制約: |angleSpan| <= π （180° を超える円弧は作成不可）
 */
export function arcGeomFromBulge(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
): ArcGeom {
  const d = Math.hypot(bx - ax, by - ay);
  const r = d * (bulge * bulge + 1) / (4 * Math.abs(bulge));

  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const sagitta = bulge * d / 2;

  // 弦の左手垂直方向（A→B を進行方向としたとき左を向くベクトル）
  const perpX = -(by - ay) / d;
  const perpY =  (bx - ax) / d;

  const h = r - Math.abs(sagitta);
  // bulge > 0（反時計 = 左膨らみ）→ 中心は左手側 → sign = +1
  // bulge < 0（時計   = 右膨らみ）→ 中心は右手側 → sign = -1
  const sign = bulge > 0 ? 1 : -1;
  const cx = mx + sign * perpX * h;
  const cy = my + sign * perpY * h;

  const startAngle = Math.atan2(ay - cy, ax - cx);
  const endAngle   = Math.atan2(by - cy, bx - cx);

  // (-π, π] に正規化してから bulge の符号と方向を合わせる
  let angleSpan = endAngle - startAngle;
  while (angleSpan >  Math.PI) angleSpan -= 2 * Math.PI;
  while (angleSpan < -Math.PI) angleSpan += 2 * Math.PI;

  // bulge 符号と回転方向を一致させる
  if (bulge > 0 && angleSpan < 0) angleSpan += 2 * Math.PI;
  if (bulge < 0 && angleSpan > 0) angleSpan -= 2 * Math.PI;

  // 作図制約: 180° 超は逆回りの短い弧に補正
  if (angleSpan >  Math.PI) angleSpan -= 2 * Math.PI;
  if (angleSpan < -Math.PI) angleSpan += 2 * Math.PI;

  return { cx, cy, r, startAngle, angleSpan };
}

export type SubNode   = { id: string; x: number; y: number };
export type SubMember = {
  id: string; a: string; b: string;
  /** 円弧サブ部材のみ：所属する円弧の幾何情報とこのサブ部材の角度範囲 */
  arcGeom?: { cx: number; cy: number; r: number; startAngle: number; angleSpan: number };
};

export function expandArcMember(
  nodeIdA: string, ax: number, ay: number,
  nodeIdB: string, bx: number, by: number,
  bulge: number,
  n = ARC_SUBDIVISIONS,
): { subNodes: SubNode[]; subMembers: SubMember[] } {
  if (Math.abs(bulge) < 1e-9) {
    return {
      subNodes: [],
      subMembers: [{ id: nextId("M"), a: nodeIdA, b: nodeIdB }],
    };
  }

  const { cx, cy, r, startAngle, angleSpan } = arcGeomFromBulge(ax, ay, bx, by, bulge);

  const subNodes: SubNode[]   = [];
  const subMembers: SubMember[] = [];
  const pointIds: string[]    = [nodeIdA];

  for (let i = 1; i < n; i++) {
    const angle = startAngle + angleSpan * (i / n);
    const id = nextId("N");
    subNodes.push({ id, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    pointIds.push(id);
  }
  pointIds.push(nodeIdB);

  for (let i = 0; i < n; i++) {
    const segStartAngle = startAngle + angleSpan * (i / n);
    const segAngleSpan  = angleSpan / n;
    subMembers.push({
      id: nextId("M"),
      a: pointIds[i],
      b: pointIds[i + 1],
      arcGeom: { cx, cy, r, startAngle: segStartAngle, angleSpan: segAngleSpan },
    });
  }

  return { subNodes, subMembers };
}

export type ExpandedFemInput = Omit<FemInput, "members"> & {
  members: { id: string; a: string; b: string }[];
  arcGroupMap: Map<string, string>;
  arcMemberGeom: Map<string, { cx: number; cy: number; r: number; startAngle: number; angleSpan: number }>;
};

export function expandArcMembers(original: FemInput): ExpandedFemInput {
  resetCounter();

  const nodeMap = new Map(original.nodes.map(n => [n.id, n]));

  const nodes:      { id: string; x: number; y: number }[] = [...original.nodes];
  const members:    { id: string; a: string; b: string }[] = [];
  const distLoads:  typeof original.distLoads               = [];
  const arcGroupMap   = new Map<string, string>();
  const arcMemberGeom = new Map<string, { cx: number; cy: number; r: number; startAngle: number; angleSpan: number }>();

  const arcMemberIds = new Set(
    original.members
      .filter(m => m.curve?.type === "arc" && Math.abs(m.curve.bulge) >= 1e-9)
      .map(m => m.id),
  );
  for (const dl of original.distLoads) {
    if (!arcMemberIds.has(dl.memberId)) distLoads.push(dl);
  }

  for (const m of original.members) {
    const isArc = m.curve?.type === "arc" && Math.abs(m.curve.bulge) >= 1e-9;

    if (!isArc) {
      members.push({ id: m.id, a: m.a, b: m.b });
      continue;
    }

    const nA = nodeMap.get(m.a)!;
    const nB = nodeMap.get(m.b)!;
    const { subNodes, subMembers } = expandArcMember(
      m.a, nA.x, nA.y,
      m.b, nB.x, nB.y,
      (m.curve as { bulge: number }).bulge,
    );

    for (const sn of subNodes) nodes.push(sn);
    for (const sm of subMembers) {
      members.push(sm);
      arcGroupMap.set(sm.id, m.id);
      if (sm.arcGeom) arcMemberGeom.set(sm.id, sm.arcGeom);
    }

    const arcDls = original.distLoads.filter(dl => dl.memberId === m.id);
    for (const dl of arcDls) {
      for (const sm of subMembers) {
        distLoads.push({ id: nextId("DL"), memberId: sm.id, angleDeg: dl.angleDeg, magnitude: dl.magnitude });
      }
    }
  }

  return { ...original, nodes, members, distLoads, arcGroupMap, arcMemberGeom };
}