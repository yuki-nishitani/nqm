import { Stage, Layer, Text } from "react-konva";
import { IconButton } from "./IconButton";
import { useAppContext } from "../contexts/AppContext";
import {
  SIDEBAR_W,
  PAD, GAP, BTN_W, BTN_H, BTN_Y,
  FOOTER_X, FOOTER_LINE_H, FOOTER_LINES,
} from "../types";

import selectSvgText   from "../assets/icons/select.svg?raw";
import lineSvgText     from "../assets/icons/line.svg?raw";
import pinSvgText      from "../assets/icons/pin.svg?raw";
import rollerSvgText   from "../assets/icons/roller.svg?raw";
import fixSvgText      from "../assets/icons/fix.svg?raw";
import jointSvgText    from "../assets/icons/joint.svg?raw";
import loadSvgText     from "../assets/icons/load.svg?raw";

import nodeEditSvgText from "../assets/icons/nodeEdit.svg?raw";

export function Sidebar() {
  const { H, mode, switchMode, nodes, members, joints, pointLoads, distLoads } = useAppContext();

  const footerTopY = H - 14 - FOOTER_LINE_H * FOOTER_LINES;
  const x0 = PAD, x1 = PAD + BTN_W + GAP;
  const LABEL_H = 20, ROW_H = BTN_H, ROW_GAP = GAP;
  let y = BTN_Y;

  return (
    <div style={{ width: SIDEBAR_W, height: "100%", background: "#141414" }}>
      <Stage width={SIDEBAR_W} height={H} pixelRatio={window.devicePixelRatio || 1}>
        <Layer>
          <Text x={16} y={14} text="NQM" fill="#ddd" fontStyle="bold" fontSize={16} />

          {/* DRAWING */}
          <Text x={16} y={y} text="DRAWING" fill="#fff" fontStyle="normal" fontSize={11} opacity={0.9} />
          {(() => { y += LABEL_H; return null; })()}
          <IconButton x={x0} y={y} w={BTN_W} h={BTN_H} active={mode === "select"}   svgText={selectSvgText}   onClick={() => switchMode("select")} />
          <IconButton x={x1} y={y} w={BTN_W} h={BTN_H} active={mode === "drawLine"} svgText={lineSvgText}     onClick={() => switchMode("drawLine")} />
          {(() => { y += ROW_H + ROW_GAP + 2; return null; })()}
          <IconButton x={x0} y={y} w={BTN_W} h={BTN_H} active={mode === "nodeEdit"} svgText={nodeEditSvgText} onClick={() => switchMode("nodeEdit")} />
          {(() => { y += ROW_H + ROW_GAP + 2; return null; })()}

          {/* SUPPORT */}
          <Text x={16} y={y} text="SUPPORT" fill="#fff" fontStyle="normal" fontSize={11} opacity={0.9} />
          {(() => { y += LABEL_H; return null; })()}
          <IconButton x={x0} y={y} w={BTN_W} h={BTN_H} active={mode === "supportPin"}    svgText={pinSvgText}    onClick={() => switchMode("supportPin")} />
          <IconButton x={x1} y={y} w={BTN_W} h={BTN_H} active={mode === "supportRoller"} svgText={rollerSvgText} onClick={() => switchMode("supportRoller")} />
          {(() => { y += ROW_H + ROW_GAP; return null; })()}
          <IconButton x={x0} y={y} w={BTN_W} h={BTN_H} active={mode === "supportFix"}    svgText={fixSvgText}    onClick={() => switchMode("supportFix")} />
          {(() => { y += ROW_H + ROW_GAP; return null; })()}

          {/* JOINT */}
          <Text x={16} y={y} text="JOINT" fill="#fff" fontStyle="normal" fontSize={11} opacity={0.9} />
          {(() => { y += LABEL_H; return null; })()}
          <IconButton x={x0} y={y} w={BTN_W} h={BTN_H} active={mode === "joint"} svgText={jointSvgText} onClick={() => switchMode("joint")} />
          {(() => { y += ROW_H + ROW_GAP; return null; })()}

          {/* LOAD */}
          <Text x={16} y={y} text="LOAD" fill="#fff" fontStyle="normal" fontSize={11} opacity={0.9} />
          {(() => { y += LABEL_H; return null; })()}
          <IconButton x={x0} y={y} w={BTN_W} h={BTN_H} active={mode === "load"}     svgText={loadSvgText}     onClick={() => switchMode("load")} />
          <IconButton x={x1} y={y} w={BTN_W} h={BTN_H} active={mode === "distLoad"} svgText={distloadSvgText} onClick={() => switchMode("distLoad")} />
          {(() => { y += ROW_H + ROW_GAP; return null; })()}

          {/* フッター */}
          <Text x={FOOTER_X} y={footerTopY + FOOTER_LINE_H * 0} text={`Mode: ${mode}`}              fill="#999" fontSize={12} />
          <Text x={FOOTER_X} y={footerTopY + FOOTER_LINE_H * 1} text={`Nodes: ${nodes.length}`}       fill="#999" fontSize={12} />
          <Text x={FOOTER_X} y={footerTopY + FOOTER_LINE_H * 2} text={`Members: ${members.length}`}   fill="#999" fontSize={12} />
          <Text x={FOOTER_X} y={footerTopY + FOOTER_LINE_H * 3} text={`Joints: ${joints.length}`}     fill="#999" fontSize={12} />
          <Text x={FOOTER_X} y={footerTopY + FOOTER_LINE_H * 4} text={`Loads: ${pointLoads.length}`}  fill="#999" fontSize={12} />
          <Text x={FOOTER_X} y={footerTopY + FOOTER_LINE_H * 5} text={`DistLoads: ${distLoads.length}`} fill="#999" fontSize={12} />
        </Layer>
      </Stage>
    </div>
  );
}