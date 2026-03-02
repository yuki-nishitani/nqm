/**
 * curveUtils.ts — 曲線メンバーのユーティリティ
 *
 * 【座標系】
 *   画面座標（Y軸下向き）で統一。
 *   bulge > 0 → 進行方向（A→B）に対して左側（画面上では右回り）に膨らむ
 *   bulge < 0 → 右側（反時計回り）に膨らむ
 *
 * 【bulge の定義】
 *   bulge = tan(θ / 4)
 *   θ: 円弧の中心角（符号付き、ラジアン）
 *
 *   bulge = 0   → 直線
 *   bulge = 1   → 半円（|θ| = π、劣弧）
 *   |bulge| > 1 → 優弧（|θ| > π）
 */

// ===== 型 =====

export type ArcParams = {
  cx: number;       // 円弧の中心 x
  cy: number;       // 円弧の中心 y
  r: number;        // 半径
  startAngle: number; // 開始角度（ラジアン、Math.atan2 基準）
  endAngle: number;   // 終了角度（ラジアン）
  anticlockwise: boolean; // Konva/Canvas の arc 方向フラグ
};

export type Point = { x: number; y: number };

// ===== bulge ↔ 円弧パラメータ 変換 =====

/**
 * bulge と端点 A, B から円弧パラメータを計算する。
 *
 * 数学的導出:
 *   弦の長さ d = |AB|
 *   半径 r = d / (2 * sin(θ/2))  ただし sin(θ/2) = 2*bulge / (1 + bulge^2) を利用
 *   → r = d * (1 + bulge^2) / (4 * |bulge|)
 *
 *   中心点は弦の垂直二等分線上:
 *   中心オフセット h = r * cos(θ/2) = r * (1 - bulge^2) / (1 + bulge^2)
 */
export function bulgeToArc(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
): ArcParams {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);

  // 弦の中点
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  const b2 = bulge * bulge;
  const r = (d * (1 + b2)) / (4 * Math.abs(bulge));

  // 中心への垂直オフセット（弦に対して垂直方向）
  // bulge > 0 なら左側（A→B 進行方向の左）、< 0 なら右側
  const h = r * (1 - b2) / (1 + b2);

  // 弦の単位垂直ベクトル（左向き）
  const nx = -dy / d;
  const ny =  dx / d;

  // bulge > 0 → 左側に中心, bulge < 0 → 右側に中心
  // ※ sign(bulge) をかける
  const sign = bulge > 0 ? 1 : -1;
  const cx = mx + sign * h * nx;
  const cy = my + sign * h * ny;

  const startAngle = Math.atan2(ay - cy, ax - cx);
  const endAngle   = Math.atan2(by - cy, bx - cx);

  // bulge > 0 → 反時計回り（画面Y下向きなので見た目は時計回り）
  // Konva の arc は anticlockwise フラグで制御
  const anticlockwise = bulge < 0;

  return { cx, cy, r, startAngle, endAngle, anticlockwise };
}

/**
 * 円弧の中心・半径・端点から bulge を逆算する。
 * 円弧作図UIの確定時に使用。
 *
 * @param cx, cy  円弧中心
 * @param ax, ay  開始点（ノードA）
 * @param bx, by  終了点（ノードB）
 * @param anticlockwise  回転方向
 */
export function arcToBulge(
  cx: number, cy: number,
  ax: number, ay: number,
  bx: number, by: number,
  anticlockwise: boolean,
): number {
  let startAngle = Math.atan2(ay - cy, ax - cx);
  let endAngle   = Math.atan2(by - cy, bx - cx);

  // 中心角 θ を符号付きで計算
  let theta = endAngle - startAngle;

  if (!anticlockwise) {
    // 時計回り（bulge > 0）: theta を 0 < theta <= 2π に正規化
    if (theta <= 0) theta += 2 * Math.PI;
  } else {
    // 反時計回り（bulge < 0）: theta を -2π <= theta < 0 に正規化
    if (theta >= 0) theta -= 2 * Math.PI;
  }

  return Math.tan(theta / 4);
}

// ===== SVG パス文字列生成 =====

/**
 * bulge から Konva.Path に渡す SVG パス文字列を生成する。
 * 形式: "M ax ay A r r 0 largeArc sweep bx by"
 */
export function bulgeToSvgPath(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
): string {
  if (Math.abs(bulge) < 1e-9) {
    // 直線フォールバック
    return `M ${ax} ${ay} L ${bx} ${by}`;
  }

  const { r, anticlockwise } = bulgeToArc(ax, ay, bx, by, bulge);

  // SVG arc フラグ
  // largeArcFlag: |θ| > π なら 1
  const theta = 4 * Math.atan(Math.abs(bulge));
  const largeArc = theta > Math.PI ? 1 : 0;

  // sweepFlag: SVG は Y下向きなので bulge > 0 が時計回り sweep=1
  const sweep = bulge > 0 ? 1 : 0;

  return `M ${ax} ${ay} A ${r} ${r} 0 ${largeArc} ${sweep} ${bx} ${by}`;
}

// ===== 円弧上の点サンプリング（FEM分割・法線計算に使用）=====

/**
 * 円弧を n 分割した点列を返す（端点含む、計 n+1 点）。
 */
export function sampleArcPoints(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
  n = 8,
): Point[] {
  if (Math.abs(bulge) < 1e-9) {
    // 直線として等分割
    return Array.from({ length: n + 1 }, (_, i) => ({
      x: ax + (bx - ax) * i / n,
      y: ay + (by - ay) * i / n,
    }));
  }

  const { cx, cy, r, startAngle, endAngle, anticlockwise } = bulgeToArc(
    ax, ay, bx, by, bulge
  );

  // 角度の差分（符号付き）
  let dAngle = endAngle - startAngle;
  if (!anticlockwise && dAngle <= 0) dAngle += 2 * Math.PI;
  if ( anticlockwise && dAngle >= 0) dAngle -= 2 * Math.PI;

  return Array.from({ length: n + 1 }, (_, i) => {
    const angle = startAngle + dAngle * i / n;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });
}

/**
 * 円弧上のパラメータ t (0〜1) における接線方向（単位ベクトル）を返す。
 * 断面力図の法線オフセットに使用。
 */
export function arcTangentAt(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
  t: number,
): Point {
  if (Math.abs(bulge) < 1e-9) {
    const d = Math.hypot(bx - ax, by - ay);
    return d > 0 ? { x: (bx - ax) / d, y: (by - ay) / d } : { x: 1, y: 0 };
  }

  const { cx, cy, r, startAngle, endAngle, anticlockwise } = bulgeToArc(
    ax, ay, bx, by, bulge
  );

  let dAngle = endAngle - startAngle;
  if (!anticlockwise && dAngle <= 0) dAngle += 2 * Math.PI;
  if ( anticlockwise && dAngle >= 0) dAngle -= 2 * Math.PI;

  const angle = startAngle + dAngle * t;

  // 接線 = 半径ベクトルを90°回転
  // anticlockwise ? 反時計: 接線 = (-sin, cos) 方向を反転
  const sign = anticlockwise ? -1 : 1;
  return {
    x: -sign * Math.sin(angle),
    y:  sign * Math.cos(angle),
  };
}

/**
 * 円弧上のパラメータ t における法線（左向き単位ベクトル）を返す。
 * 断面力図のオフセット方向として使用。
 */
export function arcNormalAt(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
  t: number,
): Point {
  const tan = arcTangentAt(ax, ay, bx, by, bulge, t);
  // 接線を90°左回転 → 法線
  return { x: -tan.y, y: tan.x };
}

// ===== 円弧作図 UI ヘルパー =====

/**
 * 中心点・開始点・マウス位置（角度）から、
 * プレビュー用の終了点を計算する。
 *
 * @param cx, cy   円弧中心
 * @param r        半径（開始点から計算済み）
 * @param mouseX, mouseY  現在のマウス位置
 * @returns 終了点（円周上にスナップ）
 */
export function arcEndFromMouse(
  cx: number, cy: number,
  r: number,
  mouseX: number, mouseY: number,
): Point {
  const angle = Math.atan2(mouseY - cy, mouseX - cx);
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

/**
 * 中心点・開始点・終了点から半径を計算する。
 * （開始点から中心までの距離を半径とする）
 */
export function arcRadius(cx: number, cy: number, ax: number, ay: number): number {
  return Math.hypot(ax - cx, ay - cy);
}

/**
 * 円弧作図の3ステップ状態型。
 * useArcDraw フック等で使用することを想定。
 */
export type ArcDrawState =
  | { step: "idle" }
  | { step: "hasCenter"; cx: number; cy: number }
  | { step: "hasStart";  cx: number; cy: number; r: number; startAngle: number; ax: number; ay: number };

/**
 * ArcDrawState に対してクリック座標を与え、次の状態へ遷移させる。
 * 確定時（step: "hasStart" でのクリック）は bulge と端点を返す。
 */
export function advanceArcDraw(
  state: ArcDrawState,
  px: number,
  py: number,
  anticlockwise: boolean,
): {
  next: ArcDrawState;
  committed?: { ax: number; ay: number; bx: number; by: number; bulge: number };
} {
  switch (state.step) {
    case "idle":
      return { next: { step: "hasCenter", cx: px, cy: py } };

    case "hasCenter": {
      const r = arcRadius(state.cx, state.cy, px, py);
      if (r < 1e-6) return { next: state }; // 中心と同じ点は無視
      const startAngle = Math.atan2(py - state.cy, px - state.cx);
      return {
        next: {
          step: "hasStart",
          cx: state.cx, cy: state.cy,
          r,
          startAngle,
          ax: px, ay: py,
        },
      };
    }

    case "hasStart": {
      const { cx, cy, r, ax, ay } = state;
      const endPoint = arcEndFromMouse(cx, cy, r, px, py);
      const bx = endPoint.x, by = endPoint.y;

      // 開始点と終了点が同じなら無視
      if (Math.hypot(bx - ax, by - ay) < 1e-6) return { next: state };

      const bulge = arcToBulge(cx, cy, ax, ay, bx, by, anticlockwise);
      return {
        next: { step: "idle" },
        committed: { ax, ay, bx, by, bulge },
      };
    }
  }
}

// ===== 円弧のバウンディングボックス（選択判定に使用）=====

/**
 * 円弧のバウンディングボックスを返す。
 */
export function arcBoundingBox(
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const points = sampleArcPoints(ax, ay, bx, by, bulge, 32);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x1: Math.min(...xs), y1: Math.min(...ys),
    x2: Math.max(...xs), y2: Math.max(...ys),
  };
}

/**
 * 点 (px, py) が円弧の近傍（tolerance以内）にあるか判定。
 * クリック選択に使用。
 */
export function pointNearArc(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  bulge: number,
  tolerance: number,
): boolean {
  if (Math.abs(bulge) < 1e-9) {
    // 直線として判定
    const { dist, t } = projectPointOnSegmentLocal(px, py, ax, ay, bx, by);
    return t >= 0 && t <= 1 && dist <= tolerance;
  }

  const { cx, cy, r } = bulgeToArc(ax, ay, bx, by, bulge);

  // 点から円弧中心への距離が r に近いかどうか
  const distToCenter = Math.hypot(px - cx, py - cy);
  if (Math.abs(distToCenter - r) > tolerance) return false;

  // 点の角度が円弧の角度範囲内かどうか
  const { startAngle, endAngle, anticlockwise } = bulgeToArc(ax, ay, bx, by, bulge);
  const angle = Math.atan2(py - cy, px - cx);
  return isAngleInArc(angle, startAngle, endAngle, anticlockwise);
}

// ── 内部ヘルパー ──────────────────────────────────────────────

function projectPointOnSegmentLocal(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { dist: Math.hypot(px - ax, py - ay), t: 0 };
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const fx = ax + t * dx, fy = ay + t * dy;
  return { dist: Math.hypot(px - fx, py - fy), t };
}

function isAngleInArc(
  angle: number,
  startAngle: number,
  endAngle: number,
  anticlockwise: boolean,
): boolean {
  // 角度を 0〜2π に正規化
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a = norm(angle);
  const s = norm(startAngle);
  const e = norm(endAngle);

  if (!anticlockwise) {
    // 時計回り（s → e 増加方向）
    return s <= e ? a >= s && a <= e : a >= s || a <= e;
  } else {
    // 反時計回り（s → e 減少方向）
    return s >= e ? a <= s && a >= e : a <= s || a >= e;
  }
}