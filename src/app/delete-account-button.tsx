"use client";

import React from "react";
import { deleteAccount } from "./auth-actions";

export function DeleteAccountButton() {
  return (
    <form
      action={deleteAccount}
      onSubmit={(event) => {
        if (!window.confirm("Удалить аккаунт? Почта, проекты и файлы исчезнут.")) event.preventDefault();
      }}
    >
      <button className="ghost danger" type="submit">
        Удалить аккаунт
      </button>
    </form>
  );
}
