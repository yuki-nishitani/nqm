// ===== FEM 計算結果の型定義 =====

export type SectionPoint = {
  t: number;
  N: number;
  Q: number;
  M: number;
};

export type ElementResult = {
  memberId: string;
  Na: number; Qa: number; Ma: number;
  Nb: number; Qb: number; Mb: number;
  points: SectionPoint[];
};

export type ReactionResult = {
  supportId: string;
  nodeId: string;
  fx: number;
  fy: number;
  m: number;
};

export type DisplacementResult = {
  nodeId: string;
  ux: number;
  uy: number;
  rot: number;
};

/** 展開済み部材（円弧をサブ直線に分解したもの）。DiagramLayer の描画に使用 */
export type ExpandedNode   = { id: string; x: number; y: number };
export type ExpandedMember = { id: string; a: string; b: string };

export type FemResult = {
  ok: true;
  elements:        ElementResult[];
  reactions:       ReactionResult[];
  displacements:   DisplacementResult[];
  /** 円弧をサブ直線に展開した後の nodes/members。DiagramLayer の描画用 */
  expandedNodes:   ExpandedNode[];
  expandedMembers: ExpandedMember[];
  /**
   * サブ部材ID → 元の円弧部材ID のマッピング。
   * 直線部材はエントリなし（自身のIDが元IDと同一）。
   * DiagramLayer で円弧グループをひとつなぎのポリラインとして描画するために使用。
   */
  arcGroupMap: Map<string, string>;
  /**
   * サブ部材ID → そのサブ部材が属する円弧の幾何情報。
   * DiagramLayer が各サブ部材上の点を円弧上の真座標で計算するために使用。
   */
  arcMemberGeom: Map<string, { cx: number; cy: number; r: number; startAngle: number; angleSpan: number }>;
} | {
  ok: false;
  reason: "unstable" | "unsupported" | "no_members" | "singular" | "validation";
  message: string;
};

/** FemInput で使用する曲線情報（Bulge のみ対応）*/
export type FemMemberCurve = { type: "arc"; bulge: number };

export type FemInput = {
  nodes:      { id: string; x: number; y: number }[];
  members:    { id: string; a: string; b: string; curve?: FemMemberCurve }[];
  supports:   { id: string; nodeId: string; type: "pin" | "roller" | "fix"; angleDeg: number }[];
  joints:     { id: string; nodeId: string }[];
  pointLoads: { id: string; nodeId: string; angleDeg: number; magnitude: number }[];
  distLoads:    { id: string; memberId: string; angleDeg: number; magnitude: number }[];
  momentLoads:  { id: string; nodeId: string; clockwise: boolean; magnitude: number }[];
};

export type SectionProps = { EA: number; EI: number };

export const DEFAULT_SECTION: SectionProps = {
  EA: 1e6,
  EI: 1e4,
};

export type DiagramMode = "none" | "N" | "Q" | "M";

/** 表示のオンオフフラグ */
export type DisplayFlags = {
  reaction: boolean;
  N:        boolean;
  Q:        boolean;
  M:        boolean;
  deformed: boolean;  // ← 変形図
};