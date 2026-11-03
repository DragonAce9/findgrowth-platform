export function EmptyCut({ title }: { title: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="lede">В этом проекте ещё нет среза. Загрузите события и заказы в студии или откройте демо.</p>
      <div className="actions">
        <a className="btn" href="/studio">
          Открыть студию
        </a>
        <a className="btn ghost" href="/projects">
          К проектам
        </a>
      </div>
    </div>
  );
}
