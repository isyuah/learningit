import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-protobuf-advanced",
  courseSlug: "grpc-go",
  title: "消息建模：Well-Known Types 与字段设计",
  summary:
    "用 Timestamp、Duration、FieldMask、包装类型和 oneof 表达真实业务语义，避免把时间、空值和枚举用裸字段硬凑。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节回答了“proto 怎样演进才兼容”，这一节回答“业务语义应该用什么字段来表达”。很多 API 设计问题的根源，不是字段名起得不好，而是用错了表示方式：把时间存成 string、把“未设置”存成零值、把互斥状态塞进两个 bool。Protocol Buffers 提供了一组 Well-Known Types，它们是标准工具，不是额外负担。",
    },
    {
      type: "definition",
      term: "Well-Known Types（WKT）",
      definition:
        "随 protobuf 一起发布的一组通用消息类型，例如 Timestamp、Duration、FieldMask、Any、Empty 和包装类型。它们用标准消息表达时间、区间、字段掩码等跨语言语义，而不是依赖语言内置类型。",
    },
    {
      type: "heading",
      text: "时间不要用 string 表达",
    },
    {
      type: "code",
      title: "用 Timestamp 而不是字符串",
      language: "protobuf",
      code: 'import "google/protobuf/timestamp.proto";\n\nmessage Book {\n  string isbn = 1;\n  string title = 2;\n  google.protobuf.Timestamp published_at = 3;\n}\n\n// 反例：\n// string published_at = 3; // 时区、格式、精度全部由调用双方自己协商',
    },
    {
      type: "paragraph",
      text: "Timestamp 表达一个确定的时间点，语义与语言和时区无关。它和 string 的关键区别不是“看起来规范”，而是生成代码会给你语言相关的类型（Go 中的 time.Time 转换、Java 中的 Instant 等），并让时间语义成为契约的一部分。范围有限的 Timestamp 是绝对时间点；如果需要“过去多久之后”或“持续多久”，那是一个区间，不是时间点。",
    },
    {
      type: "code",
      title: "Duration 表示一段时长",
      language: "protobuf",
      code: 'import "google/protobuf/duration.proto";\n\nmessage RentalPolicy {\n  string isbn = 1;\n  google.protobuf.Duration max_loan_period = 2;\n}\n\n// 反例：\n// int64 max_loan_seconds = 2; // 单位必须靠字段名和文档保证，容易写错',
    },
    {
      type: "heading",
      text: "显式表达“未设置”而不是借零值",
    },
    {
      type: "paragraph",
      text: "proto3 中 string 的默认值是空串、int 是 0、bool 是 false。如果业务里“0”和“没提供”含义不同（例如价格 0 元与没有定价），裸字段无法区分。三种常见做法：给字段加 optional 显式跟踪设置状态；用 wrapper 消息把标量包成消息；或者重新设计消息，让“没有”本身就是一种合法状态。",
    },
    {
      type: "code",
      title: "optional 与 wrapper 的选择",
      language: "protobuf",
      code: 'message SetBookPriceRequest {\n  string isbn = 1;\n  optional int64 price_cents = 2;            // 显式“可能未设置”\n  google.protobuf.StringValue description = 3; // wrapper 形式\n}\n\n// optional 让 proto3 也能追踪字段是否被显式设置；\n// wrapper 把标量变成消息，代价是额外的一层和潜在的指针语义。',
    },
    {
      type: "callout",
      variant: "note",
      title: "包装类型不是默认选择",
      body: "wrapper（StringValue、Int64Value 等）把标量变消息，生成代码里会多一层指针或包装结构，性能和心智成本更高。只有当“必须区分未设置与零值、且无法用 optional 或重新建模解决”时才考虑它。能用 optional 解决的问题，不要用 wrapper。",
    },
    {
      type: "heading",
      text: "FieldMask：告诉服务端改哪些字段",
    },
    {
      type: "code",
      title: "部分更新请求",
      language: "protobuf",
      code: 'import "google/protobuf/field_mask.proto";\n\nmessage UpdateBookRequest {\n  string isbn = 1;\n  Book book = 2;\n  google.protobuf.FieldMask update_mask = 3;\n}\n\n// 客户端只更新 title：\n// book = { isbn: "...", title: "新书名" }\n// update_mask = { paths: ["title"] }',
    },
    {
      type: "paragraph",
      text: "没有字段掩码的 UpdateBook，客户端无法表达“只改书名，其他字段保持原样”，服务端只能假设是全量替换，或自己发明一套“字段是否为 nil”的判断。FieldMask 把“这次更新哪些路径”变成契约的一部分，也让服务端可以安全地只写用户明确想改的字段。它同时是兼容性和安全边界：服务端应校验 paths 是否合法，忽略或拒绝不在允许范围内的路径。",
    },
    {
      type: "heading",
      text: "Any 与 Oneof：包装未定类型要克制",
    },
    {
      type: "code",
      title: "Any 与 oneof 的边界",
      language: "protobuf",
      code: 'message EventEnvelope {\n  string event_id = 1;\n  google.protobuf.Any payload = 2;\n}\n\n// oneof 适合已知、有限的互斥分支：\nmessage Cover {\n  oneof source {\n    string cover_url = 1;\n    bytes cover_data = 2;\n  }\n}',
    },
    {
      type: "paragraph",
      text: "Any 能携带任意类型，适合事件总线、插件系统等“类型由扩展方决定”的场景，但它把运行时类型解析、未知类型处理和跨语言注册变成调用双方的责任。若分支集合已知且有限，oneof 更安全：生成代码会给出明确的选择，旧客户端遇到未知分支时的行为也更可控。能用 oneof 或具体类型表达时，先不要用 Any。",
    },
    {
      type: "table",
      caption: "WKT 与裸字段的选择要点",
      headers: ["要表达什么", "推荐", "避免"],
      rows: [
        ["一个确定时间点", "google.protobuf.Timestamp", "string 或 int64 自造格式"],
        ["一段时长", "google.protobuf.Duration", "int64 + 文档约定单位"],
        ["可能未设置的标量", "optional 或 wrapper（按需）", "直接依赖零值"],
        ["部分更新", "google.protobuf.FieldMask", "全量替换或 nil 推断"],
        ["已知互斥分支", "oneof", "多个 bool 互相约束"],
        ["扩展方提供的任意类型", "google.protobuf.Any（受限）", "无边界地把所有消息塞进 Any"],
        ["空响应", "google.protobuf.Empty", "发明只有占位字段的响应"],
      ],
    },
    {
      type: "heading",
      text: "字段设计是契约设计，不是数据表设计",
    },
    {
      type: "paragraph",
      text: "proto 消息面向调用方：字段名、类型和嵌套结构应表达 API 语义，而不是数据库列。把内部表结构直接导出成消息，会让字段类型受存储实现绑架，未来重构数据库时反而动不了契约。设计消息时先问：调用者关心什么、什么状态是合法的、如何表达“没有”、哪些字段会一起出现或互斥。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "嵌套消息也会成为兼容性的一部分",
      body: "把字段从消息里移动到更深的嵌套结构，或把扁平字段改成 message 字段，会影响路径、JSON 映射和现有客户端代码。任何结构重构都要当作一次契约变更来评审，而不是当作内部实现细节。",
    },
    {
      type: "quiz",
      question: "为什么业务里“价格未设置”不能用裸 int64 price = 1 直接表达？",
      options: [
        "因为 int64 无法保存大于 2^63 的价格",
        "因为零值 0 无法区分“未设置”和“价格确实是 0”",
        "因为 gRPC 只允许 string 字段",
        "因为 int64 不能放进 proto3",
      ],
      answer: 1,
      explanation:
        "proto3 标量字段有默认值，裸 int64 的零值 0 会掩盖“没有提供”和“提供了 0”的区别。需要区分时用 optional、wrapper 或重新建模。",
    },
    {
      type: "exercise",
      title: "为阅读事件设计消息",
      description:
        "为 RecordReading 设计 request 和 response：事件需要记录用户、书本、阅读时长、发生时间，且“时长未知”与“时长为 0”必须可区分；响应要能表达“接受”和“逐条拒绝”。选择字段类型并说明为什么不用 string 表达时间。",
      hint:
        "先列出所有合法状态，再决定哪些字段用 Timestamp/Duration/optional，以及逐条结果应该用 status code 还是消息字段表达。",
    },
    {
      type: "keypoints",
      items: [
        "Timestamp 与 Duration 表达时间点和时长，让语义成为契约而不是口头约定。",
        "optional 和 wrapper 能区分“未设置”与零值，但 wrapper 有额外代价。",
        "FieldMask 让部分更新明确、可校验，而不是靠 nil 或全量替换猜测。",
        "Any 适合扩展方自定类型的场景，已知互斥分支优先用 oneof。",
        "消息字段按 API 语义设计，不要把内部存储结构直接导出成契约。",
      ],
    },
  ],
};
