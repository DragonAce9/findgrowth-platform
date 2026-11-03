"use client";

import React, { useEffect, useState, type MouseEvent } from "react";
import { formatCount } from "@/engine/client-copy";

function keyWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "ключ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "ключа";
  return "ключей";
}

export function KeyList({ title, keys }: { title: string; keys: string[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyReady, setCopyReady] = useState(false);

  useEffect(() => {
    setCopyReady(typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function");
  }, []);

  if (keys.length === 0) {
    return (
      <p>
        <strong>{title}.</strong> Список пуст.
      </p>
    );
  }

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(keys.join(", "));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyReady(false);
    }
  }

  return (
    <details
      className="key-list"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span>
          <strong>{title}.</strong> {formatCount(keys.length)} {keyWord(keys.length)}
        </span>
        <span className="key-actions">
          <span className="text-btn">{open ? "скрыть" : "показать"}</span>
          {copyReady ? (
            <button type="button" className={copied ? "text-btn copied" : "text-btn"} aria-live="polite" onClick={copy}>
              {copied ? "✓ Скопировано" : "скопировать"}
            </button>
          ) : null}
        </span>
      </summary>
      {open ? <pre>{keys.join(", ")}</pre> : null}
    </details>
  );
}
