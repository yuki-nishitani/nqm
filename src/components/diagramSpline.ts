/**
 * diagramSpline.ts — 断面力ダイアグラム用スプライン補間ユーティリティ
 *
 * 円弧部材のNQMダイアグラムは、サブ直線の折れ線近似によって
 * オフセット後のアウトラインがギザギザになる。
 * 本モジュールは Catmull-Rom スプラインで点列を滑らかにする。
 *
 * ■ アプローチ
 *   - ゼロライン（部材軸）はすでに arcGeom から正確な円座標で計算済みなので変更不要。
 *   - オフセット後の「アウトライン点列」のみスプライン補間する。
 *   - 断面力の符号によってオフセット方向が反転する点を正しく扱う。
 *
 * ■ Catmull-Rom の選択理由
 *   - 通過点を必ず通る（断面力の端点値が変わらない）
 *   - 接続点で C1 連続（1階微分が連続 → 折れ目なし）
 *   - パラメータなし、実装が軽量
 */

/** オフセット済み xy 座標の配列 [x0,y0, x1,y1, ...] */
export type FlatPoints = number[];

/**
 * Catmull-Rom スプラインで点列を補間し、滑らかな座標列を返す。
 *
 * @param pts  入力点列 [x0,y0, x1,y1, ...]（4点以上推奨）
 * @param subdivisions 各区間の分割数（多いほど滑らか。デフォルト4）
 * @returns    補間後の点列 [x0,y0, ...]（端点は元のまま保持）
 */
export function catmullRomSmooth(pts: FlatPoints, subdivisions = 4): FlatPoints {
  const n = pts.length / 2; // 点数
  if (n < 2) return pts;
  if (n === 2) return pts; // 2点は補間不要

  // xy ペアに分解
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(pts[i * 2]);
    ys.push(pts[i * 2 + 1]);
  }

  const result: FlatPoints = [];

  for (let i = 0; i < n - 1; i++) {
    // Catmull-Rom の4制御点: p0, p1, p2, p3
    const i0 = Math.max(0, i - 1);
    const i1 = i;
    const i2 = i + 1;
    const i3 = Math.min(n - 1, i + 2);

    const x0 = xs[i0], y0 = ys[i0];
    const x1 = xs[i1], y1 = ys[i1];
    const x2 = xs[i2], y2 = ys[i2];
    const x3 = xs[i3], y3 = ys[i3];

    // 先頭点は必ず含める
    if (i === 0) result.push(x1, y1);

    for (let j = 1; j <= subdivisions; j++) {
      const t  = j / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom 基底（alpha=0.5 相当の標準形）
      const h00 = -0.5 * t3 + t2 - 0.5 * t;
      const h10 =  1.5 * t3 - 2.5 * t2 + 1.0;
      const h01 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
      const h11 =  0.5 * t3 - 0.5 * t2;

      result.push(
        h00 * x0 + h10 * x1 + h01 * x2 + h11 * x3,
        h00 * y0 + h10 * y1 + h01 * y2 + h11 * y3,
      );
    }
  }

  return result;
}

/**
 * ゼロライン（円弧軸）の点列とオフセット点列を受け取り、
 * オフセット点列だけスプライン補間して塗りつぶし用の閉じた点列を返す。
 *
 * fill 用点列: [スプライン補間したオフセット点列] + [ゼロライン逆順]
 *
 * @param zeroPts     部材軸上の点列 [x0,y0, ...] （補間しない）
 * @param offsetPts   断面力オフセット後の点列 [x0,y0, ...]
 * @param subdivisions スプライン分割数
 */
export function buildSmoothedFillPoints(
  zeroPts: FlatPoints,
  offsetPts: FlatPoints,
  subdivisions = 4,
): { outlinePts: FlatPoints; fillPts: FlatPoints } {
  const outlinePts = catmullRomSmooth(offsetPts, subdivisions);

  // ゼロライン逆順（閉じた多角形にする）
  const zeroReversed: number[] = [];
  for (let i = zeroPts.length - 2; i >= 0; i -= 2) {
    zeroReversed.push(zeroPts[i], zeroPts[i + 1]);
  }

  const fillPts = [...outlinePts, ...zeroReversed];
  return { outlinePts, fillPts };
}