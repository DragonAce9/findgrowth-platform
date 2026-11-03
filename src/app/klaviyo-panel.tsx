import React from "react";
import { audienceGapNotice, formatCount, formatMoney } from "@/engine/client-copy";
import type { BriefAudience, BrandKeyKind } from "@/engine/brand-key";
import { klaviyoSteps, mondayStep, moveBans, type KlaviyoStep } from "@/engine/klaviyo";
import type { Pocket } from "@/engine/pipeline";
import { DataNotice } from "./data-notice";
import { CYCLE_GLOSS, Gloss } from "./glossary";
import { KeyList } from "./key-list";
import { withCodes } from "./term";

export function KlaviyoPanel({
  pockets,
  cycleDays,
  letters,
  pair,
  stageLabels,
  formulation,
  constraint,
  positioning,
  currency,
  layout = "all",
  cycle,
  audience,
  power,
  keyKind = "customer_id",
  listsHref,
}: {
  pockets: Pocket[];
  cycleDays: number;
  letters: boolean;
  letterReason?: string;
  pair: { leftName: string; rightName: string; n: number } | null;
  stageLabels?: Record<string, string>;
  formulation?: string;
  constraint?: string;
  positioning?: string;
  currency?: string;
  layout?: "all" | "monday" | "spec";
  cycle?: { low: number; high: number; hazardPeak: number | null };
  audience?: BriefAudience;
  power?: React.ReactNode;
  keyKind?: BrandKeyKind;
  listsHref?: string;
}) {
  const steps = klaviyoSteps({
    pockets,
    cycleDays,
    letters,
    pair,
    stageLabels,
    formulation,
    constraint,
    positioning,
    cycle,
  });
  if (!steps.length) return null;
  const featured = layout === "all" ? undefined : mondayStep(steps, letters);
  const bans = moveBans({ letters, featured, steps, formulation, constraint, positioning });

  const showLists = letters && featured?.kind !== "site";

  if (layout === "monday" && featured) {
    const writeN = audience?.treatment.length ?? 0;
    const holdN = audience?.control.length ?? 0;
    return (
      <>
        <MondayCard step={featured} currency={currency} letters={letters} audience={audience} />
        {showLists && audience?.covered ? (
          <p className="lede">
            <a href={listsHref ?? "/spec"}>
              {formatCount(writeN)} ключей кому писать и {formatCount(holdN)} кому не писать — в ТЗ
            </a>
          </p>
        ) : null}
        {power}
      </>
    );
  }

  if (layout === "spec" && featured) {
    return (
      <>
        <section className="section">
          <h2>Создать</h2>
          <p className="lede">Один контракт на неделю. Остальное — в запретах ниже.</p>
          <MondayCard step={featured} currency={currency} kicker="Контракт" draft letters={letters} audience={audience} />
          {power}
          {showLists ? <AudienceBlock audience={audience} confirm="" keyKind={keyKind} /> : null}
        </section>
        <section className="section bans">
          <h2>Не создавать</h2>
          <ul>
            {bans.map((ban) => (
              <li key={ban}>{ban}</li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  return (
    <section className="section">
      <h2>Klaviyo</h2>
      <p className="lede">
        {letters ? "Порядок: письмо одной покупки, затем сайт, затем второй список." : "Цепочку писем не включать: нет основания для письма."} Адреса не
        выгружаются.
      </p>
      <div className="klaviyo-grid">
        {steps.map((step) => (
          <StepCard key={step.id} step={step} currency={currency} />
        ))}
      </div>
      {letters ? <AudienceBlock audience={audience} confirm={steps.find((step) => step.confirm)?.confirm ?? ""} keyKind={keyKind} /> : null}
      <p className="source">
        {audience?.covered
          ? "Списки — идентификатор из вашей выгрузки. Адреса не выгружаются."
          : "Адреса не выгружаются. Без идентификатора из файла списков «кому» нет."}
      </p>
    </section>
  );
}

function AudienceBlock({
  audience,
  confirm,
  keyKind = "customer_id",
}: {
  audience?: BriefAudience;
  confirm: string;
  keyKind?: BrandKeyKind;
}) {
  if (!audience && !confirm) return null;
  return (
    <div className="note">
      {audience?.covered ? (
        <>
          <p>{withCodes(keyCaption(keyKind))}</p>
          <KeyList title="Кому писать" keys={audience.treatment} />
          <KeyList title="Кому не писать" keys={audience.control} />
          <p className="key-print-note">Список идентификаторов — на экране ТЗ, в печать не выводится.</p>
        </>
      ) : (
        <>
          <p>{audience?.note ?? "Кому недоступно: ключа бренда нет."}</p>
          <p>{withCodes("Идентификатор в файле — это customer_id или номер заказа order_id. Это не хеш и не почта.")}</p>
        </>
      )}
      {confirm ? (
        <p>
          <strong>Приёмка.</strong> {withCodes(confirm)}
        </p>
      ) : null}
    </div>
  );
}

function MondayCard({
  step,
  currency,
  kicker = "Ход 1 · понедельник",
  draft = false,
  letters = false,
  audience,
}: {
  step: KlaviyoStep;
  currency?: string;
  kicker?: string;
  draft?: boolean;
  letters?: boolean;
  audience?: BriefAudience;
}) {
  const money = step.revenue > 0 ? formatMoney(step.revenue, currency) : null;
  const treatment = audience?.treatment.length ?? 0;
  const control = audience?.control.length ?? 0;
  const showLine = letters && step.kind === "flow";
  const gap = showLine && treatment + control < step.size ? audienceGapNotice(treatment + control, step.size) : null;
  return (
    <article className="monday">
      <span className={step.send || step.kind === "site" ? "pri on" : "pri"}>{kicker}</span>
      <h2>
        {step.kind === "site" ? `${step.name}: править сайт` : step.send ? `Письмо: ${step.name}` : `Не включать: ${step.name}`}
      </h2>
      <p className="claim">
        {formatCount(step.size)} человек
        {money ? `. ${money} уже получены, это не ставка письма` : ". Денег от этих людей ещё нет"}. {withCodes(step.who)}
      </p>
      {showLine ? (
        <p className="lede">
          {formatCount(step.size)} человек в сегменте · письмо получают {formatCount(treatment)} · без письма остаются {formatCount(control)}
        </p>
      ) : null}
      {gap ? <DataNotice seen={gap.seen} why={gap.why} means={gap.means} /> : null}
      <dl>
        {step.product ? (
          <div>
            <dt>Товар</dt>
            <dd>{step.product}</dd>
          </div>
        ) : null}
        <div>
          <dt>Почему</dt>
          <dd>
            {step.kind === "site"
              ? "Самый большой обрыв сайта. Это не письмо: правится карточка товара."
              : money
                ? <>Молчат дольше <Gloss title={CYCLE_GLOSS}>цикла</Gloss>. {money} уже получены, это не прогноз.</>
                : <>Молчат дольше <Gloss title={CYCLE_GLOSS}>цикла</Gloss>.</>}
          </dd>
        </div>
        {draft ? (
          <div>
            <dt>Когда</dt>
            <dd>{step.when}</dd>
          </div>
        ) : null}
        {draft && step.subject ? (
          <div>
            <dt>Тема</dt>
            <dd>{step.subject}</dd>
          </div>
        ) : null}
        {draft && step.body ? (
          <div>
            <dt>Текст</dt>
            <dd>{step.body}</dd>
          </div>
        ) : null}
        <div>
          <dt>{draft ? "Приёмка" : "30 и 60 дней"}</dt>
          <dd>{draft && step.watch.startsWith("Новый заказ") ? "Новый заказ" : step.watch}</dd>
        </div>
      </dl>
    </article>
  );
}

function StepCard({ step, currency }: { step: KlaviyoStep; currency?: string }) {
  const money = step.revenue > 0 ? formatMoney(step.revenue, currency) : null;
  return (
    <article className="klaviyo-card">
      <header>
        <span className={step.send ? "pri on" : "pri"}>{step.kind === "site" ? "Сайт" : step.send ? "Включить" : "Не включать"}</span>
        <h3>
          {step.name}
          <small>
            {formatCount(step.size)}
            {money ? ` · ${money}` : ""}
          </small>
        </h3>
      </header>
      <dl>
        <div>
          <dt>Кто</dt>
          <dd>{withCodes(step.who)}</dd>
        </div>
        <div>
          <dt>Когда</dt>
          <dd>{step.when}</dd>
        </div>
        {step.product ? (
          <div>
            <dt>Товар</dt>
            <dd>{step.product}</dd>
          </div>
        ) : null}
        {step.subject ? (
          <div>
            <dt>Тема</dt>
            <dd>{step.subject}</dd>
          </div>
        ) : null}
        {step.body ? (
          <div>
            <dt>Текст</dt>
            <dd>{step.body}</dd>
          </div>
        ) : null}
        <div>
          <dt>Приёмка</dt>
          <dd>
            {step.watch}
            {step.confirm ? <> {withCodes(step.confirm)}</> : ""}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function keyCaption(kind: BrandKeyKind): string {
  if (kind === "order_id") {
    return "Кому писать и кому не писать — номер заказа order_id из вашей выгрузки. Его сверяете со своей базой сами. Это не хеш и не почта.";
  }
  return "Кому писать и кому не писать — идентификатор покупателя customer_id из вашей выгрузки. Его сверяете со своей базой сами. Это не хеш и не почта.";
}
