import { useState, useCallback } from "react";
import { PointLoad, Node2D } from "../types";
import { uid } from "../utils/geometry";

// 荷重アイコンのデフォルトオフセット距離（ノードから矢印方向へ）
const DEFAULT_OFFSET = 20;

/** ノード座標 + angleDeg + offsetDist からアイコン中心座標を計算 */
export function loadIconCenter(
  n: Node2D,
  angleDeg: number,
  offsetDist: number,
): { cx: number; cy: number } {
  const rad = ((angleDeg + 270) * Math.PI) / 180;
  return {
    cx: n.x + offsetDist * Math.cos(rad),
    cy: n.y + offsetDist * Math.sin(rad),
  };
}

export function usePointLoads(nodeById: Map<string, Node2D>) {
  const [pointLoads, setPointLoads] = useState<PointLoad[]>([]);
  const [rotDrag, setRotDrag] = useState<null | {
    id: string;
    baseAngleDeg: number;
    baseMouseRad: number;
  }>(null);

  /** ノードに荷重を追加（同ノードに既存があればトグル削除） */
  const addPointLoad = useCallback((nodeId: string) => {
    setPointLoads((prev) => {
      const exists = prev.find((l) => l.nodeId === nodeId);
      if (exists) return prev.filter((l) => l.nodeId !== nodeId);
      // 初期方向: 270° = 下向き（SVG座標系でY下向き正）
      return [...prev, { id: uid("L"), nodeId, angleDeg: 0, magnitude: 1, offsetDist: DEFAULT_OFFSET }];
    });
  }, []);

  /** 回転ドラッグ開始 */
  const startRotDrag = useCallback((id: string, angleDeg: number, mouseRad: number) => {
    setRotDrag({ id, baseAngleDeg: angleDeg, baseMouseRad: mouseRad });
  }, []);

  /** 回転ドラッグ中：ノード座標を回転中心として角度を更新 */
  const updateRotDrag = useCallback((wx: number, wy: number, shiftDown: boolean) => {
    if (!rotDrag) return;
    const load = pointLoads.find((l) => l.id === rotDrag.id);
    if (!load) return;
    const n = nodeById.get(load.nodeId);
    if (!n) return;

    // 回転中心はノード座標（オフセット前）
    // loadIconCenter が angleDeg+270 でオフセット方向を計算しているため、
    // マウス角度から -270 して angleDeg に変換する
    const cur = Math.atan2(wy - n.y, wx - n.x);
    let d = cur - rotDrag.baseMouseRad;
    while (d > Math.PI)  d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

    const raw  = rotDrag.baseAngleDeg + d * 180 / Math.PI;
    const next = shiftDown ? Math.round(raw / 45) * 45 : raw;
    setPointLoads((prev) =>
      prev.map((l) => l.id === rotDrag.id ? { ...l, angleDeg: next } : l)
    );
  }, [rotDrag, pointLoads, nodeById]);

  /** 回転ドラッグ終了 */
  const endRotDrag = useCallback(() => setRotDrag(null), []);

  /** Q/E キーで選択荷重を回転 */
  const rotateByKey = useCallback((id: string, delta: number) => {
    setPointLoads((prev) =>
      prev.map((l) => l.id === id ? { ...l, angleDeg: l.angleDeg + delta } : l)
    );
  }, []);

  /** id セットを削除（Delete キー連動） */
  const removePointLoads = useCallback((ids: Set<string>) => {
    setPointLoads((prev) => prev.filter((l) => !ids.has(l.id)));
  }, []);

  /** ノード削除連動 */
  const removeByNodeIds = useCallback((nodeIds: Set<string>) => {
    setPointLoads((prev) => prev.filter((l) => !nodeIds.has(l.nodeId)));
  }, []);

  /** マージ時: fromId の load を toId に引き継ぐ（toId に既存があれば from を削除） */
  const transferToNode = useCallback((fromId: string, toId: string) => {
    setPointLoads((prev) => {
      const hasTarget = prev.some((l) => l.nodeId === toId);
      return prev
        .filter((l) => l.nodeId !== fromId || !hasTarget)
        .map((l) => l.nodeId === fromId ? { ...l, nodeId: toId } : l);
    });
  }, []);

  return {
    pointLoads,
    rotDrag,
    addPointLoad,
    startRotDrag,
    updateRotDrag,
    endRotDrag,
    rotateByKey,
    removePointLoads,
    removeByNodeIds,
    transferToNode,
  };
}