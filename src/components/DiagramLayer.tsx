/**
 * DiagramLayer.tsx — N/Q/M ダイアグラム・反力矢印・変形図を描画する Konva.Layer
 *
 * 円弧部材は FEM 解析時にサブ直線に展開済み（fem.ts の expandArcMembers）。
 * femResult.expandedNodes / expandedMembers を使うことで、
 * 円弧専用コードを一切持たずに直線要素のロジックのみで描画できる。
 *
 * ■ 円弧グループの滑らかな描画
 *   arcGroupMap（サブ部材ID → 元円弧部材ID）を使い、同じ円弧に属する
 *   サブ部材の断面力点列を結合して1本のポリラインとして描画する。
 *   これにより扇形の重なりが消え、滑らかな帯状ダイアグラムになる。
 *
 * ■ 変形図の描画方法
 *   各部材を DEFORMED_SAMPLES 点でサンプリング。各点の変位を線形補間（軸変位）+
 *   梁たわみ理論（横変位）で求め、amplify倍して描画する。
 */

import React from "react";
import { buildSmoothedFillPoints } from "./diagramSpline";
import { Layer, Line, Text, Circle } from "react-konva";
import { useAppContext } from "../contexts/AppContext";
import { GRID } from "../types";
import type { ElementResult, ReactionResult, DisplacementResult } from "../utils/femTypes";
import { SvgIconShape } from "../SvgIconShape";

import oneDistLoadSvgText from "../assets/icons/onedistload.svg?raw";
import reactmomSvgText      from "../assets/icons/reactmom.svg?raw";

// ===== 定数 =====
const BASE_HEIGHT      = GRID * 4;
const N_COLOR          = "#4fc3f7";
const Q_COLOR          = "#81c784";
const M_COLOR          = "#e57373";
const REACTION_COLOR   = "#ffe066";
const DEFORMED_COLOR   = "#b48eff";
const ORIGINAL_COLOR   = "#333";
const LABEL_SIZE       = 11;
const OPACITY          = 0.9;
const ARROW_LEN        = -15;
const DEFORMED_SAMPLES = 21;

// 反力アイコンのサイズ（WorldLayer の distLoad と揃える）
const REACTION_ICON_SIZE     = 45;
const REACTION_MOMENT_SIZE   = 45;

// ===== ユーティリティ =====

function round2(v: number) { return Math.round(v * 100) / 100; }

function normalVec(c: number, s: number): [number, number] { return [-s, c]; }

// ===== 断面力スケール計算 =====

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

// ===== 断面力ダイアグラム =====

type DiagramPoint = {
  baseX: number; baseY: number;
  nx: number; ny: number;
  value: number;
  /** 円弧点の場合、円の中心に対する角度（ラジアン）。法線再計算に使用。 */
  arcAngle?: number;
};

/**
 * 1つの要素（サブ部材）の断面力点列をワールド座標に変換して返す。
 * arcGeom が渡された場合、baseX/Y を円弧上の真座標で計算する。
 */
function elementDiagramPoints(
  el: ElementResult,
  nA: { x: number; y: number },
  nB: { x: number; y: number },
  mode: "N"|"Q"|"M",
  arcGeom?: { cx: number; cy: number; r: number; startAngle: number; angleSpan: number },
): DiagramPoint[] {
  const dx = nB.x - nA.x, dy = nB.y - nA.y;
  const L = Math.sqrt(dx * dx + dy * dy);
  if (L < 1e-10) return [];
  const c = dx / L, s = dy / L;
  const [nx, ny] = normalVec(c, s);

  return el.points.map(p => {
    const value = mode === "N" ? p.N : mode === "Q" ? p.Q : p.M;
    let baseX: number, baseY: number;
    let arcAngle: number | undefined;
    if (arcGeom) {
      const angle = arcGeom.startAngle + arcGeom.angleSpan * p.t;
      baseX = arcGeom.cx + arcGeom.r * Math.cos(angle);
      baseY = arcGeom.cy + arcGeom.r * Math.sin(angle);
      arcAngle = angle;
      // 円弧接線方向: angleSpan の符号で進行方向を決定
      const sign = arcGeom.angleSpan >= 0 ? 1 : -1;
      const tanC = -Math.sin(angle) * sign;
      const tanS =  Math.cos(angle) * sign;
      const [anx, any] = normalVec(tanC, tanS);
      return { baseX, baseY, nx: anx, ny: any, value, arcAngle };
    } else {
      baseX = nA.x + p.t * L * c;
      baseY = nA.y + p.t * L * s;
    }
    return { baseX, baseY, nx, ny, value };
  });
}

/**
 * DiagramPoint[] から Konva points 配列を生成する。
 * offset=true  → 断面力オフセット後の座標
 * offset=false → ゼロライン（部材軸）上の座標
 */
function toKonvaPoints(pts: DiagramPoint[], scale: number, offset: boolean): number[] {
  const arr: number[] = [];
  for (const p of pts) {
    if (offset) {
      arr.push(p.baseX + p.value * scale * p.nx, p.baseY + p.value * scale * p.ny);
    } else {
      arr.push(p.baseX, p.baseY);
    }
  }
  return arr;
}

/**
 * DiagramPoint[] からラベル描画用の Konva 要素を生成する。
 */
function makeDiagramKonva(
  key: string,
  allPts: DiagramPoint[],
  scale: number,
  color: string,
  isArc = false,
): React.ReactNode[] {
  if (allPts.length === 0) return [];

  const rawDiagramPts = toKonvaPoints(allPts, scale, true);
  const zeroPts       = toKonvaPoints(allPts, scale, false);

  // 円弧の場合はオフセット点列をスプライン補間して滑らかにする
  let diagramPts: number[];
  let fillPts: number[];
  if (isArc) {
    const smoothed = buildSmoothedFillPoints(zeroPts, rawDiagramPts, 4);
    diagramPts = smoothed.outlinePts;
    fillPts    = smoothed.fillPts;
  } else {
    diagramPts = rawDiagramPts;
    const zeroPtsReversed: number[] = [];
    for (let i = zeroPts.length - 2; i >= 0; i -= 2) {
      zeroPtsReversed.push(zeroPts[i], zeroPts[i + 1]);
    }
    fillPts = [...diagramPts, ...zeroPtsReversed];
  }

  const va = round2(allPts[0].value);
  const vb = round2(allPts[allPts.length - 1].value);
  const lax = diagramPts[0] + 3;
  const lay = diagramPts[1] - 13;
  const lbx = diagramPts[diagramPts.length - 2] + 3;
  const lby = diagramPts[diagramPts.length - 1] - 13;

  return [
    <Line key={`${key}-fill`}
      points={fillPts} fill={color} opacity={0.2}
      closed={true} strokeWidth={0} stroke={color} listening={false} />,
    <Line key={`${key}-outline`}
      points={diagramPts} stroke={color} strokeWidth={1.5}
      opacity={OPACITY} listening={false} />,
    <Line key={`${key}-zero`}
      points={zeroPts} stroke={color}
      strokeWidth={0.5} opacity={0.3} dash={[4, 4]} listening={false} />,
    <Text key={`${key}-la`}
      x={lax} y={lay} text={`${va}`}
      fontSize={LABEL_SIZE} fill={color} opacity={OPACITY} listening={false} />,
    <Text key={`${key}-lb`}
      x={lbx} y={lby} text={`${vb}`}
      fontSize={LABEL_SIZE} fill={color} opacity={OPACITY} listening={false} />,
  ];
}

/**
 * 断面力ダイアグラムを描画する。
 * arcGroupMap でまとめられた円弧グループは1本の滑らかなポリラインに結合する。
 */
function buildDiagramElements(
  elements: ElementResult[],
  nodeById: Map<string, { x: number; y: number }>,
  memberMap: Map<string, { a: string; b: string }>,
  arcGroupMap: Map<string, string>,
  arcMemberGeom: Map<string, { cx: number; cy: number; r: number; startAngle: number; angleSpan: number }>,
  mode: "N"|"Q"|"M",
  color: string,
  scale: number,
): React.ReactNode[] {
  const elems: React.ReactNode[] = [];

  // 元円弧部材ID → サブ要素リスト（展開順を維持するため Map で収集）
  const arcGroups = new Map<string, ElementResult[]>();
  const straightElements: ElementResult[] = [];

  for (const el of elements) {
    const origId = arcGroupMap.get(el.memberId);
    if (origId !== undefined) {
      if (!arcGroups.has(origId)) arcGroups.set(origId, []);
      arcGroups.get(origId)!.push(el);
    } else {
      straightElements.push(el);
    }
  }

  // ---- 直線部材：個別描画 ----
  for (const el of straightElements) {
    const m = memberMap.get(el.memberId);
    if (!m) continue;
    const nA = nodeById.get(m.a), nB = nodeById.get(m.b);
    if (!nA || !nB) continue;

    const pts = elementDiagramPoints(el, nA, nB, mode);
    elems.push(...makeDiagramKonva(el.memberId, pts, scale, color));
  }

  // ---- 円弧グループ：サブ部材の【端点のみ】を使いスプライン補間で滑らかに描画 ----
  //
  // サブ部材内の中間サンプル点（el.points の t=0.1〜0.9）は使わない。
  // 各サブ部材の境界点（t=0 と t=1）のみを収集し、
  // arcGeom から正確な円弧座標・法線を計算した後、
  // スプライン補間で滑らかなアウトラインを生成する。
  for (const [origId, groupEls] of arcGroups) {
    // ノードIDキャッシュ: 同一境界点を1つのオブジェクトとして共有
    const nodePointCache = new Map<string, DiagramPoint>();

    /**
     * arcGeom + angle から DiagramPoint を生成するヘルパー。
     * value は el.points の端点（t=0 or t=1）から取得。
     */
    const makeArcPoint = (
      geom: { cx: number; cy: number; r: number; startAngle: number; angleSpan: number },
      angle: number,
      value: number,
    ): DiagramPoint => {
      const baseX = geom.cx + geom.r * Math.cos(angle);
      const baseY = geom.cy + geom.r * Math.sin(angle);
      const sign = geom.angleSpan >= 0 ? 1 : -1;
      const tanC = -Math.sin(angle) * sign;
      const tanS =  Math.cos(angle) * sign;
      const [nx, ny] = normalVec(tanC, tanS);
      return { baseX, baseY, nx, ny, value };
    };

    const boundaryPts: DiagramPoint[] = [];

    for (let gi = 0; gi < groupEls.length; gi++) {
      const el = groupEls[gi];
      const m = memberMap.get(el.memberId);
      if (!m) continue;

      const geom = arcMemberGeom.get(el.memberId);
      if (!geom) continue;

      const ptA = el.points[0];
      const ptB = el.points[el.points.length - 1];
      const valA = mode === "N" ? ptA.N : mode === "Q" ? ptA.Q : ptA.M;
      const valB = mode === "N" ? ptB.N : mode === "Q" ? ptB.Q : ptB.M;

      const angleA = geom.startAngle;
      const angleB = geom.startAngle + geom.angleSpan;

      if (!nodePointCache.has(m.a)) nodePointCache.set(m.a, makeArcPoint(geom, angleA, valA));
      if (!nodePointCache.has(m.b)) nodePointCache.set(m.b, makeArcPoint(geom, angleB, valB));

      // 先頭サブ部材のみ a端を追加、以降は b端のみ追加（境界重複を防ぐ）
      if (gi === 0) boundaryPts.push(nodePointCache.get(m.a)!);
      boundaryPts.push(nodePointCache.get(m.b)!);
    }

    if (boundaryPts.length < 2) continue;

    // スプライン補間で滑らかなアウトラインを生成して描画
    elems.push(...makeDiagramKonva(origId, boundaryPts, scale, color, true));
  }

  return elems;
}

// ===== 変形図 =====

function buildDeformedPoints(
  ax: number, ay: number,
  bx: number, by: number,
  c: number, s: number, L: number,
  ql: [number, number, number, number, number, number],
  amplify: number,
): number[] {
  const [ua, va, thetaA, ub, vb, thetaB] = ql;
  const pts: number[] = [];
  for (let i = 0; i < DEFORMED_SAMPLES; i++) {
    const t = i / (DEFORMED_SAMPLES - 1);
    const t2 = t * t, t3 = t * t * t;
    const u = ua + (ub - ua) * t;
    const h1 = 1 - 3 * t2 + 2 * t3;
    const h2 = t - 2 * t2 + t3;
    const h3 = 3 * t2 - 2 * t3;
    const h4 = -t2 + t3;
    const v = h1 * va + h2 * thetaA * L + h3 * vb + h4 * thetaB * L;
    const ux_global = u * c - v * s;
    const uy_global = u * s + v * c;
    const baseX = ax + t * L * c;
    const baseY = ay + t * L * s;
    pts.push(baseX + ux_global * amplify, baseY + uy_global * amplify);
  }
  return pts;
}

function buildDeformedElements(
  members: { id: string; a: string; b: string }[],
  nodeById: Map<string, { x: number; y: number }>,
  dispMap: Map<string, DisplacementResult>,
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

    const ua =  dA.ux * c + dA.uy * s;
    const va = -dA.ux * s + dA.uy * c;
    const ub =  dB.ux * c + dB.uy * s;
    const vb = -dB.ux * s + dB.uy * c;

    const pts = buildDeformedPoints(
      nA.x, nA.y, nB.x, nB.y, c, s, L,
      [ua, va, dA.rot, ub, vb, dB.rot],
      amplify,
    );

    elems.push(
      <Line key={`${m.id}-orig`}
        points={[nA.x, nA.y, nB.x, nB.y]}
        stroke={ORIGINAL_COLOR} strokeWidth={1}
        dash={[6, 4]} opacity={0.6} listening={false} />,
      <Line key={`${m.id}-def`}
        points={pts} stroke={DEFORMED_COLOR}
        strokeWidth={2} opacity={OPACITY} listening={false} />,
    );
  }

  const drawnNodes = new Set<string>();
  for (const m of members) {
    for (const nid of [m.a, m.b]) {
      if (drawnNodes.has(nid)) continue;
      drawnNodes.add(nid);
      const n = nodeById.get(nid);
      const d = dispMap.get(nid);
      if (!n || !d) continue;
      elems.push(
        <Circle key={`node-${nid}`}
          x={n.x + d.ux * amplify}
          y={n.y + d.uy * amplify}
          radius={3} fill={DEFORMED_COLOR}
          opacity={OPACITY} listening={false} />,
      );
    }
  }

  return elems;
}

// ===== 反力表示（SvgIconShape 版） =====
//
// 【fx / fy — onedistload.svg】
//   SVG の「素の向き」: rotation=0 → 下向き（WorldLayer の distLoad に合わせた初期値）
//   fy > 0 (上向き力) → rotation=180  (下から上に向かう矢印)
//   fy < 0 (下向き力) → rotation=0
//   fx > 0 (右向き力) → rotation=270  (左から右に向かう矢印)
//   fx < 0 (左向き力) → rotation=90
//
//   アイコン中心位置は WorldLayer の distLoadIconCenter と同様に
//   ノードから矢印方向へ ARROW_LEN だけオフセットした点をアイコン中心とする。
//
// 【m — moment.svg】
//   SVG の「素の向き」: rotation=0 → 反時計回り（WorldLayer の momentLoad に合わせた初期値）
//   m > 0 (反時計回り) → scaleX=1
//   m < 0 (時計回り)  → scaleX=-1  (WorldLayer と同じ反転方式)

function buildReactionElements(
  reactions: ReactionResult[],
  nodeById: Map<string, { x: number; y: number }>,
): React.ReactNode[] {
  const elems: React.ReactNode[] = [];
  const half  = REACTION_ICON_SIZE / 2;
  const mHalf = REACTION_MOMENT_SIZE / 2;

  for (const r of reactions) {
    const nd = nodeById.get(r.nodeId);
    if (!nd) continue;

    // ---- fx（水平反力） ----
    if (Math.abs(r.fx) > 1e-4) {
      // fx > 0 → 右向き力 → rotation=270、アイコン中心はノードの左 ARROW_LEN
      // fx < 0 → 左向き力 → rotation=90、 アイコン中心はノードの右 ARROW_LEN
      const rotation = r.fx > 0 ? 270 : 90;
      const offsetX  = r.fx > 0 ? -ARROW_LEN : ARROW_LEN;
      // アイコン中心を矢印の根元側に配置（矢先がノードに向く）
      const cx = nd.x + offsetX;
      const cy = nd.y;
      const labelX = r.fx > 0 ? cx + 18 : cx -40;
      elems.push(
        <SvgIconShape
          key={`${r.supportId}-fx`}
          svgText={oneDistLoadSvgText}
          x={cx} y={cy}
          w={REACTION_ICON_SIZE} h={REACTION_ICON_SIZE}
          stroke={REACTION_COLOR}
          rotation={rotation}
          offsetX={half} offsetY={half}
          opacity={OPACITY}
          listening={false}
        />,
        <Text key={`${r.supportId}-fxl`}
          x={labelX} y={nd.y - 6}
          text={`${round2(Math.abs(r.fx))}`}
          fontSize={LABEL_SIZE} fill={REACTION_COLOR} opacity={OPACITY} listening={false} />,
      );
    }

    // ---- fy（鉛直反力） ----
    if (Math.abs(r.fy) > 1e-4) {
      // fy > 0 → 上向き力 → rotation=180、アイコン中心はノードの下 ARROW_LEN
      // fy < 0 → 下向き力 → rotation=0、  アイコン中心はノードの上 ARROW_LEN
      const rotation = r.fy > 0 ? 0 : 180;
      const offsetY  = r.fy > 0 ? -ARROW_LEN : ARROW_LEN;
      const cx = nd.x;
      const cy = nd.y + offsetY;
      const labelY = r.fy > 0 ? cy + 14 : cy - 28;
      elems.push(
        <SvgIconShape
          key={`${r.supportId}-fy`}
          svgText={oneDistLoadSvgText}
          x={cx} y={cy}
          w={REACTION_ICON_SIZE} h={REACTION_ICON_SIZE}
          stroke={REACTION_COLOR}
          rotation={rotation}
          offsetX={half} offsetY={half}
          opacity={OPACITY}
          listening={false}
        />,
        <Text key={`${r.supportId}-fyl`}
          x={nd.x - 10 } y={labelY}
          text={`${round2(Math.abs(r.fy))}`}
          fontSize={LABEL_SIZE} fill={REACTION_COLOR} opacity={OPACITY} listening={false} />,
      );
    }

    // ---- m（モーメント反力） ----
    if (Math.abs(r.m) > 1e-4) {
      // r.m > 0 → 反時計回り → scaleX=1（SVG初期値）
      // r.m < 0 → 時計回り  → scaleX=-1（WorldLayer の momentLoad と同じ反転）
      elems.push(
        <SvgIconShape
          key={`${r.supportId}-m`}
          svgText={reactmomSvgText}
          x={nd.x} y={nd.y}
          w={REACTION_MOMENT_SIZE} h={REACTION_MOMENT_SIZE}
          stroke={REACTION_COLOR}
          scaleX={r.m > 0 ? -1 : 1}
          offsetX={mHalf} offsetY={mHalf}
          opacity={OPACITY}
          listening={false}
        />,
        <Text key={`${r.supportId}-ml`}
          x={nd.x + 20} y={nd.y + 20}
          text={`M=${round2(r.m)}`}
          fontSize={LABEL_SIZE} fill={REACTION_COLOR} opacity={OPACITY} listening={false} />,
      );
    }
  }

  return elems;
}

// ===== デバッグ: 展開済みポリライン表示 =====

const DEBUG_EXPANDED = true;  // ← false にすればオフ

function buildDebugExpandedElements(
  expandedNodes:   { id: string; x: number; y: number }[],
  expandedMembers: { id: string; a: string; b: string }[],
): React.ReactNode[] {
  if (!DEBUG_EXPANDED) return [];

  const nodeById = new Map(expandedNodes.map(n => [n.id, n]));
  const elems: React.ReactNode[] = [];

  for (const m of expandedMembers) {
    const nA = nodeById.get(m.a);
    const nB = nodeById.get(m.b);
    if (!nA || !nB) continue;
    if (!m.id.startsWith("__M_")) continue;
    elems.push(
      <Line key={`dbg-m-${m.id}`}
        points={[nA.x, nA.y, nB.x, nB.y]}
        stroke="#ff9800" strokeWidth={2}
        opacity={0.8} dash={[4, 2]} listening={false} />,
    );
  }

  for (const n of expandedNodes) {
    if (!n.id.startsWith("__N_")) continue;
    const num = n.id.replace("__N_", "");
    elems.push(
      <Circle key={`dbg-n-${n.id}`}
        x={n.x} y={n.y} radius={4}
        fill="#ff3333" opacity={0.9} listening={false} />,
      <Text key={`dbg-nl-${n.id}`}
        x={n.x + 5} y={n.y - 12}
        text={num} fontSize={9} fill="#ff9800" opacity={0.8} listening={false} />,
    );
  }

  return elems;
}

// ===== メインコンポーネント =====

export function DiagramLayer() {
  const { femResult, displayFlags, diagramScale, deformedScale } = useAppContext();

  if (!femResult?.ok) return null;

  const { elements, reactions, displacements, expandedNodes, expandedMembers, arcGroupMap, arcMemberGeom } = femResult;

  const nodeById  = new Map(expandedNodes.map(n => [n.id, n]));
  const memberMap = new Map(expandedMembers.map(m => [m.id, m]));
  const dispMap   = new Map(displacements.map(d => [d.nodeId, d]));

  const scaleN = calcScale(elements, "N", BASE_HEIGHT, diagramScale);
  const scaleQ = calcScale(elements, "Q", BASE_HEIGHT, diagramScale);
  const scaleM = calcScale(elements, "M", BASE_HEIGHT, diagramScale);

  return (
    <Layer listening={false}>
      {/* デバッグ: 展開済みポリライン（オレンジ線＋赤ノード） */}
      {buildDebugExpandedElements(expandedNodes, expandedMembers)}

      {/* 変形図（断面力より先に描いて背面に） */}
      {displayFlags.deformed && buildDeformedElements(expandedMembers, nodeById, dispMap, deformedScale)}

      {/* 反力 */}
      {displayFlags.reaction && buildReactionElements(reactions, nodeById)}

      {/* N / Q / M 図 */}
      {displayFlags.N && buildDiagramElements(elements, nodeById, memberMap, arcGroupMap, arcMemberGeom, "N", N_COLOR, scaleN)}
      {displayFlags.Q && buildDiagramElements(elements, nodeById, memberMap, arcGroupMap, arcMemberGeom, "Q", Q_COLOR, scaleQ)}
      {displayFlags.M && buildDiagramElements(elements, nodeById, memberMap, arcGroupMap, arcMemberGeom, "M", M_COLOR, scaleM)}
    </Layer>
  );
}