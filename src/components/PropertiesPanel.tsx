import { useAppContext } from "../contexts/AppContext";

const PANEL_STYLE: React.CSSProperties = {
  position:        "absolute",
  top:          16,
  right:           30,
  width:           200,
  minHeight:       60,
  background:      "#1e1e1e",
  border:          "1px solid #333",
  borderRadius:    6,
  padding:         "10px 14px",
  color:           "#ddd",
  fontSize:        12,
  fontFamily:      "monospace",
  pointerEvents:   "none",
  userSelect:      "none",
  zIndex:          100,
};

const HEADER_STYLE: React.CSSProperties = {
  fontSize:     11,
  color:        "#888",
  marginBottom: 8,
  letterSpacing: 1,
  textTransform: "uppercase",
};

const ROW_STYLE: React.CSSProperties = {
  display:       "flex",
  justifyContent: "space-between",
  marginBottom:  4,
};

const LABEL_STYLE: React.CSSProperties = { color: "#888" };
const VALUE_STYLE: React.CSSProperties = { color: "#fff" };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={ROW_STYLE}>
      <span style={LABEL_STYLE}>{label}</span>
      <span style={VALUE_STYLE}>{value}</span>
    </div>
  );
}

export function PropertiesPanel() {
  const {
    sel,
    mode,
    supports,
    members,
    joints,
    pointLoads,
    distLoads,
    nodeById,
    selectedNodeId,
  } = useAppContext();

  // ===== 表示内容を決定 =====
  let title    = "";
  let rows: { label: string; value: string }[] = [];

  // nodeEdit モードで選択中のノード
  if (mode === "nodeEdit" && selectedNodeId) {
    const n = nodeById.get(selectedNodeId);
    if (n) {
      title = "NODE";
      rows = [
        { label: "X", value: String(n.x) },
        { label: "Y", value: String(n.y) },
      ];
    }
  }

  // support 選択
  else if (sel.kind === "supports" && sel.ids.length === 1) {
    const s = supports.find((s) => s.id === sel.ids[0]);
    if (s) {
      const n = nodeById.get(s.nodeId);
      title = "SUPPORT";
      rows = [
        { label: "Type",  value: s.type.toUpperCase() },
        { label: "Angle", value: `${s.angleDeg}°` },
        ...(n ? [
          { label: "X", value: String(n.x) },
          { label: "Y", value: String(n.y) },
        ] : []),
      ];
    }
  }

  // member 選択
  else if (sel.kind === "members" && sel.ids.length === 1) {
    const m = members.find((m) => m.id === sel.ids[0]);
    if (m) {
      const a = nodeById.get(m.a);
      const b = nodeById.get(m.b);
      const len = (a && b)
        ? Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100
        : null;
      title = "MEMBER";
      rows = [
        ...(len !== null ? [{ label: "Length", value: String(len) }] : []),
        ...(a ? [{ label: "A  (x,y)", value: `${a.x}, ${a.y}` }] : []),
        ...(b ? [{ label: "B  (x,y)", value: `${b.x}, ${b.y}` }] : []),
      ];
    }
  }

  // joint 選択
  else if (sel.kind === "joints" && sel.ids.length === 1) {
    const j = joints.find((j) => j.id === sel.ids[0]);
    if (j) {
      const n = nodeById.get(j.nodeId);
      title = "JOINT";
      rows = n ? [
        { label: "X", value: String(n.x) },
        { label: "Y", value: String(n.y) },
      ] : [];
    }
  }

  // load 選択
  else if (sel.kind === "loads" && sel.ids.length === 1) {
    const l = pointLoads.find((l) => l.id === sel.ids[0]);
    if (l) {
      const n = nodeById.get(l.nodeId);
      title = "POINT LOAD";
      rows = [
        { label: "Angle",     value: `${l.angleDeg}°` },
        { label: "Magnitude", value: String(l.magnitude) },
        ...(n ? [
          { label: "X", value: String(n.x) },
          { label: "Y", value: String(n.y) },
        ] : []),
      ];
    }
  }

  // distLoad 選択
  else if (sel.kind === "distLoads" && sel.ids.length === 1) {
    const l = distLoads.find((l) => l.id === sel.ids[0]);
    if (l) {
      title = "DIST LOAD";
      rows = [
        { label: "Angle",     value: `${l.angleDeg}°` },
        { label: "Magnitude", value: String(l.magnitude) },
      ];
    }
  }

  // 何も選択されていない
  if (!title) {
    return (
      <div style={PANEL_STYLE}>
        <div style={HEADER_STYLE}>PROPERTIES</div>
        <div style={{ color: "#444", fontSize: 11 }}>— no selection —</div>
      </div>
    );
  }

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>{title}</div>
      {rows.map((r) => (
        <Row key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  );
}