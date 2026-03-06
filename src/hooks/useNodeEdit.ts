import { useState, useCallback } from "react";
import { CurveSplitCandidate } from "./curveSplit";

type NodeDrag = {
  nodeId: string;
  offsetX: number; // ドラッグ開始時のノード座標とポインタのズレ
  offsetY: number;
};

export function useNodeEdit() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDrag,       setNodeDrag]       = useState<NodeDrag | null>(null);

  // ── 曲線分割候補（mouseMove で更新、クリックで確定） ──
  const [splitCandidate, setSplitCandidate] = useState<CurveSplitCandidate | null>(null);

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  /**
   * ドラッグ開始。
   * nodeX/nodeY: ノードのワールド座標
   * pointerX/pointerY: ポインタのワールド座標
   */
  const startDrag = useCallback((
    nodeId: string,
    nodeX: number, nodeY: number,
    pointerX: number, pointerY: number,
  ) => {
    setSelectedNodeId(nodeId);
    setNodeDrag({
      nodeId,
      offsetX: pointerX - nodeX,
      offsetY: pointerY - nodeY,
    });
  }, []);

  const endDrag = useCallback(() => {
    setNodeDrag(null);
  }, []);

  /**
   * mouseMove 時に Canvas から呼ぶ。
   * 曲線メンバーへの最近傍点が一定距離以内なら候補をセット、
   * そうでなければクリア。
   *
   * 例（Canvas 側）:
   *   for (const m of members.filter(m => m.curve)) {
   *     const nA = nodes.find(n => n.id === m.a)!;
   *     const nB = nodes.find(n => n.id === m.b)!;
   *     const hit = nearestOnCurve(nA.x, nA.y, nB.x, nB.y, m.curve!, wx, wy);
   *     if (hit.dist < SNAP_R / zoom) {
   *       updateSplitCandidate({ memberId: m.id, t: hit.t, worldX: hit.x, worldY: hit.y });
   *       return;
   *     }
   *   }
   *   updateSplitCandidate(null);
   */
  const updateSplitCandidate = useCallback((candidate: CurveSplitCandidate | null) => {
    setSplitCandidate(candidate);
  }, []);

  /**
   * クリック時に Canvas から呼ぶ。
   * 候補があれば確定して返す（呼び出し側で splitMemberAtT を実行する）。
   * 候補がなければ null を返す。
   *
   * 例（Canvas 側）:
   *   const hit = confirmSplit();
   *   if (hit) {
   *     const newId = generateId();
   *     const { newNode, memberA, memberB } = splitMemberAtT(
   *       members.find(m => m.id === hit.memberId)!,
   *       nodes.find(n => n.id === memberA.a)!,
   *       nodes.find(n => n.id === memberB.b)!,
   *       hit.t, newId,
   *     );
   *     setNodes(ns => [...ns.filter(n => n.id !== ...), newNode]);
   *     setMembers(ms => [
   *       ...ms.filter(m => m.id !== hit.memberId),
   *       { id: generateId(), ...memberA },
   *       { id: generateId(), ...memberB },
   *     ]);
   *   }
   */
  const confirmSplit = useCallback((): CurveSplitCandidate | null => {
    const c = splitCandidate;
    setSplitCandidate(null);
    return c;
  }, [splitCandidate]);

  return {
    selectedNodeId,
    nodeDrag,
    splitCandidate,   // Canvas の描画で「分割点プレビュー」を表示するために公開
    selectNode,
    startDrag,
    endDrag,
    updateSplitCandidate,
    confirmSplit,
  };
}