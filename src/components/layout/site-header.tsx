import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu, Moon, Sun } from "lucide-react";
import { site } from "@/content/site";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/dialog";
import { LinkButton } from "@/components/ui/button";
import { CommandMenu } from "@/components/ui/command-menu";
import { Logo } from "./logo";

/**
 * 站点页头：吸顶、毛玻璃、当前路由高亮、主题切换、移动端抽屉导航。
 */
export function SiteHeader() {
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-all duration-200",
        scrolled
          ? "border-line bg-canvas/85 backdrop-blur-md dark:border-night-line dark:bg-night/85"
          : "border-transparent bg-canvas dark:bg-night",
      )}
    >
      <div className="wrap flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav aria-label="主导航" className="hidden items-center gap-1 md:flex">
          {site.nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200"
                    : "text-ink-soft hover:bg-canvas-2 hover:text-ink dark:text-night-soft dark:hover:bg-night-surface-2 dark:hover:text-night-ink",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <CommandMenu />
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
            className="rounded-md p-2.5 text-ink-soft transition-colors hover:bg-canvas-2 hover:text-ink dark:text-night-soft dark:hover:bg-night-surface-2 dark:hover:text-night-ink"
          >
            {theme === "dark" ? (
              <Sun aria-hidden className="size-5" />
            ) : (
              <Moon aria-hidden className="size-5" />
            )}
          </button>
          <LinkButton to="/#courses" size="sm" className="hidden sm:inline-flex">
            浏览课程
          </LinkButton>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="打开菜单"
            className="rounded-md p-2.5 text-ink-soft transition-colors hover:bg-canvas-2 hover:text-ink md:hidden dark:text-night-soft dark:hover:bg-night-surface-2 dark:hover:text-night-ink"
          >
            <Menu aria-hidden className="size-5" />
          </button>
        </div>
      </div>

      {/* 移动端抽屉导航 */}
      <Dialog
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="导航"
      >
        <nav aria-label="移动端导航" className="flex flex-col gap-1">
          {site.nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2.5 text-[0.9375rem] font-medium transition-colors",
                  isActive
                    ? "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200"
                    : "text-ink-soft hover:bg-canvas-2 hover:text-ink dark:text-night-soft dark:hover:bg-night-surface-2 dark:hover:text-night-ink",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </Dialog>
    </header>
  );
}
