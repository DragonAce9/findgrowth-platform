import { register } from "../auth-actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  taken: "Этот адрес уже занят.",
  bad: "Нужна почта вида name@domain.",
  short: "Пароль — от 8 символов.",
};

export default async function RegisterPage({
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
      <h1>Создать аккаунт</h1>
      <p className="lede">
        FindGrowth читает выгрузку магазина и говорит, кому написать на этой неделе и кого оставить без письма. Почта нужна только
        для входа. Это не адреса из файла магазина. После регистрации откроется копия демо-проекта Atelier.
      </p>
      {e && ERRORS[e] ? <p className="auth-error">{ERRORS[e]}</p> : null}
      <form className="auth-form" action={register}>
        <label>
          Почта
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Пароль
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </label>
        <button type="submit">Создать</button>
      </form>
      <p className="auth-alt">
        Уже есть аккаунт? <a href="/login">Войти</a>
      </p>
    </div>
  );
}
