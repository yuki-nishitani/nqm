import { useState, useCallback } from "react";
import { Mode, Selection } from "../types";

export function useMode(setSel: (s: Selection) => void) {
  const [mode, setMode] = useState<Mode>("drawLine");

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    if (next !== "select") setSel({ kind: "none" });
  }, [setSel]);

  return { mode, setMode, switchMode };
}