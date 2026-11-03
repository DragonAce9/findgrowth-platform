import React, { type ReactNode } from "react";

const CODES = new Set(["Placed Order", "received_email", "flow", "customer_id", "anonymous_id", "order_id"]);

/** Russian gloss, then the source token in <code>. */
export function Term({ code, children }: { code: string; children: ReactNode }) {
  return (
    <span>
      {children} <code>{code}</code>
    </span>
  );
}

/** Wrap known source tokens that already sit inside a Russian sentence. */
export function withCodes(text: string): ReactNode {
  const parts = text.split(/(Placed Order|received_email|flow|customer_id|anonymous_id|order_id)/g);
  return parts.map((part, index) =>
    CODES.has(part) ? <code key={index}>{part}</code> : <span key={index}>{part}</span>,
  );
}
