import { useState, useCallback } from "react";

type NodeDrag = {
  nodeId: string;
  offsetX: number; // ドラッグ開始時のノード座標とポインタのズレ
  offsetY: number;
};

export function useNodeEdit() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDrag,       setNodeDrag]       = useState<NodeDrag | null>(null);

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  /**
   * ドラッグ開始。
   * nodeX/nodeY: ノードのワールド座標
   * pointerX/pointerY: ポインタのワールド座標
   */
  const startDrag = useCallback((nodeId: string, nodeX: number, nodeY: number, pointerX: number, pointerY: number) => {
    setSelectedNodeId(nodeId);
    setNodeDrag({
      nodeId,
      offsetX: pointerX - nodeX,
      offsetY: pointerY - nodeY,
    });
  }, []);

  const endDrag = useCallback(() => {
    setNodeDrag(null);
  }, []);

  return {
    selectedNodeId,
    nodeDrag,
    selectNode,
    startDrag,
    endDrag,
  };
}