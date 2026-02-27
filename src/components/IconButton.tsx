import Konva from "konva";
import { Rect } from "react-konva";
import { SvgIconShape } from "../SvgIconShape";
import { WHITE, BLUE, ICON_PAD } from "../types";

type IconButtonProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
  svgText: string;
  onClick: () => void;
};

export function IconButton({ x, y, w, h, active, svgText, onClick }: IconButtonProps) {
  const stop = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onClick();
  };
  return (
    <>
      <Rect
        x={x} y={y} width={w} height={h} cornerRadius={10}
        fill={active ? WHITE : "rgba(255,255,255,0.12)"}
        onMouseDown={stop} onTouchStart={stop}
      />
      <SvgIconShape
        svgText={svgText}
        x={x + ICON_PAD} y={y + ICON_PAD}
        w={w - ICON_PAD * 2} h={h - ICON_PAD * 2}
        stroke={BLUE}
        fill={active ? WHITE : "rgba(255,255,255,0.12)"}
        listening={false}
      />
    </>
  );
}