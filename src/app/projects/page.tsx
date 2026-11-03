import { createProject, openDemoProject } from "../actions";
import { currentProject, projectList } from "@/engine/access";
import { DeleteAccountButton } from "../delete-account-button";
import { ruDate } from "@/engine/client-copy";
import { latestCutMeta } from "@/engine/platform-db";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { user, projects } = await projectList();
  const open = await currentProject();
  return (
    <div className="page">
      <p className="trust">{user.email}</p>
      <h1>Проекты</h1>
      <p className="lede">
        FindGrowth читает выгрузку магазина и говорит, кому написать на этой неделе, кого оставить без письма, чтобы разницу можно
        было измерить, и принесло ли письмо повторную покупку.
      </p>
      <div className="project-grid">
        {projects.map((project) => {
          const cut = latestCutMeta(project.id);
          return (
            <article key={project.id} className="project-card">
              <div className="project-row">
                <h2>{project.name}</h2>
                {project.demo ? <span className="tag">Демо данные</span> : null}
                {open?.project.id === project.id ? <span className="tag hidden">○ открыт</span> : null}
              </div>
              <p>{cut ? `Последний срез ${ruDate(cut.asOf)}` : "Среза ещё нет"}</p>
              <a className="btn" href={`/projects/open?id=${project.id}`}>
                Открыть
              </a>
            </article>
          );
        })}
      </div>
      <section className="section">
        <h2>Новый проект</h2>
        <form className="limits" action={createProject}>
          <label>
            Название
            <input name="name" required maxLength={80} placeholder="Магазин" />
          </label>
          <button type="submit">Создать пустой</button>
        </form>
        <form action={openDemoProject} style={{ marginTop: 12 }}>
          <button className="ghost" type="submit">
            Открыть демо Atelier
          </button>
        </form>
      </section>
      <section className="section">
        <h2>Аккаунт</h2>
        <p className="lede">Удаление стирает почту входа, проекты и файлы. Адреса покупателей платформа и так не отдаёт.</p>
        <DeleteAccountButton />
      </section>
    </div>
  );
}
