import { Play, Video } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 视频占位/嵌入：16:9 容器。
 * - provider="placeholder"：不加载任何外链，仅展示美观的占位面板
 *   （模板默认演示态，避免示例里出现真实视频）
 * - provider="youtube" | "bilibili"：src 填 iframe 嵌入地址
 * - provider="mp4"：src 填视频文件地址，渲染原生 <video>
 *
 * 替换为真实视频时把 provider 改为对应类型即可，见
 * docs/CONTENT-AUTHORING.md「视频」一节。
 */
export function VideoEmbed({
  title,
  provider,
  src,
  duration,
  className,
}: {
  title: string;
  provider: "youtube" | "bilibili" | "mp4" | "placeholder";
  src: string;
  duration?: string;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-md border border-line bg-surface dark:border-night-line dark:bg-night-surface",
        className,
      )}
    >
      <div className="relative aspect-video w-full">
        {provider === "placeholder" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-primary-100/70 dark:bg-primary-900/30">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary-700 text-white shadow-lift dark:bg-primary-600">
              <Play aria-hidden className="ml-0.5 size-6 fill-current" />
            </span>
            <div className="text-center">
              <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary-900 dark:text-primary-200">
                <Video aria-hidden className="size-4" />
                {title}
              </p>
              {duration && (
                <p className="mt-0.5 text-xs text-primary-700/70 dark:text-primary-300/70">
                  示例占位 · 时长 {duration}（在内容数据中替换为真实视频）
                </p>
              )}
            </div>
          </div>
        ) : provider === "mp4" ? (
          <video
            src={src}
            controls
            preload="metadata"
            className="absolute inset-0 h-full w-full bg-ink"
            aria-label={title}
          />
        ) : (
          <iframe
            src={src}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>
      {provider !== "placeholder" && (
        <figcaption className="border-t border-line px-4 py-2.5 text-sm text-ink-soft dark:border-night-line dark:text-night-soft">
          {title}
        </figcaption>
      )}
    </figure>
  );
}
