import { createContext, useContext, useRef, useState, useCallback, useEffect, RefObject } from "react";
import Konva from "konva";

import { useWindowSize, useLatest } from "../hooks/useUtils";
import { useDrawLine }  from "../hooks/useDrawLine";
import { useSupports }  from "../hooks/useSupports";
import { useJoints }    from "../hooks/useJoints";
import { usePointLoads } from "../hooks/usePointLoads";
import { useDistLoads }  from "../hooks/useDistLoads";
import { useMomentLoads } from "../hooks/useMomentLoads";
import { useNodeEdit }   from "../hooks/useNodeEdit";
import { useSelection }  from "../hooks/useSelection";
import { useMode }       from "../hooks/useMode";
import { useKeyboard }   from "../hooks/useKeyboard";
import { useFem }        from "../hooks/useFem";
import { SupportType } from "../types";
import { uid } from "../utils/geometry";

// ===== Context の型 =====
type AppContextValue = ReturnType<typeof useAppContextValue> & {
  stageRef: RefObject<Konva.Stage>;
};

// ===== フック・ロジックをまとめる関数 =====
function useAppContextValue() {
  const { w: W, h: H } = useWindowSize();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  // ----- 描画 -----
  const {
    nodes, members, setMembers,
    drawPathIds, nodeById, findNearbyNode,
    addPoint, commitPath, resetPath, removeNodes,
    splitMember, deleteNode, moveNode, mergeNode,
  } = useDrawLine();

  const membersRef  = useLatest(members);
  const nodeByIdRef = useLatest(nodeById);

  // ----- 選択 -----
  const {
    sel, setSel,
    boxStart, selBox, selectedSet,
    startBox, updateBox, clearBox,
    commitSelBoxFromCurrent,
  } = useSelection(membersRef, nodeByIdRef);

  // ----- モード -----
  const { mode, switchMode } = useMode(setSel);

  // ----- ノード編集 -----
  const {
    selectedNodeId, nodeDrag,
    selectNode, startDrag, endDrag,
  } = useNodeEdit();

  // ----- 支点 -----
  const {
    supports,
    rotDrag,
    toggleSupport,
    startRotDrag,
    updateRotDrag,
    endRotDrag,
    rotateByKey,
    removeSupports,
    removeByNodeIds: removeSupportsByNodeIds,
    transferToNode:  transferSupport,
  } = useSupports(nodeById);

  // ----- ジョイント -----
  const {
    joints,
    toggleJoint,
    addJointDirect,
    removeByNodeIds: removeJointsByNodeIds,
    removeByNodeId:  removeJointByNodeId,
    removeJoints,
    transferToNode:  transferJoint,
  } = useJoints();

  // ----- 集中荷重 -----
  const {
    pointLoads,
    rotDrag: loadRotDrag,
    addPointLoad,
    startRotDrag:  startLoadRotDrag,
    updateRotDrag: updateLoadRotDrag,
    endRotDrag:    endLoadRotDrag,
    rotateByKey:   rotateLoadByKey,
    removePointLoads,
    removeByNodeIds: removeLoadsByNodeIds,
    transferToNode:  transferLoad,
  } = usePointLoads(nodeById);

  // ----- 等分布荷重 -----
  const {
    distLoads,
    rotDrag: distRotDrag,
    toggleDistLoad,
    startRotDrag:  startDistRotDrag,
    updateRotDrag: updateDistRotDrag,
    endRotDrag:    endDistRotDrag,
    removeDistLoads,
    removeByMemberIds: removeDistLoadsByMemberIds,
  } = useDistLoads();

  // ----- モーメント荷重 -----
  const {
    momentLoads,
    addMomentLoad,
    flipMomentLoad,
    removeMomentLoads,
    removeMomentsByNodeIds,
    transferMomentToNode,
  } = useMomentLoads(nodeById);

  // ----- FEM 解析 -----
  const {
    femResult,
    validation,
    isStale,
    markStale,
    displayFlags,
    setDisplayFlag,
    diagramScale,
    setDiagramScale,
    deformedScale,
    setDeformedScale,
    runAnalysis,
    clearResult,
  } = useFem();

  // モデルが変更されたら結果を古い状態にマーク
  useEffect(() => {
    if (femResult !== null) markStale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, members, supports, joints, pointLoads, distLoads, momentLoads]);

  // 解析実行ラッパー（現在のモデルを渡す）
  const handleRunAnalysis = useCallback(() => {
    runAnalysis({ nodes, members, supports, joints, pointLoads, distLoads, momentLoads });
  }, [runAnalysis, nodes, members, supports, joints, pointLoads, distLoads, momentLoads]);

  // ----- 複合操作 -----
  const toggleSupportWithExclusion = useCallback((nodeId: string, supportType: SupportType) => {
    removeJointByNodeId(nodeId);
    toggleSupport(nodeId, supportType);
  }, [toggleSupport, removeJointByNodeId]);

  // ----- Shift+挿入ノードの後片付け -----
  const cleanupInsertedNode = useCallback((
    nodeId: string,
    removedJointIds:  Set<string> = new Set(),
    removedLoadIds:   Set<string> = new Set(),
  ) => {
    if (supports.some((s) => s.nodeId === nodeId)) return;
    if (joints.some((j) => !removedJointIds.has(j.id) && j.nodeId === nodeId)) return;
    if (pointLoads.some((l) => !removedLoadIds.has(l.id) && l.nodeId === nodeId)) return;
    if (momentLoads.some((l) => l.nodeId === nodeId)) return;
    if (distLoads.some((l) => {
      const m = members.find((m) => m.id === l.memberId);
      return m && (m.a === nodeId || m.b === nodeId);
    })) return;

    const connected = members.filter((m) => m.a === nodeId || m.b === nodeId);
    if (connected.length !== 2) return;

    const [m1, m2] = connected;
    const endA = m1.a === nodeId ? m1.b : m1.a;
    const endB = m2.a === nodeId ? m2.b : m2.a;

    const nA = nodeById.get(endA);
    const nB = nodeById.get(endB);
    const nP = nodeById.get(nodeId);
    if (!nA || !nB || !nP) return;

    const cross = (nP.x - nA.x) * (nB.y - nA.y) - (nP.y - nA.y) * (nB.x - nA.x);
    if (Math.abs(cross) > 1e-6) return;

    setMembers((prev) => {
      const rest = prev.filter((m) => m.id !== m1.id && m.id !== m2.id);
      const dup  = rest.some((m) =>
        (m.a === endA && m.b === endB) || (m.a === endB && m.b === endA)
      );
      return dup ? rest : [...rest, { id: uid("M"), a: endA, b: endB }];
    });
    removeNodes(new Set([nodeId]));
  }, [supports, joints, pointLoads, distLoads, members, nodeById, setMembers, removeNodes]);

  // ----- Delete 処理 -----
  const handleDelete = useCallback(() => {
    if (mode === "nodeEdit" && selectedNodeId) {
      const removed = deleteNode(selectedNodeId);
      removeSupportsByNodeIds(removed);
      removeJointsByNodeIds(removed);
      removeLoadsByNodeIds(removed);
      removeMomentsByNodeIds(removed);
      selectNode(null);
      return;
    }
    if (sel.kind === "joints" && sel.ids.length > 0) {
      const removedIds = new Set(sel.ids);
      const nodeIds = joints
        .filter((j) => removedIds.has(j.id))
        .map((j) => j.nodeId);
      removeJoints(removedIds);
      nodeIds.forEach((nid) => cleanupInsertedNode(nid, removedIds));
      setSel({ kind: "none" });
      return;
    }
    if (sel.kind === "supports" && sel.ids.length > 0) {
      removeSupports(new Set(sel.ids));
      setSel({ kind: "none" });
      return;
    }
    if (sel.kind === "loads" && sel.ids.length > 0) {
      const removedIds = new Set(sel.ids);
      const nodeIds = pointLoads
        .filter((l) => removedIds.has(l.id))
        .map((l) => l.nodeId);
      removePointLoads(removedIds);
      nodeIds.forEach((nid) => cleanupInsertedNode(nid, new Set(), removedIds));
      setSel({ kind: "none" });
      return;
    }
    if (sel.kind === "momentLoads" && sel.ids.length > 0) {
      removeMomentLoads(new Set(sel.ids));
      setSel({ kind: "none" });
      return;
    }
    if (sel.kind === "distLoads" && sel.ids.length > 0) {
      removeDistLoads(new Set(sel.ids));
      setSel({ kind: "none" });
      return;
    }
    if (sel.kind !== "members" || sel.ids.length === 0) return;
    const delIds = new Set(sel.ids);
    setMembers((prev) => {
      const deleted  = prev.filter((m) => delIds.has(m.id));
      if (!deleted.length) return prev;
      const next     = prev.filter((m) => !delIds.has(m.id));
      const used     = new Set(next.flatMap((m) => [m.a, m.b]));
      const toRemove = new Set(deleted.flatMap((m) => [m.a, m.b]).filter((id) => !used.has(id)));
      removeNodes(toRemove);
      removeSupportsByNodeIds(toRemove);
      removeJointsByNodeIds(toRemove);
      removeLoadsByNodeIds(toRemove);
      removeMomentsByNodeIds(toRemove);
      removeDistLoadsByMemberIds(delIds);
      return next;
    });
    setSel({ kind: "none" });
  }, [
    mode, selectedNodeId, deleteNode, selectNode,
    sel, setMembers, removeNodes,
    removeSupports, removeJoints, removePointLoads, removeDistLoads,
    removeSupportsByNodeIds, removeJointsByNodeIds, removeLoadsByNodeIds,
    removeDistLoadsByMemberIds, setSel, cleanupInsertedNode,
    joints, pointLoads,
  ]);

  const handleEscape = useCallback(() => { resetPath(); clearBox(); }, [resetPath, clearBox]);

  // switchMode をラップ: drawモードを離れる時は commitPath、drawモードに入る時も commitPath でパスをリセット
  const switchModeWithCommit = useCallback((nextMode: Parameters<typeof switchMode>[0]) => {
    commitPath();
    switchMode(nextMode);
  }, [commitPath, switchMode]);

  // ----- キーボード -----
  const { spaceDown, shiftDown } = useKeyboard({
    mode,
    onEscape: handleEscape,
    onEnter:  commitPath,
    onDelete: handleDelete,
  });

  return {
    // ウィンドウ
    W, H,
    // ポインタ
    pointer, setPointer,
    // 描画
    nodes, members, setMembers,
    drawPathIds, nodeById, findNearbyNode,
    addPoint, commitPath, resetPath, removeNodes,
    splitMember, deleteNode, moveNode, mergeNode,
    membersRef,
    // 選択
    sel, setSel,
    boxStart, selBox, selectedSet,
    startBox, updateBox, clearBox,
    commitSelBoxFromCurrent,
    // モード
    mode, switchMode: switchModeWithCommit,
    // ノード編集
    selectedNodeId, nodeDrag,
    selectNode, startDrag, endDrag,
    // 支点
    supports, rotDrag,
    toggleSupport, toggleSupportWithExclusion,
    startRotDrag, updateRotDrag, endRotDrag, rotateByKey,
    removeSupports, removeSupportsByNodeIds, transferSupport,
    // ジョイント
    joints,
    toggleJoint, addJointDirect,
    removeJointsByNodeIds, removeJointByNodeId,
    removeJoints, transferJoint,
    // 集中荷重
    pointLoads, loadRotDrag,
    addPointLoad,
    startLoadRotDrag, updateLoadRotDrag, endLoadRotDrag, rotateLoadByKey,
    removePointLoads, removeLoadsByNodeIds, transferLoad,
    // 等分布荷重
    distLoads, distRotDrag,
    toggleDistLoad,
    startDistRotDrag, updateDistRotDrag, endDistRotDrag,
    removeDistLoads, removeDistLoadsByMemberIds,
    // モーメント荷重
    momentLoads,
    addMomentLoad, flipMomentLoad,
    removeMomentLoads, removeMomentsByNodeIds, transferMomentToNode,
    // キーボード
    spaceDown, shiftDown,
    // FEM 解析
    femResult,
    validation,
    isStale,
    displayFlags,
    setDisplayFlag,
    diagramScale,
    setDiagramScale,
    deformedScale,
    setDeformedScale,
    handleRunAnalysis,
    clearResult,
  };
}

// ===== Context 本体 =====
const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const stageRef = useRef<Konva.Stage>(null);
  const value    = useAppContextValue();
  return (
    <AppContext.Provider value={{ ...value, stageRef }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}