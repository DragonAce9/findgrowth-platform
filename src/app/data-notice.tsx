import React from "react";

/** Honest three-part notice. Not for ordinary “thin data” chips. */
export function DataNotice({ seen, why, means }: { seen: string; why: string; means: string }) {
  return (
    <div className="note warn" role="note">
      <p>
        <strong>⚠ {seen}</strong>
      </p>
      <p>{why}</p>
      <p>{means}</p>
    </div>
  );
}
