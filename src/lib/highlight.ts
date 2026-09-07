/* ==================================================================
 * 语法高亮（Shiki · 懒加载）
 * ----------------------------------------------------------------
 * - 使用 shiki/bundle/full：开箱即用，覆盖 Go / C++ / Rust / Java 等
 *   几乎所有语言（此前 bundle/web 不含 Go 导致回退为纯文本）
 * - 引擎 lazy-load：首次遇到代码块才加载；结果按 (语言, 代码) 缓存
 * - 不支持的代码语言自动回退为纯文本
 *
 * 换主题：改下方 THEME（可用主题见 node_modules/@shikijs/themes）。
 * ================================================================== */

const THEME = "github-dark-default";

/** 短名/别名 → Shiki 注册 id（bundle/full 覆盖绝大多数语言） */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "shellscript",
  shell: "shellscript",
  yml: "yaml",
  md: "markdown",
};

type ShikiFullModule = typeof import("shiki/bundle/full");

let shikiPromise: Promise<ShikiFullModule> | null = null;
const cache = new Map<string, { html: string; highlighted: boolean }>();
const CACHE_LIMIT = 300;

/** 纯文本转义（回退渲染用） */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function highlightCode(
  code: string,
  language: string,
): Promise<{ html: string; highlighted: boolean }> {
  const key = `${language}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    if (!shikiPromise) shikiPromise = import("shiki/bundle/full");
    const { codeToHtml } = await shikiPromise;
    const lang = ALIASES[language] ?? language;
    const html = await codeToHtml(code, { lang, theme: THEME });
    const result = { html, highlighted: true };
    cache.set(key, result);
    if (cache.size > CACHE_LIMIT) cache.clear();
    return result;
  } catch {
    const result = { html: escapeHtml(code), highlighted: false };
    cache.set(key, result);
    return result;
  }
}
