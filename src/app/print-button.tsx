"use client";

export function PrintButton() {
  return (
    <button type="button" className="ghost" data-print="true" onClick={() => window.print()}>
      Напечатать
    </button>
  );
}
