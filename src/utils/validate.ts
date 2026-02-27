/**
 * validate.ts — 解析実行前の構造モデル検証
 *
 * 各チェックは独立して実行し、全エラーをまとめて返す。
 * ひとつでも "error" レベルがあれば解析は中止する。
 */

import type { FemInput } from "./femTypes";

export type ValidationLevel = "error" | "warning";
export type ValidationIssue = {
  level:   ValidationLevel;
  code:    string;
  message: string;
  /** 問題に関係するIDのリスト（ハイライト等に使う） */
  ids?: string[];
};

/** バリデーション結果 */
export type ValidationResult = {
  ok: boolean;           // error が0件なら true
  issues: ValidationIssue[];
};

export function validateModel(input: FemInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  const { nodes, members, supports, pointLoads, distLoads } = input;

  // ── 1. 部材がない ──────────────────────────────────
  if (members.length === 0) {
    issues.push({
      level: "error",
      code: "NO_MEMBERS",
      message: "部材が1本もありません。",
    });
    return { ok: false, issues };  // これ以上チェック不要
  }

  // ── 2. 孤立ノード（どの部材にも属さないノード）────────
  const usedNodeIds = new Set(members.flatMap(m => [m.a, m.b]));
  const isolatedNodes = nodes.filter(n => !usedNodeIds.has(n.id));
  if (isolatedNodes.length > 0) {
    issues.push({
      level: "error",
      code: "ISOLATED_NODES",
      message: `孤立したノードが ${isolatedNodes.length} 個あります。部材に接続されていないノードを削除してください。`,
      ids: isolatedNodes.map(n => n.id),
    });
  }

  // ── 3. 部材ネットワークの連結性チェック ──────────────
  // 部材が存在するノードのみを対象に Union-Find
  const usedNodes = [...usedNodeIds];
  if (usedNodes.length > 0) {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (x: string, y: string) => {
      parent.set(find(x), find(y));
    };
    usedNodes.forEach(id => parent.set(id, id));
    members.forEach(m => union(m.a, m.b));

    const roots = new Set(usedNodes.map(find));
    if (roots.size > 1) {
      issues.push({
        level: "error",
        code: "DISCONNECTED_STRUCTURE",
        message: `部材が ${roots.size} つの独立したグループに分かれています。構造を1つに繋げてください。`,
      });
    }
  }

  // ── 4. 支点がない ──────────────────────────────────
  if (supports.length === 0) {
    issues.push({
      level: "error",
      code: "NO_SUPPORTS",
      message: "支点が設定されていません。pin・roller・fix のいずれかを配置してください。",
    });
  } else {
    // ── 5. 支点が部材に接続されているか ─────────────────
    const disconnectedSupports = supports.filter(s => !usedNodeIds.has(s.nodeId));
    if (disconnectedSupports.length > 0) {
      issues.push({
        level: "error",
        code: "SUPPORT_NOT_ON_MEMBER",
        message: `部材に接続されていない支点が ${disconnectedSupports.length} 個あります。`,
        ids: disconnectedSupports.map(s => s.id),
      });
    }

    // ── 6. 拘束自由度が不足していないか（簡易チェック）──
    // pin=2拘束, roller=1拘束, fix=3拘束 の合計が最低3以上必要
    const totalConstraints = supports.reduce((sum, s) => {
      if (s.type === "pin")    return sum + 2;
      if (s.type === "roller") return sum + 1;
      if (s.type === "fix")    return sum + 3;
      return sum;
    }, 0);
    if (totalConstraints < 3) {
      issues.push({
        level: "error",
        code: "INSUFFICIENT_CONSTRAINTS",
        message: "支点の拘束が不足しています。最低でも3つの拘束自由度（pin+roller など）が必要です。",
      });
    }
  }

  // ── 7. 荷重がない ──────────────────────────────────
  const hasLoad = pointLoads.length > 0 || distLoads.length > 0;
  if (!hasLoad) {
    issues.push({
      level: "warning",
      code: "NO_LOADS",
      message: "荷重が設定されていません。解析しても全ての断面力が0になります。",
    });
  }

  // ── 8. 荷重magnitude = 0 ────────────────────────────
  const zeroLoads = [
    ...pointLoads.filter(l => l.magnitude === 0),
    ...distLoads.filter(l => l.magnitude === 0),
  ];
  if (zeroLoads.length > 0) {
    issues.push({
      level: "warning",
      code: "ZERO_MAGNITUDE_LOAD",
      message: `magnitude が 0 の荷重が ${zeroLoads.length} 個あります（断面力への寄与なし）。`,
      ids: zeroLoads.map(l => l.id),
    });
  }

  // ── 9. 同一座標の重複ノード ──────────────────────────
  const coordSet = new Set<string>();
  const dupNodes: string[] = [];
  for (const n of nodes) {
    const key = `${Math.round(n.x)},${Math.round(n.y)}`;
    if (coordSet.has(key)) dupNodes.push(n.id);
    else coordSet.add(key);
  }
  if (dupNodes.length > 0) {
    issues.push({
      level: "warning",
      code: "DUPLICATE_NODES",
      message: `同一座標に重複するノードが ${dupNodes.length} 個あります。意図しない場合は確認してください。`,
      ids: dupNodes,
    });
  }

  // ── 10. 長さ0の部材 ────────────────────────────────
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const zeroMembers = members.filter(m => {
    const a = nodeMap.get(m.a);
    const b = nodeMap.get(m.b);
    if (!a || !b) return false;
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy) < 1e-6;
  });
  if (zeroMembers.length > 0) {
    issues.push({
      level: "error",
      code: "ZERO_LENGTH_MEMBER",
      message: `長さが0の部材が ${zeroMembers.length} 本あります。`,
      ids: zeroMembers.map(m => m.id),
    });
  }

  const ok = issues.filter(i => i.level === "error").length === 0;
  return { ok, issues };
}