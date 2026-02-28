import { useState, useMemo, useCallback, useRef } from "react";
import { Node2D, Member } from "../types";
import { snap, uid, dist2, projectPointOnSegment } from "../utils/geometry";
import { SNAP_R } from "../types";

// ─── ユーティリティ ────────────────────────────────────────────
/**
 * 現在の nodes/members を受け取り、
 * ノード nodeId (座標 x, y) が乗っている全部材を分割する。
 * 副作用なし。新しい members 配列を返す。
 */
function splitMembersOnNode(
  nodeId: string,
  x: number,
  y: number,
  nodes: Node2D[],
  members: Member[]
): Member[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let result = [...members];

  for (const m of members) {
    if (m.a === nodeId || m.b === nodeId) continue; // 既に接続済み
    const na = nodeMap.get(m.a);
    const nb = nodeMap.get(m.b);
    if (!na || !nb) continue;

    const proj = projectPointOnSegment(x, y, na.x, na.y, nb.x, nb.y);
    if (proj.t > 1e-6 && proj.t < 1 - 1e-6 && proj.dist < 1e-6) {
      result = result.filter((r) => r.id !== m.id);
      result.push({ id: uid("M"), a: m.a, b: nodeId });
      result.push({ id: uid("M"), a: nodeId, b: m.b });
    }
  }

  return result;
}

// ─── Hook ─────────────────────────────────────────────────────
export function useDrawLine() {
  const [nodes,       setNodes]       = useState<Node2D[]>([]);
  const [members,     setMembers]     = useState<Member[]>([]);
  const [drawPathIds, setDrawPathIds] = useState<string[]>([]);

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

  /**
   * 新しいノードを追加したとき、そのノードが既存部材上に乗っていれば
   * その部材を分割する。
   * ※ ノードが nodes に追加された直後に呼ぶこと。
   */
  const _autoSplitOnNode = useCallback((nodeId: string, x: number, y: number) => {
    setMembersWrapped((prevMembers) => {
      const currentNodes = nodesRef.current;
      return splitMembersOnNode(nodeId, x, y, currentNodes, prevMembers);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** ノードを追加 or 既存ノードに接続して線を伸ばす */
  const addPoint = useCallback((wx: number, wy: number) => {
    const x = snap(wx), y = snap(wy);
    const nearby = findNearbyNode(x, y);
    let nodeId: string;

    if (nearby) {
      nodeId = nearby.id;
      // 既存ノードを再利用する場合も、そのノードが部材上に乗っていない保証はないので
      // 念のりチェック（通常は addPoint 時に既に分割済みのはず）
    } else {
      const newNode: Node2D = { id: uid("N"), x, y };
      setNodesWrapped((prev) => [...prev, newNode]);
      nodeId = newNode.id;
      // 新ノードが既存部材上に乗っていれば分割
      _autoSplitOnNode(nodeId, x, y);
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
  }, [nodes, _autoSplitOnNode]); // eslint-disable-line react-hooks/exhaustive-deps

  const _cleanupOrphan = useCallback((prevPath: string[]) => {
    if (prevPath.length !== 1) return;
    const orphanId = prevPath[0];
    const isConnected = membersRef.current.some(
      (m) => m.a === orphanId || m.b === orphanId
    );
    if (!isConnected) {
      setNodesWrapped((ns) => ns.filter((n) => n.id !== orphanId));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commitPath = useCallback(() => {
    setDrawPathIds((prevPath) => {
      _cleanupOrphan(prevPath);
      return [];
    });
  }, [_cleanupOrphan]);

  const resetPath = useCallback(() => {
    setDrawPathIds((prevPath) => {
      _cleanupOrphan(prevPath);
      return [];
    });
  }, [_cleanupOrphan]);

  const removeNodes = useCallback((toRemove: Set<string>) => {
    if (!toRemove.size) return;
    setNodesWrapped((ns) => ns.filter((n) => !toRemove.has(n.id)));
    setDrawPathIds((p) => p.filter((id) => !toRemove.has(id)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      // 3本以上: 接続部材を全て切断するだけ
      return rest;
    });
    return removed;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ノードを (x, y) に移動する。
   * 移動後、そのノードが別の既存部材上に乗っていれば自動分割する。
   */
  const moveNode = useCallback((nodeId: string, x: number, y: number, force = false): boolean => {
    const occupied = !force && nodesRef.current.some(
      (n) => n.id !== nodeId && n.x === x && n.y === y
    );
    if (occupied) return false;

    setNodesWrapped((ns) => ns.map((n) => n.id === nodeId ? { ...n, x, y } : n));

    // 移動後に部材上に乗っていれば分割
    // setNodesWrapped は非同期なので ref 経由で最新 nodes を渡す
    setMembersWrapped((prevMembers) => {
      const currentNodes = nodesRef.current.map((n) =>
        n.id === nodeId ? { ...n, x, y } : n
      );
      return splitMembersOnNode(nodeId, x, y, currentNodes, prevMembers);
    });

    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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