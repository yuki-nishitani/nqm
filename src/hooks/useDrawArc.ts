/**
 * useDrawArc.ts — 円弧描画フック
 *
 * 操作ステップ:
 *   1. 中心点クリック
 *   2. 開始点クリック（半径が確定）
 *   3. 終了点クリック（円弧が確定・コミット）
 *
 * プレビュー:
 *   - step 1 完了後: 中心→マウスの半径線
 *   - step 2 完了後: 円弧のプレビュー + 中心マーカー
 *
 * 180°判定:
 *   マウスの「累積角度変化」を積分することで方向と終点を決定する。
 *   - 瞬間的な外積ではなく軌跡を追跡するため、180°付近でも安定して動作する。
 *   - 累積が ±π に達したらクランプし、180°を超えた円弧は描画されない。
 *   - 正の累積 = 反時計回り、負の累積 = 時計回り。
 */

import { useState, useCallback, useRef } from "react";
import { snap } from "../utils/geometry";
import {
  ArcDrawState,
  advanceArcDraw,
  arcToBulge,
  bulgeToSvgPath,
} from "../utils/curveUtils";

export type ArcPreview =
  | { kind: "none" }
  | {
      kind: "radius";          // step1完了: 中心とマウスを結ぶ線
      cx: number; cy: number;
      mx: number; my: number;  // マウス位置
    }
  | {
      kind: "arc";             // step2完了: 円弧プレビュー
      cx: number; cy: number;
      r: number;
      ax: number; ay: number;  // 開始点
      bx: number; by: number;  // 終了点候補（累積角度から計算）
      svgPath: string;
      anticlockwise: boolean;
    };

export function useDrawArc(
  addArcMember: (
    ax: number, ay: number,
    bx: number, by: number,
    bulge: number,
  ) => { nodeIdA: string; nodeIdB: string } | null,
) {
  const [arcState,  setArcState]  = useState<ArcDrawState>({ step: "idle" });
  const [anticlockwise, setAnticlockwise] = useState(false);
  const [mousePos,  setMousePos]  = useState<{ x: number; y: number } | null>(null);

  // 最新値を ref で保持（コールバック内で stale にならないように）
  const anticlockwiseRef = useRef(false);
  const arcStateRef      = useRef<ArcDrawState>({ step: "idle" });

  // --- 累積角度トラッキング用 ref ---
  // スナップ前のマウス実座標
  const rawMouseRef         = useRef<{ x: number; y: number } | null>(null);
  // 直前フレームのマウス角度（中心からの atan2）。null = hasStart直後で未初期化
  const prevRawAngleRef     = useRef<number | null>(null);
  // 累積角度変化（正 = 反時計回り、負 = 時計回り）
  const accumAngleRef       = useRef<number>(0);

  // arcState と ref を同期させるラッパー
  const setArcStateSync = useCallback((next: ArcDrawState) => {
    arcStateRef.current = next;
    setArcState(next);
  }, []);

  /** 累積角度トラッキングをリセット */
  const resetAccum = useCallback(() => {
    prevRawAngleRef.current = null;
    accumAngleRef.current   = 0;
  }, []);

  /** マウス移動: スナップ済み座標でプレビュー用 state を更新 */
  const updateMouse = useCallback((wx: number, wy: number) => {
    setMousePos({ x: wx, y: wy });
  }, []);

  /**
   * マウス実座標（スナップ前）を更新し、hasStart 中なら累積角度を積分する。
   *
   * フレーム間の角度差を -π〜π に正規化して加算するため、
   * 180°付近でも方向が安定して追従する。
   * 累積が ±π に達したらクランプして 180° を超える円弧を防止する。
   */
  const updateRawMouse = useCallback((rx: number, ry: number) => {
    rawMouseRef.current = { x: rx, y: ry };

    const state = arcStateRef.current;
    if (state.step !== "hasStart") return;

    const { cx, cy } = state;
    const currentAngle = Math.atan2(ry - cy, rx - cx);

    if (prevRawAngleRef.current === null) {
      // hasStart 確定直後の初回フレーム: 開始角からの初期オフセットで初期化
      const startAngle = Math.atan2(state.ay - cy, state.ax - cx);
      let initialDelta = currentAngle - startAngle;
      if (initialDelta >  Math.PI) initialDelta -= 2 * Math.PI;
      if (initialDelta < -Math.PI) initialDelta += 2 * Math.PI;
      accumAngleRef.current   = initialDelta;
      prevRawAngleRef.current = currentAngle;
      return;
    }

    // フレーム間の角度差を -π〜π に正規化
    let delta = currentAngle - prevRawAngleRef.current;
    if (delta >  Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;

    accumAngleRef.current += delta;

    // 180° 制限: ±π をクランプ（わずかに手前で止める）
    const LIMIT = Math.PI - 1e-4;
    if (accumAngleRef.current >  LIMIT) accumAngleRef.current =  LIMIT;
    if (accumAngleRef.current < -LIMIT) accumAngleRef.current = -LIMIT;

    prevRawAngleRef.current = currentAngle;
  }, []);

  /**
   * 累積角度と円の状態から、プレビューと同一の終点・bulge を計算するヘルパー。
   * preview() と handleClick() の両方がこれを使うことで、
   * 「表示される円弧 = コミットされる円弧」を保証する。
   */
  const calcArcFromAccum = useCallback((
    cx: number, cy: number, r: number,
    ax: number, ay: number,
    accum: number,
  ): { bx: number; by: number; bulge: number; anticlockwise: boolean } | null => {
    if (Math.abs(accum) < 1e-6) return null;

    const startAngle = Math.atan2(ay - cy, ax - cx);
    const endAngle   = startAngle + accum;
    const bx = cx + r * Math.cos(endAngle);
    const by = cy + r * Math.sin(endAngle);

    if (Math.hypot(bx - ax, by - ay) < 1e-6) return null;

    const naturalAnticlockwise = accum >= 0;

    let bulge = arcToBulge(cx, cy, ax, ay, bx, by, naturalAnticlockwise);
    if (Math.abs(bulge) > 1) {
      bulge = arcToBulge(cx, cy, ax, ay, bx, by, !naturalAnticlockwise);
    }

    return { bx, by, bulge, anticlockwise: naturalAnticlockwise };
  }, []);

  /** クリック: ステップを進める（全座標グリッドスナップ） */
  const handleClick = useCallback((wx: number, wy: number) => {
    const px = snap(wx);
    const py = snap(wy);
    const prev = arcStateRef.current;

    const { next, committed } = advanceArcDraw(prev, px, py, anticlockwiseRef.current);
    setArcStateSync(next);

    // 開始点が確定したタイミングで累積角度をリセット
    if (next.step === "hasStart") {
      resetAccum();
    }

    if (committed) {
      if (prev.step === "hasStart") {
        const { cx, cy, r, ax, ay } = prev;

        // ★ advanceArcDraw が返す bx/by（スナップ座標）ではなく、
        //    プレビューと同じ累積角度ベースの終点・bulge を使う
        const result = calcArcFromAccum(cx, cy, r, ax, ay, accumAngleRef.current);
        if (result) {
          addArcMember(ax, ay, result.bx, result.by, result.bulge);
        }
      }
    }
  }, [addArcMember, setArcStateSync, resetAccum, calcArcFromAccum]);

  /** 回転方向トグル（Tab キーなどに割り当てる想定） */
  const toggleDirection = useCallback(() => {
    setAnticlockwise((v) => {
      anticlockwiseRef.current = !v;
      return !v;
    });
  }, []);

  /** Escape / モード離脱でリセット */
  const reset = useCallback(() => {
    setArcStateSync({ step: "idle" });
    setMousePos(null);
    rawMouseRef.current = null;
    resetAccum();
  }, [setArcStateSync, resetAccum]);

  /**
   * 現在のプレビュー状態を計算して返す。
   *
   * hasStart 中は arcEndFromMouse（円上投影）を使わず、
   * 累積角度から直接終点を計算する。これにより:
   *   - 180°付近でも終点が安定する
   *   - 方向がマウスの実際の動き（軌跡）に忠実に追従する
   */
  const preview = useCallback((): ArcPreview => {
    if (!mousePos) return { kind: "none" };
    const { x: mx, y: my } = mousePos;

    if (arcState.step === "hasCenter") {
      return {
        kind: "radius",
        cx: arcState.cx, cy: arcState.cy,
        mx, my,
      };
    }

    if (arcState.step === "hasStart") {
      const { cx, cy, r, ax, ay } = arcState;

      const result = calcArcFromAccum(cx, cy, r, ax, ay, accumAngleRef.current);
      if (!result) return { kind: "none" };

      const { bx, by, bulge, anticlockwise: naturalAnticlockwise } = result;
      const svgPath = bulgeToSvgPath(ax, ay, bx, by, bulge);

      return {
        kind: "arc",
        cx, cy, r,
        ax, ay,
        bx, by,
        svgPath,
        anticlockwise: naturalAnticlockwise,
      };
    }

    return { kind: "none" };
  }, [arcState, mousePos, calcArcFromAccum]);

  return {
    arcState,
    anticlockwise,
    preview,
    handleClick,
    updateMouse,
    updateRawMouse,
    reset,
    toggleDirection,
  };
}