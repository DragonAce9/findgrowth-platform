import React from "react";
import { evidenceState, type EvidenceRule } from "@/engine/stats";

/** Chip for thin or hidden evidence. Enough renders nothing. */
export function EvidenceBadge({ n, rule }: { n: number; rule: EvidenceRule }) {
  const state = evidenceState(n, rule);
  if (state.level === "enough") return null;
  if (state.level === "thin") {
    return (
      <span className="tag thin" role="note">
        ◐ мало данных
      </span>
    );
  }
  return (
    <span className="tag hidden" role="note">
      ▧ скрыто
    </span>
  );
}

export function evidenceReason(n: number, rule: EvidenceRule): string {
  return evidenceState(n, rule).reason;
}
