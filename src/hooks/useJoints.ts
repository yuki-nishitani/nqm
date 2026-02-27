import { useState, useCallback } from "react";
import { Joint, Member } from "../types";
import { uid } from "../utils/geometry";

export function useJoints() {
  const [joints, setJoints] = useState<Joint[]>([]);

  /**
   * joint モードでノードをクリックしたときの処理。
   * 以下の条件をすべて満たす場合のみ追加、それ以外はブロック：
   *   1. 接続メンバーが 2 本以上
   *   2. 同一ノードに Support がない
   * すでに joint があれば削除（トグル）。
   */
  const toggleJoint = useCallback((
    nodeId: string,
    members: Member[],
    supportNodeIds: Set<string>,
  ) => {
    // 既存 joint → 削除（トグル）
    const existing = joints.find((j) => j.nodeId === nodeId);
    if (existing) {
      setJoints((prev) => prev.filter((j) => j.nodeId !== nodeId));
      return;
    }

    // 条件チェック
    const connectionCount = members.filter(
      (m) => m.a === nodeId || m.b === nodeId
    ).length;
    if (connectionCount < 2) return;        // メンバー 1 本以下はブロック
    if (supportNodeIds.has(nodeId)) return;  // Support と重複はブロック

    setJoints((prev) => [...prev, { id: uid("J"), nodeId }]);
  }, [joints]);

  /** ノード削除に連動して joint も削除 */
  const removeByNodeIds = useCallback((nodeIds: Set<string>) => {
    setJoints((prev) => prev.filter((j) => !nodeIds.has(j.nodeId)));
  }, []);

  /** Support が追加されたノードの joint を削除（排他保証） */
  const removeByNodeId = useCallback((nodeId: string) => {
    setJoints((prev) => prev.filter((j) => j.nodeId !== nodeId));
  }, []);

  /** id セットを削除（Delete キー連動） */
  const removeJoints = useCallback((ids: Set<string>) => {
    setJoints((prev) => prev.filter((j) => !ids.has(j.id)));
  }, []);

  /** マージ時: fromId の joint を toId に引き継ぐ（toId に既存があれば from を削除） */
  const transferToNode = useCallback((fromId: string, toId: string) => {
    setJoints((prev) => {
      const hasTarget = prev.some((j) => j.nodeId === toId);
      return prev
        .filter((j) => j.nodeId !== fromId || !hasTarget)
        .map((j) => j.nodeId === fromId ? { ...j, nodeId: toId } : j);
    });
  }, []);

  /** 条件チェックなしでジョイントを直接追加（線上挿入用） */
  const addJointDirect = useCallback((nodeId: string) => {
    setJoints((prev) => {
      if (prev.some((j) => j.nodeId === nodeId)) return prev; // 重複防止
      return [...prev, { id: uid("J"), nodeId }];
    });
  }, []);

  return {
    joints,
    toggleJoint,
    removeByNodeIds,
    removeByNodeId,
    removeJoints,
    transferToNode,
    addJointDirect,
  };
}