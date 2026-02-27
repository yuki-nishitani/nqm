import { useRef, useEffect, useState } from "react";

/** 常に最新の値を ref で保持する（stale クロージャ回避） */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}

export function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const handler = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return size;
}