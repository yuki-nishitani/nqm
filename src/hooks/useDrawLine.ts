import { useState, useMemo, useCallback, useRef } from "react";
import { Node2D, Member } from "../types";
import { snap, uid, dist2 } from "../utils/geometry";
import { SNAP_R } from "../types";

export function useDrawLine() {
  const [nodes,       setNodes]       = useState<Node2D[]>([]);
  const [members,     setMembers]     = useState<Member[]>([]);
  const [drawPathIds, setDrawPathIds] = useState<string[]>([]);

  // 最新の members/nodes を ref で保持（コールバック内で最新値を同期的に参照するため）
  const membersRef = useRef<Member[]>(members);
  const nodesRef   = useRef<Node2D[]>(nodes);
  const setMembersWrapped: typeof setMembers = useCallback((v) => {
    setMembers((prev) => {
      const next = typeof v === "function" ? (v as (p: Member[]) => Member[])(prev) : v;
      membersRef.current = next;
      return next;
    });
  }, []);
  const setNodesWrapped: typeof setNodes = useCallback((v) => {
    setNodes((prev) => {
      const next = typeof v === "function" ? (v as (p: Node2D[]) => Node2D[])(prev) : v;
      nodesRef.current = next;
      return next;
    });
  }, []);

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
      setNodesWrapped((prev) => [...prev, newNode]);
      nodeId = newNode.id;
    }

    setDrawPathIds((prevPath) => {
      if (!prevPath.length) return [nodeId];
      const lastId = prevPath[prevPath.length - 1];
      if (lastId === nodeId) return prevPath;
      setMembersWrapped((prev) => {
        const dup = prev.some(
          (m) => (m.a === lastId && m.b === nodeId) || (m.a === nodeId && m.b === lastId)
        );
        return dup ? prev : [...prev, { id: uid("M"), a: lastId, b: nodeId }];
      });
      return [...prevPath, nodeId];
    });
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * drawPathIds が1要素（まだメンバーを1本も作っていない孤立ノード）かどうかを判定して
   * 必要なら削除する共通処理。
   */
  const _cleanupOrphan = useCallback((prevPath: string[]) => {
    if (prevPath.length !== 1) return;
    const orphanId = prevPath[0];
    // members（最新 ref）に接続がなければ孤立ノードとして削除
    const isConnected = membersRef.current.some(
      (m) => m.a === orphanId || m.b === orphanId
    );
    if (!isConnected) {
      setNodesWrapped((ns) => ns.filter((n) => n.id !== orphanId));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Enter / ダブルクリック / モード変更でパスを確定。
   * drawPathIds が1要素（孤立ノード）の場合はノードも削除してキャンセル扱いにする。
   */
  const commitPath = useCallback(() => {
    setDrawPathIds((prevPath) => {
      _cleanupOrphan(prevPath);
      return [];
    });
  }, [_cleanupOrphan]);

  /**
   * Escape でパスをリセット。孤立ノード削除も commitPath と同様に行う。
   */
  const resetPath = useCallback(() => {
    setDrawPathIds((prevPath) => {
      _cleanupOrphan(prevPath);
      return [];
    });
  }, [_cleanupOrphan]);

  /** 指定 nodeId セットを削除（member削除に連動） */
  const removeNodes = useCallback((toRemove: Set<string>) => {
    if (!toRemove.size) return;
    setNodesWrapped((ns) => ns.filter((n) => !toRemove.has(n.id)));
    setDrawPathIds((p) => p.filter((id) => !toRemove.has(id)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * メンバー memberId を点 (x, y) で分割する。
   */
  const splitMember = useCallback((memberId: string, x: number, y: number): string | null => {
    const target = membersRef.current.find((m) => m.id === memberId);
    if (!target) return null;

    const newNodeId = uid("N");
    const newNode: Node2D = { id: newNodeId, x, y };

    setNodesWrapped((prevNodes) => [...prevNodes, newNode]);
    setMembersWrapped((prevMembers) => [
      ...prevMembers.filter((m) => m.id !== memberId),
      { id: uid("M"), a: target.a, b: newNodeId },
      { id: uid("M"), a: newNodeId, b: target.b },
    ]);

    return newNodeId;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ノードを削除する。接続メンバー数に応じてルールを適用。
   */
  const deleteNode = useCallback((nodeId: string): Set<string> => {
    const removed = new Set<string>([nodeId]);
    setMembersWrapped((prevMembers) => {
      const connected = prevMembers.filter((m) => m.a === nodeId || m.b === nodeId);
      const rest      = prevMembers.filter((m) => m.a !== nodeId && m.b !== nodeId);

      setNodesWrapped((ns) => ns.filter((n) => n.id !== nodeId));
      setDrawPathIds((p) => p.filter((id) => id !== nodeId));

      if (connected.length === 0) return rest;
      if (connected.length === 1) return rest;

      if (connected.length === 2) {
        const [m1, m2] = connected;
        const a = m1.a === nodeId ? m1.b : m1.a;
        const c = m2.a === nodeId ? m2.b : m2.a;
        const dup = rest.some(
          (m) => (m.a === a && m.b === c) || (m.a === c && m.b === a)
        );
        return dup ? rest : [...rest, { id: uid("M"), a, b: c }];
      }

      // 3本以上
      return rest;
    });
    return removed;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ノードを (x, y) に移動する。
   */
  const moveNode = useCallback((nodeId: string, x: number, y: number, force = false): boolean => {
    const occupied = !force && nodesRef.current.some(
      (n) => n.id !== nodeId && n.x === x && n.y === y
    );
    if (occupied) return false;
    setNodesWrapped((ns) => ns.map((n) => n.id === nodeId ? { ...n, x, y } : n));
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ノード B を ノード A にマージする。
   */
  const mergeNode = useCallback((nodeIdB: string, nodeIdA: string) => {
    setMembersWrapped((prev) => {
      const rewritten = prev.map((m) => {
        const a = m.a === nodeIdB ? nodeIdA : m.a;
        const b = m.b === nodeIdB ? nodeIdA : m.b;
        return { ...m, a, b };
      });
      const noLoop = rewritten.filter((m) => m.a !== m.b);
      const seen = new Set<string>();
      const deduped = noLoop.filter((m) => {
        const key = [m.a, m.b].sort().join(":");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return deduped;
    });
    setNodesWrapped((ns) => ns.filter((n) => n.id !== nodeIdB));
    setDrawPathIds((p) => p.filter((id) => id !== nodeIdB));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    nodes,
    members,
    setMembers: setMembersWrapped,
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