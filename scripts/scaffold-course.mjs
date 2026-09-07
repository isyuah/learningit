/**
 * 新课程脚手架：npm run scaffold:course -- --slug my-course --title "我的课程"
 * ----------------------------------------------------------------
 * 生成 src/content/courses/<slug>/ 结构（课程元信息 + 示例课时），
 * 站点通过约定式加载自动识别新课程，无需修改任何索引文件。
 *
 * 可选参数：--tagline "副标题"  --level beginner|intermediate|advanced  --hours 8
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i === -1 || !args[i + 1]) return undefined;
  return args[i + 1];
}

const slug = getArg("slug");
const title = getArg("title") ?? (slug ? slug.replace(/-/g, " ") : undefined);
const tagline = getArg("tagline") ?? "一句话副标题（在这里填写）";
const level = getArg("level") ?? "beginner";
const hours = Number(getArg("hours") ?? 8);

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error("用法：npm run scaffold:course -- --slug my-course --title \"我的课程\"");
  console.error("slug 必须是小写字母数字与连字符，例如 sql-basics");
  process.exit(1);
}
if (!title) {
  console.error("缺少 --title 参数");
  process.exit(1);
}
if (!["beginner", "intermediate", "advanced"].includes(level)) {
  console.error("--level 只能是 beginner | intermediate | advanced");
  process.exit(1);
}

const coursesDir = join(process.cwd(), "src", "content", "courses");
const dir = join(coursesDir, slug);

if (existsSync(dir)) {
  console.error(`课程已存在：${slug}`);
  process.exit(1);
}

// 封面序号与配色：按已有课程数自动分配
const count = readdirSync(coursesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
const coverIndex = String(count + 1).padStart(2, "0");
const coverColors = ["primary", "amber", "info", "success", "danger"];
const coverColor = coverColors[count % coverColors.length];
const updatedAt = new Date().toISOString().slice(0, 7);

mkdirSync(join(dir, "lessons"), { recursive: true });

const courseTs = `/* ==================================================================
 * 课程：${title}（${slug}）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "${slug}",
  title: "${title}",
  tagline: "${tagline}",
  description:
    "在这里填写课程简介。\\n\\n支持用换行分段，会渲染成多个段落。",
  level: "${level}",
  hours: ${hours},
  learners: 0,
  coverIndex: "${coverIndex}",
  coverColor: "${coverColor}",
  updatedAt: "${updatedAt}",
  outcomes: [
    "学完本课后你将掌握的能力一",
    "能力二（删除不需要的行）",
  ],
  chapters: [
    {
      id: "ch1",
      title: "第一章",
      intro: "章节导语（可选）",
      lessons: [
        { slug: "lesson-1", title: "第一课：课程导入", minutes: 12, kind: "reading" },
        { slug: "lesson-2", title: "第二课：核心概念", minutes: 15, kind: "reading" },
        // kind: reading | video | exercise | quiz；locked: true 可锁定
      ],
    },
  ],
};
`;

const sampleLesson = `/* ==================================================================
 * 课时：第一课：课程导入（lesson-1）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。课时元信息（标题/时长/类型）一律以
 * course.ts 大纲为准，本文件不需要重复声明；summary 与 blocks 是
 * 课时独有字段，写在文件里。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 写完内容后运行 npm run validate 检查。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "一句话简介（显示在大纲与页头）",
  blocks: [
    {
      type: "paragraph",
      text: "在这节课里，你将了解这门课会讲什么、怎么学。把这段示例文字替换成你的真实内容。",
    },
    {
      type: "keypoints",
      items: [
        "本课要点一：先声明学习目标",
        "本课要点二",
      ],
    },
    {
      type: "exercise",
      title: "动手练习",
      description: "给学习者一个可以立即动手的小任务。",
      hint: "可选的提示，默认折叠。",
    },
  ],
};
`;

writeFileSync(join(dir, "course.ts"), courseTs, "utf8");
writeFileSync(join(dir, "lessons", "lesson-1.ts"), sampleLesson, "utf8");

console.log(`\n✅ 已创建课程「${title}」：src/content/courses/${slug}/`);
console.log("   目录结构：");
console.log(`     course.ts          课程信息与大纲（${coverIndex} · ${coverColor} 封面）`);
console.log("     lessons/lesson-1.ts  示例课时（已自动生效，无需改索引）");
console.log("\n下一步：");
console.log("  1. 编辑 course.ts：完善简介、outcomes、章节与课时大纲");
console.log("  2. 为每个大纲 slug 新建 lessons/<slug>.ts 并写入内容");
console.log("  3. npm run validate   # 校验 slug 与内容");
console.log("  4. npm run dev        # 预览，课程已出现在首页与 /#courses\n");
