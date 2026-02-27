import { useState, useEffect, useCallback } from "react";
import { Mode } from "../types";

type KeyboardDeps = {
  mode: Mode;
  onEscape: () => void;
  onEnter:  () => void;
  onDelete: () => void;
};

export function useKeyboard({
  mode,
  onEscape,
  onEnter,
  onDelete,
}: KeyboardDeps) {
  const [spaceDown, setSpaceDown] = useState(false);
  const [shiftDown, setShiftDown] = useState(false);

  // Space / Shift / Escape / Enter
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === " ")      { ev.preventDefault(); setSpaceDown(true); }
      if (ev.key === "Shift")  { setShiftDown(true); }
      if (ev.key === "Escape") { onEscape(); }
      if (ev.key === "Enter" && mode === "drawLine") { onEnter(); }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === " ")     setSpaceDown(false);
      if (ev.key === "Shift") setShiftDown(false);
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup",   onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
    };
  }, [mode, onEscape, onEnter]);

  // Delete / Backspace: 選択要素を削除
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      onDelete();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDelete]);

  return { spaceDown, shiftDown };
}