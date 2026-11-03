import React from "react";

/** One sentence for a failed cut. The mark is in the text: `.note.warn` does not draw it. */
export function failedCutMessage(error: string | null | undefined): string {
  const reason = error?.trim();
  if (!reason) return "⚠ Причина не записана: откройте файл и проверьте колонки заказов.";
  return reason.startsWith("⚠") ? reason : `⚠ ${reason}`;
}

export function FailedCut({ error }: { error: string | null | undefined }) {
  return (
    <div className="page">
      <h1>Срез не посчитался</h1>
      <p className="lede">Файл сохранился, расчёт остановился. Загрузите его ещё раз из студии.</p>
      <p className="note warn">{failedCutMessage(error)}</p>
    </div>
  );
}
