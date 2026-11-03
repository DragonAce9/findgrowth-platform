# Требования к фронту FindGrowth: честная поверхность данных

Дата: 9 октября 2026. Статус: **требования и бэклог, код не менялся.**
Источник: `docs/ux-review-data-surface.md` (UX-аудит того же дня). Всё, на что опирается этот документ, проверено по коду; имена функций, типов и пути указаны так, чтобы задачу мог взять разработчик без контекста.

Бэклог с теми же идентификаторами задач (F0.1 … F6.4): канвас `findgrowth-front-backlog` в папке канвасов проекта. Идентификаторы в документе и в канвасе совпадают. Полный плоский список задач, включая эпики F7 (токены) и F8 (решения владельца) и задачи, добавленные по дизайн-спецификации, — `docs/frontend-tasks.md`. Дизайн-спецификация — `docs/ux-design-spec.md`; принятые решения по её расхождениям с этим документом — раздел 9.

Стек: Next 15 App Router, React 19, TypeScript, server actions. Экраны — серверные компоненты в `src/app/`, движок — `src/engine/`. UI на русском, код на английском. Тесты: `npm test` = `tsx --test src/engine/*.test.ts` (`package.json`).

---

## 1. Цель и принципы

Фронт показывает то, что посчитал движок, и ровно с той уверенностью, с какой он это посчитал. Семь правил, которые не обсуждаются в задачах:

1. **Интервал всегда рядом с долей.** Нет точки без интервала: ни в прозе, ни на графике. Где интервала посчитать нельзя — состояние «мало данных», не голое число. Источник интервалов — `wilsonInterval`, `diffProportions`, `bootstrapMean` (`src/engine/stats.ts`), Гринвуд в `kaplanMeier` (`src/engine/survival.ts`).
2. **Слово «эффект» — только при `status === "confirmed"`.** Это уже правило `liftParagraph` (`src/engine/holdout.ts:242–272`): состояние 1 «Измеренный эффект», состояние 2 «Наблюдаемая разница между группами», состояние 3 «Холдаут нарушен» с `showNumbers: false`. Фронт делает это правило видимым (плашка статуса), а не только текстовым.
3. **Один паттерн «достаточно / мало / скрыто».** Движок уже отдаёт `evidenceState(n, rule)` → `{ level: "enough" | "thin" | "hidden"; reason }` с правилами `people | lookalike | experiment | support | cycle` (`src/engine/stats.ts:467–486`). Экран сейчас использует его только для устройств. Требование: один компонент на все доли, группы, пары, тесты и цикл; пороги остаются у правила, слова общие.
4. **Никаких цифр в прозе карточек проблем и ведра.** Голден-тест `src/engine/golden.test.ts:530` (`assert.doesNotMatch(card.problem, /\d/)`) и фильтр `!/\d/.test(item)` в `renderModelCard` (`src/engine/registry.ts:152`). Новые текстовые блоки — «Ведро», «Что донести» — под тем же тестом.
5. **Русский копирайт, никакого английского на экране.** Имя столбца или объекта (`received_email`, `Placed Order`) допускается только в `<code>` с русской подписью рядом. Словарь — раздел 2.2.
6. **Никаких новых UI-библиотек.** Все макеты собираются из `src/app/globals.css` и рукописного SVG в `src/app/week-charts.tsx` (`plotFrame`, `PlotGrid`, `W = 880`, `H = 360`, `PAD`). Единственные новые компоненты — на этих же примитивах.
7. **Фронт не маскирует дефекты данных, а вскрывает их.** Если движок даёт противоречивые числа, экран говорит об этом словами, а не выбирает одно из двух (раздел 5).

---

## 2. Общие требования

### 2.1 Форматирование чисел — один хелпер

Сейчас на одном экране живут четыре формата: `pct()` даёт «99.4 %» с пробелом (`client-copy.ts:489–491`), `ruBand()` даёт «50% (39.3%–60.7%)» без пробела и с точкой (`client-copy.ts:493–496`), `hitSentence` имеет свой локальный `pct` (`src/engine/insights.ts:103`), `diagnostic-pack.tsx:73–74` печатает «30.3–48.6» без знака процента, `metricText` в `registry.ts:131–136` сам заменяет точку на запятую, `formatAxis` в `week-charts.tsx:853–856` через `Intl.NumberFormat("ru-RU")`. На Неделе косметики «1250820 человек» (из `weekVerdict`, `client-copy.ts:437`, и `.kpi` `page.tsx:119`) стоит рядом с «1 250 820 не перешли» (`shownPeople().text`, `stats.ts:488–492`).

**Решение (зафиксировано):**

| Правило | Как |
|---|---|
| Разряды | `Intl.NumberFormat("ru-RU")` — неразрывный пробел между разрядами. Везде, включая `{step.size} человек` в `MondayCard` и `.kpi .lbl` |
| Десятичный разделитель | Запятая. Не более одного знака после запятой; целые — без дробной части. Вероятность (`probTreatmentGreater`) — тоже одна десятичная: «80,3 %» (согласовано, раздел 9 п. 2). Минус — типографский − (U+2212) |
| Процент | **Пробел перед знаком — неразрывный (U+00A0): «50 %»**. Один вариант на всю платформу; «50%» без пробела запрещён |
| Интервал | `50 % (39,3 %–60,7 %)` — короткое тире U+2013 между границами, пробел перед каждым % |
| Пункты процента | «+20 п.п., интервал от −20,6 до +52,8 п.п.» (`formatPp`) — только для разностей долей (`measureLift.diff`, `seasonal`); в прозе и `aria-label` одна форма. Короткое тире между знаковыми числами («−21–+53») не используется; на шкале `DiffScale` концы подписываются отдельными числами (согласовано, раздел 9 п. 1) |
| Валюта | **Всегда.** `formatMoney(value, currency)` при пустом `currency` даёт «55 у. е.», а строка доверия по-прежнему говорит «валюта в файле не указана». Голое «55 (49–61)» запрещено |
| Люди | `shownPeople(n).text` — «меньше 5» при 0 < n < 5, иначе число с разрядами |

Реализация: расширить `src/engine/client-copy.ts` (там уже `pct`, `ruBand`, `formatMoney`, `personRateBand`) функциями `formatPct(p)`, `formatBand(p, low, high)`, `formatPp(diff, low, high)`, `formatCount(n)`; `ruBand` и `pct` становятся обёртками над ними, чтобы существующие тесты не ломались. Локальные форматтеры (`insights.ts:103`, `registry.ts:131–136`, `diagnostic-pack.tsx:73–74`) удаляются. Голден-тест на формат — задача F6.1.

### 2.2 Словарь русских терминов

Один объект `RU_TERMS` рядом с `CHANNEL_RU` и `REASON_RU` в `client-copy.ts:28–44`, плюс маленький компонент `<Term code="received_email">письмо получено</Term>` → `<span>письмо получено <code>received_email</code></span>`.

| На экране сейчас | Где | Показывать |
|---|---|---|
| `mobile` / `desktop` / `tablet` | `diagnostic-pack.tsx:76` (`label: row.device`) | телефон / компьютер / планшет |
| `Placed Order = 1, старше 41 дн.` | `klaviyo.ts:135, 153` (`step.who`); `moveBans` `klaviyo.ts:40` | «Заказ оформлен (<code>Placed Order</code>) = 1, старше 41 дн.» |
| `received_email` | `confirmColumnText` `klaviyo.ts:68–70`; `CONFIRM_COLUMN` `holdout.ts:157` | «столбец <code>received_email</code> — письмо получено» |
| `control` | `powerBrief` `experiments.ts:152–157` «В control N человек» | «без письма N человек» (treatment — «письмо получают») |
| `flow` | `klaviyo.ts:48, 140`, `cut-lede.tsx:135`, `retention-diagnostic/page.tsx:110` «в этот flow» | «цепочка писем» (в скобках `<code>flow</code>` только в ТЗ, где это имя объекта Klaviyo) |
| `live` / `queue` | `catalog/page.tsx:63–67` легенда, `:78` «Очередь» | «в работе / в очереди» |
| Имена мер Каталога (`identity_coverage`, `orphan_revenue`, `repeat_rate`, …) | `catalog/page.tsx:72–76`, источник `methodology/mart-catalog.yaml` | русская подпись + `<code>identity_coverage</code>` под ней; карта `METRIC_RU` |
| `hero-cta` | `experiment_id` в `ExperimentChart` `week-charts.tsx:384` | как есть, в `<code>`: это имя теста в файле бренда |
| `контроль / вариант` | уже по-русски: `variantLabel` `week-charts.tsx:840–844` | не трогать |
| Blockers тестов на французском | `experiments.ts:82–84` → уже переводятся `blockerRu` `client-copy.ts:450–455` | не трогать; проверить, что `ExperimentChart` использует `decisionLabel`, а не сырой `blockers` |

### 2.3 Адаптивность

Брейкпойнт сейчас один — `@media (max-width: 860px)` (`globals.css:561`). Навигация ломается на ~897 px (все скриншоты аудита): «АККАУНТ» обрезан, «Срез 1 сентября 2026» наезжает на «Студия», «Каталог / Выйти» переносятся второй строкой. Причина — `.top` на `display: flex; height: 64px` с `white-space: nowrap` у `.project-name`, `.as-of`, `.tag` и `margin-left: auto` у `.top-foot` (`globals.css:34–116`).

Требование: второй брейкпойнт `@media (max-width: 1024px)`: `.top` — `height: auto; flex-wrap: wrap`, `.top-foot` — во всю ширину второй строкой, `text-align: left`, `.account-links` — в строку. Проверка на 897×1000 и 1280×900; печать Брифа не меняется. Дополнительно (согласовано, раздел 9 п. 10): на `≤ 860` — `.plot { min-width: 720px }` с горизонтальной прокруткой в `.plot-scroll` и подсказкой «График прокручивается вбок.»; `DiffScale` и `AccumulationScale` получают `width 640` и не прокручиваются; `StepChart small` сжимается до 100 %.

### 2.4 Доступность статусов

- Каждый цветной статус несёт слово: «Подтверждён / Не проверен / Нарушен», «Готов / Не готов», «мало данных». Цвет — дублирование, не носитель смысла. Бриф печатается (`PrintButton`, `@media print` `globals.css:574`), и в ч/б слово — единственное, что остаётся.
- SVG-графики уже имеют `role="img"` и `<title>`; новые компоненты (`StepChart`, `DiffScale`, `AccumulationScale`) обязаны иметь то же плюс `aria-label` с ключевыми числами.
- `.tag` в верхнем регистре с `letter-spacing: 0.04em` (`globals.css:74–86`) — оставить для коротких слов, не для фраз с причиной: причина идёт обычным текстом рядом.
- `textarea` добавить в правило `button, input, select { font: inherit }` (`globals.css:29`): поля «Граница бренда» на Студии сейчас моноширинные (скриншот 03).

### 2.5 Тестирование

Инфраструктура: `node:test` через `tsx` (`npm test`). Файлы `*.test.tsx` в `src/app` не подхватываются скриптом — его надо расширить до `src/**/*.test.{ts,tsx}` (F6.2). Для снапшотов компонентов достаточно `react-dom/server` `renderToStaticMarkup` — без `jsdom` и без новых зависимостей.

Три слоя:

1. **Голден-тесты копирайта** (`src/engine/golden.test.ts`): слово «эффект» только при `confirmed`; нет цифр в `ReasonCodes` и «Что донести»; формат чисел из 2.1; `sendWindowText` при `fromData === false` не печатает «день N–N».
2. **Статический рендер компонентов kit**: `HoldoutVerdict` в трёх состояниях, `DiffScale` рисует засечку на нуле, `EvidenceBadge` не рендерится при `enough`, `StepChart` рисует полигон полосы, `KeyList` по умолчанию свёрнут, `ColumnChart` с `band` рисует усы.
3. **Проверка в браузере** по протоколу раздела 8 на трёх срезах аудита: Atelier `asOf 2026-09-01`, «Второй срез» `asOf 2027-01-15` (run `c_0e9cd67dd71702d3f9febe4e`), Магазин косметики `asOf 2020-02-29`.

---

## 3. Компоненты kit: новые и расширяемые

Все компоненты — серверные (без `"use client"`), кроме `KeyList` (кнопка «скопировать»). Стили — классы `globals.css`, графики — на `plotFrame`/`PlotGrid` из `week-charts.tsx`. Файлы: один компонент — один файл в `src/app/` (`holdout-verdict.tsx`, `evidence.tsx`, `key-list.tsx`, …), графики — внутри `week-charts.tsx`.

### 3.1 `HoldoutVerdict` — статус холдаута (F2.1)

```ts
props: {
  status: HoldoutState;               // "confirmed" | "unchecked" | "violated" — src/engine/holdout.ts:153
  interim: boolean;                   // MeasuredLift.interim
  contamination: number | null;       // HoldoutRecord.contamination; лимит CONTAMINATION_LIMIT = 0.2 (holdout.ts:156)
  compliance: number | null;
  onReceived: number | null;          // ITT / c, второе число, не замена ITT
  diff: { diff: number; low: number; high: number } | null;  // MeasuredLift
  probTreatmentGreater: number;
  treatmentN: number; controlN: number;
  reason?: string;                    // почему «не проверен»: «нет столбца received_email»
}
```

| `status` | Класс | Плашка | Заголовок (из `liftParagraph().title`) | Тело |
|---|---|---|---|---|
| `confirmed` | блок `.verdict.ok` (sage) + чип `.status.ok` | «✓ Подтверждён» | «Измеренный эффект» (+ « · промежуточный» при `interim`) | `liftParagraph().body`; строка «Заражение контроля: X % из допустимых 20 %»; при `onReceived` — «Второе число, оценка на получивших: …» |
| `unchecked` | **новый** блок `.verdict.wait` на `--gold-soft` + чип `.status.wait` | «○ Не проверен» | «Наблюдаемая разница между группами» | числа есть, слова «эффект» нет; «Почему: в срезе нет столбца <code>received_email</code>»; «Заражение контроля: не измерено» |
| `violated` | **новый** блок `.verdict.bad` на новом токене `--danger-soft` + чип `.status.bad` | «✕ Нарушен» | «Холдаут нарушен» | `showNumbers: false`; причина словами: «контроль получил письмо чаще, чем в 20 % случаев» (`contamination > CONTAMINATION_LIMIT`) или «группы назначены не случайно» (`deviation === "selective"`) |

Почему новые классы, а не `.verdict.no`: `.verdict.no` в коде — это `--gold-soft`, не danger (`globals.css:197`), и он уже занят под «Письмо нельзя» на Брифе. Его не трогаем. Разделение блока и чипа (согласовано, раздел 9 п. 3): `.verdict.*` — только карточка; слово статуса с маркером — чип `.status.ok / .wait / .bad` 12 px, цвет слова — чернильные токены `--sage-ink / --gold-ink / --danger-ink` (`ux-design-spec.md` §2.2–2.3, §10).

Под заголовком всегда строка «Письмо получают T, без письма остаются C» (через `shownPeople`), затем `DiffScale`, затем тело. Используется на Неделе (`page.tsx:190–230`, заменяет `.section` с `<h2>` из `liftParagraph`) и на Брифе (`retention-diagnostic/page.tsx:113–130`, где сейчас всё это стоит одним `<p className="source">`).

### 3.2 `DiffScale` — мини-шкала разницы (F2.2)

```ts
props: { diff: number; low: number; high: number; unit?: "п.п."; height?: number /* 72 */; width?: number /* W; 640 на ≤ 860 */ }
```

Горизонтальная ось от `min(low, 0)` до `max(high, 0)` с запасом; серая полоса `low–high`, точка на `diff`, вертикальная засечка на нуле (как пунктир на 50 в `ExperimentChart`, `week-charts.tsx:351`). Подписи концов — отдельными числами, подпись точки — `formatPp`. Если `low < 0 < high` — подпись «Интервал задевает ноль: разница могла быть и в другую сторону». SVG с `role="img"` и `aria-label="Разница повтора +20 п.п., интервал от −20,6 до +52,8 п.п., задевает ноль"`. Ширина — `W`, высота — **72** единицы viewBox (согласовано, раздел 9 п. 4: два ряда подписей и вынос засечки нуля), не `H`: нужен `plotFrame`-подобный хелпер с параметром высоты. Детали анатомии и состояний — `ux-design-spec.md` §3.2.

### 3.3 `EvidenceBadge` и паттерн «достаточно / мало / скрыто» (F2.3)

```ts
EvidenceBadge({ level, reason }: ReturnType<typeof evidenceState>)  // null при "enough"
HiddenStub({ reason }: { reason: string })                           // серая заглушка вместо столбца
```

| Уровень | Вид | Текст |
|---|---|---|
| `enough` | ничего | — |
| `thin` | `.tag.thin` на `--gold-soft` в `.proof-kicker` графика | «◐ мало данных» + причина из `evidenceState` обычным текстом: «в варианте меньше пятидесяти» |
| `hidden` | столбца нет; на его месте штрихованный прямоугольник **высотой 18 единиц** у основания (паттерн `hatch`; согласовано, раздел 9 п. 11) и подпись; в карточках — нейтральный чип `.tag.hidden` «▧ скрыто» на `--paper-2` (раздел 9 п. 8) | причина: «меньше пяти человек» / «пара не показывается» / «цикла нет» |

Графики получают необязательный проп `evidence?: { level; reason }` на столбец (`ChartColumn`, `StackColumn`, `ChartGroup.bars[i]` в `week-charts.tsx:473–478, 615–619, 742–745`). Под всеми графиками Разбора — одна строка: «Порог для каждого графика — в его подписи. Правила — одни на платформу». Разрозненные фразы («меньше 5 человек», «меньше 30 человек на экран не попадает» `diagnostic-pack.tsx:103`, «меньше 200 человек» `recognition-panel.tsx:79`, «от 50 человек» `page.tsx:252`) заменяются на бейдж и причину.

Правила по экранам: устройства — `lookalike`; каналы, первый товар, когорты, воронка, письма — `people`; пары — `support`; тесты — `experiment`; цикл — `cycle`.

### 3.4 `StepChart` — кривая Каплана–Майера (F3.2)

```ts
props: {
  curve: SurvivalPoint[];            // src/engine/survival.ts:1–10: time, survival, low, high, hazard
  median: number | null; q25: number | null; hazardPeak: number | null;
  window: { low: number; high: number; fromData: boolean };   // ObservedCycle, pipeline.ts:453–459
  prior: { low: number; high: number };                        // config.replenishmentLow/High
  n: number;                                                   // fit.events
  size?: "full" | "small";                                     // 360 с сеткой / 160, сетка — только линии 0 % и 50 % (Бриф; согласовано, раздел 9 п. 5)
}
```

Рисует: ступенчатую линию `survival` (ось Y «Доля без второй покупки», 0–100 %), полигон Гринвуда `low–high` полупрозрачным `--sage-soft`, пунктир медианы (`--rose`, как линия цикла в `RecencyChart`), маркер ▲ на `hazardPeak` с подписью «пик хазарда, день N», заливку окна отправки `[window.low, window.high]`. Ось X — дни, тики кратны 30.

Копирайт в подписи:
- `fromData === true`: «N пар. Полоса — где кривая может лежать на самом деле. Окно отправки: день L–R».
- `fromData === false`: «Своей медианы ещё нет: кривая не опустилась до половины. Окно — день L–R из приора категории». Окно нулевой ширины «день 96–96» не рисуется и не пишется (раздел 5.2).
- `evidenceState(n, "cycle").level === "thin"` (n < 8, `CYCLE_PRIOR = 8` `pipeline.ts:462`): бейдж «мало данных: усадка к приору категории».
- `hazardPeak` вне `[low, high]`: «Пик хазарда — день P, за пределами окна: окно сжато к приору».

Данные: `observedCycle` (`pipeline.ts:464–496`) сейчас отдаёт только `{ low, high, n, fromData, hazardPeak }` и не возвращает кривую. Движок должен добавить в `ObservedCycle` поля `curve`, `median`, `q25` (или экспортировать функцию `cycleObservations(entities, asOf)` → `SurvivalObservation[]`, чтобы экран сам звал `kaplanMeier`). Это задача «оба».

### 3.5 Проп `band` для `ColumnChart` / `StackedChart` / `GroupedChart` (F3.1)

```ts
ChartColumn { ...; band?: [number, number] }      // в единицах оси (для unit="%" — проценты 0–100)
StackColumn { ...; band?: [number, number] }      // усы на верхушке стека
ChartGroup.bars[i] { ...; band?: [number, number] }
```

Усы: вертикальная линия от `band[0]` до `band[1]` через центр столбца, короткие горизонтальные засечки на концах, цвет `--ink`, `strokeWidth 1.25`; `frame = plotFrame(peak, include = max(band[1]))`, чтобы верхний ус не вылезал за ось. Подпись над столбцом не двигается. В легенде добавляется `{ swatch: "", wide: true, text: "Усы — интервал Уилсона. Если усы перекрываются, разницы не видно." }` (или «интервал бутстрепа» для LTV).

Где применить: «Прошлый список» (`insights-panel.tsx:179–200` — `hitRateLow/High`, `hitRatePopularLow/High`, `hitRateRandomLow/High` уже прокинуты в пропсы), устройства (`segmentReads().low/high`), каналы и первый товар (`wilsonInterval(successes, n)` там, где сейчас только `personRateBand` в подписи), «Письма в файле», AARRR, бренды в корзине (`recognition-panel.tsx:60–76`).

### 3.6 `AccumulationScale` — Beta-Beta между срезами (F3.3)

```ts
props: {
  prob: number;                                   // betaBetaGreater по накопленному постериору
  decision: "scale" | "stop" | "continue";        // moveDecision(prob) — stats.ts:455–459
  thresholds: typeof MOVE_THRESHOLDS;             // { scaleAt: 0.9, stopAt: 0.1 } — stats.ts:423
  slices: number;                                 // сколько срезов накоплено
  moveName: string;                               // «Одна покупка»
}
```

Горизонтальная шкала 0–1 высотой ~60 px: три зоны с подписями «остановить | продолжать | масштабировать» (из `MOVE_DECISION_RU`, `stats.ts:461–465`), засечки на 0,1 и 0,9, точка на `prob`. Подпись: «Накоплено по ходу «{moveName}» за {slices} среза. Вероятность, что письмо даёт повтор чаще: {prob}. Решение: {MOVE_DECISION_RU[decision]}». При `slices === 1`: «Первый срез: это только накопление в приор, не решение».

Данные: `accumulateMove(prior, obs)` и `moveDecision` (`stats.ts:425–459`) **не импортируются ни одним файлом вне `stats.ts` и тестов** (проверено `rg` по `src`). `MovePosterior` нигде не хранится между срезами. Движок должен: считать `accumulateMove` в `buildWorkspace` по `measuredLift.{treatmentHits, treatmentN, controlHits, controlN}` с приором из предыдущего среза того же `brandId` и `moveId`, сохранять его в `cuts` и отдавать в `Workspace` поле `movePosterior`. До этого фронт показывает шкалу по постериору одного среза с подписью «первый срез». Это DOR для движка.

### 3.7 `ModelCard` в два слоя (F4.1, F4.2)

Данные: таблица `models` (`src/engine/platform-db.ts:234–270`, `latestModelForProject`), тип `StoredModelCard` (`registry.ts:115–122`): `version`, `status: "shadow" | "challenger" | "champion"`, `metrics` (`pr_auc`, `brier`, `lift_at_20`, `baseline_*` — каждая `{ value, low, high }`), `card` — JSON из `ml/findgrowth_ml/propensity.py` с полями `calibration: [{ bin, predicted, observed }] × 5`, `reason_codes: string[]`, `synthetic: true`, `mode: "shadow"`, `psi?`. Решение чемпиона — `decideChampion()` (`registry.ts:17–44`), поле `audit` на английском; PSI — `populationStabilityIndex`, `psiWarning` (порог `PSI_WARN = 0.25`). `decideChampion` и `populationStabilityIndex` вне тестов не вызываются — для карточки оператора движок должен записывать `audit` и `psi` в `card_json` при `insertModel`.

**Оператору (Каталог)** — один `.proof`:
- `.proof-kicker`: «Модель v{version}» + чип статуса (`STATUS_RU` в `registry.ts:124`): «тень» — нейтральный `.tag.hidden` «○ тень», «претендент» — `.tag` (gold), «чемпион» — `.status.ok` «✓ чемпион» (согласовано, раздел 9 п. 12).
- `.kpis` × 2: «PR-AUC 0,41 (0,36–0,47)», «Brier 0,19 (0,17–0,21)» — `formatBand` без знака %.
- `GroupedChart` «Калибровка: предсказано и наблюдаемое по пяти бинам», две серии (`predicted`, `observed`), ось «Доля повтора», легенда с подписью «диагональ — идеально».
- строка «PSI 0,08 · порог 0,25» и `psiWarning()` жёлтым (`.note.warn`) при превышении.
- строка решения: «Чемпион v2 остаётся: претендент не лучше по PR-AUC» — русская версия `audit` (карта по `status`/`killed`, не парсинг английской строки).
- при `card.synthetic === true`: «Синтетическая модель: это не факт на экране».
- без строки в `models` — как сейчас: «Карточки модели для этого проекта нет» (`renderModelCard(null)`), ничего не выдумывать.

**Бренду (Бриф, приложение)** — один `.proof`: «Модель подсказывает товар · в тени». Фраза из `scoringActivation(config)` (`src/engine/scoring-gate.ts:6–9`): при `shadow` — «Предложение и группа письма от неё не меняются, пока оператор не записал уведомление о профилировании». Ниже `ReasonCodes`. Никаких метрик и никакого скора.

### 3.8 `PowerNote` — калькулятор мощности (F2.4)

```ts
props: { controlN: number; repeatBand: { p: number; low: number; high: number }; effectPp: 5 }
```

Считает `need = nControlForEffect(repeatBand.p, effectPp)` (`experiments.ts:143–150`) и рендерит `.kpis` из трёх `.kpi`: «{controlN} · без письма в этом срезе» / «{need} · нужно, чтобы увидеть 5 п.п.» / «накопление в приор · решения этот срез не даст» (при `controlN < need`) или «решение возможно · мощность 0,8 достигнута». Подпись: «При доле повтора {formatBand}. Число «нужно» считается от наблюдаемой доли, α = 0,05, мощность 0,8». Полоса прогресса не нужна. Заменяет строку `powerBrief()` (`experiments.ts:152–157`), которая сейчас стоит на Неделе (`page.tsx:137`) и дважды на ТЗ (`spec/page.tsx:72–77` и `:83`). Не показывается, когда письмо нельзя или ход — сайт (раздел 5.3).

### 3.9 `PilotChecklist` (F4.5)

Данные: `recognition.pilot` (`src/engine/recognize.ts:45`, `:328`) типа `PilotChecklist` (`src/engine/pilot.ts:10–19`): `items: PilotCheck[]` с `id`, `label`, `met`, `detail`; шесть пунктов, последний (`sends`) помечен «Желательно». Сейчас — шесть абзацев «Да. / Нет.» в `.note` (`recognition-panel.tsx:23–34`).

Рендер в `.wanted-card`: заголовок «Готовность файла пилота: K из 6» + чип `.status.ok` «✓ Готов» / `.status.bad` «✕ Не готов» (готов — когда все пять обязательных `met`; чип, а не блок `.verdict` — согласовано, раздел 9 п. 3); таблица строк «✓/✗ · label · detail»; футер «Галочки только из счётчиков файла. Что донести: {labels невыполненных обязательных, строчными, через запятую}». «Что донести» — без цифр (голден-тест).

### 3.10 `ReasonCodes` — ведро словами (F4.3)

```ts
props: { bucket: SnapshotBucket | null; reasons: string[] }
```

«Ведро: {давно не покупал, первый товар — крем, канал — почта}» — слова из `reasonCodes()` (`src/engine/reasons.ts:14–29`, словарь `PHRASES`) или из `card.reason_codes`; фильтр `/\d/` как в `renderModelCard`. `bucket` словами: top — «скорее вернётся», middle — «неясно», bottom — «скорее нет» — только как подпись, без числа `score`. Используется в «Один покупатель» на Студии (`studio/page.tsx:235–239`: сейчас `{params.sku}. {reasonLabel(...)}`) и в Брифе-приложении рядом с `ModelCard` бренду.

Данные: `playgroundRecommend` (`pipeline.ts:675–684`) возвращает только `Recommendation`; `SnapshotLine.bucket` (`types.ts:133–145`) есть в снимке, но reason codes на уровне покупателя движок не отдаёт. Движок должен вернуть `{ recommendation, bucket, reasons }`. DOR.

### 3.11 `CohortLtvTable` (F4.4, закрывает дефект F0.8)

Данные: `unitEconomics().cohorts: CohortLtv[]` (`src/engine/unit-econ.ts:54–60`, расчёт `cohortHorizons` `:261–270`): три горизонта `90 | 180 | 365`, `n`, `ltv`, `low`, `high` (бутстреп по людям, 300 реплик). Сейчас `unit-panel.tsx:68–79` фильтрует `row.n > 0` — поэтому 365 исчезает без причины (скриншот 03c).

Рендер: `.unit-grid` из трёх `.unit-card` всегда (горизонты фиксированы), каждая — `.unit-src.file` «Файл», `.val` `formatMoney(ltv)`, строка `formatMoney(low)–formatMoney(high)` отдельной строкой (не в скобках), «людей {shownPeople(n).text}», и `EvidenceBadge(evidenceState(n, "people"))`. При `n === 0` — состояние «скрыто» с причиной «ни один покупатель не прожил {horizon} дней». По правилу `people` (`enoughAt 5`, `stats.ts:471`) когорта из 20 человек — `enough`, чипа «мало данных» у неё нет (согласовано, раздел 9 п. 6; критерий F4.4 исправлен; отдельное правило для когорт — вопрос владельцу, F8.2). Подпись под сеткой: «Уже заплаченное внутри горизонта, только у тех, кто горизонт прожил. Не ARPU ÷ отток. Интервал — бутстреп по людям». Валюта — по правилу 2.1 («у. е.», если не указана).

### 3.12 `KeyList` — списки «Кому / Кому не» (F0.4)

```ts
"use client"
props: { title: "Кому" | "Кому не"; keys: string[] }
```

По умолчанию свёрнут: «**Кому.** 284 ключа · показать · скопировать». `<details>` раскрывает список; «скопировать» — `navigator.clipboard.writeText(keys.join(", "))` с подтверждением «Скопировано» на две секунды. Никогда не рендерит стену: при раскрытии — `max-height` с прокруткой. Заменяет `audience.treatment.join(", ")` в `AudienceBlock` (`klaviyo-panel.tsx:111–133`).

**Не показывается вовсе**, если ход — сайт или письмо запрещено (`featured.kind === "site"` или `privacy.letters === false`) — раздел 5.3. Ключи — только ключ бренда (`customer_id` / `order_id`, `src/engine/brand-key.ts`), HMAC и адреса сюда не попадают (`assertBrandKeyLink`).

---

## 4. Требования по экранам

Условные обозначения состояний: **E** — enough (обычный вид), **T** — thin (бейдж «мало данных» + причина), **H** — hidden (заглушка с причиной).

### 4.1 Неделя / Итог — `src/app/page.tsx`

| Блок | Данные движка | Компонент | Копирайт | Мало данных |
|---|---|---|---|---|
| Строка доверия `.trust` | `revenueShareLine`, `privacyVerdict` | как есть | формат 2.1: «99,4 % выручки … По числу заказов: 99,2 % (…)» одним форматом | — |
| `.kpis` «Одна покупка / Повтор / Обрыв сайта» | `queryDiagnostic` → `Pocket.size/revenue` (`pipeline.ts:575–625`) | как есть, третья карточка — F5.2 | «Обрыв сайта»: `.val` «80 чел.», `.lbl` «В кассе пока ничего: 80 человек не дошли до корзины» вместо «0 €» | — |
| Карточка хода `.monday` | `klaviyoSteps` → `mondayStep`; аудитория из снимка | `MondayCard` + строка аудитории (F0.3) | «40 человек в сегменте · письмо получают 10 · без письма остаются 10»; при расхождении — «В снимок попали 20 из 40» + причина | — |
| Списки «Кому / Кому не» | `audienceForBrief` со снимком (F0.1) | `KeyList` (F0.4) | свёрнуто, счётчик | не показывать при `letters === false` или ход — сайт |
| Приёмка | `step.confirm` (`confirmColumnText`) | `<Term>` для `received_email` | один раз на экран | — |
| Мощность | `nControlForEffect`, `repeatWithin` | `PowerNote` (F2.4) | три `.kpi`, без прогресса | скрыть при `letters === false` |
| Давность покупок | `recencyBuckets`, `observedCycle` | `RecencyChart` как есть + **`StepChart`** под ним (F3.2) | подпись по `fromData` (3.4) | `cycle` → T при n < 8 |
| Воронка | `funnelGap`, `wilsonInterval(purchased, visitors)` | `FunnelChart` как есть | `funnelLine` через `formatBand` | `people` → H при visitors < 5 (уже) |
| Прошлый список | `hitRate*` с `Low/High` | `ColumnChart` + `band` (F3.1) | «Усы — интервал Уилсона…» | столбец без интервала не рисуется |
| Наблюдаемая разница | `measuredLift`, `workspace.holdout` | **`HoldoutVerdict`** + `DiffScale` (F2.1, F2.2) | три состояния 3.1; «эффект» только при `confirmed` | `treatmentN`/`controlN` < 5 → `shownPeople` «меньше 5» |
| Накопление | `movePosterior` (DOR движка) | `AccumulationScale` (F3.3) | «Первый срез: только накопление в приор» | — |
| Сезонная поправка | `formatSeasonal` | как есть | — | уже: «Группа меньше 5 человек…» |
| Разбор среза → Тест | `experimentReadiness`, `decisionLabel` | `ExperimentChart` + `EvidenceBadge` (`experiment`) | «мало данных: в варианте меньше пятидесяти» вместо «Пунктир — 50 человек» | T/H по правилу |

### 4.2 Студия («Входы среза») и «Разбор прогона» — `src/app/studio/page.tsx`, `unit-panel.tsx`, `recognition-panel.tsx`, `diagnostic-pack.tsx`

| Блок | Данные движка | Компонент | Копирайт | Мало данных |
|---|---|---|---|---|
| Граница бренда (форма) | `config.formulation/constraint/positioning`, `profilingNotice`, `poolingConsent` | как есть; `textarea` в `font: inherit` (F1.4) | под чекбоксом «Уведомление о профилировании»: «без уведомления модель остаётся в тени» (`scoringActivation`) (F5.5) | — |
| Экономика среза `.unit-grid` | `unitEconomics().cards/derived` | `UnitPanel` как есть | валюта всегда; P&L «Срез, не месяц..» → одна точка (`unit-panel.tsx:159`) (F1.6) | `personRateBand` → «меньше 5» (уже) |
| Когортный LTV | `unitEconomics().cohorts` | **`CohortLtvTable`** (F4.4) | три карточки, 365 в состоянии H с причиной | `people` → T/H |
| Чек-лист пилота | `recognition.pilot` | **`PilotChecklist`** (F4.5) | «Готовность: 2 из 6 · Не готов»; «Что донести: …» | — |
| Устройства | `lookalikeByDevice`, `segmentReads` (`raw, shrunk, low, high, differs, n`) | `GroupedChart` «сырое / усаженное» + `band` на усаженном (F3.4) | подписи телефон / компьютер / планшет; «усадка тянет малые группы к среднему; «отличается от среднего» — только после поправки Бенджамини–Хохберга» | `lookalike` → T при n < 30, H при n < 5 |
| Каналы, первый товар | `channelCuts`, `firstProductLines`; `segmentReads` для усадки | `StackedChart` + `band` + `EvidenceBadge` | как у устройств | `people` |
| Повтор за N дней | `repeatWithin`, `repeatView` | `RepeatWindowChart` как есть | `formatBand` | уже |
| Тесты | `experimentReadiness` | `ExperimentChart` + `EvidenceBadge` | как на Неделе | `experiment` |
| Один покупатель | `playgroundRecommend` (+ bucket/reasons — DOR) | результат: «{sku}. Почему: {reasonLabel}.» + `ReasonCodes` (F4.3) | без цифр | — |
| Общая строка под Разбором | — | текст | «Порог для каждого графика — в его подписи. Правила — одни на платформу» | — |

### 4.3 Бриф — `src/app/agents/retention-diagnostic/page.tsx`

| Блок | Данные движка | Компонент | Копирайт | Мало данных |
|---|---|---|---|---|
| Вердикт «Письмо можно / нельзя» | `privacyVerdict` | `.verdict.ok/.no` как есть | — | — |
| Четыре карточки проблем | `problemCards` (`cut-lede.tsx:96–178`) | `CutLede` как есть | голден: `problem` без цифр (уже) | — |
| Абзац «Письмо получают 10 человек … Окно отправки …» (`:107–112`) | `stored.snapshot` arms, `sendWindowText(observedCycle)` | `.note` + **малый `StepChart`** (`size: "small"`) (F3.2) | окно по `fromData` (3.4); **не рендерить при `letters === false`** (F0.5) | `cycle` |
| Измеренный результат (`:113–130`, сейчас `.source` 12 px) | `measuredLift`, `holdout`, `seasonal` | **`HoldoutVerdict`** + `DiffScale` в `.section` (F5.1) | слово статуса читается в ч/б при печати | — |
| Товар и почему эта пара | `topCoPurchases`, `sequentialPairs`; `coViewPairs().qualified` (DOR движка) | текст-шаблон из трёх строк (F4.6) | «Основа блока — популярное в категории. Персональная пара — исключение: она ставится, только если её нижняя граница выше доли по всему магазину. В этом срезе таких пар: {нет | N}» | `support` → H «пара не показывается» |
| Приложение → пары «Какие товары покупали вместе» | `topCoPurchases(…, 5)` | `ColumnChart` + `EvidenceBadge(support)` | при всех `n === 2` — не график, а `.note`: «Пять пар по два человека. Этого мало, чтобы класть товар в письмо»; «номер товара» в подписи оси, если имени нет (уже) | `support` |
| Приложение → карточка модели бренду | `latestModelForProject`, `scoringActivation` | `ModelCard` слой «бренд» + `ReasonCodes` (F4.2) | «Модель подсказывает товар · в тени» | нет строки в `models` → блок не рендерится |
| Приложение → `RecognitionPanel` | `recognition.pilot` | `PilotChecklist` (F4.5) | как на Студии | — |

### 4.4 ТЗ — `src/app/spec/page.tsx`

| Блок | Данные движка | Компонент | Копирайт | Мало данных |
|---|---|---|---|---|
| Карточка «Создать» | `mondayStep`, `audienceForBrief` (снимок) | `MondayCard draft` + строка аудитории (F0.3) | «40 человек в сегменте · получают 10 · остаются 10» — те же числа, что на Неделе и Брифе (F0.1) | — |
| Кому / Кому не | `audience` | `KeyList` (F0.4) | свёрнуто | не показывать при `letters === false` |
| Приёмка этого действия | `step.confirm`, `step.watch`, `acceptLine` | один нумерованный список в `.klaviyo-card` (F5.3) | 1. «Столбец <code>received_email</code> в следующем срезе…» (один раз, сейчас три: `klaviyo-panel.tsx:193–198`, `AudienceBlock`, `spec/page.tsx:81`); 2. «30-й день …»; 3. «60-й день …»; 4. «Не включать …» | — |
| Мощность | `nControlForEffect` | `PowerNote` (F2.4) один раз (сейчас `powerBrief` дважды: `spec/page.tsx:72–77`, `:83`) | «10 без письма · нужно 1 570 · накопление в приор» | — |
| `step.who` «Placed Order = 1» | `klaviyoSteps` | `<Term>` | «Заказ оформлен (<code>Placed Order</code>) = 1» | — |

### 4.5 Каталог — `src/app/catalog/page.tsx`

| Блок | Данные движка | Компонент | Копирайт | Мало данных |
|---|---|---|---|---|
| Карточка модели оператору | `latestModelForProject` → `StoredModelCard`; `card.calibration`, `card.psi`, решение чемпиона | **`ModelCard`** слой «оператор» (F4.1) | 3.7 | нет строки — «Карточки модели для этого проекта нет» |
| Живые меры / очередь | `martCatalog()` из `methodology/mart-catalog.yaml` | `GroupedChart` как есть | легенда «В работе, 6 / В очереди, 64»; имена мер — русская подпись + `<code>name</code>` (`METRIC_RU`) (F5.4) | — |

### 4.6 Входы (загрузка, прогресс) — `studio/page.tsx:24–44`

Состояния «Считаем срез / Срез не посчитался» остаются текстом. Дополнительно: при `jobStatus === "failed"` показывать `jobError`, если он есть в `cuts` (`platform-db.ts` поле `jobError`) — одним `.note.warn`, без стека.

---

## 5. Дефекты данных: вскрыть, а не замаскировать

### 5.1 «control 40» на Неделе против «без письма остаются 10» на Брифе и ТЗ

**Что на экране (срез Atelier, `asOf 2026-09-01`).** Неделя: «В control 40 человек; чтобы увидеть 5 п.п. … нужно 1570» (скриншот 02b). ТЗ: карточка «Создать» — «40 человек», списки «Кому» — 10 ключей, «Кому не» — 10, «В control 10 человек» (скриншот 05). Бриф: «Письмо получают 10 человек, без письма остаются 10» (скриншот 04b). На косметике — та же картина в большем масштабе: Неделя — «В control 284 человек… нужно 1483» и стена из 568 ключей (284 + 284, скриншот 10); Бриф — «Письмо получают 10 человек».

**Откуда берутся числа — три разных выборки.**

1. **40 = размер сегмента хода.** `Pocket.size` для `risk` («одна покупка, старше цикла») из `queryDiagnostic` (`src/engine/pipeline.ts:604–612`). Это число в `MondayCard` («40 человек», `klaviyo-panel.tsx:154`) и в карточке проблемы. Правильное число для «кому писать».
2. **control 40 на Неделе = половина всех ключей бренда, а не сегмента.** Неделя грузит срез через `loadOwnedRun` (`page.tsx:27`) → `hydrateCutForUser` → `startRun`, где `snapshot: null` (`src/engine/store.ts:105–112`); снимок подставляется только если он уже записан в `cuts` (`platform.ts:309`). Снимок пишет только `diagnosticFor` (`store.ts:128–141`), который вызывают Бриф и ТЗ через `loadOwnedDiagnostic` (`access.ts:81–90`). Пока Бриф не открывали, на Неделе `stored.snapshot === null`, и `audienceForBrief(keys, null, id)` (`src/engine/brand-key.ts:104–122`) идёт по запасной ветке: назначает `assignArms` 50/50 **на всех `brandKeys`** — 80 покупателей Atelier → 40/40; 568 ключей косметики → 284/284. Отсюда и стена идентификаторов. Дополнительный запасной путь `controlN = audience.control.length || Math.floor(once.size / 2)` (`page.tsx:63`) даёт ещё одно число (20), если ключей нет.
3. **10/10 на Брифе и ТЗ = снимок из первых двадцати покупателей.** `writeReportSnapshot` берёт `buyers.slice(0, 20)` (`pipeline.ts:637–638`) — первые 20 конвертированных покупателей **без учёта сегмента**: переменная `targets` заводится и не используется (`pipeline.ts:633–636`, `void targets` `:671`). `assignArms` делит их 10/10. Бриф считает `treatmentN/controlN` прямо по `stored.snapshot` (`retention-diagnostic/page.tsx:70–71`); ТЗ — через `audienceForBrief` с тем же снимком (`spec/page.tsx:30`).

**Гипотеза.** Расхождение — не разные снимки одного и того же, а два разных дефекта: (а) Неделя читает срез без снимка и попадает на запасную ветку `audienceForBrief`, поэтому её число зависит от того, открывали ли уже Бриф в этом процессе (`diagnosticFor` мутирует тот же объект `stored` в памяти — `store.ts:139` — после открытия Брифа Неделя при перезагрузке покажет 10); (б) сам снимок строится не из сегмента хода, а из первых двадцати покупателей, поэтому «Кому» на Брифе — не те 40 человек, о которых говорит карточка.

**Как проверить.** Чистый процесс `npm run dev`, демо Atelier: открыть Неделю → ожидаем 40; открыть Бриф → 10; перезагрузить Неделю → ожидаем 10 (подтверждает (а)). Для (б): сверить `entity_id` строк `stored.snapshot` с множеством `risk`-покупателей из `queryDiagnostic` — пересечение будет частичным. Прочитать `cuts.snapshot` среза в SQLite (`loadCut`) до и после открытия Брифа.

**Чья задача.** Фронт — F0.1 (Неделя грузит срез через `loadOwnedDiagnostic`, убрать запасной `Math.floor`), F0.3 (строка аудитории говорит словами, сколько из сегмента попало в снимок). Движок — F0.2 (снимок из сегмента хода; решить, весь сегмент или кап, и если кап — отдать причину). До F0.2 фронт пишет «В снимок попали 20 из 40» и не прячет расхождение.

### 5.2 Карточка письма и «окно день 96–96, пик хазарда день 121» под ходом сайта на косметике

**Что на экране.** Бриф косметики (`asOf 2020-02-29`, «письмо нельзя»): «Письмо получают 10 человек, без письма остаются 10. Окно отправки: день 96–96 с момента покупки, пик хазарда категории — день 121» (над скриншотом 11). Неделя косметики: «В control 284 человек… нужно 1483» под карточкой «Карточка товара: править сайт» (дефект 10 аудита).

**Откуда.** Абзац рендерится по условию `treatmentN + controlN > 0` (`retention-diagnostic/page.tsx:107–112`) без проверки `privacy.letters`; `AudienceBlock` и `powerBrief` на Неделе — без проверки `featured.kind` (`klaviyo-panel.tsx:51–57`, `page.tsx:137`). Окно: `observedCycle` (`pipeline.ts:464–496`) считает `weight = events / (events + CYCLE_PRIOR)`; при 115 вторых покупках `weight ≈ 0,93`, но `fromData = weight >= 0.5 && fit.median !== null` ложно — значит, `fit.median === null`: кривая KM не опустилась до 0,5, большинство покупателей цензурированы (Студия так и пишет: «своей медианы ещё нет»). Тогда `dataHigh = config.replenishmentHigh = 90`, `low = round(0,93 · q25 + 0,07 · 30)`; `low = 96` означает `q25 ≈ 100` дней. `high = Math.max(low, round(0,93 · 90 + 0,07 · 90)) = Math.max(96, 90) = 96` (`pipeline.ts:485–488`). То есть «окно 96–96» — это q25 данных, упёршийся в потолок приора; окна из данных нет. `sendWindowText` (`klaviyo.ts:62–66`) печатает «день L–R» и пик без проверки, лежит ли пик в окне (121 > 96). Проверить на данных косметики: `kaplanMeier(observations).median === null` и `q25 ≈ 100`.

**Чья задача.** Фронт — F0.5 (не рендерить карточку письма, списки и мощность при `letters === false` или ход — сайт). Оба — F0.6: `sendWindowText` получает `fromData`, `n`, приор и при `fromData === false` пишет «окно из приора категории: день 30–90; своей медианы ещё нет (вторых покупок 115)», при пике вне окна — отдельная фраза; `StepChart` рисует кривую и показывает, почему окно такое. Голден-тест: при `fromData === false` в строке нет «день N–N» с равными N.

### 5.3 `holdout` всегда `unchecked`

**Откуда.** `buildWorkspace` пишет `holdout: emptyHoldout()` безусловно (`pipeline.ts:303`). Парсер подтверждения `parseReceivedColumn` и `holdoutFromConfirmation` (`holdout.ts:200–240`) существуют, тестируются, но в пайплайн не включены. Поэтому `liftParagraph` всегда в состоянии 2 и «Измеренный эффект» на экране появиться не может, даже если бренд загрузил столбец `received_email`.

**Чья задача.** Движок — F0.7: при наличии столбца `received_email` в заказах или событиях следующего среза (формат — зафиксировать: столбец в CSV заказов по ключу бренда) считать `parseReceivedColumn({ rows, arms, deviation })` и класть `holdoutFromConfirmation(itt, parsed, deviation)` в `workspace.holdout`. Фронт — `HoldoutVerdict` (F2.1) уже сейчас показывает причину «Не проверен: в срезе нет столбца received_email» и честно говорит, что заражение не измерено. Фронт не маскирует: не подставляет «подтверждён» и не прячет плашку.

### 5.4 Пропадающий LTV 365

**Откуда.** `cohortHorizons` возвращает все три горизонта всегда (`unit-econ.ts:261–270`), но `unit-panel.tsx:72–74` фильтрует `row.n > 0`, и 365 исчезает, когда никто не прожил год (Atelier: данные с 2026-03 по 2026-09). Косметика к тому же без валюты: «55 (49–61)».

**Чья задача.** Только фронт — F0.8 / F4.4: карточка остаётся на месте в состоянии «скрыто» с причиной «ни один покупатель не прожил год»; валюта по правилу 2.1.

### 5.5 Сводка «кто чинит»

| Дефект | Фронт | Движок |
|---|---|---|
| 40 vs 10 | F0.1, F0.3 | F0.2 |
| Карточка письма / окно 96–96 / мощность под сайтом | F0.5 | F0.6 (сигнатура `sendWindowText`, кривая в `ObservedCycle`) |
| `holdout` всегда `unchecked` | F2.1 показывает причину | F0.7 |
| LTV 365 | F0.8 (F4.4) | — |
| Накопление Beta-Beta не хранится | F3.3 рисует по одному срезу | F3.3 (DOR): `movePosterior` в `Workspace` |
| Co-view не считается в пайплайне | F4.6 шаблон текста | F4.6 (DOR): `coView` в `Workspace` |
| Reason codes покупателя | F4.3 | F4.3 (DOR): `playgroundRecommend` → bucket, reasons |
| Карточка модели без калибровки/PSI/решения на русском | F4.1 | F4.1 (DOR): `audit`/`psi` в `card_json`, русская причина |

---

## 6. Что осознанно не делаем

| Не делаем | Почему |
|---|---|
| `predicted_lift`, прогноз выручки от письма | Платформа измеряет, а не обещает. На экране — наблюдаемая разница с интервалом и «замороженная выручка» как арифметика (`frozenRevenue = control × repeat × aov`, `holdout.ts:115`), подписанная «не прогноз» |
| Адреса, телефоны, имена, экспорт списков | Только ключ бренда (`brand-key.ts`, `assertBrandKeyLink`). `KeyList` сворачивает, не выгружает файл |
| Отправку писем, коннекторы к Klaviyo, OAuth | Платформа не отправляет; ТЗ — поручение человеку. Кнопок «отправить» нет |
| Цифры 91 % / 24 % и другие отраслевые бенчмарки | Не из файла бренда — не на экране |
| SaaS-LTV = ARPU ÷ churn | Карточки говорят «Не ARPU ÷ отток»; только когортный LTV по прожитому горизонту |
| Сырой `score` модели | Бренду — ведро словами; оператору — метрики качества |
| Co-view как основу рекомендации | Основа — популярное в категории; персональная пара — исключение при нижней границе выше магазина |
| Новые библиотеки графиков и UI | Всё на `globals.css` и `week-charts.tsx`; `StepChart`, `DiffScale`, `AccumulationScale` — на `plotFrame` |
| Переименование `--rose` | Это код, не экран; в документах зовём «акцент» |
| Полосу прогресса «10 / 1570» | 0,6 % выглядит провалом, а это нормальное начало |

---

## 7. Порядок спринтов и зависимости

```
Спринт 1 · дефекты данных и стена id      F0.1 → F0.3 ; F0.4 ; F0.5 ; F0.6 ; F1.1 ; F1.6 ; F6.1 ; F6.4
                                            движок параллельно: F0.2 (DOR), F0.7 (DOR)
Спринт 2 · статус holdout и «мало данных»  F2.1 → F2.2 → F5.1 ; F2.3 ; F2.4 → F5.3 ; F1.2 → F6.3 ; F1.3 ; F1.4 ; F1.5 ; F5.2
Спринт 3 · графики                         F3.1 → F3.4 ; F3.2 (нужна кривая из движка) ; F3.3 (DOR) ; F0.8/F4.4 ; F4.5 ; F6.2
Спринт 4 · карточки и каталог              F4.1 (DOR) ; F4.2 → F4.3 (DOR) ; F4.6 (DOR) ; F5.4 ; F5.5
```

Зависимости, которые нельзя обойти:
- `F0.3` после `F0.1`: строка аудитории имеет смысл только когда Неделя видит снимок.
- `F5.1` после `F2.1` и `F2.2`: Бриф переносит результат в готовый компонент.
- `F5.3` после `F2.4`: дедупликация приёмки заменяет `powerBrief` на `PowerNote`.
- `F3.4` после `F3.1`: усадка показывается усами.
- `F6.3` после `F1.2`: лексический тест ждёт словарь.
- `F4.3` после `F4.2`: ведро словами рендерится внутри карточки бренду.
- Все задачи с DOR (F0.2, F0.7, F3.3, F4.1, F4.3, F4.6) — фронт делает свою часть по данным, которые уже есть, и честно подписывает отсутствующее; ждать движок для остального.

---

## 8. Протокол проверки в браузере (F6.4)

Три среза × пять экранов × две ширины (897 и 1280 px). Для каждого — скриншот в `/tmp/fg-ux-after/`.

1. Неделя: числа «получают / остаются» совпадают с Брифом и ТЗ; `HoldoutVerdict` со словом статуса; `DiffScale` с засечкой на нуле; списки свёрнуты; на косметике нет ни списков, ни мощности, ни карточки письма.
2. Бриф: измеренный результат не в `.source`; малый `StepChart` рядом с окном; печать в PDF — статус читается без цвета.
3. ТЗ: `received_email` один раз, мощность один раз, приёмка одним списком.
4. Студия: `textarea` в Inter; LTV три карточки; чек-лист с итогом; устройства по-русски с усами.
5. Каталог: карточка модели (при наличии строки в `models`) или одна честная строка; «в работе / в очереди».
6. Все экраны: ни одного «%» без пробела, ни одной десятичной точки в русской прозе, ни одного числа ≥ 10 000 без разрядов, ни одной суммы без валюты или «у. е.».
7. Нав на 897 px: «АККАУНТ» не обрезан, «Срез …» не наезжает на «Студия».

Дизайн-приёмка по чеклисту `ux-design-spec.md` §7 — отдельный шаг после этого протокола (задача F6.5 в `docs/frontend-tasks.md`).

---

## 9. Согласовано с ux-design-spec

`docs/ux-design-spec.md` (раздел 9) перечисляет 12 расхождений с этим документом. Решения зафиксированы 9 октября 2026; где расхождение принято в пользу дизайна, соответствующие строки выше исправлены с пометкой «согласовано, раздел 9 п. N». Полный список задач с обновлёнными критериями — `docs/frontend-tasks.md`, канвас `findgrowth-front-backlog`.

**Принято по умолчанию (решение за фронтом):**

1. Разность долей в прозе и `aria-label` — «+20 п.п., интервал от −20,6 до +52,8 п.п.» (`formatPp`); на шкале концы отдельными числами (§2.1). Задачи F1.1, F2.2, F6.1.
2. Вероятность — одна десятичная «80,3 %» (§2.1). F1.1, F2.1.
3. `.verdict.*` — только блок; слово статуса — чип `.status.ok / .wait / .bad` 12 px с маркером ✓ ○ ✕ и чернильным цветом (§3.1, §3.9). F7.3, F2.1, F4.5.
4. `DiffScale` — высота 72 единицы viewBox (§3.2). F2.2.
5. `StepChart small` — 160 с линиями сетки 0 % и 50 % (§3.4). F3.2.
6. Когорта LTV из 20 человек — `enough` по правилу `people`, чипа нет; критерий F4.4 исправлен (§3.11). F4.4.
8. Нейтральный чип `.tag.hidden` (`--paper-2 / --ink-soft`) для «скрыто» и статуса модели «тень» (§2.4, §3.3). F7.3, F2.3, F4.1, F4.4.
9. Строка «Повтор за 120 дней … Следующая покупка …» на Брифе — `.lede` 14 px, не `.source` (`retention-diagnostic/page.tsx:101–106`). F5.1.
10. На `≤ 860` — `.plot { min-width: 720px }` с прокруткой; `DiffScale` / `AccumulationScale` — `width 640` (§2.3). F7.7, F2.2, F3.3.
11. `HiddenStub` — высота 18 единиц у основания, не 0 (§3.3). F2.3.
12. Чипы статуса модели: тень `.tag.hidden` ○ / претендент `.tag` / чемпион `.status.ok` ✓ (§3.7). F4.1.

Дополнительно из спецификации принято без расхождений: токены `--sage-ink`, `--gold-ink`, `--danger-ink`, `--rose-ink`, `--danger-soft`, затемнение `--muted` до `#5b6573` и тест контраста (эпик F7); паттерн «честная плашка» из трёх частей для вскрытых дефектов (компонент `DataNotice`, F2.5); текстовая альтернатива у каждого SVG (F1.5); макеты экранов §4 как отдельные задачи (F5.7–F5.11).

**Открытые вопросы владельцу** (задачи с DOR «Решение владельца»):

- п. 7 — печать ТЗ: содержит ли PDF ключи «Кому / Кому не»? До решения печатается только счётчик и строка «Список ключей — на экране ТЗ, в печать не выводится» (F8.1).
- п. 6, альтернатива — нужен ли чип «мало данных» на когорте из 20 (правило `cohort` с `enoughAt 30` в `EVIDENCE` — изменение движка)? До решения — одно правило на платформу (F8.2).
- Из этого документа: снимок — весь сегмент или кап с причиной (F0.2); формат файла со столбцом `received_email` (F0.7); русские подписи мер каталога (F5.4).

Порядок исполнения с учётом токенов: F7 → F0 + F1 → F2 → F3 / F4 → F5 → F6; детальный план спринтов — `docs/frontend-tasks.md`, раздел 1 (раздел 7 выше остаётся как исходная разбивка).
