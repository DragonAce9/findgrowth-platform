import React from "react";
import type { PilotChecklist as Pilot } from "@/engine/pilot";
import { withCodes } from "./term";

const BRING: Record<string, string> = {
  buyers: "покупателей",
  repeats: "повторные покупки",
  "nonbuyer-email": "почту у непокупателей",
  windows: "полный период",
  "customer-id": "выгрузку Klaviyo",
};

const REQUIRED = ["buyers", "repeats", "nonbuyer-email", "windows", "customer-id"];

/** File readiness from counters already on the recognition object. */
export function PilotChecklist({ pilot }: { pilot: Pilot | null | undefined }) {
  if (!pilot) return null;
  const required = pilot.items.filter((item) => REQUIRED.includes(item.id));
  const metRequired = required.filter((item) => item.met).length;
  const ready = metRequired === required.length && required.length > 0;
  const missing = required.filter((item) => !item.met).map((item) => BRING[item.id]).filter(Boolean);
  return (
    <article className="wanted-card pilot">
      <div className="pilot-head">
        <h3>
          Готовность файла пилота: {pilot.items.filter((item) => item.met).length} из {pilot.items.length}
        </h3>
        <span className={ready ? "status ok" : "status bad"} role="status">
          {ready ? "✓ Готов" : "✕ Не готов"}
        </span>
      </div>
      <p className="lede">{ready ? "Файл годится для пилота." : `Что донести: ${missing.join(", ")}.`}</p>
      <p className="purpose">Галочки только из счётчиков файла.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Проверка</th>
            <th scope="col">В файле</th>
          </tr>
        </thead>
        <tbody>
          {pilot.items.map((item) => {
            const optional = item.id === "sends";
            return (
              <tr key={item.id}>
                <td>
                  <span
                    className={item.met ? "mark ok" : optional ? "mark mute" : "mark no"}
                    aria-label={item.met ? "выполнено" : "не выполнено"}
                  >
                    {item.met ? "✓" : "✗"}
                  </span>{" "}
                  {item.id === "customer-id" ? withCodes(item.label) : item.label}
                </td>
                <td>{item.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}
