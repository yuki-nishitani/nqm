import { useState, useCallback } from "react";
import { MomentLoad, Node2D } from "../types";
import { uid } from "../utils/geometry";

export function useMomentLoads(_nodeById: Map<string, Node2D>) {
  const [momentLoads, setMomentLoads] = useState<MomentLoad[]>([]);

  /** ノードにモーメント荷重を追加（既存があればトグル削除） */
  const addMomentLoad = useCallback((nodeId: string) => {
    setMomentLoads((prev) => {
      const exists = prev.find((l) => l.nodeId === nodeId);
      if (exists) return prev.filter((l) => l.nodeId !== nodeId);
      // デフォルト: 反時計回り (clockwise=false)
      return [...prev, { id: uid("MO"), nodeId, clockwise: false, magnitude: 1 }];
    });
  }, []);

  /** 方向を反転（clockwise ↔ counter-clockwise） */
  const flipMomentLoad = useCallback((id: string) => {
    setMomentLoads((prev) =>
      prev.map((l) => l.id === id ? { ...l, clockwise: !l.clockwise } : l)
    );
  }, []);

  /** id セットを削除 */
  const removeMomentLoads = useCallback((ids: Set<string>) => {
    setMomentLoads((prev) => prev.filter((l) => !ids.has(l.id)));
  }, []);

  /** ノード削除連動 */
  const removeMomentsByNodeIds = useCallback((nodeIds: Set<string>) => {
    setMomentLoads((prev) => prev.filter((l) => !nodeIds.has(l.nodeId)));
  }, []);

  /** マージ時の引き継ぎ */
  const transferMomentToNode = useCallback((fromId: string, toId: string) => {
    setMomentLoads((prev) => {
      const hasTarget = prev.some((l) => l.nodeId === toId);
      return prev
        .filter((l) => l.nodeId !== fromId || !hasTarget)
        .map((l) => l.nodeId === fromId ? { ...l, nodeId: toId } : l);
    });
  }, []);

  return {
    momentLoads,
    addMomentLoad,
    flipMomentLoad,
    removeMomentLoads,
    removeMomentsByNodeIds,
    transferMomentToNode,
  };
}