import { useState, useMemo, useCallback } from "react";
import { Node2D, Member } from "../types";
import { snap, uid, dist2 } from "../utils/geometry";
import { SNAP_R } from "../types";

export function useDrawLine() {
  const [nodes,       setNodes]       = useState<Node2D[]>([]);
  const [members,     setMembers]     = useState<Member[]>([]);
  const [drawPathIds, setDrawPathIds] = useState<string[]>([]);

  const nodeById = useMemo(() => {
    const m = new Map<string, Node2D>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  function findNearbyNode(x: number, y: number) {
    const r2 = SNAP_R * SNAP_R;
    let best: Node2D | null = null;
    let bestD2 = Infinity;
    for (const n of nodes) {
      const d2 = dist2(n.x, n.y, x, y);
      if (d2 < r2 && d2 < bestD2) { best = n; bestD2 = d2; }
    }
    return best;
  }

  /** ノードを追加 or 既存ノードに接続して線を伸ばす */
  const addPoint = useCallback((wx: number, wy: number) => {
    const x = snap(wx), y = snap(wy);
    const nearby = findNearbyNode(x, y);
    let nodeId: string;
    if (nearby) {
      nodeId = nearby.id;
    } else {
      const newNode: Node2D = { id: uid("N"), x, y };
      setNodes((prev) => [...prev, newNode]);
      nodeId = newNode.id;
    }

    setDrawPathIds((prevPath) => {
      if (!prevPath.length) return [nodeId];
      const lastId = prevPath[prevPath.length - 1];
      if (lastId === nodeId) return prevPath;
      setMembers((prev) => {
        const dup = prev.some(
          (m) => (m.a === lastId && m.b === nodeId) || (m.a === nodeId && m.b === lastId)
        );
        return dup ? prev : [...prev, { id: uid("M"), a: lastId, b: nodeId }];
      });
      return [...prevPath, nodeId];
    });
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Enter / ダブルクリックでパス確定 */
  const commitPath = useCallback(() => {
    setDrawPathIds([]);
  }, []);

  /** Escape でパスをリセット */
  const resetPath = useCallback(() => {
    setDrawPathIds([]);
  }, []);

  /** 指定 nodeId セットを削除（member削除に連動） */
  const removeNodes = useCallback((toRemove: Set<string>) => {
    if (!toRemove.size) return;
    setNodes((ns) => ns.filter((n) => !toRemove.has(n.id)));
    setDrawPathIds((p) => p.filter((id) => !toRemove.has(id)));
  }, []);

  /**
   * メンバー memberId を点 (x, y) で分割する。
   * 既存メンバー A-B を削除し、A-P と P-B の2本に置き換える。
   * 挿入した新規ノードの id を返す（荷重配置に使う）。
   * ※ 存在チェックと uid 生成を setMembers の外で行い、返却 id を確実に確定させる。
   */
  const splitMember = useCallback((memberId: string, x: number, y: number): string | null => {
    // 対象メンバーが存在するか事前チェック（現時点の members state を直接参照）
    const target = members.find((m) => m.id === memberId);
    if (!target) return null;

    // id を先に確定させる
    const newNodeId = uid("N");
    const newNode: Node2D = { id: newNodeId, x, y };

    setNodes((prevNodes) => [...prevNodes, newNode]);
    setMembers((prevMembers) => [
      ...prevMembers.filter((m) => m.id !== memberId),
      { id: uid("M"), a: target.a, b: newNodeId },
      { id: uid("M"), a: newNodeId, b: target.b },
    ]);

    return newNodeId;
  }, [members]);

  /**
   * ノードを削除する。接続メンバー数に応じてルールを適用。
   * 0本: ノードのみ削除
   * 1本: ノード＋メンバー削除
   * 2本(A-B-C): Bを削除してA-Cを新規接続
   * 3本以上: ノード＋全接続メンバーを削除
   * 戻り値: 削除されたノードidセット（support/joint/load連動用）
   */
  const deleteNode = useCallback((nodeId: string): Set<string> => {
    const removed = new Set<string>([nodeId]);
    setMembers((prevMembers) => {
      const connected = prevMembers.filter((m) => m.a === nodeId || m.b === nodeId);
      const rest      = prevMembers.filter((m) => m.a !== nodeId && m.b !== nodeId);

      if (connected.length === 0) {
        // 0本: ノードだけ削除
        setNodes((ns) => ns.filter((n) => n.id !== nodeId));
        setDrawPathIds((p) => p.filter((id) => id !== nodeId));
        return rest;
      }

      if (connected.length === 1) {
        // 1本: ノード＋メンバー削除
        setNodes((ns) => ns.filter((n) => n.id !== nodeId));
        setDrawPathIds((p) => p.filter((id) => id !== nodeId));
        return rest;
      }

      if (connected.length === 2) {
        // 2本: A-B-C → A-C に簡略化
        const [m1, m2] = connected;
        const a = m1.a === nodeId ? m1.b : m1.a;
        const c = m2.a === nodeId ? m2.b : m2.a;
        // 重複チェック
        const dup = rest.some(
          (m) => (m.a === a && m.b === c) || (m.a === c && m.b === a)
        );
        setNodes((ns) => ns.filter((n) => n.id !== nodeId));
        setDrawPathIds((p) => p.filter((id) => id !== nodeId));
        return dup ? rest : [...rest, { id: uid("M"), a, b: c }];
      }

      // 3本以上: ノード＋全接続メンバー削除
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setDrawPathIds((p) => p.filter((id) => id !== nodeId));
      return rest;
    });
    return removed;
  }, []);

  /**
   * ノードを (x, y) に移動する。
   * force=false（デフォルト）: 移動先に別ノードがある場合は false を返してキャンセル。
   * force=true: 重複チェックをスキップ（Shift+ドラッグのマージ用）。
   */
  const moveNode = useCallback((nodeId: string, x: number, y: number, force = false): boolean => {
    const occupied = !force && nodes.some((n) => n.id !== nodeId && n.x === x && n.y === y);
    if (occupied) return false;
    setNodes((ns) => ns.map((n) => n.id === nodeId ? { ...n, x, y } : n));
    return true;
  }, [nodes]);

  /**
   * ノード B を ノード A にマージする。
   * - B に接続するメンバーの端点を A に付け替え
   * - A-A 自己ループ・重複メンバーは除去
   * - B を削除
   * 戻り値: マージ元 B の id セット（support/joint/load 引き継ぎ判定用）
   */
  const mergeNode = useCallback((nodeIdB: string, nodeIdA: string) => {
    setMembers((prev) => {
      const rewritten = prev.map((m) => {
        const a = m.a === nodeIdB ? nodeIdA : m.a;
        const b = m.b === nodeIdB ? nodeIdA : m.b;
        return { ...m, a, b };
      });
      // 自己ループ除去
      const noLoop = rewritten.filter((m) => m.a !== m.b);
      // 重複除去（後勝ち）
      const seen = new Set<string>();
      const deduped = noLoop.filter((m) => {
        const key = [m.a, m.b].sort().join(":");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return deduped;
    });
    setNodes((ns) => ns.filter((n) => n.id !== nodeIdB));
    setDrawPathIds((p) => p.filter((id) => id !== nodeIdB));
  }, []);

  return {
    nodes,
    members,
    setMembers,
    drawPathIds,
    nodeById,
    findNearbyNode,
    addPoint,
    commitPath,
    resetPath,
    removeNodes,
    splitMember,
    deleteNode,
    moveNode,
    mergeNode,
  };
}