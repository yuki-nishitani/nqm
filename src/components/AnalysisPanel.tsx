/**
 * AnalysisPanel.tsx — 解析実行・結果表示コントロール
 */

import { useAppContext } from "../contexts/AppContext";

const PANEL_W = 210;
const DEFORMED_COLOR = "#b48eff";

function ToggleBtn({ label, color, active, onClick }: {
  label: string; color: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: "5px 0", borderRadius: 4,
      border: `1.5px solid ${color}`,
      background: active ? color : "transparent",
      color: active ? "#111" : color,
      fontWeight: "bold", fontSize: 12, cursor: "pointer",
      transition: "background 0.15s",
    }}>
      {label}
    </button>
  );
}

function ScaleRow({ label, value, min, max, step, color, onChange }: {
  label: string; value: number; min: number; max: number;
  step: number; color: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10, color: "#888" }}>
        {label}:
        <span style={{ color, marginLeft: 4, fontWeight: "bold" }}>
          {value >= 100 ? Math.round(value) : value.toFixed(2)}×
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color }} />
    </div>
  );
}

export function AnalysisPanel() {
  const {
    femResult, validation, isStale,
    displayFlags, setDisplayFlag,
    diagramScale, setDiagramScale,
    deformedScale, setDeformedScale,
    handleRunAnalysis, clearResult,
  } = useAppContext();

  const hasResult = femResult !== null;
  const hasError  = femResult && !femResult.ok;
  const warnings  = validation?.issues.filter(i => i.level === "warning") ?? [];

  // 断面力・反力のどれかが表示ONかどうか（スケールスライダーの表示判定）
  const showingDiagram = displayFlags.N || displayFlags.Q || displayFlags.M;

  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, width: PANEL_W,
      background: "#1a1a2e", border: "1px solid #333", borderRadius: 8,
      padding: 12, display: "flex", flexDirection: "column", gap: 8,
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)", zIndex: 100, userSelect: "none",
    }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#aaa", fontSize: 11, fontWeight: "bold", flex: 1 }}>構造解析</span>
        {hasResult && (
          <button onClick={clearResult} style={{
            background: "transparent", border: "none",
            color: "#555", cursor: "pointer", fontSize: 13, padding: "0 2px",
          }} title="結果をクリア">✕</button>
        )}
      </div>

      {/* 解析実行ボタン */}
      <button onClick={handleRunAnalysis} style={{
        padding: "8px 0", borderRadius: 5, border: "none",
        background: isStale ? "#e67e22" : "#2980b9",
        color: "#fff", fontWeight: "bold", fontSize: 13,
        cursor: "pointer", transition: "background 0.2s", position: "relative",
      }}>
        {isStale ? "再解析" : "解析実行"}
        {isStale && (
          <span style={{
            position: "absolute", top: -6, right: -6,
            width: 10, height: 10, borderRadius: "50%",
            background: "#e74c3c", border: "2px solid #1a1a2e",
          }} />
        )}
      </button>

      {/* エラー */}
      {hasError && (
        <div style={{
          background: "#3d1010", border: "1px solid #c0392b",
          borderRadius: 4, padding: "6px 8px", fontSize: 11,
          color: "#e74c3c", whiteSpace: "pre-wrap", lineHeight: 1.5,
        }}>
          ⚠ {(femResult as { message: string }).message}
        </div>
      )}

      {/* 警告 */}
      {!hasError && warnings.length > 0 && (
        <div style={{
          background: "#2d2a10", border: "1px solid #f39c12",
          borderRadius: 4, padding: "6px 8px", fontSize: 11,
          color: "#f39c12", lineHeight: 1.5,
        }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w.message}</div>)}
        </div>
      )}

      {/* 解析成功時の表示コントロール */}
      {femResult?.ok && (
        <>
          <div style={{ color: "#27ae60", fontSize: 11 }}>✓ 解析完了</div>

          {/* ── 変形図 ── */}
          <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 6 }}>
            <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>変形図</div>
            <div style={{ display: "flex", gap: 4 }}>
              <ToggleBtn label="変形図" color={DEFORMED_COLOR}
                active={displayFlags.deformed}
                onClick={() => setDisplayFlag("deformed", !displayFlags.deformed)} />
            </div>
            {displayFlags.deformed && (
              <div style={{ marginTop: 6 }}>
                <ScaleRow label="拡大率" value={deformedScale}
                  min={0.1} max={10} step={0.1}
                  color={DEFORMED_COLOR} onChange={setDeformedScale} />
              </div>
            )}
          </div>

          {/* ── 断面力・反力 ── */}
          <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 6 }}>
            <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>断面力・反力</div>

            {/* 反力 */}
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <ToggleBtn label="反力" color="#ffe066"
                active={displayFlags.reaction}
                onClick={() => setDisplayFlag("reaction", !displayFlags.reaction)} />
            </div>

            {/* N / Q / M */}
            <div style={{ display: "flex", gap: 4 }}>
              <ToggleBtn label="N" color="#4fc3f7"
                active={displayFlags.N}
                onClick={() => setDisplayFlag("N", !displayFlags.N)} />
              <ToggleBtn label="Q" color="#81c784"
                active={displayFlags.Q}
                onClick={() => setDisplayFlag("Q", !displayFlags.Q)} />
              <ToggleBtn label="M" color="#e57373"
                active={displayFlags.M}
                onClick={() => setDisplayFlag("M", !displayFlags.M)} />
            </div>

            {/* 断面力スケール（N/Q/Mのいずれかがオンのとき表示） */}
            {showingDiagram && (
              <div style={{ marginTop: 6 }}>
                <ScaleRow label="断面力スケール" value={diagramScale}
                  min={0.1} max={5} step={0.05}
                  color="#aaa" onChange={setDiagramScale} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}