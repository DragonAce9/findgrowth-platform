import React from "react";

/** Manual export. There is no connector: the brand uploads both files. */
export function ExportChecklist() {
  return (
    <div className="note">
      <p>Автоматической связи пока нет. Оба файла выгружаете сами и загружаете здесь.</p>
      <ol>
        <li>
          События. В Klaviyo выгрузите события в JSON. В каждом событии нужны <code>event_name</code>, <code>timestamp</code>,{" "}
          <code>session_id</code>. Колонка визита по умолчанию — <code>anonymous_id</code>, её можно сменить в поле ниже.
        </li>
        <li>
          Заказы. Из админки магазина: заказы → экспорт CSV. Нужны <code>order_id</code>, <code>created_at</code>, <code>sku</code>,{" "}
          <code>product_name</code>, <code>quantity</code>, <code>revenue</code>, <code>status</code>,{" "}
          <code>is_subscription_renewal</code>. Статус — одно из <code>paid</code>, <code>cancelled</code>, <code>refunded</code>. Чтобы
          списки «кому» совпали с вашей базой, добавьте <code>customer_id</code>. Почту можно не класть: на экран она не выводится.
        </li>
      </ol>
    </div>
  );
}
