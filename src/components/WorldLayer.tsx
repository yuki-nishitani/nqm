import Konva from "konva";
import { Layer, Circle, Line, Rect, Shape, Text } from "react-konva";
import React, { useCallback } from "react";

import { SvgIconShape } from "../SvgIconShape";
import { useAppContext } from "../contexts/AppContext";
import { loadIconCenter } from "../hooks/usePointLoads";
import { distLoadIconCenter } from "../hooks/useDistLoads";
import {
  SupportType,
  GRID_RANGE, GRID,
  BLUE, WHITE, YELLOW,
  START_MARKER_RADIUS,
} from "../types";

import pinSvgText        from "../assets/icons/pin.svg?raw";
import rollerSvgText     from "../assets/icons/roller.svg?raw";
import fixSvgText        from "../assets/icons/fix.svg?raw";
import jointSvgText      from "../assets/icons/joint.svg?raw";
import loadSvgText       from "../assets/icons/load.svg?raw";
import oneDistLoadSvgText from "../assets/icons/onedistload.svg?raw";
import momentSvgText      from "../assets/icons/moment.svg?raw";

interface Props {
  getWorldPointer: () => { x: number; y: number } | null;
  draft:         number[] | null;
  draftPolyline: number[] | null;
  startMarker:   { x: number; y: number } | null;
}

export function WorldLayer({ getWorldPointer, draft, draftPolyline, startMarker }: Props) {
  const {
    mode, pointer,
    nodes, members, nodeById,
    sel, setSel, selBox, selectedSet, clearBox,
    supports, rotDrag, startRotDrag,
    toggleSupportWithExclusion,
    joints, toggleJoint,
    pointLoads, loadRotDrag, startLoadRotDrag,
    distLoads, distRotDrag, startDistRotDrag,
    momentLoads, flipMomentLoad,
    selectedNodeId, startDrag,
  } = useAppContext();

  // グリッド描画
  const gridDrawer = useCallback((ctx: Konva.Context, shape: Konva.Shape) => {
    ctx.beginPath();
    for (let x = -GRID_RANGE; x <= GRID_RANGE; x += GRID) { ctx.moveTo(x, -GRID_RANGE); ctx.lineTo(x, GRID_RANGE); }
    for (let y = -GRID_RANGE; y <= GRID_RANGE; y += GRID) { ctx.moveTo(-GRID_RANGE, y); ctx.lineTo(GRID_RANGE, y); }
    ctx.strokeShape(shape);
  }, []);

  return (
    <Layer>
      {/* グリッド */}
      <Shape sceneFunc={gridDrawer} stroke="#222" strokeWidth={1} listening={false} />

      {/* nodeEdit モード: ノードを小円で表示 */}
      {mode === "nodeEdit" && nodes.map((n) => {
        const isSel = selectedNodeId === n.id;
        return (
          <Circle
            key={n.id}
            x={n.x} y={n.y}
            radius={isSel ? 7 : 5}
            fill={isSel ? BLUE : WHITE}
            stroke={isSel ? BLUE : "#888"}
            strokeWidth={1}
            onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              ev.cancelBubble = true;
              const wp = getWorldPointer();
              if (!wp) return;
              startDrag(n.id, n.x, n.y, wp.x, wp.y);
            }}
          />
        );
      })}

      {/* 支点 */}
      {supports.map((s) => {
        const n = nodeById.get(s.nodeId);
        if (!n) return null;
        const isSel   = sel.kind === "supports" && sel.ids.includes(s.id);
        const svgText = s.type === "pin" ? pinSvgText : s.type === "roller" ? rollerSvgText : fixSvgText;
        const size    = s.type === "fix" ? 60 : 36;
        const d       = s.type === "fix" ? 5  : 12;
        const rad     = ((s.angleDeg + 90) * Math.PI) / 180;
        const cx      = n.x + d * Math.cos(rad);
        const cy      = n.y + d * Math.sin(rad);
        return (
          <SvgIconShape
            key={s.id}
            svgText={svgText}
            x={cx} y={cy} w={size} h={size}
            stroke={isSel ? BLUE : WHITE}
            rotation={s.angleDeg}
            offsetX={size / 2} offsetY={size / 2}
            onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              const isSupportMode = mode === "supportPin" || mode === "supportRoller" || mode === "supportFix";
              if (mode !== "select" && !isSupportMode) return;
              ev.cancelBubble = true;
              if (isSupportMode) {
                const supportType: SupportType =
                  mode === "supportPin" ? "pin" : mode === "supportRoller" ? "roller" : "fix";
                if (s.type !== supportType) {
                  toggleSupportWithExclusion(s.nodeId, supportType);
                  setSel({ kind: "none" });
                  return;
                }
              }
              setSel({ kind: "supports", ids: [s.id] });
              clearBox();
            }}
          />
        );
      })}

      {/* メンバー（線） */}
      {members.map((m) => {
        const a = nodeById.get(m.a), b = nodeById.get(m.b);
        if (!a || !b) return null;
        const isSel = selectedSet.has(m.id);
        return (
          <Line
            key={m.id}
            points={[a.x, a.y, b.x, b.y]}
            stroke={isSel ? BLUE : WHITE}
            strokeWidth={isSel ? 4 : 2}
            hitStrokeWidth={12}
            onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              if (mode !== "select") return;
              ev.cancelBubble = true;
              setSel({ kind: "members", ids: [m.id] });
              clearBox();
            }}
          />
        );
      })}

      {/* ジョイント */}
      {joints.map((j) => {
        const n = nodeById.get(j.nodeId);
        if (!n) return null;
        const isSel = sel.kind === "joints" && sel.ids.includes(j.id);
        const size  = 28;
        return (
          <SvgIconShape
            key={j.id}
            svgText={jointSvgText}
            x={n.x} y={n.y}
            w={size} h={size}
            stroke={isSel ? BLUE : WHITE}
            fill="#111"
            offsetX={size / 2} offsetY={size / 2}
            listening={mode === "select" || mode === "joint"}
            onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              if (mode !== "select" && mode !== "joint") return;
              ev.cancelBubble = true;
              setSel({ kind: "joints", ids: [j.id] });
              clearBox();
            }}
          />
        );
      })}

      {/* 回転ハンドル（支点選択時） */}
      {sel.kind === "supports" && sel.ids.length === 1 && (() => {
        const s = supports.find(v => v.id === sel.ids[0]);
        if (!s) return null;
        const n = nodeById.get(s.nodeId);
        if (!n) return null;
        const cx = n.x, cy = n.y;
        const R = 45, HIT_W = 18, KNOB_R = 6;
        const rad = ((s.angleDeg + 90) * Math.PI) / 180;
        const kx = cx + R * Math.cos(rad);
        const ky = cy + R * Math.sin(rad);
        const startRot = (ev: Konva.KonvaEventObject<MouseEvent>) => {
          ev.cancelBubble = true;
          const wp = getWorldPointer();
          if (!wp) return;
          startRotDrag(s.id, s.angleDeg, Math.atan2(wp.y - cy, wp.x - cx));
          clearBox();
        };
        return (
          <>
            <Circle x={cx} y={cy} radius={R} stroke={YELLOW} strokeWidth={2} dash={[6, 4]} listening={false} />
            <Circle x={cx} y={cy} radius={R} stroke="rgba(0,0,0,0)" strokeWidth={HIT_W} onMouseDown={startRot} />
            <Circle x={kx} y={ky} radius={KNOB_R} fill={YELLOW} onMouseDown={startRot} />
          </>
        );
      })()}

      {/* 等分布荷重 */}
      {distLoads.map((l) => {
        const m = members.find((m) => m.id === l.memberId);
        if (!m) return null;
        const a = nodeById.get(m.a), b = nodeById.get(m.b);
        if (!a || !b) return null;
        const isSel = sel.kind === "distLoads" && sel.ids.includes(l.id);
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return null;
        const ARROW_SPACING = 25;
        const size  = 30;
        const count = Math.max(2, Math.floor(len / ARROW_SPACING));
        const icons: JSX.Element[] = [];
        for (let i = 0; i <= count; i++) {
          const t  = i / count;
          const px = a.x + t * dx;
          const py = a.y + t * dy;
          const { cx, cy } = distLoadIconCenter(px, py, l.angleDeg, size / 2);
          icons.push(
            <SvgIconShape
              key={i}
              svgText={oneDistLoadSvgText}
              x={cx} y={cy}
              w={size} h={size}
              stroke={isSel ? BLUE : WHITE}
              rotation={l.angleDeg}
              offsetX={size / 2} offsetY={size / 2}
              listening={mode === "select" || mode === "distLoad"}
              onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
                if (mode !== "select" && mode !== "distLoad") return;
                ev.cancelBubble = true;
                setSel({ kind: "distLoads", ids: [l.id] });
                clearBox();
              }}
            />
          );
        }
        return <React.Fragment key={l.id}>{icons}</React.Fragment>;
      })}

      {/* 回転ハンドル（等分布荷重選択時） */}
      {sel.kind === "distLoads" && sel.ids.length === 1 && (() => {
        const l = distLoads.find(v => v.id === sel.ids[0]);
        if (!l) return null;
        const m = members.find((m) => m.id === l.memberId);
        if (!m) return null;
        const a = nodeById.get(m.a), b = nodeById.get(m.b);
        if (!a || !b) return null;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const R  = 45, HIT_W = 18, KNOB_R = 6;
        const rad = ((l.angleDeg + 270) * Math.PI) / 180;
        const kx = cx + R * Math.cos(rad);
        const ky = cy + R * Math.sin(rad);
        const startRot = (ev: Konva.KonvaEventObject<MouseEvent>) => {
          ev.cancelBubble = true;
          const wp = getWorldPointer();
          if (!wp) return;
          startDistRotDrag(l.id, l.angleDeg, Math.atan2(wp.y - cy, wp.x - cx), cx, cy);
          clearBox();
        };
        return (
          <>
            <Circle x={cx} y={cy} radius={R} stroke={YELLOW} strokeWidth={2} dash={[6, 4]} listening={false} />
            <Circle x={cx} y={cy} radius={R} stroke="rgba(0,0,0,0)" strokeWidth={HIT_W} onMouseDown={startRot} />
            <Circle x={kx} y={ky} radius={KNOB_R} fill={YELLOW} onMouseDown={startRot} />
          </>
        );
      })()}

      {/* 集中荷重 */}
      {pointLoads.map((l) => {
        const n = nodeById.get(l.nodeId);
        if (!n) return null;
        const isSel = sel.kind === "loads" && sel.ids.includes(l.id);
        const size  = 45;
        const { cx, cy } = loadIconCenter(n, l.angleDeg, l.offsetDist);
        return (
          <SvgIconShape
            key={l.id}
            svgText={loadSvgText}
            x={cx} y={cy}
            w={size} h={size}
            stroke={isSel ? BLUE : WHITE}
            rotation={l.angleDeg}
            offsetX={size / 2} offsetY={size / 2}
            listening={mode === "select" || mode === "load"}
            onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              if (mode !== "select" && mode !== "load") return;
              ev.cancelBubble = true;
              setSel({ kind: "loads", ids: [l.id] });
              clearBox();
            }}
          />
        );
      })}

      {/* 回転ハンドル（集中荷重選択時） */}
      {sel.kind === "loads" && sel.ids.length === 1 && (() => {
        const l = pointLoads.find(v => v.id === sel.ids[0]);
        if (!l) return null;
        const n = nodeById.get(l.nodeId);
        if (!n) return null;
        const cx = n.x, cy = n.y;
        const R  = 50, HIT_W = 18, KNOB_R = 6;
        const rad = ((l.angleDeg + 270) * Math.PI) / 180;
        const kx = cx + R * Math.cos(rad);
        const ky = cy + R * Math.sin(rad);
        const startRot = (ev: Konva.KonvaEventObject<MouseEvent>) => {
          ev.cancelBubble = true;
          const wp = getWorldPointer();
          if (!wp) return;
          startLoadRotDrag(l.id, l.angleDeg, Math.atan2(wp.y - cy, wp.x - cx));
          clearBox();
        };
        return (
          <>
            <Circle x={cx} y={cy} radius={R} stroke={YELLOW} strokeWidth={2} dash={[6, 4]} listening={false} />
            <Circle x={cx} y={cy} radius={R} stroke="rgba(0,0,0,0)" strokeWidth={HIT_W} onMouseDown={startRot} />
            <Circle x={kx} y={ky} radius={KNOB_R} fill={YELLOW} onMouseDown={startRot} />
          </>
        );
      })()}


            {/* モーメント荷重 */}
      {momentLoads.map((l) => {
        const n = nodeById.get(l.nodeId);
        if (!n) return null;
        const isSel = sel.kind === "momentLoads" && sel.ids.includes(l.id);
        const size  = 45;
        return (
          <SvgIconShape
            key={l.id}
            svgText={momentSvgText}
            x={n.x} y={n.y}
            w={size} h={size}
            stroke={isSel ? BLUE : WHITE}
            scaleX={l.clockwise ? -1 : 1}
            offsetX={size / 2} offsetY={size / 2}
            listening={mode === "select" || mode === "momentLoad"}
            onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              if (mode !== "select" && mode !== "momentLoad") return;
              ev.cancelBubble = true;
              setSel({ kind: "momentLoads", ids: [l.id] });
              clearBox();
            }}
          />
        );
      })}

      {/* 反転ガイド（モーメント荷重選択時） */}
      {sel.kind === "momentLoads" && sel.ids.length === 1 && (() => {
        const l = momentLoads.find(v => v.id === sel.ids[0]);
        if (!l) return null;
        const n = nodeById.get(l.nodeId);
        if (!n) return null;

        const cx = n.x, cy = n.y;
        const R = 38;

        // 右 → 上 に移動
        const btnX = cx;
        const btnY = cy - R;

        return (
          <>
            {/* 反転ボタン */}
            <Circle
              x={btnX} y={btnY} radius={10}
              fill={YELLOW} opacity={0.9}
              onMouseDown={(ev: Konva.KonvaEventObject<MouseEvent>) => {
                ev.cancelBubble = true;
                flipMomentLoad(l.id);
              }}
            />

            {/* アイコン */}
            <Text
              x={btnX} y={btnY}
              text={l.clockwise ? "↺" : "↻"}
              fontSize={13} fill="#111" fontStyle="bold"
              offsetX={6} offsetY={7}
              listening={false}
            />
          </>
        );
      })()}

      {/* 選択ボックス */}
      {mode === "select" && selBox && (
        <Rect
          x={selBox.x} y={selBox.y} width={selBox.w} height={selBox.h}
          stroke="#7ff" strokeWidth={1.5} dash={[6, 6]}
          fill="rgba(127,255,255,0.10)" listening={false}
        />
      )}

      {/* ドラフト描画 */}
      {draftPolyline && <Line points={draftPolyline} stroke="#7ff" strokeWidth={2} listening={false} />}
      {draft          && <Line points={draft}         stroke="#7ff" strokeWidth={2} dash={[6, 6]} listening={false} />}

      {/* 始点マーカー */}
      {startMarker && (
        <Circle x={startMarker.x} y={startMarker.y} radius={START_MARKER_RADIUS}
          stroke="#7ff" strokeWidth={2} listening={false} />
      )}

      {/* カーソルドット */}
      {mode === "drawLine" && pointer && (
        <Circle x={pointer.x} y={pointer.y} radius={3} fill="#7ff" opacity={0.8} listening={false} />
      )}
    </Layer>
  );
}