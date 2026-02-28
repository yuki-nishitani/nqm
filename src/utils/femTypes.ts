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

export type FemResult = {
  ok: true;
  elements:      ElementResult[];
  reactions:     ReactionResult[];
  displacements: DisplacementResult[];
} | {
  ok: false;
  reason: "unstable" | "unsupported" | "no_members" | "singular" | "validation";
  message: string;
};

export type FemInput = {
  nodes:      { id: string; x: number; y: number }[];
  members:    { id: string; a: string; b: string }[];
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