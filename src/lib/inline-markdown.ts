/* ==================================================================
 * 行内 Markdown（Inline Markdown）
 * ----------------------------------------------------------------
 * 课程叙事字段（paragraph/list/callout/quiz/…，见 MD_FIELDS）在渲染前
 * 经过本解析器。只支持「行内」语法 —— 块级结构（标题/列表/表格/代码
 * 围栏/引用…）一律用对应的结构化块表达，validate 会拦截块级记号。
 *
 * 支持语法（与 docs/CONTENT-AUTHORING.md 保持一致）：
 *   **加粗**      *斜体*        ~~删除线~~      `行内代码`
 *   [文字](https://… )         外部链接（http/https/mailto，新窗口）
 *   [文字](/courses/…)         站内链接（react-router 跳转）
 *   [文字](glossary:key)       术语引用 → 悬浮卡片 + 术语表锚点
 *   <https://…>                尖括号自动链接
 *   \* 转义                     行尾两个空格 + 换行 = 强制换行
 * 其余字符一律按字面输出（React 转义，无 XSS 面）。
 *
 * 本文件是纯函数模块（不依赖 React/DOM），同时被渲染层
 * （learning/inline-content.tsx）与 scripts/validate.ts 引用，
 * 语法规则只有这一份实现。
 * ================================================================== */
import type { LessonBlock } from "@/content/types";

export type MdInlineNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: MdInlineNode[] }
  | { kind: "em"; children: MdInlineNode[] }
  | { kind: "del"; children: MdInlineNode[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MdInlineNode[] }
  | { kind: "br" };

/** 反斜杠可转义的字符集（与 CommonMark 常用集一致） */
const ESCAPABLES = "\\`*_{}[]<>()#+-.!~|";

/* ------------------------------------------------------------------
 * 解析器：单遍扫描 + 递归。对受控内容采用务实规则（不做 CommonMark
 * 完整强调歧义处理），覆盖 AI 写作的全部常见形态。
 * ------------------------------------------------------------------ */

/** 在 from 起找下一个未被转义、且不在行内代码 span 内的 delim */
function findDelim(src: string, from: number, delim: string): number {
  let pos = from;
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === "\\") {
      pos += 2;
      continue;
    }
    if (ch === "`") {
      // 跳过行内代码 span（按单个反引号计；内部记号一律不算分隔符）
      let end = src.indexOf("`", pos + 1);
      while (end !== -1 && src[end - 1] === "\\") {
        end = src.indexOf("`", end + 1);
      }
      if (end === -1) return -1;
      pos = end + 1;
      continue;
    }
    if (src.startsWith(delim, pos)) return pos;
    pos += 1;
  }
  return -1;
}

/** 链接文字：跳过转义与代码 span，按嵌套深度找收尾 ] */
function findLinkClose(src: string, from: number): number {
  let depth = 0;
  let pos = from;
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === "\\") {
      pos += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", pos + 1);
      if (end === -1) return -1;
      pos = end + 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      if (depth === 0) return pos;
      depth -= 1;
    }
    pos += 1;
  }
  return -1;
}

/** 链接目标：支持 [x](<含空格>) 与普通形式；返回 (href, 结束下标+1) */
function readLinkDest(src: string, from: number): { href: string; end: number } | null {
  let pos = from;
  if (src[pos] === "<") {
    const close = src.indexOf(">", pos + 1);
    if (close === -1) return null;
    return { href: src.slice(pos + 1, close), end: close + 2 }; // 跳过 ">)" 前的 ">"
  }
  // 无尖括号：href 内不允许空格与换行
  let esc = false;
  while (pos < src.length) {
    const ch = src[pos];
    if (esc) {
      esc = false;
    } else if (ch === "\\") {
      esc = true;
    } else if (ch === " " || ch === "\n" || ch === ")") {
      break;
    }
    pos += 1;
  }
  if (pos >= src.length || src[pos] === ")" && pos === from) {
    if (pos < src.length && src[pos] === ")") return null;
  }
  if (pos >= src.length || src[pos] !== ")" && src[pos] !== " ") {
    return null;
  }
  // pos 停在空白或 ) 上；href 截至 pos；要求后随 )（允许空格前为 href 边界的情况除外）
  if (src[pos] === " ") {
    // 空白后必须紧跟 ) 才接受（Markdown 常见写法 [x](url )）
    const after = pos;
    let q = pos;
    while (q < src.length && src[q] === " ") q += 1;
    if (q >= src.length || src[q] !== ")") return null;
    return { href: src.slice(from, after).trim(), end: q + 1 };
  }
  return { href: src.slice(from, pos).trim(), end: pos + 1 };
}

export function parseInline(src: string): MdInlineNode[] {
  const nodes: MdInlineNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // 转义
    if (ch === "\\" && i + 1 < src.length && ESCAPABLES.includes(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // 行内代码：连续反引号按相同长度闭合
    if (ch === "`") {
      let run = 0;
      while (src[i + run] === "`") run += 1;
      const close = src.indexOf("`".repeat(run), i + run);
      if (close !== -1 && !src.slice(i + run, close).includes("\n")) {
        flush();
        nodes.push({ kind: "code", text: src.slice(i + run, close) });
        i = close + run;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // 换行：行尾两空格 → <br>，否则折叠成空格
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r") {
        i += 1;
        continue;
      }
      if (buf.endsWith("  ")) {
        buf = buf.slice(0, -2);
        flush();
        nodes.push({ kind: "br" });
      } else {
        buf += " ";
      }
      i += 1;
      continue;
    }

    // 链接 [文字](目标)
    if (ch === "[") {
      const close = findLinkClose(src, i + 1);
      if (close !== -1 && src[close + 1] === "(") {
        const dest = readLinkDest(src, close + 2);
        if (dest) {
          flush();
          const label = src.slice(i + 1, close);
          nodes.push({
            kind: "link",
            href: dest.href,
            children: parseInline(label),
          });
          i = dest.end;
          continue;
        }
      }
      buf += ch;
      i += 1;
      continue;
    }

    // 图片语法 ![..](..) 平台不支持：整体按字面输出（validate 会报错引导）
    if (ch === "!" && src[i + 1] === "[") {
      const close = findLinkClose(src, i + 2);
      if (close !== -1 && src[close + 1] === "(") {
        const dest = readLinkDest(src, close + 2);
        if (dest) {
          buf += src.slice(i, dest.end);
          i = dest.end;
          continue;
        }
      }
      buf += ch;
      i += 1;
      continue;
    }

    // 强调：** / * / __ / _ / ~~
    if (ch === "*" || ch === "_" || ch === "~") {
      let run = 0;
      while (src[i + run] === ch) run += 1;
      if (ch === "~") {
        if (run >= 2) {
          const delim = "~~";
          const close = findDelim(src, i + 2, delim);
          if (close !== -1 && close > i + 2) {
            flush();
            nodes.push({ kind: "del", children: parseInline(src.slice(i + 2, close)) });
            i = close + 2;
            continue;
          }
        }
        buf += "~".repeat(run);
        i += run;
        continue;
      }
      // 下划线强调避免误伤标识符：_ 两侧不得贴字母/数字
      const word = (p: number) => /[\w\u4e00-\u9fa5]/.test(src[p] ?? "");
      if (ch === "_" && word(i - 1)) {
        buf += ch;
        i += 1;
        continue;
      }
      if (run >= 2) {
        const delim = ch === "_" ? "__" : "**";
        const close = findDelim(src, i + 2, delim);
        const usable = ch !== "_" || !word(close + 1);
        if (close !== -1 && close > i + 2 && usable) {
          flush();
          nodes.push({ kind: "strong", children: parseInline(src.slice(i + 2, close)) });
          i = close + 2;
          continue;
        }
        buf += ch;
        i += 1;
        continue;
      }
      // 单个分隔符
      const delim = ch;
      const close = findDelim(src, i + 1, delim);
      const usable = ch !== "_" || (!word(i - 1) && !word(close + 1));
      if (close !== -1 && close > i + 1 && usable) {
        flush();
        nodes.push({ kind: "em", children: parseInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    // 尖括号自动链接 <https://…>
    if (ch === "<") {
      const m = /^<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^<>\s]+)>/.exec(src.slice(i));
      if (m) {
        flush();
        nodes.push({ kind: "link", href: m[1], children: [] });
        i += m[0].length;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  flush();
  return nodes;
}

/* ------------------------------------------------------------------
 * 链接分类（渲染层路由 + validate 白名单共用）
 * ------------------------------------------------------------------ */

export type HrefKind = "glossary" | "internal" | "external" | "other";

export function classifyHref(href: string): HrefKind {
  if (href.startsWith("glossary:")) return "glossary";
  if (href.startsWith("/")) return "internal";
  if (/^https?:\/\//i.test(href)) return "external";
  if (/^mailto:/i.test(href)) return "external";
  return "other";
}

/** 遍历 token 树收集全部链接 href（保留出现顺序） */
export function collectLinks(src: string): string[] {
  const out: string[] = [];
  const walk = (nodes: MdInlineNode[]) => {
    for (const n of nodes) {
      if (n.kind === "link") {
        out.push(n.href);
        walk(n.children);
      } else if (n.kind === "strong" || n.kind === "em" || n.kind === "del") {
        walk(n.children);
      }
    }
  };
  walk(parseInline(src));
  return out;
}

/** 提取文本中的术语引用 key（glossary:key 链接） */
export function collectGlossaryKeys(src: string): string[] {
  return collectLinks(src)
    .filter((h) => h.startsWith("glossary:"))
    .map((h) => h.slice("glossary:".length));
}

/* ------------------------------------------------------------------
 * 块级 Markdown 记号检测（validate 拦截用；逐行、转义感知）
 * ---------------------------------------------------------------- */

export interface BlockMdMarker {
  /** 记号名（错误信息用） */
  name: string;
  /** 引导修正文案 */
  fix: string;
  /** 命中示例片段 */
  sample: string;
}

/** 块级记号检测：行首记号一旦被反斜杠转义，行首字符就是 \，
 *  锚定正则自然放行；仅中行出现的图片记号 ![ 需做转义奇偶检查 */
function blockMarkerRules(line: string): BlockMdMarker[] {
  const found: BlockMdMarker[] = [];
  if (/^#{1,6}\s+\S/.test(line))
    found.push({ name: "标题（#）", fix: "heading / subheading 块", sample: line });
  if (/^>\s?/.test(line))
    found.push({ name: "引用（>）", fix: "quote 块", sample: line });
  if (/^[-*+]\s+\S/.test(line))
    found.push({ name: "列表（- / * / +）", fix: "list 块", sample: line });
  if (/^\d{1,9}[.)]\s+\S/.test(line))
    found.push({ name: "有序列表（1.）", fix: "list 块（ordered: true）", sample: line });
  if (/^(`{3,}|~{3,})/.test(line))
    found.push({ name: "代码围栏（```）", fix: "code 块", sample: line });
  if (/^\|.*\|\s*$/.test(line) || /^\|? *:?-+:? *\|( *:?-+:? *\|)+ *\|?\s*$/.test(line))
    found.push({ name: "表格（|）", fix: "table 块", sample: line });
  if (/^([-*_])( *\1){2,}\s*$/.test(line))
    found.push({ name: "分隔线（---）", fix: "divider 块", sample: line });
  const img = /!\[[^\]]*\]\(/.exec(line);
  if (img) {
    let bs = 0;
    for (let p = img.index - 1; p >= 0 && line[p] === "\\"; p--) bs += 1;
    if (bs % 2 === 0) {
      found.push({ name: "图片（![…](…)）", fix: "文字描述（平台暂无图片能力）", sample: line });
    }
  }
  return found;
}

/** 检测叙事字符串里的块级记号（返回去重后的规则命中） */
export function findBlockMarkers(text: string): BlockMdMarker[] {
  const out: BlockMdMarker[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    for (const m of blockMarkerRules(rawLine)) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      out.push(m);
    }
  }
  return out;
}

/** 纯文本字段是否含 Markdown 记号（validate 警告用，避免字面显示） */
export function hasInlineMarkers(text: string): boolean {
  return /(?:^|[^\\])(?:\*\*|~~|`|\[[^\]\n]*\]\(|\*\*[^*]+\*\*)/.test(text) ||
    /^\s*#{1,6}\s/.test(text) ||
    /^\s*>\s?/.test(text) ||
    /^\s*[-*+]\s/.test(text);
}

/* ------------------------------------------------------------------
 * 字段分类：哪些块字段走行内 Markdown、哪些保持纯文本
 * ----------------------------------------------------------------
 * validate 与渲染层共用这份清单，保证「放行 = 已渲染」。
 * ------------------------------------------------------------------ */

export type BlockShape = { type: string } & Record<string, unknown>;

/** 渲染为行内 Markdown 的字段（按块类型） */
export const MD_FIELDS: Record<string, string[]> = {
  paragraph: ["text"],
  list: ["items"],
  callout: ["title", "body"],
  table: ["rows"],
  definition: ["definition"],
  keypoints: ["items"],
  quiz: ["question", "options", "explanation"],
  exercise: ["description", "hint"],
  quote: ["text"],
};

/** 保持纯文本、但含文本的字段（出现记号 → 警告） */
export const PLAIN_FIELDS: Record<string, string[]> = {
  heading: ["text"],
  subheading: ["text"],
  table: ["caption", "headers"],
  definition: ["term"],
  quote: ["source"],
};

/** 遍历块的每个行内 Markdown 字符串字段（数组字段逐个回调） */
export function walkMdStrings(
  block: BlockShape,
  cb: (field: string, value: string) => void,
): void {
  const fields = MD_FIELDS[block.type] ?? [];
  for (const field of fields) {
    const v = block[field];
    if (typeof v === "string") {
      cb(field, v);
    } else if (Array.isArray(v)) {
      for (const row of v) {
        if (typeof row === "string") cb(field, row);
        else if (Array.isArray(row)) {
          for (const cell of row) if (typeof cell === "string") cb(field, cell);
        }
      }
    }
  }
}

/** 遍历纯文本字段（数组字段逐个回调） */
export function walkPlainStrings(
  block: BlockShape,
  cb: (field: string, value: string) => void,
): void {
  const fields = PLAIN_FIELDS[block.type] ?? [];
  for (const field of fields) {
    const v = block[field];
    if (typeof v === "string") cb(field, v);
    else if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "string") cb(field, item);
    }
  }
}

/** LessonBlock 上的行内 Markdown 字段遍历（类型安全的便捷包装） */
export function walkLessonBlockMd(
  block: LessonBlock,
  cb: (field: string, value: string) => void,
): void {
  walkMdStrings(block as unknown as BlockShape, cb);
}

/** LessonBlock 上的纯文本字段遍历（类型安全的便捷包装） */
export function walkLessonBlockPlain(
  block: LessonBlock,
  cb: (field: string, value: string) => void,
): void {
  walkPlainStrings(block as unknown as BlockShape, cb);
}
