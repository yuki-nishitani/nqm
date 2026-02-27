import { useState, useCallback } from "react";
import { solveFem } from "../utils/fem";
import { validateModel, type ValidationResult } from "../utils/validate";
import type { FemResult, FemInput, DisplayFlags } from "../utils/femTypes";
import type { Node2D, Member, Support, Joint, PointLoad, DistLoad } from "../types";

type UseFemInput = {
  nodes: Node2D[]; members: Member[]; supports: Support[];
  joints: Joint[]; pointLoads: PointLoad[]; distLoads: DistLoad[];
};

type UseFemReturn = {
  femResult:       FemResult | null;
  validation:      ValidationResult | null;
  isStale:         boolean;
  markStale:       () => void;
  displayFlags:    DisplayFlags;
  setDisplayFlag:  (key: keyof DisplayFlags, value: boolean) => void;
  diagramScale:    number;
  setDiagramScale: (v: number) => void;
  deformedScale:   number;
  setDeformedScale:(v: number) => void;
  runAnalysis:     (input: UseFemInput) => void;
  clearResult:     () => void;
};

export function useFem(): UseFemReturn {
  const [femResult,   setFemResult]   = useState<FemResult | null>(null);
  const [validation,  setValidation]  = useState<ValidationResult | null>(null);
  const [isStale,     setIsStale]     = useState(false);
  const [diagramScale,    setDiagramScale]    = useState(1.0);
  const [deformedScale,   setDeformedScale]   = useState(1.0);  // 変形図拡大率
  const [displayFlags, setDisplayFlags] = useState<DisplayFlags>({
    reaction: true,
    N:        false,
    Q:        false,
    M:        true,
    deformed: false,
  });

  const setDisplayFlag = useCallback((key: keyof DisplayFlags, value: boolean) => {
    setDisplayFlags(prev => ({ ...prev, [key]: value }));
  }, []);

  const markStale = useCallback(() => setIsStale(true), []);

  const runAnalysis = useCallback((input: UseFemInput) => {
    const femInput: FemInput = {
      nodes:      input.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })),
      members:    input.members.map(m => ({ id: m.id, a: m.a, b: m.b })),
      supports:   input.supports.map(s => ({ id: s.id, nodeId: s.nodeId, type: s.type, angleDeg: s.angleDeg })),
      joints:     input.joints.map(j => ({ id: j.id, nodeId: j.nodeId })),
      pointLoads: input.pointLoads.map(pl => ({ id: pl.id, nodeId: pl.nodeId, angleDeg: pl.angleDeg, magnitude: pl.magnitude })),
      distLoads:  input.distLoads.map(dl => ({ id: dl.id, memberId: dl.memberId, angleDeg: dl.angleDeg, magnitude: dl.magnitude })),
    };

    const vResult = validateModel(femInput);
    setValidation(vResult);

    if (!vResult.ok) {
      setFemResult({ ok: false, reason: "validation",
        message: vResult.issues.filter(i => i.level === "error").map(i => i.message).join("\n") });
      setIsStale(false);
      return;
    }

    try {
      setFemResult(solveFem(femInput));
    } catch {
      setFemResult({ ok: false, reason: "singular", message: "計算中に予期しないエラーが発生しました。" });
    }
    setIsStale(false);
  }, []);

  const clearResult = useCallback(() => {
    setFemResult(null); setValidation(null); setIsStale(false);
  }, []);

  return {
    femResult, validation, isStale, markStale,
    displayFlags, setDisplayFlag,
    diagramScale, setDiagramScale,
    deformedScale, setDeformedScale,
    runAnalysis, clearResult,
  };
}