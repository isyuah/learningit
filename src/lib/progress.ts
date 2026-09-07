import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "lt-progress";

/**
 * 学习进度：把「已完成的课时 slug」持久化到 localStorage。
 * 模板自带的轻量方案，无需后端。替换为账号体系时，改这里的实现即可。
 */
export function useProgress() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCompleted(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
    } catch {
      /* ignore */
    }
  }, [completed]);

  const isCompleted = useCallback(
    (slug: string) => completed.has(slug),
    [completed],
  );

  const toggle = useCallback((slug: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const markCompleted = useCallback((slug: string) => {
    setCompleted((prev) => {
      if (prev.has(slug)) return prev;
      const next = new Set(prev);
      next.add(slug);
      return next;
    });
  }, []);

  return { completed, isCompleted, toggle, markCompleted };
}
