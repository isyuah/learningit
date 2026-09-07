import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 className：先拼合再交给 tailwind-merge 去重冲突类名 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 格式化时长："45 分钟" / "1.5 小时" */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`;
}
