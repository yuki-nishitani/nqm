/**
 * DiagramLayer.tsx — N/Q/M ダイアグラム・反力矢印・変形図を描画する Konva.Layer
 *
 * ■ 変形図の描画方法
 *   各部材を11点でサンプリング。各点の変位を線形補間（軸変位）+
 *   梁たわみ理論（横変位）で求め、amplify倍して描画する。
 *
 *   局所座標系での点xにおける変位:
 *     u(x) = ua + (ub-ua)*x/L                          (軸変位: 線形)
 *     v(x) = Na0*(1-3t²+2t³) + θa*L*(t-2t²+t³)        (横変位: 3次Hermite)
 *           + Nb0*(3t²-2t³)  + θb*L*(-t²+t³)
 *     ただし t=x/L, Na0=va(局所), Nb0=vb(局所)
 *
 *   大域座標系に変換後、amplify を乗じて表示位置を計算。
 */

import React from "react";
import { Layer, Line, Arrow, Text, Circle } from "react-konva";
import { useAppContext } from "../contexts/AppContext";
import { GRID } from "../types";
import type { ElementResult, ReactionResult, DisplacementResult } from "../utils/femTypes";

// ===== 定数 =====
const BASE_HEIGHT      = GRID * 4;
const N_COLOR          = "#4fc3f7";
const Q_COLOR          = "#81c784";
const M_COLOR          = "#e57373";
const REACTION_COLOR   = "#ffe066";
const DEFORMED_COLOR   = "#b48eff";  // 紫: 変形図
const ORIGINAL_COLOR   = "#333";     // 暗いグレー: 変形前の参照線
const LABEL_SIZE       = 11;
const OPACITY          = 0.9;
const ARROW_LEN        = GRID * 2.5;
const DEFORMED_SAMPLES = 21;         // 変形図は多めにサンプル

// ===== ユーティリティ =====

function round2(v: number) { return Math.round(v * 100) / 100; }

function normalVec(c: number, s: number): [number, number] { return [-s, c]; }

function buildPolylinePoints(
  ts: number[], values: number[],
  ax: number, ay: number, bx: number, by: number,
  c: number, s: number, scale: number,
): number[] {
  const L = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
  const [nx, ny] = normalVec(c, s);
  const pts: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const px = ax + ts[i] * L * c;
    const py = ay + ts[i] * L * s;
    pts.push(px + values[i] * scale * nx, py + values[i] * scale * ny);
  }
  return pts;
}

function calcScale(elements: ElementResult[], mode: "N"|"Q"|"M", baseH: number, userScale: number): number {
  let maxVal = 0;
  for (const el of elements)
    for (const pt of el.points) {
      const v = Math.abs(mode === "N" ? pt.N : mode === "Q" ? pt.Q : pt.M);
      if (v > maxVal) maxVal = v;
    }
  if (maxVal < 1e-10) return 1;
  return (baseH / maxVal) * userScale;
}

// ===== 変形図: Hermite補間で部材のたわみ形状を生成 =====
// 局所座標系での横変位v(t): 3次エルミート補間
// v(t) = h1*va + h2*θa*L + h3*vb + h4*θb*L
//   h1 = 1 - 3t² + 2t³
//   h2 = t - 2t² + t³
//   h3 = 3t² - 2t³
//   h4 = -t² + t³

function buildDeformedPoints(
  ax: number, ay: number,
  bx: number, by: number,
  c: number, s: number, L: number,
  // 局所変位 [ua, va, θa, ub, vb, θb]
  ql: [number, number, number, number, number, number],
  amplify: number,
): number[] {
  const [ua, va, thetaA, ub, vb, thetaB] = ql;
  const pts: number[] = [];

  for (let i = 0; i < DEFORMED_SAMPLES; i++) {
    const t = i / (DEFORMED_SAMPLES - 1);
    const t2 = t * t, t3 = t * t * t;

    // 軸変位: 線形補間
    const u = ua + (ub - ua) * t;

    // 横変位: Hermite補間
    const h1 = 1 - 3 * t2 + 2 * t3;
    const h2 = t - 2 * t2 + t3;
    const h3 = 3 * t2 - 2 * t3;
    const h4 = -t2 + t3;
    const v = h1 * va + h2 * thetaA * L + h3 * vb + h4 * thetaB * L;

    // 局所→大域変換 + amplify
    const ux_global = u * c - v * s;
    const uy_global = u * s + v * c;

    // 元の位置 + 変位 * amplify
    const baseX = ax + t * L * c;
    const baseY = ay + t * L * s;
    pts.push(baseX + ux_global * amplify, baseY + uy_global * amplify);
  }

  return pts;
}

// ===== 変形図描画 =====

function buildDeformedElements(
  members: { id: string; a: string; b: string }[],
  nodeById: Map<string, { x: number; y: number }>,
  dispMap: Map<string, DisplacementResult>,
  // ヒンジノードのhingeDof変位を取得するコールバック（将来拡張用）
  amplify: number,
): React.ReactNode[] {
  const elems: React.ReactNode[] = [];

  for (const m of members) {
    const nA = nodeById.get(m.a);
    const nB = nodeById.get(m.b);
    if (!nA || !nB) continue;

    const dA = dispMap.get(m.a);
    const dB = dispMap.get(m.b);
    if (!dA || !dB) continue;

    const dx = nB.x - nA.x, dy = nB.y - nA.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1e-10) continue;
    const c = dx / L, s = dy / L;

    // 局所変位: [ua, va, θa, ub, vb, θb]
    // 大域変位を局所座標に変換
    const ua =  dA.ux * c + dA.uy * s;
    const va = -dA.ux * s + dA.uy * c;
    const ub =  dB.ux * c + dB.uy * s;
    const vb = -dB.ux * s + dB.uy * c;

    const pts = buildDeformedPoints(
      nA.x, nA.y, nB.x, nB.y, c, s, L,
      [ua, va, dA.rot, ub, vb, dB.rot],
      amplify,
    );

    // 参照線（元形状、暗いグレー）
    elems.push(
      <Line
        key={`${m.id}-orig`}
        points={[nA.x, nA.y, nB.x, nB.y]}
        stroke={ORIGINAL_COLOR}
        strokeWidth={1}
        dash={[6, 4]}
        opacity={0.6}
        listening={false}
      />,
    );

    // 変形後の形状
    elems.push(
      <Line
        key={`${m.id}-def`}
        points={pts}
        stroke={DEFORMED_COLOR}
        strokeWidth={2}
        opacity={OPACITY}
        listening={false}
      />,
    );
  }

  // 変形後のノード位置に小円
  const drawnNodes = new Set<string>();
  for (const m of members) {
    for (const nid of [m.a, m.b]) {
      if (drawnNodes.has(nid)) continue;
      drawnNodes.add(nid);
      const n = nodeById.get(nid);
      const d = dispMap.get(nid);
      if (!n || !d) continue;
      elems.push(
        <Circle
          key={`node-${nid}`}
          x={n.x + d.ux * amplify}
          y={n.y + d.uy * amplify}
          radius={3}
          fill={DEFORMED_COLOR}
          opacity={OPACITY}
          listening={false}
        />,
      );
    }
  }

  return elems;
}

// ===== 反力矢印 =====

function buildReactionElements(
  reactions: ReactionResult[],
  nodeById: Map<string, { x: number; y: number }>,
): React.ReactNode[] {
  const elems: React.ReactNode[] = [];

  for (const r of reactions) {
    const nd = nodeById.get(r.nodeId);
    if (!nd) continue;

    if (Math.abs(r.fx) > 1e-4) {
      const sign = r.fx > 0 ? -1 : 1;
      const x1 = nd.x + sign * ARROW_LEN;
      elems.push(
        <Arrow key={`${r.supportId}-fx`}
          points={[x1, nd.y, nd.x, nd.y]}
          stroke={REACTION_COLOR} fill={REACTION_COLOR}
          strokeWidth={2} pointerLength={8} pointerWidth={6} opacity={OPACITY} />,
        <Text key={`${r.supportId}-fxl`}
          x={x1 + (sign > 0 ? -28 : 4)} y={nd.y - 14}
          text={`${round2(Math.abs(r.fx))}`}
          fontSize={LABEL_SIZE} fill={REACTION_COLOR} opacity={OPACITY} />,
      );
    }

    if (Math.abs(r.fy) > 1e-4) {
      const sign = r.fy > 0 ? -1 : 1;
      const y1 = nd.y + sign * ARROW_LEN;
      elems.push(
        <Arrow key={`${r.supportId}-fy`}
          points={[nd.x, y1, nd.x, nd.y]}
          stroke={REACTION_COLOR} fill={REACTION_COLOR}
          strokeWidth={2} pointerLength={8} pointerWidth={6} opacity={OPACITY} />,
        <Text key={`${r.supportId}-fyl`}
          x={nd.x + 6} y={y1 + (sign > 0 ? -16 : 4)}
          text={`${round2(Math.abs(r.fy))}`}
          fontSize={LABEL_SIZE} fill={REACTION_COLOR} opacity={OPACITY} />,
      );
    }

    if (Math.abs(r.m) > 1e-4) {
      elems.push(
        <Circle key={`${r.supportId}-m`}
          x={nd.x} y={nd.y} radius={10}
          stroke={REACTION_COLOR} strokeWidth={2} opacity={OPACITY} />,
        <Text key={`${r.supportId}-ml`}
          x={nd.x + 13} y={nd.y - 7}
          text={`M=${round2(r.m)}`}
          fontSize={LABEL_SIZE} fill={REACTION_COLOR} opacity={OPACITY} />,
      );
    }
  }

  return elems;
}

// ===== 断面力ダイアグラム =====

function buildDiagramElements(
  elements: ElementResult[],
  nodeById: Map<string, { x: number; y: number }>,
  memberMap: Map<string, { a: string; b: string }>,
  mode: "N"|"Q"|"M",
  color: string,
  scale: number,
): React.ReactNode[] {
  const elems: React.ReactNode[] = [];

  for (const el of elements) {
    const m = memberMap.get(el.memberId);
    if (!m) continue;
    const nA = nodeById.get(m.a), nB = nodeById.get(m.b);
    if (!nA || !nB) continue;

    const dx = nB.x - nA.x, dy = nB.y - nA.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1e-10) continue;
    const c = dx / L, s = dy / L;
    const [nx, ny] = normalVec(c, s);

    const ts     = el.points.map(p => p.t);
    const values = el.points.map(p => mode === "N" ? p.N : mode === "Q" ? p.Q : p.M);

    const diagramPts = buildPolylinePoints(ts, values, nA.x, nA.y, nB.x, nB.y, c, s, scale);
    const fillPts    = [...diagramPts, nB.x, nB.y, nA.x, nA.y];

    const va  = round2(values[0]);
    const vb  = round2(values[values.length - 1]);
    const lax = nA.x + values[0] * scale * nx + 3;
    const lay = nA.y + values[0] * scale * ny - 13;
    const lbx = nB.x + values[values.length - 1] * scale * nx + 3;
    const lby = nB.y + values[values.length - 1] * scale * ny - 13;

    elems.push(
      <Line key={`${el.memberId}-fill`}
        points={fillPts} fill={color} opacity={0.2}
        closed={true} strokeWidth={0} stroke={color} listening={false} />,
      <Line key={`${el.memberId}-outline`}
        points={diagramPts} stroke={color} strokeWidth={1.5}
        opacity={OPACITY} listening={false} />,
      <Line key={`${el.memberId}-zero`}
        points={[nA.x, nA.y, nB.x, nB.y]} stroke={color}
        strokeWidth={0.5} opacity={0.3} dash={[4, 4]} listening={false} />,
      <Text key={`${el.memberId}-la`}
        x={lax} y={lay} text={`${va}`}
        fontSize={LABEL_SIZE} fill={color} opacity={OPACITY} listening={false} />,
      <Text key={`${el.memberId}-lb`}
        x={lbx} y={lby} text={`${vb}`}
        fontSize={LABEL_SIZE} fill={color} opacity={OPACITY} listening={false} />,
    );
  }

  return elems;
}

// ===== メインコンポーネント =====

export function DiagramLayer() {
  const { femResult, displayFlags, diagramScale, deformedScale, members, nodeById } = useAppContext();

  if (!femResult?.ok) return null;

  const { elements, reactions, displacements } = femResult;
  const memberMap = new Map(members.map(m => [m.id, m]));
  const dispMap   = new Map(displacements.map(d => [d.nodeId, d]));

  const scaleN = calcScale(elements, "N", BASE_HEIGHT, diagramScale);
  const scaleQ = calcScale(elements, "Q", BASE_HEIGHT, diagramScale);
  const scaleM = calcScale(elements, "M", BASE_HEIGHT, diagramScale);

  return (
    <Layer listening={false}>
      {/* 変形図（断面力より先に描いて背面に） */}
      {displayFlags.deformed && buildDeformedElements(members, nodeById, dispMap, deformedScale)}

      {/* 反力 */}
      {displayFlags.reaction && buildReactionElements(reactions, nodeById)}

      {/* N / Q / M 図 */}
      {displayFlags.N && buildDiagramElements(elements, nodeById, memberMap, "N", N_COLOR, scaleN)}
      {displayFlags.Q && buildDiagramElements(elements, nodeById, memberMap, "Q", Q_COLOR, scaleQ)}
      {displayFlags.M && buildDiagramElements(elements, nodeById, memberMap, "M", M_COLOR, scaleM)}
    </Layer>
  );
}