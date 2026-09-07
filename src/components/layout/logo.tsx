import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * 站点 Logo：品牌字「知」+ 站点名。现代、简洁。
 */
export function Logo({
  to = "/",
  className,
}: {
  to?: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-label="返回首页"
      className={cn("inline-flex items-center gap-2.5", className)}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary-600 shadow-card dark:bg-primary-500">
        <svg viewBox="0 0 64 64" aria-hidden className="size-5">
          <text
            x="32"
            y="45"
            textAnchor="middle"
            fontSize="38"
            fontWeight="600"
            fill="#FFFFFF"
            fontFamily="'Noto Sans SC Variable', 'PingFang SC', 'Microsoft YaHei', sans-serif"
          >
            知
          </text>
        </svg>
      </span>
      <span className="text-[1.125rem] font-semibold tracking-wide text-ink dark:text-night-ink">
        知学
      </span>
    </Link>
  );
}
