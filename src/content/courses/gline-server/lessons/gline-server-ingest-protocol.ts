/* ==================================================================
 * 课时：摄取协议：严格解码与 canonical hash（gline-server-ingest-protocol）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-ingest-protocol",
  courseSlug: "gline-server",
  title: "摄取协议：严格解码与 canonical hash",
  summary: "Agent 发来的 JSON 如何被严格解码、逐字段校验，并算出一个「与字节序无关」的幂等 hash？",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "协议层 internal/protocol/ingestv1 是 Agent 与 Server 共享的同一个 Go 包——两端编解码用同一份代码，协议漂移会在编译期暴露。这一课拆 Decode 与 Normalize:输入如何被严格解析、逐字段校验、最后变成带 canonical hash 的领域 Batch。",
    },
    {
      type: "heading",
      text: "wire 格式:版本化的 BatchRequest",
    },
    {
      type: "code",
      title: "真实 wire 字段(protocol.go:22-39)",
      language: "json",
      code: `{
  "protocol_version": 1,
  "batch_id": "uuid",            // Agent 生成,重试不变
  "agent_id": "uuid",
  "pipeline_id": "uuid",
  "sequence": 123,               // 批内有序号,单调(文件字节偏移)
  "sent_at": "RFC3339",
  "entries": [
    {
      "sequence": 0,             // 必须 = 数组下标(0,1,2...)
      "observed_at": "RFC3339",  // 事件时间(Agent 时钟)
      "level": "INFO",           // TRACE..FATAL
      "service": "...", "host": "...",
      "message": "...",
      "attributes": { ... }      // 任意 JSON,深度受限
    }
  ]
}`,
    },
    {
      type: "callout",
      variant: "note",
      title: "字段名以源码为准",
      body: "仓库 docs/guides 的协议示例把字段写作 version / sequence_no,那是旧版描述。当前源码(protocol.go:22-39)的真实 JSON tag 是 protocol_version 与 sequence。阅读旧文档时要注意:学习本课以代码为准。",
    },
    {
      type: "heading",
      text: "Decode:拒绝一切含糊",
    },
    {
      type: "paragraph",
      text: "Decode(protocol.go:84)的严格性体现在四个选择:",
    },
    {
      type: "list",
      items: [
        "DisallowUnknownFields:未知字段直接报错——防止「发错字段名但被静默忽略」的漂移。",
        "UseNumber:JSON 数字用 json.Number 保留原文,不用 float64——防止大整数精度损失。",
        "LimitReader(max+1):超限读 max+1 字节即可判定 body 过大,返回 ErrBodyTooLarge(413)。",
        "单对象 + 拒绝 trailing:解码后再 Decode 一次必须 io.EOF,否则报 ErrTrailingJSON——拒绝「一个请求塞两个 JSON」。",
      ],
    },
    {
      type: "heading",
      text: "Normalize:校验 + 规范化 + 注入身份",
    },
    {
      type: "paragraph",
      text: "Normalize(protocol.go:117)把 wire 的 BatchRequest 变成领域的 domain.Batch。它做三件事:",
    },
    {
      type: "list",
      items: [
        "逐字段校验:protocol_version=1;batch_id/agent_id/pipeline_id 是合法 UUID;sequence ≥ 0;sent_at 非零;entries 非空且 ≤ 上限;每条 entry 的 sequence 必须等于数组下标(拒绝乱序/空洞);level 属于六种合法值;service/host/message/attributes 有长度与深度上限。",
        "错误聚合:所有校验错误收进 validator(fields 最多 MaxFieldErrors=16 条),返回 ValidationError → HTTP 422 invalid_batch,details 带每条错误的 path+reason——Agent 拿到能精确定位坏字段。",
        "注入身份:把认证得到的 projectID 写进 batch 和每条 entry(entry.ProjectID = projectID),并回填 BatchID/AgentID/PipelineID。这正是 AGENTS.md「项目身份来自认证上下文,绝不来自请求体」的落实——请求体里没有 project_id 字段。",
      ],
    },
    {
      type: "heading",
      text: "CanonicalPayload:幂等 hash 的输入",
    },
    {
      type: "paragraph",
      text: "幂等判重不能直接对原始请求字节做 hash——同一逻辑内容,Agent 重试时 JSON 键序、空白、数字表示可能不同(不同版本 Agent、代理重排)。所以 CanonicalPayload(protocol.go:192-230)**手工构造一份规范 JSON**:",
    },
    {
      type: "list",
      items: [
        "固定键序:batch 级字段按 protocol_version → batch_id → agent_id → pipeline_id → sequence → sent_at → entries 写死顺序。",
        "规范化标量:UUID 转小写;时间统一 UTC + RFC3339Nano;sequence 用十进制整数。",
        "规范化 attributes:走 canonicalJSON——递归排序键、规范化数字(避免 1 vs 1.0 vs 1e0 被视为不同)、限定深度。",
        "每条 entry 的 sequence 用数组下标(0,1,2...)而不是请求里的原始值——保证重试时即使 entry 顺序没变也一致。",
      ],
    },
    {
      type: "code",
      title: "sha256(canonical) → 32 字节 payload hash",
      language: "text",
      code: "canonical := CanonicalPayload(request, normalizedEntries)  // 确定性 JSON\npayloadHash := sha256.Sum256(canonical)                          // 32 B\n\n// 同逻辑内容的 batch,无论 wire 字节序如何 → 同 hash\n// 不同内容(哪怕一个字符) → 不同 hash",
    },
    {
      type: "callout",
      variant: "warning",
      title: "为什么 canonical 不含 project_id",
      body: "CanonicalPayload 只序列化请求本身的字段,project 是认证上下文、由 Normalize 注入。幂等判重是 (project_id, batch_id) + payload_hash:project_id 在数据库唯一约束里,hash 只负责「同一 batch_id 的内容是否一致」。如果把 project 编进 hash,同 batch_id 在不同 project 会得到不同 hash,反而干扰判重。",
    },
    {
      type: "quiz",
      question: "Agent 重试同一批数据,但这次 JSON 里 attributes 的键顺序变了(内容相同)。Server 的 payload hash 会变吗?",
      options: [
        "会变,因为原始字节不同",
        "不会变,因为 canonical 递归排序了键",
        "会变,因为 hash 包含键序信息",
        "不确定,取决于 attributes 嵌套深度",
      ],
      answer: 1,
      explanation:
        "CanonicalPayload 对 attributes 走 canonicalJSON——递归排序键、规范化数字。所以「内容相同、键序不同」的两个请求产生相同的 canonical 字节,sha256 相同。这正是「与字节序无关」的幂等 hash 的意义。",
    },
    {
      type: "keypoints",
      items: [
        "Agent 与 Server 共享 ingestv1 包,协议漂移编译期暴露。",
        "Decode 严格:拒未知字段、拒 trailing、json.Number 保精度、限量读 body。",
        "Normalize 校验 + 规范化 + 注入认证身份(project_id 不进请求体)。",
        "canonical hash 与字节序无关:固定键序 + 排序 attributes + 规范化数字/时间。",
      ],
    },
  ],
};
