import { Link } from "react-router-dom";
import { site } from "@/content/site";
import { Logo } from "./logo";

/** 站点页脚：关于 + 链接列 + 版权 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas-2/70 dark:border-night-line dark:bg-night-2">
      <div className="wrap py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-soft dark:text-night-soft">
              {site.footer.about}
            </p>
            <p className="mt-3 text-xs text-ink-faint dark:text-night-faint">
              {site.slogan}
            </p>
          </div>

          {site.footer.columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="text-sm font-semibold text-ink dark:text-night-ink">
                {col.title}
              </h3>
              <ul className="mt-3.5 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label + link.to}>
                    <Link
                      to={link.to}
                      className="text-sm text-ink-soft transition-colors hover:text-primary-700 dark:text-night-soft dark:hover:text-primary-300"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between dark:border-night-line dark:text-night-faint">
          <p>
            © {new Date().getFullYear()} {site.name} · 示例内容，替换为你自己的课程
          </p>
          <p>
            基于{" "}
            <Link
              to="/guide"
              className="text-ink-soft underline decoration-line-strong underline-offset-2 transition-colors hover:text-primary-700 dark:text-night-soft dark:hover:text-primary-300"
            >
              Learning Template
            </Link>{" "}
            构建
          </p>
        </div>
      </div>
    </footer>
  );
}
