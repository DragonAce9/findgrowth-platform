import { createHash } from "node:crypto";
import { z } from "zod";
import { armSalt } from "./hash";
import { assertSessionScoringAllowed } from "./scoring-gate";

/**
 * Contract for a future onsite snippet. This module does not render a block,
 * call a site, or store anyone. assertSessionScoringAllowed stays the gate.
 */
export const ONSITE_EVENTS = ["view", "view_pdp", "offer_shown", "offer_click", "add_to_cart", "purchase"] as const;

export const onsiteEventSchema = z.object({
  event_name: z.enum(ONSITE_EVENTS),
  timestamp: z.string().min(1),
  session_id: z.string().min(1),
  anonymous_id: z.string().min(1),
  consent: z.boolean(),
  product_id: z.string().optional(),
  offer_id: z.string().optional(),
});

export const onsiteOfferSchema = z.object({
  offer_id: z.string().min(1),
  variant_id: z.string().min(1),
  product_id: z.string().min(1),
  title: z.string().min(1),
});

export type OnsiteEvent = z.infer<typeof onsiteEventSchema>;
export type OnsiteOffer = z.infer<typeof onsiteOfferSchema>;

export interface OnsiteAssignment {
  showOffer: boolean;
  arm: "treatment" | "control" | null;
  /** Kept only when consent is true. Otherwise the id is not stored across sessions. */
  storedAnonymousId: string | null;
  reason: string;
}

/** Lower half of the hash does not see the block. Deterministic, not a connector. */
export function onsiteArm(anonymousId: string, snapshotId: string, salt = armSalt()): "treatment" | "control" {
  const hex = createHash("sha256").update(`${anonymousId}|${snapshotId}|${salt}`).digest("hex");
  const bucket = Number.parseInt(hex.slice(0, 8), 16);
  return bucket < 0x80000000 ? "control" : "treatment";
}

export function assignOnsite(event: unknown, snapshotId: string, salt = armSalt()): OnsiteAssignment {
  const parsed = onsiteEventSchema.parse(event);
  if (!parsed.consent) {
    return {
      showOffer: false,
      arm: null,
      storedAnonymousId: null,
      reason: "Без согласия anonymous_id между сессиями не хранится. Блок не показывается.",
    };
  }
  assertSessionScoringAllowed({ advertisingConsent: true });
  const arm = onsiteArm(parsed.anonymous_id, snapshotId, salt);
  return {
    showOffer: arm === "treatment",
    arm,
    storedAnonymousId: parsed.anonymous_id,
    reason: arm === "control" ? "Группа без блока." : "Группа видит оффер.",
  };
}

export function parseOnsiteOffer(value: unknown): OnsiteOffer {
  return onsiteOfferSchema.parse(value);
}
