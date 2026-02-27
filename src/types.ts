// ===== 型定義 =====
export type Node2D    = { id: string; x: number; y: number };
export type Member    = { id: string; a: string; b: string };
export type Selection = { kind: "none" } | { kind: "members"; ids: string[] } | { kind: "supports"; ids: string[] } | { kind: "joints"; ids: string[] } | { kind: "loads"; ids: string[] } | { kind: "distLoads"; ids: string[] } | { kind: "node"; id: string };
export type Mode      = "select" | "drawLine" | "supportPin" | "supportRoller" | "supportFix" | "joint" | "load" | "nodeEdit" | "distLoad";
export type SupportType = "pin" | "roller" | "fix";
export type Support  = { id: string; nodeId: string; type: SupportType; angleDeg: number };
export type Joint    = { id: string; nodeId: string };
export type PointLoad = { id: string; nodeId: string; angleDeg: number; magnitude: number; offsetDist: number };
export type DistLoad  = { id: string; memberId: string; angleDeg: number; magnitude: number };

// ===== キャンバス定数 =====
export const GRID               = 25;
export const SNAP_R             = 12;
export const SIDEBAR_W          = 130;
export const START_MARKER_RADIUS = 7;
export const ZOOM_SCALE_FACTOR  = 1.06;
export const GRID_RANGE         = 4000;
export const BOX_MIN_SIZE       = 3;
export const DBL_MS             = 280;  // ダブルクリック判定時間 (ms)
export const DBL_DIST           = 10;   // 同上・位置ズレ許容 (px)

// ===== カラー =====
export const BLUE   = "#2aa8ff";
export const WHITE  = "#ddd";
export const YELLOW = "#ffd754";

// ===== サイドバーレイアウト定数 =====
export const ICON_PAD     = 4;
export const PAD          = 12;
export const GAP          = 7;
export const BTN_W        = (SIDEBAR_W - PAD * 2 - GAP) / 2;
export const BTN_H        = BTN_W;
export const BTN_Y        = 50;
export const FOOTER_X     = 16;
export const FOOTER_LINE_H = 18;
export const FOOTER_LINES = 6;