import { Shape } from "react-konva";
import { useMemo } from "react";
import Konva from "konva";

// ===== 型定義 =====
type SvgStyle = {
  fill: string;        // "none" or CSS color
  stroke: string;      // "none" or CSS color
  strokeWidth: number;
  strokeDasharray: number[];
  strokeLinecap: CanvasLineCap;
  strokeLinejoin: CanvasLineJoin;
  strokeMiterlimit: number;
};

type DrawCommand =
  | { type: "path";     d: string;       style: SvgStyle }
  | { type: "polyline"; points: number[]; style: SvgStyle }
  | { type: "line";     x1: number; y1: number; x2: number; y2: number; style: SvgStyle }
  | { type: "circle";   cx: number; cy: number; r: number; style: SvgStyle }
  | { type: "rect";     x: number; y: number; w: number; h: number; rx: number; ry: number; style: SvgStyle }
  | { type: "ellipse";  cx: number; cy: number; rx: number; ry: number; style: SvgStyle };

type SvgIconShapeProps = {
  svgText: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 全パスの stroke 色を上書き（省略で SVG 元色を使用） */
  stroke?: string;
  /** stroke 幅を上書き（省略で各要素の SVG 元値を使用） */
  strokeWidth?: number;
  /** fill 色を上書き（省略で SVG 元色を使用） */
  fill?: string;
  dash?: number[];
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  keepAspect?: boolean;
} & Omit<Konva.ShapeConfig, "sceneFunc" | "x" | "y">;
// ↑ rotation / offsetX / offsetY / onMouseDown / listening などが入る



type ParsedSvg = {
  viewBox: [number, number, number, number];
  commands: DrawCommand[];
};

// ===== CSS クラス → スタイルを解析 =====
function parseCssClasses(svgEl: SVGSVGElement): Map<string, Partial<SvgStyle>> {
  const map = new Map<string, Partial<SvgStyle>>();

  const styleEls = svgEl.querySelectorAll("style");
  styleEls.forEach((styleEl) => {
    const text = styleEl.textContent || "";
    // ".cls-1 { ... }" のようなブロックを正規表現で取り出す
    const blocks = text.matchAll(/\.([^{]+)\{([^}]+)\}/g);
    for (const block of blocks) {
      const selectors = block[1].trim().split(/\s*,\s*/);
      const declarations = block[2];

      const style: Partial<SvgStyle> = {};

      const get = (prop: string) => {
        const m = declarations.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`));
        return m ? m[1].trim() : null;
      };

      const fillVal = get("fill");
      if (fillVal) style.fill = fillVal;

      const strokeVal = get("stroke");
      if (strokeVal) style.stroke = strokeVal;

      const swVal = get("stroke-width");
      if (swVal) style.strokeWidth = parseFloat(swVal);

      const sdaVal = get("stroke-dasharray");
      if (sdaVal) {
        style.strokeDasharray = sdaVal
          .split(/[\s,]+/)
          .map(parseFloat)
          .filter((n) => !isNaN(n));
      }

      const slcVal = get("stroke-linecap");
      if (slcVal) style.strokeLinecap = slcVal as CanvasLineCap;

      const sljVal = get("stroke-linejoin");
      if (sljVal) style.strokeLinejoin = sljVal as CanvasLineJoin;

      const smVal = get("stroke-miterlimit");
      if (smVal) style.strokeMiterlimit = parseFloat(smVal);

      for (const sel of selectors) {
        const cls = sel.trim().replace(/^\./, "");
        const existing = map.get(cls) ?? {};
        map.set(cls, { ...existing, ...style });
      }
    }
  });

  return map;
}

// 要素の style を解決（CSS クラス → インライン属性の順にマージ）
function resolveStyle(el: Element, cssMap: Map<string, Partial<SvgStyle>>): SvgStyle {
  const base: SvgStyle = {
    fill: "black",
    stroke: "none",
    strokeWidth: 1,
    strokeDasharray: [],
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: 4,
  };

  // CSS クラスを適用
  const classList = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  for (const cls of classList) {
    const s = cssMap.get(cls);
    if (s) Object.assign(base, s);
  }

  // インライン属性で上書き
  const attr = (name: string) => el.getAttribute(name);

  const fillAttr = attr("fill");
  if (fillAttr) base.fill = fillAttr;

  const strokeAttr = attr("stroke");
  if (strokeAttr) base.stroke = strokeAttr;

  const swAttr = attr("stroke-width");
  if (swAttr) base.strokeWidth = parseFloat(swAttr);

  const sdaAttr = attr("stroke-dasharray");
  if (sdaAttr) {
    base.strokeDasharray = sdaAttr
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => !isNaN(n));
  }

  const slcAttr = attr("stroke-linecap");
  if (slcAttr) base.strokeLinecap = slcAttr as CanvasLineCap;

  const sljAttr = attr("stroke-linejoin");
  if (sljAttr) base.strokeLinejoin = sljAttr as CanvasLineJoin;

  return base;
}

// SVG ポイント文字列 ("x1,y1 x2,y2 ...") → [x1,y1,x2,y2,...]
function parsePoints(s: string): number[] {
  return s
    .trim()
    .split(/[\s,]+/)
    .map(parseFloat)
    .filter((n) => !isNaN(n));
}

// ===== SVG パーサー本体 =====
function parseSvg(svgText: string): ParsedSvg {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg") as SVGSVGElement | null;
  if (!svg) throw new Error("SVG root not found");

  // viewBox
  const vb = svg.getAttribute("viewBox");
  let viewBox: [number, number, number, number] = [0, 0, 100, 100];
  if (vb) {
    const nums = vb.split(/[\s,]+/).map(Number);
    if (nums.length === 4 && nums.every(Number.isFinite)) {
      viewBox = nums as [number, number, number, number];
    }
  } else {
    viewBox = [0, 0, Number(svg.getAttribute("width")) || 100, Number(svg.getAttribute("height")) || 100];
  }

  const cssMap = parseCssClasses(svg);
  const commands: DrawCommand[] = [];

  // 描画対象タグを深さ優先で収集（<g> は再帰的に展開）
  const DRAWABLE = new Set(["path", "polyline", "polygon", "line", "circle", "ellipse", "rect"]);

  function walk(el: Element) {
    const tag = el.tagName.toLowerCase();

    if (tag === "defs" || tag === "style") return; // skip

    if (DRAWABLE.has(tag)) {
      const style = resolveStyle(el, cssMap);

      if (tag === "path") {
        const d = el.getAttribute("d") || "";
        if (d.trim()) commands.push({ type: "path", d, style });

      } else if (tag === "polyline" || tag === "polygon") {
        const pts = parsePoints(el.getAttribute("points") || "");
        if (tag === "polygon" && pts.length >= 2) {
          // polygon は閉じる
          pts.push(pts[0], pts[1]);
        }
        if (pts.length >= 4) commands.push({ type: "polyline", points: pts, style });

      } else if (tag === "line") {
        const x1 = parseFloat(el.getAttribute("x1") || "0");
        const y1 = parseFloat(el.getAttribute("y1") || "0");
        const x2 = parseFloat(el.getAttribute("x2") || "0");
        const y2 = parseFloat(el.getAttribute("y2") || "0");
        commands.push({ type: "line", x1, y1, x2, y2, style });

      } else if (tag === "circle") {
        const cx = parseFloat(el.getAttribute("cx") || "0");
        const cy = parseFloat(el.getAttribute("cy") || "0");
        const r  = parseFloat(el.getAttribute("r")  || "0");
        if (r > 0) commands.push({ type: "circle", cx, cy, r, style });

      } else if (tag === "ellipse") {
        const cx = parseFloat(el.getAttribute("cx") || "0");
        const cy = parseFloat(el.getAttribute("cy") || "0");
        const rx = parseFloat(el.getAttribute("rx") || "0");
        const ry = parseFloat(el.getAttribute("ry") || "0");
        commands.push({ type: "ellipse", cx, cy, rx, ry, style });

      } else if (tag === "rect") {
        const x  = parseFloat(el.getAttribute("x")  || "0");
        const y  = parseFloat(el.getAttribute("y")  || "0");
        const rw = parseFloat(el.getAttribute("width")  || "0");
        const rh = parseFloat(el.getAttribute("height") || "0");
        const rx = parseFloat(el.getAttribute("rx") || "0");
        const ry = parseFloat(el.getAttribute("ry") || rx.toString());
        if (rw > 0 && rh > 0) commands.push({ type: "rect", x, y, w: rw, h: rh, rx, ry, style });
      }
      return;
    }

    // <g> 等は子を再帰
    for (const child of Array.from(el.children)) {
      walk(child);
    }
  }

  for (const child of Array.from(svg.children)) {
    walk(child);
  }

  if (commands.length === 0) throw new Error("No drawable elements found in SVG");

  return { viewBox, commands };
}

// ===== Canvas 描画 =====
// scale: ctx.scale() で適用済みのスケール値。
// lineWidth / dasharray はスケール変換の影響を受けるため、scale で割って補正する。
function applyStyle(
  ctx: Konva.Context,
  style: SvgStyle,
  scale: number,
  overrideStroke?: string,
  overrideStrokeWidth?: number,
  overrideFill?: string
) {
  const fill   = overrideFill   ?? style.fill;
  const stroke = overrideStroke ?? style.stroke;
  const sw     = overrideStrokeWidth ?? style.strokeWidth;

  ctx.fillStyle   = fill   === "none" ? "rgba(0,0,0,0)" : fill;
  ctx.strokeStyle = stroke === "none" ? "rgba(0,0,0,0)" : stroke;
  // FIX: ctx.scale(s) 適用後は lineWidth が s 倍されてしまうため、s で割って補正
  ctx.lineWidth   = sw;
  ctx.lineCap     = style.strokeLinecap;
  ctx.lineJoin    = style.strokeLinejoin;
  ctx.miterLimit  = style.strokeMiterlimit;
  // dasharray も同様にスケール補正
  ctx.setLineDash(style.strokeDasharray);
}

function drawCommand(
  ctx: Konva.Context,
  cmd: DrawCommand,
  scale: number,
  overrideStroke?: string,
  overrideStrokeWidth?: number,
  overrideFill?: string
) {
  applyStyle(ctx, cmd.style, scale, overrideStroke, overrideStrokeWidth, overrideFill);

  const doFill = cmd.style.fill !== "none" && (overrideFill ?? cmd.style.fill) !== "none";
  const doStroke = (overrideStroke ?? cmd.style.stroke) !== "none";

  if (cmd.type === "path") {
    const path2d = new Path2D(cmd.d);
    if (doFill)   ctx.fill(path2d);
    if (doStroke) ctx.stroke(path2d);

  } else if (cmd.type === "polyline") {
    ctx.beginPath();
    const pts = cmd.points;
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (doFill)   ctx.fill();
    if (doStroke) ctx.stroke();

  } else if (cmd.type === "line") {
    ctx.beginPath();
    ctx.moveTo(cmd.x1, cmd.y1);
    ctx.lineTo(cmd.x2, cmd.y2);
    if (doStroke) ctx.stroke();

  } else if (cmd.type === "circle") {
    ctx.beginPath();
    ctx.arc(cmd.cx, cmd.cy, cmd.r, 0, Math.PI * 2);
    if (doFill)   ctx.fill();
    if (doStroke) ctx.stroke();

  } else if (cmd.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(cmd.cx, cmd.cy, cmd.rx, cmd.ry, 0, 0, Math.PI * 2);
    if (doFill)   ctx.fill();
    if (doStroke) ctx.stroke();

  } else if (cmd.type === "rect") {
    ctx.beginPath();
    if (cmd.rx > 0 || cmd.ry > 0) {
      const r = Math.min(cmd.rx, cmd.ry);
      ctx.roundRect(cmd.x, cmd.y, cmd.w, cmd.h, r);
    } else {
      ctx.rect(cmd.x, cmd.y, cmd.w, cmd.h);
    }
    if (doFill)   ctx.fill();
    if (doStroke) ctx.stroke();
  }
}

// ===== SvgIconShape コンポーネント =====
export function SvgIconShape({
  svgText,
  x,
  y,
  w,
  h,
  stroke,
  strokeWidth,
  fill,
  dash,
  lineCap,
  lineJoin,
  keepAspect = true,
  ...shapeProps
}: SvgIconShapeProps) {
  const parsed = useMemo(() => parseSvg(svgText), [svgText]);
  const [minX, minY, vbW, vbH] = parsed.viewBox;

  return (
    <Shape
      x={x}
      y={y}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.fillStrokeShape(shape);
      }}
      {...shapeProps}
      sceneFunc={(ctx) => {
        ctx.save();

        // viewBox → ターゲットサイズへのスケーリング
        const sx = w / vbW;
        const sy = h / vbH;
        const s  = keepAspect ? Math.min(sx, sy) : 1;

        const drawW = keepAspect ? vbW * s : vbW * sx;
        const drawH = keepAspect ? vbH * s : vbH * sy;
        const padX = (w - drawW) / 2;
        const padY = (h - drawH) / 2;

        ctx.translate(padX, padY);
        ctx.scale(keepAspect ? s : sx, keepAspect ? s : sy);
        ctx.translate(-minX, -minY);

        // 全要素を描画（scale を渡して lineWidth を補正）
        for (const cmd of parsed.commands) {
          const effectiveStyle = { ...cmd.style };
          if (dash)     effectiveStyle.strokeDasharray = dash;
          if (lineCap)  effectiveStyle.strokeLinecap   = lineCap;
          if (lineJoin) effectiveStyle.strokeLinejoin  = lineJoin;

          drawCommand(ctx, { ...cmd, style: effectiveStyle }, s, stroke, strokeWidth, fill);
        }

        ctx.restore();
        // fillStrokeShape は呼ばない（手動描画で完結）
      }}
    />
  );
}