import React from "react";

const BUCKET: Record<string, string> = {
  top: "скорее вернётся",
  middle: "неясно",
  bottom: "скорее нет",
};

/** Bucket and up to three reasons. Digits never enter the sentence. */
export function ReasonCodes({
  bucket,
  reasons,
}: {
  bucket: "top" | "middle" | "bottom" | null;
  reasons: string[];
}) {
  const words = reasons.filter((reason) => reason.length > 0 && !/\d/.test(reason)).slice(0, 3);
  if (!bucket && !words.length) return null;
  const name = bucket ? BUCKET[bucket] : null;
  if (name && !words.length) {
    return (
      <p className="reason">
        Ведро: <strong>{name}</strong>.
      </p>
    );
  }
  if (!name) {
    return <p className="reason">Ведро: {words.join(", ")}.</p>;
  }
  return (
    <p className="reason">
      Ведро: <strong>{name}</strong>
      {words.length ? ` · ${words.join(" · ")}` : "."}
    </p>
  );
}
