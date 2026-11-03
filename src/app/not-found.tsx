export default function NotFound() {
  return (
    <div className="page">
      <h1>Нет такого среза</h1>
      <p className="lede">Срез не найден или принадлежит другому аккаунту.</p>
      <a className="btn" href="/projects">
        К проектам
      </a>
    </div>
  );
}
