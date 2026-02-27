import { useState, useCallback } from "react";
import { Support, SupportType, Node2D } from "../types";
import { uid } from "../utils/geometry";

export function useSupports(nodeById: Map<string, Node2D>) {
  const [supports, setSupports] = useState<Support[]>([]);
  const [rotDrag,  setRotDrag]  = useState<null | {
    id: string;
    baseAngleDeg: number;
    baseMouseRad: number;
  }>(null);

  /** 既存ノードに支点を追加・置換・削除（トグル） */
  const toggleSupport = useCallback((nodeId: string, supportType: SupportType) => {
    setSupports((prev) => {
      const idx = prev.findIndex((s) => s.nodeId === nodeId);
      if (idx >= 0) {
        const cur = prev[idx];
        if (cur.type === supportType) return prev.filter((s) => s.nodeId !== nodeId); // 同種 → 削除
        return prev.map((s) => s.nodeId === nodeId ? { ...s, type: supportType } : s); // 異種 → 置換
      }
      return [...prev, { id: uid("S"), nodeId, type: supportType, angleDeg: 0 }];
    });
  }, []);

  /** 回転ドラッグ開始 */
  const startRotDrag = useCallback((id: string, angleDeg: number, mouseRad: number) => {
    setRotDrag({ id, baseAngleDeg: angleDeg, baseMouseRad: mouseRad });
  }, []);

  /** 回転ドラッグ中：角度を更新 */
  const updateRotDrag = useCallback((wx: number, wy: number, shiftDown: boolean) => {
    if (!rotDrag) return;
    const s = supports.find(v => v.id === rotDrag.id);
    if (!s) return;
    const n = nodeById.get(s.nodeId);
    if (!n) return;

    const cur = Math.atan2(wy - n.y, wx - n.x);
    let d = cur - rotDrag.baseMouseRad;
    while (d > Math.PI)  d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

    const raw  = rotDrag.baseAngleDeg + d * 180 / Math.PI;
    const next = shiftDown ? Math.round(raw / 45) * 45 : raw;
    setSupports(prev => prev.map(v => v.id === rotDrag.id ? { ...v, angleDeg: next } : v));
  }, [rotDrag, supports, nodeById]);

  /** 回転ドラッグ終了 */
  const endRotDrag = useCallback(() => setRotDrag(null), []);

  /** Q/E キーで選択支点を回転 */
  const rotateByKey = useCallback((id: string, delta: number) => {
    setSupports(prev => prev.map(s => s.id === id ? { ...s, angleDeg: s.angleDeg + delta } : s));
  }, []);

  /** 指定 id セットを削除 */
  const removeSupports = useCallback((ids: Set<string>) => {
    setSupports(prev => prev.filter(s => !ids.has(s.id)));
  }, []);

  /** ノード削除連動 */
  const removeByNodeIds = useCallback((nodeIds: Set<string>) => {
    setSupports(prev => prev.filter(s => !nodeIds.has(s.nodeId)));
  }, []);

  /** マージ時: fromId の support を toId に引き継ぐ（toId に既存があれば from を削除） */
  const transferToNode = useCallback((fromId: string, toId: string) => {
    setSupports((prev) => {
      const hasTarget = prev.some((s) => s.nodeId === toId);
      return prev
        .filter((s) => s.nodeId !== fromId || !hasTarget)
        .map((s) => s.nodeId === fromId ? { ...s, nodeId: toId } : s);
    });
  }, []);

  return {
    supports,
    rotDrag,
    toggleSupport,
    startRotDrag,
    updateRotDrag,
    endRotDrag,
    rotateByKey,
    removeSupports,
    removeByNodeIds,
    transferToNode,
  };
}