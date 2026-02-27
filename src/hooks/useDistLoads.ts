import { useState, useCallback } from "react";
import { DistLoad } from "../types";
import { uid } from "../utils/geometry";

// 荷重アイコンのデフォルトオフセット距離（メンバー上の点から矢印方向へ）
const DEFAULT_OFFSET = 20;

/** メンバー上の点座標 + angleDeg + offsetDist からアイコン中心座標を計算 */
export function distLoadIconCenter(
  px: number,
  py: number,
  angleDeg: number,
  offsetDist: number,
): { cx: number; cy: number } {
  const rad = ((angleDeg + 270) * Math.PI) / 180;
  return {
    cx: px + offsetDist * Math.cos(rad),
    cy: py + offsetDist * Math.sin(rad),
  };
}

export function useDistLoads() {
  const [distLoads, setDistLoads] = useState<DistLoad[]>([]);
  const [rotDrag, setRotDrag] = useState<null | {
    id: string;
    baseAngleDeg: number;
    baseMouseRad: number;
    cx: number; // 回転中心（メンバー中点）
    cy: number;
  }>(null);

  /** メンバーに等分布荷重を追加（既存があればトグル削除） */
  const toggleDistLoad = useCallback((memberId: string) => {
    setDistLoads((prev) => {
      const exists = prev.find((l) => l.memberId === memberId);
      if (exists) return prev.filter((l) => l.memberId !== memberId);
      return [...prev, { id: uid("D"), memberId, angleDeg: 0, magnitude: 1 }];
    });
  }, []);

  /** 回転ドラッグ開始（cx, cy: メンバー中点） */
  const startRotDrag = useCallback((
    id: string, angleDeg: number, mouseRad: number, cx: number, cy: number
  ) => {
    setRotDrag({ id, baseAngleDeg: angleDeg, baseMouseRad: mouseRad, cx, cy });
  }, []);

  /** 回転ドラッグ中 */
  const updateRotDrag = useCallback((wx: number, wy: number, shiftDown: boolean) => {
    if (!rotDrag) return;
    const cur = Math.atan2(wy - rotDrag.cy, wx - rotDrag.cx);
    let d = cur - rotDrag.baseMouseRad;
    while (d > Math.PI)  d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const raw  = rotDrag.baseAngleDeg + d * 180 / Math.PI;
    const next = shiftDown ? Math.round(raw / 45) * 45 : raw;
    setDistLoads((prev) =>
      prev.map((l) => l.id === rotDrag.id ? { ...l, angleDeg: next } : l)
    );
  }, [rotDrag]);

  /** 回転ドラッグ終了 */
  const endRotDrag = useCallback(() => setRotDrag(null), []);

  /** id セットを削除（Delete キー連動） */
  const removeDistLoads = useCallback((ids: Set<string>) => {
    setDistLoads((prev) => prev.filter((l) => !ids.has(l.id)));
  }, []);

  /** メンバー削除連動 */
  const removeByMemberIds = useCallback((memberIds: Set<string>) => {
    setDistLoads((prev) => prev.filter((l) => !memberIds.has(l.memberId)));
  }, []);

  return {
    distLoads,
    rotDrag,
    toggleDistLoad,
    startRotDrag,
    updateRotDrag,
    endRotDrag,
    removeDistLoads,
    removeByMemberIds,
  };
}