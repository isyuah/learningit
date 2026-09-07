import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-buf-workflow",
  courseSlug: "grpc-go",
  title: "用 Buf 管理 proto 工程",
  summary:
    "把 proto 当作一等工程资产：用 buf 做 lint、breaking change 检查、代码生成和依赖管理，让契约变更在合并前就被发现。",
  minutes: 28,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "前面几节用裸 protoc 生成了代码。protoc 本身不提供 lint、兼容性检查或依赖管理：谁来保证字段命名一致？谁来阻止把删除的字段编号复用？谁来统一管理 googleapis 等公共依赖？Buf 是围绕 proto 工程化的一套工具链，它把这些检查变成可重复执行的命令和可写进 CI 的规则。",
    },
    {
      type: "definition",
      term: "Buf",
      definition:
        "面向 Protocol Buffers 的现代工具链，提供 lint、breaking change 检测、代码生成（buf generate）和模块/依赖管理（buf.yaml、buf.lock）。它把 proto 工程化的检查变成标准化命令。",
    },
    {
      type: "heading",
      text: "先建立 proto 的目录边界",
    },
    {
      type: "code",
      title: "buf.yaml 定义模块根",
      language: "yaml",
      code: 'version: v2\nmodules:\n  - path: proto\nlint:\n  use:\n    - STANDARD\nbreaking:\n  use:\n    - FILE',
    },
    {
      type: "paragraph",
      text: "buf.yaml 声明哪些目录属于这个 proto 模块，并打开 lint 与 breaking 检查。目录边界决定 import 路径和生成代码的包名，也决定哪些文件属于“同一份契约”。把 proto 和生成的 Go 代码分开管理，是减少生成文件污染仓库的第一步。",
    },
    {
      type: "heading",
      text: "lint 让契约有统一的风格",
    },
    {
      type: "code",
      title: "运行 buf lint",
      language: "bash",
      code: "buf lint\n# PACKAGE_VERSION_SUFFIX: package catalog should be suffixed with a correctly formed version\n# ENUM_ZERO_VALUE_SUFFIX: enum zero value AVAILABILITY_AVAILABLE should be suffixed with _UNSPECIFIED",
    },
    {
      type: "paragraph",
      text: "lint 规则不是装饰。PACKAGE_VERSION_SUFFIX 提醒你给 package 加版本号（catalog.v1 而不是 catalog），让同一个 proto 目录将来能容纳 v2；ENUM_ZERO_VALUE_SUFFIX 要求枚举零值以 _UNSPECIFIED 结尾，这正好呼应“默认值不能是真实业务状态”。规则可以按团队约定调整，但默认的 STANDARD 集合通常值得先遵守，再讨论例外。",
    },
    {
      type: "callout",
      variant: "note",
      title: "lint 是风格，breaking 是兼容性",
      body: "lint 解决“写得好不好看、规不规范”，breaking 解决“这次改动会不会破坏已发布的客户端”。两者目的不同：一个可以慢慢调整规则，另一个直接决定线上兼容性，必须在 CI 里和版本边界上一起执行。",
    },
    {
      type: "heading",
      text: "breaking 检查在合并前发现兼容性问题",
    },
    {
      type: "code",
      title: "对照上一个版本检查",
      language: "bash",
      code: "git checkout HEAD~1 -- proto   # 取出上一个版本的 proto 作为基准\nbuf breaking proto --against .git#branch=main,subdir=proto\n# FILE: previously present field \"author\" was deleted.",
    },
    {
      type: "paragraph",
      text: "buf breaking 把当前 proto 与某个基准比较，报告删除字段、复用编号、改变类型等不兼容变更。它不是“禁止改契约”，而是把改契约变成显式决策：要么接受为破坏性版本变更，要么在设计阶段就避免。这比让每个服务端团队手工记得“字段编号不能复用”可靠得多。",
    },
    {
      type: "heading",
      text: "用 buf generate 统一代码生成",
    },
    {
      type: "code",
      title: "buf.gen.yaml 声明生成规则",
      language: "yaml",
      code: 'version: v2\ninputs:\n  - directory: proto\nplugins:\n  - local: protoc-gen-go\n    out: gen\n    opt: paths=source_relative\n  - local: protoc-gen-go-grpc\n    out: gen\n    opt: paths=source_relative',
    },
    {
      type: "code",
      title: "生成代码",
      language: "bash",
      code: "buf generate\n# 从 proto 目录生成到 gen/，规则由 buf.gen.yaml 统一声明",
    },
    {
      type: "paragraph",
      text: "用 buf generate 代替散落在文档里的 protoc 命令，好处是生成规则被版本管理、可重复执行，新同事不需要从记忆里还原一条 6 行的 protoc 命令。生成文件通常提交到仓库并纳入代码评审，或由 CI 在受控环境下生成并验证与提交版本一致。两种方式各有取舍，选择前先明确团队如何保证“生成代码和 proto 永远同步”。",
    },
    {
      type: "heading",
      text: "把检查写进 CI 而不是靠自觉",
    },
    {
      type: "code",
      title: "PR 检查的最小集合",
      language: "yaml",
      code: "steps:\n  - run: buf lint\n  - run: buf breaking --against https://github.com/your-org/catalog-proto.git#branch=main,subdir=proto\n  - run: buf generate && git diff --exit-code gen/",
    },
    {
      type: "paragraph",
      text: "三个检查分别回答：风格是否符合约定、相对上次发布是否兼容、生成代码是否与 proto 同步。最后一条 git diff 能抓住“改了 proto 却忘了重新生成”的人为失误。breaking 的基准应该是真实发布的版本边界，而不是随便一个分支；否则线上客户端仍可能被悄悄破坏。",
    },
    {
      type: "table",
      caption: "裸 protoc 与 Buf 工作流的对比",
      headers: ["能力", "裸 protoc", "Buf"],
      rows: [
        ["生成代码", "手写命令行，散落在文档", "buf.gen.yaml 声明，可重复执行"],
        ["lint", "不内置", "buf lint，规则可配置"],
        ["兼容性检查", "靠人工记忆字段编号", "buf breaking 对照基准"],
        ["依赖管理", "手工下载 googleapis", "模块与 buf.lock 锁定版本"],
        ["CI 集成", "每次都要写脚本", "标准化命令，直接进 pipeline"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "工具不替代契约评审",
      body: "Buf 能抓住字段编号复用、类型改变等机械性破坏，但“这个字段语义改没改”仍然要人判断。breaking 通过不意味着契约设计正确，它只是把机械错误挡在门外。",
    },
    {
      type: "quiz",
      question: "buf breaking 最合适的基准通常是什么？",
      options: [
        "当前工作区里任意未提交的文件",
        "最近一次向客户端发布的 proto 版本边界",
        "自己电脑上的 proto 副本",
        "生成代码的字符数",
      ],
      answer: 1,
      explanation:
        "breaking 检查要回答“已发布客户端是否被破坏”，因此基准应是真实发布的版本，而不是随意选一个分支或本地状态。",
    },
    {
      type: "exercise",
      title: "为 CatalogService 建立 proto 工程",
      description:
        "为 CatalogService 创建 buf.yaml、buf.gen.yaml，把现有 catalog.proto 放进 proto 目录，运行 buf lint 修复所有违规，再用 buf breaking 验证一次删除字段的变更会被拦截。",
      hint:
        "先从 STANDARD lint 规则开始；对确实有理由的例外，用 lint.ignore 或 rule 配置显式记录原因，而不是悄悄关掉整个检查。",
    },
    {
      type: "keypoints",
      items: [
        "Buf 把 proto 的 lint、兼容性检查、生成和依赖管理变成标准化命令。",
        "lint 解决风格一致性，breaking 解决已发布客户端的兼容性，二者都要进 CI。",
        "buf.gen.yaml 统一生成规则，生成的代码要与 proto 保持同步并接受评审。",
        "breaking 的基准应是真实发布版本，工具不能替代契约评审本身。",
      ],
    },
  ],
};
