import type { RunConfig } from "./types";

export interface PrivacyFacts {
  origin: "operator" | "public_research";
  advertisingConsent: boolean;
  customerNotice: boolean;
}

export interface PrivacyDecision {
  id: string;
  allowed: boolean;
  text: string;
}

export interface PrivacyVerdict {
  letters: boolean;
  letterReason: string;
  decisions: PrivacyDecision[];
  lawLabel: string;
}

export const LIA_NOTICE = `Шаблон для политики бренда. Это не юридическое заключение и не сертификат соответствия.

FindGrowth считает агрегаты по файлу заказов и визитов: повтор, воронку, цикл, пары товаров. Адрес, телефон и имя в отчёт не попадают. Письма платформа не отправляет и списки адресов не выгружает.

Если скоринг когда-нибудь начнёт менять предложение человеку, это профилирование. Правовая основа — GDPR (регламент ЕС 2016/679) и директива ePrivacy (2002/58/EC). У человека есть право возразить против профилирования (GDPR, ст. 21) и право на доступ и удаление своих данных (ст. 15 и ст. 17). Пока уведомление о профилировании не записано, скоринг остаётся в тени и предложение не меняет.

Рекламное письмо возможно только при согласии или при сообщении покупателю о похожих товарах и бесплатном отказе. Публичный исследовательский файл для писем не используется.

Таблица соответствия stable_id и ключа бренда (customer_id или номер заказа) — псевдонимизированные данные бренда у процессора. Ключи возвращаются бренду в поручении. Адреса, телефоны и имена не выгружаются. Путь «выгрузка идентификаторов для рассылки» не разрешён.`;

const LAW = "GDPR (регламент ЕС 2016/679), ст. 5 и ст. 6, и ст. 13 директивы ePrivacy (2002/58/EC)";

export function privacyOf(config: RunConfig): PrivacyFacts {
  const origin = config.dataOrigin ?? (config.brandId === "rees46-cosmetics" ? "public_research" : "operator");
  return {
    origin,
    advertisingConsent: config.advertisingConsent === true,
    customerNotice: config.customerNotice === true,
  };
}

export function privacyVerdict(facts: PrivacyFacts): PrivacyVerdict {
  const letters = letterDecision(facts);
  return {
    letters: letters.allowed,
    letterReason: letters.reason,
    lawLabel: LAW,
    decisions: [
      {
        id: "aggregates",
        allowed: true,
        text:
          facts.origin === "public_research"
            ? "Считать людей, воронку, повтор и суммы. В отчёте нет адресов, телефонов и имён. Файл публичный, цель среза — статистика, не контакт."
            : "Считать людей, воронку, повтор и суммы по клиентам оператора. В отчёте нет адресов, телефонов и имён.",
      },
      {
        id: "stable",
        allowed: true,
        text: "Связывать визит и заказ через хеш. Адрес, телефон, имя и customer_id не могут быть идентификатором визита.",
      },
      {
        id: "site",
        allowed: true,
        text: "Менять сайт. Это не обращение к человеку.",
      },
      {
        id: "letters",
        allowed: letters.allowed,
        text: letters.reason,
      },
      {
        id: "export",
        allowed: false,
        text: "Выгружать адрес, телефон, имя или список идентификаторов для рассылки. Платформа их не отдаёт.",
      },
    ],
  };
}

function letterDecision(facts: PrivacyFacts): { allowed: boolean; reason: string } {
  if (facts.origin === "public_research") {
    return {
      allowed: false,
      reason:
        "Рекламное письмо этим людям нельзя. Файл собран для исследования, это не клиентская база оператора. Цель «написать и продать» с целью сбора не совпадает (GDPR, ст. 5). Согласия на электронную рекламу в срезе нет (директива ePrivacy, ст. 13).",
    };
  }
  if (facts.advertisingConsent) {
    return {
      allowed: true,
      reason:
        "Письмо можно: записано предварительное согласие на электронную рекламу (директива ePrivacy, ст. 13). В каждом письме нужен бесплатный отказ.",
    };
  }
  if (facts.customerNotice) {
    return {
      allowed: true,
      reason:
        "Письмо своим покупателям о похожем товаре можно: при сборе им сказали об этом и они могут отказаться (директива ePrivacy, ст. 13). Тем, кто не покупал, писать нельзя.",
    };
  }
  return {
    allowed: false,
    reason:
      "Рекламное письмо нельзя: нет согласия на электронную рекламу и нет отметки, что покупателю при сборе сказали о похожих товарах и он может отказаться (директива ePrivacy, ст. 13, GDPR, ст. 6). Размер группы смотреть можно.",
  };
}
