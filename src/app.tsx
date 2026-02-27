import { AppProvider }       from "./contexts/AppContext";
import { Sidebar }           from "./components/Sidebar";
import { WorldStage }        from "./components/WorldStage";
import { PropertiesPanel }   from "./components/PropertiesPanel";
import { AnalysisPanel } from "./components/AnalysisPanel";

export default function App() {
  return (
    <AppProvider>
      <div style={{ width: "100vw", height: "100vh", background: "#111", display: "flex", position: "relative" }}>
        <Sidebar />
        <WorldStage />
        <PropertiesPanel />
        <AnalysisPanel /> 
      </div>
    </AppProvider>
  );
}