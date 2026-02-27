import { useState, useMemo, useCallback } from "react";
import { Selection, Member, Node2D } from "../types";
import { BOX_MIN_SIZE } from "../types";
import { segmentHitsRect } from "../utils/geometry";

type Rect = { x1: number; y1: number; x2: number; y2: number; x: number; y: number; w: number; h: number };

export function useSelection(
  membersRef: React.MutableRefObject<Member[]>,
  nodeByIdRef: React.MutableRefObject<Map<string, Node2D>>,
) {
  const [sel,      setSel]      = useState<Selection>({ kind: "none" });
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd,   setBoxEnd]   = useState<{ x: number; y: number } | null>(null);

  const isBoxing = boxStart !== null && boxEnd !== null;

  const selBox = useMemo<Rect | null>(() => {
    if (!isBoxing || !boxStart || !boxEnd) return null;
    const x1 = Math.min(boxStart.x, boxEnd.x), y1 = Math.min(boxStart.y, boxEnd.y);
    const x2 = Math.max(boxStart.x, boxEnd.x), y2 = Math.max(boxStart.y, boxEnd.y);
    return { x1, y1, x2, y2, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }, [isBoxing, boxStart, boxEnd]);

  const selectedSet = useMemo(
    () => sel.kind === "members" ? new Set(sel.ids) : new Set<string>(),
    [sel],
  );

  const startBox = useCallback((x: number, y: number) => {
    setBoxStart({ x, y });
    setBoxEnd({ x, y });
  }, []);

  const updateBox = useCallback((x: number, y: number) => {
    setBoxEnd({ x, y });
  }, []);

  const clearBox = useCallback(() => {
    setBoxStart(null);
    setBoxEnd(null);
  }, []);

  const commitSelBox = useCallback((box: Rect | null) => {
    const isTooSmall = !box || (box.w < BOX_MIN_SIZE && box.h < BOX_MIN_SIZE);
    setBoxStart(null);
    setBoxEnd(null);
    if (isTooSmall) return;
    const hitIds = membersRef.current.filter((m) => {
      const a = nodeByIdRef.current.get(m.a);
      const b = nodeByIdRef.current.get(m.b);
      return a && b && segmentHitsRect(a.x, a.y, b.x, b.y, { x1: box!.x1, y1: box!.y1, x2: box!.x2, y2: box!.y2 });
    }).map((m) => m.id);
    setSel(hitIds.length ? { kind: "members", ids: hitIds } : { kind: "none" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    sel, setSel,
    boxStart,
    selBox,
    selectedSet,
    startBox,
    updateBox,
    clearBox,
    /** selBox を自動参照して確定する版（App 側から呼ぶだけでOK） */
    commitSelBoxFromCurrent: useCallback(() => {
      const box = selBox; // 呼び出し時点の selBox を使う → App 側で useLatest 不要
      const isTooSmall = !box || (box.w < BOX_MIN_SIZE && box.h < BOX_MIN_SIZE);
      setBoxStart(null);
      setBoxEnd(null);
      if (isTooSmall) return;
      const hitIds = membersRef.current.filter((m) => {
        const a = nodeByIdRef.current.get(m.a);
        const b = nodeByIdRef.current.get(m.b);
        return a && b && segmentHitsRect(a.x, a.y, b.x, b.y, { x1: box!.x1, y1: box!.y1, x2: box!.x2, y2: box!.y2 });
      }).map((m) => m.id);
      setSel(hitIds.length ? { kind: "members", ids: hitIds } : { kind: "none" });
    }, [selBox]), // eslint-disable-line react-hooks/exhaustive-deps
  };
}