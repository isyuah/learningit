import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-protobuf-contract",
  courseSlug: "grpc-go",
  title: "Protobuf 契约与兼容性",
  summary:
    "理解字段编号、默认值、枚举、oneof 与 reserved，学会让 proto 在多版本客户端共存时仍可演进。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "gRPC 项目最容易被低估的部分不是 server.Serve，而是契约演进。服务端和客户端不一定同时发布：旧客户端可能继续发送旧字段，新客户端可能读取新字段。Protocol Buffers 的字段编号和未知字段处理，为这种滚动升级提供了基础，但它不会替你修复不兼容的设计。",
    },
    {
      type: "heading",
      text: "字段名会变，字段编号不能随便变",
    },
    {
      type: "code",
      title: "字段编号是线上身份",
      language: "protobuf",
      code: 'message Book {\n  string isbn = 1;\n  string title = 2;\n  string author = 3;\n}\n\n// 可以改字段名，但改名会影响生成代码和 JSON 映射习惯\n// 不能把原来的 author = 3 改成不同语义的 price = 3\n// 删除字段后也不能马上复用 3\nmessage BookV2 {\n  reserved 3;\n  reserved "author";\n  string isbn = 1;\n  string title = 2;\n  string price = 4;\n}',
    },
    {
      type: "paragraph",
      text: "二进制消息使用 field number 识别字段。删除字段后使用 reserved 把编号和名称保留下来，编译器可以阻止后来的人误复用。字段编号不是数组下标，也不是为了好看而顺序排列的 UI 序号。",
    },
    {
      type: "heading",
      text: "默认值会隐藏“字段没传”和“字段传了零值”",
    },
    {
      type: "paragraph",
      text: "proto3 的标量字段有语言相关的默认值。对于 string，未设置时通常读成空字符串；数值读成 0；bool 读成 false。若业务需要区分“没有提供”和“明确提供了空值/零值”，要使用 optional、message 包装类型或重新建模，而不能只看 Go 结构体读出来的零值。",
    },
    {
      type: "table",
      caption: "常见契约变更的风险",
      headers: ["变更", "通常是否兼容", "原因与做法"],
      rows: [
        ["新增字段", "通常兼容", "旧客户端忽略未知字段；新客户端要接受旧服务端缺少该字段"],
        ["删除字段并保留编号", "可兼容", "用 reserved 防止编号和名称被复用"],
        ["改变已有字段语义", "不兼容", "同一个编号会被旧版本按旧含义解读"],
        ["改变字段类型", "高风险", "即便 wire type 偶尔相容，业务语义和生成类型也可能不相容"],
        ["给 enum 新增值", "通常兼容", "旧客户端可能把未知数值当作未知值，不能假设它理解新语义"],
      ],
    },
    {
      type: "heading",
      text: "枚举与 oneof 要表达状态，而不是省字段",
    },
    {
      type: "code",
      title: "把互斥结果表达清楚",
      language: "protobuf",
      code: 'enum Availability {\n  AVAILABILITY_UNSPECIFIED = 0;\n  AVAILABILITY_IN_STOCK = 1;\n  AVAILABILITY_SOLD_OUT = 2;\n}\n\nmessage BookView {\n  string isbn = 1;\n  Availability availability = 2;\n\n  oneof cover {\n    string cover_url = 3;\n    bytes cover_image = 4;\n  }\n}',
    },
    {
      type: "paragraph",
      text: "枚举通常把 UNSPECIFIED 放在 0 位，避免默认值被误解成一个真实业务状态。oneof 适合表达同一时刻只能出现一种表示的选择；如果客户端收到未知的新 oneof 分支，旧客户端不能把它当作自己理解的分支处理，所以业务要保留安全的 fallback。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要把 proto 当数据库表直接暴露",
      body: "数据库字段的生命周期、隐私和聚合方式，通常与对外服务契约不同。proto 应围绕调用者需要的语义设计；为了省映射代码而把内部表结构原样导出，会让内部重构变成外部兼容性事故。",
    },
    {
      type: "heading",
      text: "服务方法也属于契约",
    },
    {
      type: "paragraph",
      text: "新增一个 RPC 通常比修改已有 RPC 更容易兼容。对于查询类能力，优先定义清晰的请求和响应；列表查询要提前考虑分页、排序、过滤和结果上限；写入类方法要明确重复调用是否安全。一个名为 UpdateBook 的方法，如果没有定义资源标识和字段掩码，客户端很难知道它是全量替换还是部分更新。",
    },
    {
      type: "quiz",
      question: "删除 proto 字段后，为什么通常要写 reserved 3？",
      options: [
        "让字段 3 在网络上传输得更快",
        "防止未来把 3 复用于不同语义，导致旧消息被错误解读",
        "让 Go 编译器自动生成数据库迁移",
        "让旧客户端自动获得新字段",
      ],
      answer: 1,
      explanation:
        "field number 是线上身份。复用已删除编号可能让旧数据或旧客户端发送的字段被新代码按不同语义解析，reserved 能把这种错误变成编译期问题。",
    },
    {
      type: "exercise",
      title: "审查一次 proto 变更",
      description:
        "把 Book 增加 published_at、删除 author、增加 price 和 availability。分别决定哪些字段可以直接新增，哪些编号必须 reserved，以及如何表示“没有发布时间”和“发布时间为 Unix epoch”的区别。",
      hint:
        "先列出旧客户端可能发送什么、新客户端可能读取什么，再决定是否需要 optional 或 Timestamp message。",
    },
    {
      type: "keypoints",
      items: [
        "field number 是二进制契约的身份，删除后不要复用，使用 reserved。",
        "新增字段通常比改变已有字段语义更容易兼容。",
        "默认值可能抹平“未设置”和“明确设置为零值”的区别。",
        "enum 的 0 值应是安全的 UNSPECIFIED；oneof 用于互斥表示。",
        "服务方法的请求、响应、分页和幂等语义同样需要设计。",
      ],
    },
  ],
};
