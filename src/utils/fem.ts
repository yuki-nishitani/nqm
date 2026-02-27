/**
 * fem.ts — マトリックス変位法ソルバー
 *
 * ■ 座標系: Konva スクリーン座標 (x→右, y→下)
 *
 * ■ 荷重角度規則
 *   0° = 下向き, 90° = 左向き, -90° = 右向き, 180° = 上向き
 *
 * ■ ローラー angleDeg
 *   0° = x方向が自由（y拘束）, 90° = y方向が自由（x拘束）
 *
 * ■ 自由度設計
 *   通常ノード : [ux, uy, θ]  3DOF
 *   ヒンジノード: [ux, uy]    2DOF のみ（nodeθを持たせない）
 *     → 接続する各部材端に独立θ (hingeDof) を追加
 *     → 孤立自由度による特異行列を根本から排除
 */

import { Matrix, solve } from "ml-matrix";
import type {
  FemInput, FemResult, ElementResult,
  ReactionResult, DisplacementResult, SectionPoint,
} from "./femTypes";
import { DEFAULT_SECTION } from "./femTypes";
import { validateModel } from "./validate";

// ===== ユーティリティ =====

function deg2rad(deg: number) { return deg * Math.PI / 180; }

/** 0°=下向き, 90°=左向き, -90°=右向き */
function loadVector(angleDeg: number, magnitude: number): [number, number] {
  const rad = deg2rad(angleDeg);
  return [-magnitude * Math.sin(rad), magnitude * Math.cos(rad)];
}

/** ローラー拘束方向: 0°→(0,1)=y拘束, 90°→(1,0)=x拘束 */
function rollerConstraintVector(angleDeg: number): [number, number] {
  const rad = deg2rad(angleDeg);
  return [Math.sin(rad), Math.cos(rad)];
}

function memberGeom(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const L = Math.sqrt(dx * dx + dy * dy);
  return { L, c: dx / L, s: dy / L };
}

// ===== 自由度マップ =====
// ヒンジノードは [ux, uy] のみ。θは持たせない。
// nodeDof の型: isHinge=false → [ux, uy, θ], isHinge=true → [ux, uy, -1]
// -1 は「θなし」を表すセンチネル値

type DofMap = {
  /** nodeId → [ux_idx, uy_idx, θ_idx or -1] */
  nodeDof:  Map<string, [number, number, number]>;
  /** `${memberId}:${nodeId}` → θ_idx  (ヒンジ端のみ) */
  hingeDof: Map<string, number>;
  totalDof: number;
};

function buildDofMap(
  nodes:   FemInput["nodes"],
  members: FemInput["members"],
  joints:  FemInput["joints"],
): DofMap {
  const nodeDof  = new Map<string, [number, number, number]>();
  const hingeDof = new Map<string, number>();
  const jointNodeIds = new Set(joints.map(j => j.nodeId));
  let idx = 0;

  for (const n of nodes) {
    if (jointNodeIds.has(n.id)) {
      // ヒンジノード: ux, uy のみ。θ=-1(なし)
      nodeDof.set(n.id, [idx, idx + 1, -1]);
      idx += 2;
    } else {
      // 通常ノード: ux, uy, θ
      nodeDof.set(n.id, [idx, idx + 1, idx + 2]);
      idx += 3;
    }
  }

  // ヒンジ端の部材ごとに独立θを追加
  for (const m of members) {
    for (const nid of [m.a, m.b]) {
      if (jointNodeIds.has(nid)) {
        hingeDof.set(`${m.id}:${nid}`, idx++);
      }
    }
  }

  return { nodeDof, hingeDof, totalDof: idx };
}

/** ノードの回転DOFインデックスを返す（ヒンジの場合はhingeDof優先） */
function getRotDof(
  memberId: string,
  nodeId: string,
  dofMap: DofMap,
  jointNodeIds: Set<string>,
): number {
  if (jointNodeIds.has(nodeId)) {
    return dofMap.hingeDof.get(`${memberId}:${nodeId}`)!;
  }
  return dofMap.nodeDof.get(nodeId)![2];
}

// ===== 要素剛性マトリックス (局所座標系 6×6) =====
// 局所DOF順: [ua, va, θa, ub, vb, θb]

function localStiffness(L: number, EA: number, EI: number): number[][] {
  const a = EA / L;
  const b = 12 * EI / (L * L * L);
  const c =  6 * EI / (L * L);
  const d =  4 * EI / L;
  const e =  2 * EI / L;
  return [
    [ a,  0,  0, -a,  0,  0],
    [ 0,  b,  c,  0, -b,  c],
    [ 0,  c,  d,  0, -c,  e],
    [-a,  0,  0,  a,  0,  0],
    [ 0, -b, -c,  0,  b, -c],
    [ 0,  c,  e,  0, -c,  d],
  ];
}

// 座標変換行列 T: q_local = T * q_global
function transformMatrix(c: number, s: number): number[][] {
  return [
    [ c,  s,  0,  0,  0,  0],
    [-s,  c,  0,  0,  0,  0],
    [ 0,  0,  1,  0,  0,  0],
    [ 0,  0,  0,  c,  s,  0],
    [ 0,  0,  0, -s,  c,  0],
    [ 0,  0,  0,  0,  0,  1],
  ];
}

// K_global += T^T * K_local * T
function assembleMember(K: number[][], kl: number[][], T: number[][], dofs: number[]) {
  const n = 6;
  const KT: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        KT[i][j] += kl[i][k] * T[k][j];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let v = 0;
      for (let k = 0; k < n; k++) v += T[k][i] * KT[k][j];
      K[dofs[i]][dofs[j]] += v;
    }
}

// ===== 荷重ベクトル =====

function applyPointLoad(F: number[], dofMap: DofMap, nodeId: string, angleDeg: number, magnitude: number) {
  const dofs = dofMap.nodeDof.get(nodeId);
  if (!dofs) return;
  const [fx, fy] = loadVector(angleDeg, magnitude);
  F[dofs[0]] += fx;
  F[dofs[1]] += fy;
}

function applyDistLoad(
  F: number[],
  dofMap: DofMap,
  memberId: string,
  nodeIdA: string, nodeIdB: string,
  c: number, s: number, L: number,
  angleDeg: number, magnitude: number,
  jointNodeIds: Set<string>,
) {
  const [wx, wy] = loadVector(angleDeg, magnitude);
  const qu =  wx * c + wy * s;
  const qv = -wx * s + wy * c;

  // 固定端力（局所座標）
  const fua = qu * L / 2;
  const fub = qu * L / 2;
  const fva = qv * L / 2;
  const ma  =  qv * L * L / 12;
  const fvb = qv * L / 2;
  const mb  = -qv * L * L / 12;

  const toGlobal = (fu: number, fv: number): [number, number] =>
    [fu * c - fv * s, fu * s + fv * c];

  const [fxA, fyA] = toGlobal(fua, fva);
  const [fxB, fyB] = toGlobal(fub, fvb);

  const dofsA = dofMap.nodeDof.get(nodeIdA)!;
  const dofsB = dofMap.nodeDof.get(nodeIdB)!;
  const tA = getRotDof(memberId, nodeIdA, dofMap, jointNodeIds);
  const tB = getRotDof(memberId, nodeIdB, dofMap, jointNodeIds);

  F[dofsA[0]] += fxA;
  F[dofsA[1]] += fyA;
  F[tA]       += ma;
  F[dofsB[0]] += fxB;
  F[dofsB[1]] += fyB;
  F[tB]       += mb;
}

// ===== 境界条件（ペナルティ法） =====

const PENALTY = 1e15;

function applyBoundaryConditions(
  K: number[][],
  supports: FemInput["supports"],
  dofMap: DofMap,
  // 支点ノードに接続するhingeDofを参照するために members も受け取る
  members: FemInput["members"],
  jointNodeIds: Set<string>,
) {
  for (const sup of supports) {
    const dofs = dofMap.nodeDof.get(sup.nodeId);
    if (!dofs) continue;
    const [ux, uy, rotOrMinus] = dofs;

    if (sup.type === "fix") {
      K[ux][ux] += PENALTY;
      K[uy][uy] += PENALTY;
      // 通常ノード: nodeθを拘束
      if (rotOrMinus !== -1) {
        K[rotOrMinus][rotOrMinus] += PENALTY;
      }
      // ヒンジノード: 接続する全hingeDofを拘束（支点にヒンジは来ない前提だが念のため）
      if (jointNodeIds.has(sup.nodeId)) {
        for (const m of members) {
          for (const nid of [m.a, m.b]) {
            if (nid === sup.nodeId) {
              const hd = dofMap.hingeDof.get(`${m.id}:${nid}`);
              if (hd !== undefined) K[hd][hd] += PENALTY;
            }
          }
        }
      }
    } else if (sup.type === "pin") {
      K[ux][ux] += PENALTY;
      K[uy][uy] += PENALTY;
    } else if (sup.type === "roller") {
      const [nx, ny] = rollerConstraintVector(sup.angleDeg);
      K[ux][ux] += PENALTY * nx * nx;
      K[ux][uy] += PENALTY * nx * ny;
      K[uy][ux] += PENALTY * ny * nx;
      K[uy][uy] += PENALTY * ny * ny;
    }
  }
}

// ===== 断面力計算 =====
//
// 材端力ベース: fa = K_local * q_local + fixedEnd補正
//
// 符号規則（局所座標系）:
//   fa[0]: a端 u方向力 → Na = +fa[0]  (引張正)
//   fa[1]: a端 v方向力 → Qa = -fa[1]  (局所vとせん断力の正方向が逆)
//   fa[2]: a端 モーメント → Ma = +fa[2]
//   fa[3]: b端 u方向力 → Nb = -fa[3]  (b端はu方向が逆)
//   fa[4]: b端 v方向力 → Qb = -fa[4]
//   fa[5]: b端 モーメント → Mb = -fa[5]  (b端はモーメントも逆)

function calcElementForces(
  memberId: string,
  nodeIdA: string, nodeIdB: string,
  c: number, s: number, L: number,
  EA: number, EI: number,
  disp: number[],
  dofMap: DofMap,
  jointNodeIds: Set<string>,
  distLoadsForMember: { angleDeg: number; magnitude: number }[],
): ElementResult {
  const dofsA = dofMap.nodeDof.get(nodeIdA)!;
  const dofsB = dofMap.nodeDof.get(nodeIdB)!;
  const tAIdx = getRotDof(memberId, nodeIdA, dofMap, jointNodeIds);
  const tBIdx = getRotDof(memberId, nodeIdB, dofMap, jointNodeIds);

  // 大域変位 → 局所変位
  const uxA = disp[dofsA[0]], uyA = disp[dofsA[1]], thA = disp[tAIdx];
  const uxB = disp[dofsB[0]], uyB = disp[dofsB[1]], thB = disp[tBIdx];
  const ql = [
     uxA*c + uyA*s, -uxA*s + uyA*c, thA,
     uxB*c + uyB*s, -uxB*s + uyB*c, thB,
  ];

  const kl = localStiffness(L, EA, EI);
  const fl = kl.map(row => row.reduce((sum, k, j) => sum + k * ql[j], 0));

  // 等分布荷重の固定端力補正（複数対応）
  let fixedEnd = [0, 0, 0, 0, 0, 0];
  let qv_dist = 0, qu_dist = 0;
  for (const dl of distLoadsForMember) {
    const [wx, wy] = loadVector(dl.angleDeg, dl.magnitude);
    const qu =  wx * c + wy * s;
    const qv = -wx * s + wy * c;
    qu_dist += qu;
    qv_dist += qv;
    fixedEnd[0] += -qu * L / 2;
    fixedEnd[1] += -qv * L / 2;
    fixedEnd[2] += -qv * L * L / 12;
    fixedEnd[3] += -qu * L / 2;
    fixedEnd[4] += -qv * L / 2;
    fixedEnd[5] +=  qv * L * L / 12;
  }

  const fa = fl.map((v, i) => v + fixedEnd[i]);

  // 断面力（数値検証済みの符号規則）
  const Na =  fa[0];
  const Qa = -fa[1];  // ← -fa[1] が正しい（v方向と断面力の正方向が逆）
  const Ma =  fa[2];
  const Nb = -fa[3];
  const Qb = -fa[4];
  const Mb = -fa[5];

  // 中間点サンプル（11点）: a端からの積分
  const SAMPLES = 11;
  const points: SectionPoint[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    const x = t * L;
    points.push({
      t,
      N: Na - qu_dist * x,
      Q: Qa - qv_dist * x,
      M: Ma + Qa * x - qv_dist * x * x / 2,
    });
  }

  return { memberId, Na, Qa, Ma, Nb, Qb, Mb, points };
}
// ===== メインソルバー =====

export function solveFem(input: FemInput): FemResult {
  const validation = validateModel(input);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "validation",
      message: validation.issues.filter(i => i.level === "error").map(i => i.message).join("\n"),
    };
  }

  const { nodes, members, supports, joints, pointLoads, distLoads } = input;
  const nodeMap      = new Map(nodes.map(n => [n.id, n]));
  const jointNodeIds = new Set(joints.map(j => j.nodeId));
  const dofMap       = buildDofMap(nodes, members, joints);
  const N            = dofMap.totalDof;
  const { EA, EI }   = DEFAULT_SECTION;

  const K: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  const F: number[]   = Array(N).fill(0);

  // 剛性マトリックスのアセンブル
  for (const m of members) {
    const nA = nodeMap.get(m.a)!;
    const nB = nodeMap.get(m.b)!;
    const { L, c, s } = memberGeom(nA.x, nA.y, nB.x, nB.y);
    if (L < 1e-10) continue;

    const tAIdx = getRotDof(m.id, m.a, dofMap, jointNodeIds);
    const tBIdx = getRotDof(m.id, m.b, dofMap, jointNodeIds);
    const dA = dofMap.nodeDof.get(m.a)!;
    const dB = dofMap.nodeDof.get(m.b)!;

    assembleMember(K, localStiffness(L, EA, EI), transformMatrix(c, s),
      [dA[0], dA[1], tAIdx, dB[0], dB[1], tBIdx]);
  }

  // 集中荷重
  for (const pl of pointLoads) {
    applyPointLoad(F, dofMap, pl.nodeId, pl.angleDeg, pl.magnitude);
  }

  // 等分布荷重（同一部材への複数対応）
  // Map<memberId, DistLoad[]> で集約
  const distLoadsByMember = new Map<string, typeof distLoads>();
  for (const dl of distLoads) {
    const arr = distLoadsByMember.get(dl.memberId) ?? [];
    arr.push(dl);
    distLoadsByMember.set(dl.memberId, arr);
  }
  for (const [mid, dls] of distLoadsByMember) {
    const m = members.find(m => m.id === mid);
    if (!m) continue;
    const nA = nodeMap.get(m.a)!;
    const nB = nodeMap.get(m.b)!;
    const { L, c, s } = memberGeom(nA.x, nA.y, nB.x, nB.y);
    for (const dl of dls) {
      applyDistLoad(F, dofMap, m.id, m.a, m.b, c, s, L, dl.angleDeg, dl.magnitude, jointNodeIds);
    }
  }

  // 境界条件
  applyBoundaryConditions(K, supports, dofMap, members, jointNodeIds);

  // 連立方程式を解く
  let dispArray: number[];
  try {
    dispArray = solve(new Matrix(K), Matrix.columnVector(F)).getColumn(0);
  } catch {
    return { ok: false, reason: "singular", message: "剛性行列が特異です。構造が不安定な可能性があります。" };
  }

  const maxDisp = Math.max(...dispArray.map(Math.abs));
  if (!isFinite(maxDisp) || maxDisp > 1e10) {
    return { ok: false, reason: "unstable", message: "構造が不安定です。支点条件を確認してください。" };
  }

  // 断面力
  const elementResults: ElementResult[] = [];
  for (const m of members) {
    const nA = nodeMap.get(m.a)!;
    const nB = nodeMap.get(m.b)!;
    const { L, c, s } = memberGeom(nA.x, nA.y, nB.x, nB.y);
    if (L < 1e-10) continue;
    elementResults.push(calcElementForces(
      m.id, m.a, m.b, c, s, L, EA, EI, dispArray, dofMap, jointNodeIds,
      distLoadsByMember.get(m.id) ?? [],
    ));
  }

  // 反力（拘束DOFごとに K*U - F を計算）
  const reactions: ReactionResult[] = [];
  for (const sup of supports) {
    const dofs = dofMap.nodeDof.get(sup.nodeId);
    if (!dofs) continue;
    const [uxDof, uyDof, rotDof] = dofs;

    const reactionAtDof = (dof: number) => {
      let r = 0;
      for (let j = 0; j < N; j++) r += K[dof][j] * dispArray[j];
      r -= F[dof];
      return r;
    };

    const rx = reactionAtDof(uxDof);
    const ry = reactionAtDof(uyDof);
    // モーメント反力: fix のみ、かつ nodeθ が存在する場合
    const rm = (sup.type === "fix" && rotDof !== -1) ? reactionAtDof(rotDof) : 0;

    reactions.push({ supportId: sup.id, nodeId: sup.nodeId, fx: rx, fy: ry, m: rm });
  }

  // 変位結果
  const displacements: DisplacementResult[] = nodes.map(n => {
    const d = dofMap.nodeDof.get(n.id)!;
    return {
      nodeId: n.id,
      ux:  dispArray[d[0]],
      uy:  dispArray[d[1]],
      rot: d[2] !== -1 ? dispArray[d[2]] : 0,
    };
  });

  return { ok: true, elements: elementResults, reactions, displacements };
}