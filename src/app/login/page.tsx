import { login } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  return (
    <div className="auth-page">
      <a className="logo" href="/login">
        Find<span>growth</span>
      </a>
      <h1>Вход</h1>
      <p className="lede">
        FindGrowth читает выгрузку магазина и говорит, кому написать на этой неделе, кого оставить без письма, чтобы разницу можно
        было измерить, и принесло ли письмо повторную покупку.
      </p>
      {e === "auth" ? <p className="auth-error">Почта или пароль не подходят.</p> : null}
      <form className="auth-form" action={login}>
        <label>
          Почта
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Пароль
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Войти</button>
      </form>
      <p className="auth-alt">
        Нет аккаунта? <a href="/register">Создать</a>
      </p>
    </div>
  );
}
