export function channelGroup(source?: string, medium?: string): string {
  const s = (source ?? "").toLowerCase();
  const m = (medium ?? "").toLowerCase();
  if (!s && !m) return "direct";
  if (m === "cpc" || m === "paid" || m === "ppc") {
    if (s.includes("instagram") || s === "ig") return "instagram";
    if (s.includes("facebook") || s.includes("meta") || s === "fb") return "paid_social";
    if (s.includes("google") || s === "bing") return "paid_search";
    return "paid_other";
  }
  if (s.includes("instagram") || s === "ig") return "instagram";
  if (m === "organic" || m === "seo") return "organic";
  if (m === "email") return "email";
  if (m === "referral") return "referral";
  if (m === "social") return "organic_social";
  return s || "direct";
}

const FORBIDDEN_STABLE_COLUMNS = new Set([
  "email",
  "customer_id",
  "customer_email",
  "user_email",
  "phone",
  "tel",
  "telephone",
  "name",
  "full_name",
  "first_name",
  "last_name",
  "passport",
]);

export function assertStableIdColumn(column: string): void {
  if (FORBIDDEN_STABLE_COLUMNS.has(column.trim().toLowerCase())) {
    throw new Error(
      `Колонка ${column} не может быть идентификатором визита. Адрес, телефон, имя и customer_id только связывают заказ с визитом и в отчёт не попадают.`,
    );
  }
}
