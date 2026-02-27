import Konva from "konva";
import { Stage } from "react-konva";
import { useMemo } from "react";

import { WorldLayer } from "./WorldLayer";
import { useAppContext } from "../contexts/AppContext";
import { snap, projectPointOnSegment, nearestGridIntersectionOnSegment } from "../utils/geometry";
import { SupportType, SIDEBAR_W, ZOOM_SCALE_FACTOR, DBL_MS, DBL_DIST } from "../types";
import { useRef } from "react";
import { DiagramLayer } from "./DiagramLayer";

export function WorldStage() {
  const {
    W, H,
    stageRef,
    mode, pointer, setPointer,
    nodes, members, nodeById, findNearbyNode,
    drawPathIds,
    addPoint, commitPath, splitMember, moveNode, mergeNode,
    sel, setSel,
    boxStart, startBox, updateBox, clearBox, commitSelBoxFromCurrent,
    supports, rotDrag, updateRotDrag, endRotDrag, toggleSupportWithExclusion,
    joints, toggleJoint, addJointDirect,
    pointLoads, loadRotDrag, updateLoadRotDrag, endLoadRotDrag, addPointLoad,
    distLoads, distRotDrag, updateDistRotDrag, endDistRotDrag, toggleDistLoad,
    selectedNodeId, nodeDrag, selectNode, startDrag, endDrag,
    transferSupport, transferJoint, transferLoad,
    spaceDown, shiftDown,
  } = useAppContext();

  const lastDownRef = useRef<{ t: number; x: number; y: number } | null>(null);

  // ポインタ取得
  function getWorldPointer() {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return stage.getAbsoluteTransform().copy().invert().point(p);
  }

  // ホイールズーム
  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pos      = stage.getPointerPosition();
    if (!pos) return;
    const origin   = { x: (pos.x - stage.x()) / oldScale, y: (pos.y - stage.y()) / oldScale };
    const newScale = e.evt.deltaY > 0 ? oldScale / ZOOM_SCALE_FACTOR : oldScale * ZOOM_SCALE_FACTOR;
    stage.scale({ x: newScale, y: newScale });
    stage.position({ x: pos.x - origin.x * newScale, y: pos.y - origin.y * newScale });
  }

  // 派生値
  const draft = useMemo(() => {
    if (mode !== "drawLine" || !pointer || !drawPathIds.length) return null;
    const a = nodeById.get(drawPathIds[drawPathIds.length - 1]);
    return a ? [a.x, a.y, pointer.x, pointer.y] : null;
  }, [mode, pointer, drawPathIds, nodeById]);

  const draftPolyline = useMemo(() => {
    if (mode !== "drawLine" || drawPathIds.length < 2) return null;
    const pts: number[] = [];
    for (const id of drawPathIds) {
      const n = nodeById.get(id);
      if (!n) return null;
      pts.push(n.x, n.y);
    }
    return pts;
  }, [mode, drawPathIds, nodeById]);

  const startMarker = useMemo(() => {
    if (mode !== "drawLine" || !drawPathIds.length) return null;
    return nodeById.get(drawPathIds[0]) ?? null;
  }, [mode, drawPathIds, nodeById]);

  // Shift+クリックでメンバー線上の最近傍交点を探すヘルパー
  function findBestIntersection() {
    let bestDist = Infinity;
    let bestMemberId: string | null = null;
    let bestPt: { x: number; y: number } | null = null;
    const wp = getWorldPointer();
    if (!wp) return null;
    for (const m of members) {
      const a = nodeById.get(m.a), b = nodeById.get(m.b);
      if (!a || !b) continue;
      const pt = nearestGridIntersectionOnSegment(wp.x, wp.y, a.x, a.y, b.x, b.y);
      if (!pt) continue;
      const d = Math.hypot(wp.x - pt.x, wp.y - pt.y);
      if (d < bestDist) { bestDist = d; bestMemberId = m.id; bestPt = pt; }
    }
    return bestMemberId && bestPt ? { memberId: bestMemberId, pt: bestPt, wp } : null;
  }

  return (
    <div style={{ flex: 1, height: "100%" }}>
      <Stage
        ref={stageRef}
        width={W - SIDEBAR_W} height={H}
        pixelRatio={window.devicePixelRatio || 1}
        draggable={spaceDown}
        onWheel={onWheel}
        onDblClick={() => { if (mode === "drawLine") commitPath(); }}

        onMouseMove={() => {
          const wp = getWorldPointer();
          if (!wp) return;
          if (rotDrag)     { updateRotDrag(wp.x, wp.y, shiftDown); return; }
          if (loadRotDrag) { updateLoadRotDrag(wp.x, wp.y, shiftDown); return; }
          if (distRotDrag) { updateDistRotDrag(wp.x, wp.y, shiftDown); return; }
          if (mode === "nodeEdit" && nodeDrag) {
            moveNode(nodeDrag.nodeId, snap(wp.x - nodeDrag.offsetX), snap(wp.y - nodeDrag.offsetY), true);
            return;
          }
          if (mode === "drawLine") {
            setPointer({ x: snap(wp.x), y: snap(wp.y) });
          } else {
            if (pointer) setPointer(null);
          }
          if (mode === "select" && boxStart && !spaceDown) updateBox(wp.x, wp.y);
        }}

        onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt?.button === 2) return;
          const wp = getWorldPointer();
          if (!wp) return;

          // drawLine: ダブルクリック判定
          if (mode === "drawLine") {
            const now  = performance.now();
            const prev = lastDownRef.current;
            if (prev) {
              const dt = now - prev.t;
              const d2 = (wp.x - prev.x) ** 2 + (wp.y - prev.y) ** 2;
              if (dt < DBL_MS && d2 < DBL_DIST ** 2) {
                commitPath();
                lastDownRef.current = null;
                return;
              }
            }
            lastDownRef.current = { t: now, x: wp.x, y: wp.y };
          }

          const stage        = e.target.getStage();
          const clickedEmpty = stage && e.target === stage;

          // select: ボックス選択開始
          if (mode === "select") {
            if (!clickedEmpty || spaceDown) return;
            setSel({ kind: "none" });
            startBox(wp.x, wp.y);
            return;
          }

          if (clickedEmpty) setSel({ kind: "none" });

          // nodeEdit
          if (mode === "nodeEdit") {
            if (shiftDown) {
              const hit = findBestIntersection();
              if (!hit) return;
              const newNodeId = splitMember(hit.memberId, hit.pt.x, hit.pt.y);
              if (newNodeId) selectNode(newNodeId);
              return;
            }
            const nearby = findNearbyNode(wp.x, wp.y);
            if (!nearby) { selectNode(null); return; }
            const n = nodeById.get(nearby.id)!;
            startDrag(nearby.id, n.x, n.y, wp.x, wp.y);
            return;
          }

          // support
          if (mode === "supportPin" || mode === "supportRoller" || mode === "supportFix") {
            const supportType: SupportType =
              mode === "supportPin" ? "pin" : mode === "supportRoller" ? "roller" : "fix";
            const nearby = findNearbyNode(wp.x, wp.y);
            if (!nearby) return;
            const existingSupport = supports.find((s) => s.nodeId === nearby.id);
            if (existingSupport && existingSupport.type === supportType) {
              setSel({ kind: "supports", ids: [existingSupport.id] });
            } else {
              toggleSupportWithExclusion(nearby.id, supportType);
              setSel({ kind: "none" });
            }
            return;
          }

          // joint
          if (mode === "joint") {
            if (shiftDown) {
              const hit = findBestIntersection();
              if (!hit) return;
              const newNodeId = splitMember(hit.memberId, hit.pt.x, hit.pt.y);
              if (newNodeId) addJointDirect(newNodeId);
            } else {
              const nearby = findNearbyNode(wp.x, wp.y);
              if (!nearby) return;
              const existingJoint = joints.find((j) => j.nodeId === nearby.id);
              if (existingJoint) {
                setSel({ kind: "joints", ids: [existingJoint.id] });
                return;
              }
              const supportNodeIds = new Set(supports.map((s) => s.nodeId));
              toggleJoint(nearby.id, members, supportNodeIds);
            }
            setSel({ kind: "none" });
            return;
          }

          // load
          if (mode === "load") {
            if (shiftDown) {
              const hit = findBestIntersection();
              if (!hit) return;
              const newNodeId = splitMember(hit.memberId, hit.pt.x, hit.pt.y);
              if (newNodeId) addPointLoad(newNodeId);
            } else {
              const nearby = findNearbyNode(wp.x, wp.y);
              if (!nearby) return;
              const existingLoad = pointLoads.find((l) => l.nodeId === nearby.id);
              if (existingLoad) {
                setSel({ kind: "loads", ids: [existingLoad.id] });
                return;
              }
              addPointLoad(nearby.id);
            }
            setSel({ kind: "none" });
            return;
          }

          // distLoad
          if (mode === "distLoad") {
            const HIT = 12;
            let bestDist = HIT;
            let bestMemberId: string | null = null;
            for (const m of members) {
              const a = nodeById.get(m.a), b = nodeById.get(m.b);
              if (!a || !b) continue;
              const proj = projectPointOnSegment(wp.x, wp.y, a.x, a.y, b.x, b.y);
              if (proj.dist < bestDist) { bestDist = proj.dist; bestMemberId = m.id; }
            }
            if (!bestMemberId) return;
            const existingDistLoad = distLoads.find((l) => l.memberId === bestMemberId);
            if (existingDistLoad) {
              setSel({ kind: "distLoads", ids: [existingDistLoad.id] });
            } else {
              toggleDistLoad(bestMemberId);
              setSel({ kind: "none" });
            }
            return;
          }

          // drawLine
          if (mode !== "drawLine") return;
          addPoint(wp.x, wp.y);
        }}

        onMouseUp={() => {
          if (rotDrag)     { endRotDrag();     return; }
          if (loadRotDrag) { endLoadRotDrag(); return; }
          if (distRotDrag) { endDistRotDrag(); return; }
          if (mode === "nodeEdit" && nodeDrag) {
            const draggedId = nodeDrag.nodeId;
            const dragged   = nodeById.get(draggedId);
            if (dragged) {
              const target = nodes.find(
                (n) => n.id !== draggedId && n.x === dragged.x && n.y === dragged.y
              );
              if (target) {
                transferSupport(target.id, draggedId);
                transferJoint(target.id, draggedId);
                transferLoad(target.id, draggedId);
                mergeNode(target.id, draggedId);
                selectNode(null);
              }
            }
            endDrag();
            return;
          }
          if (mode === "select") commitSelBoxFromCurrent();
        }}
      >
        <WorldLayer
          getWorldPointer={getWorldPointer}
          draft={draft}
          draftPolyline={draftPolyline}
          startMarker={startMarker}
        />
        <DiagramLayer />
      </Stage>
    </div>
  );
}