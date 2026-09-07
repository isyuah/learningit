/* ==================================================================
 * 课时：两层幂等：SQL 唯一约束与纵深防御（gline-server-ingest-storage）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码与 migrations/（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-ingest-storage",
  courseSlug: "gline-server",
  title: "两层幂等：SQL 唯一约束与纵深防御",
  summary: "应用层的幂等判断万一漏了怎么办？数据库怎么兜底？表结构如何把「不重」变成约束？",
  minutes: 14,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课讲的 Accept 事务依赖两个数据库操作:InsertBatch(ON CONFLICT DO NOTHING)与 InsertEntries。这一课看这两张表的真实结构,理解「幂等」如何从应用逻辑下沉为数据库约束——即使未来某个 handler 写错,DB 也拒绝重复。",
    },
    {
      type: "heading",
      text: "第一层:ingest_batches 主键即幂等键",
    },
    {
      type: "code",
      title: "migrations/0003_ingest_batches.up.sql(节选)",
      language: "sql",
      code: `CREATE TABLE ingest_batches (
    id              uuid NOT NULL,
    project_id      uuid NOT NULL REFERENCES projects(id),
    ...
    payload_hash    bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
    status          text NOT NULL CHECK (status IN ('committed','rejected','quarantined')),
    PRIMARY KEY (project_id, id),              -- ← 幂等键:同 project 下 batch_id 唯一
    FOREIGN KEY (project_id, agent_id, pipeline_id)
        REFERENCES pipelines(project_id, agent_id, id),
    CHECK ((status = 'committed') = (committed_at IS NOT NULL)),
    CHECK ((status = 'committed') = (error_code IS NULL))
);`,
    },
    {
      type: "paragraph",
      text: "主键是 (project_id, id) 而非自增 id——这就是「幂等第一锁」的物理实现。应用层的 InsertBatch 用 INSERT ... ON CONFLICT (project_id, id) DO NOTHING(ingest.go),靠 RowsAffected 判断是插入了(1)还是冲突了(0)。payload_hash 有 32 字节 CHECK;status 与 committed_at/error_code 的关联也有 CHECK 约束,保证状态机不会被非法组合污染。",
    },
    {
      type: "callout",
      variant: "note",
      title: "列名 sequence_no 与 JSON 字段 sequence 的对应",
      body: "数据库列叫 sequence_no,wire JSON 字段叫 sequence——两者是同一概念(Agent 的文件字节偏移/批内序号),只是 SQL 命名风格。guides 文档用 JSON 视角写 sequence_no 时容易混;以 migrations 列名和 protocol.go 的 json tag 各自为准。",
    },
    {
      type: "heading",
      text: "第二层:log_entries 的 entry 级唯一",
    },
    {
      type: "code",
      title: "migrations/0004_log_entries.up.sql(节选)",
      language: "sql",
      code: `CREATE TABLE log_entries (
    id              bigserial PRIMARY KEY,
    project_id      uuid NOT NULL REFERENCES projects(id),
    batch_id        uuid NOT NULL,
    batch_sequence  integer NOT NULL CHECK (batch_sequence >= 0),
    ...
    observed_at     timestamptz NOT NULL,
    ingested_at     timestamptz NOT NULL DEFAULT now(),
    attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (project_id, batch_id, batch_sequence),   -- ← 第二层幂等
    FOREIGN KEY (project_id, batch_id)
        REFERENCES ingest_batches(project_id, id) ON DELETE CASCADE
);`,
    },
    {
      type: "paragraph",
      text: "UNIQUE (project_id, batch_id, batch_sequence) 保证同一批内同一序号只能出现一次。平时它不触发(第一层已挡住重复批),但它是数据库级最后防线:万一应用逻辑把同一批的 entries 插了两次,这个约束会抛 23505 唯一冲突,classifyError 把它映射成 ErrConflict → 整个事务回滚。",
    },
    {
      type: "heading",
      text: "为什么需要两层?纵深防御",
    },
    {
      type: "table",
      caption: "两层幂等各防什么",
      headers: ["层", "机制", "防什么", "如果这层失效"],
      rows: [
        ["应用层", "ON CONFLICT DO NOTHING + RowsAffected", "同批并发/重试到达时只插一次", "事务回滚,不会双写批次元数据"],
        ["DB 层 1", "PK (project_id, id)", "同 project 下 batch_id 重复", "插入直接违反主键,报错回滚"],
        ["DB 层 2", "UNIQUE(project_id, batch_id, batch_sequence)", "同批同序号 entry 重复", "插入违反唯一约束,报错回滚"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "复合外键:租户隔离的第三道墙",
      body: "log_entries 的 FOREIGN KEY (project_id, batch_id) REFERENCES ingest_batches 与 (project_id, agent_id, pipeline_id) REFERENCES pipelines 都是复合的——数据库层面就杜绝了「A 项目的 batch 引用 B 项目的 pipeline」这类跨租户脏数据。应用层 RequireProject + SQL 层复合外键 = 纵深防御。",
    },
    {
      type: "heading",
      text: "检索索引:查询路径的地基",
    },
    {
      type: "paragraph",
      text: "entries 表建了多个复合索引支撑查询:log_entries_project_time_idx (project_id, observed_at DESC, id DESC) 是主检索索引(keyset 排序用);service/level 各有带前缀的复合索引;还有 ingested_at 的 BRIN 索引给 retention 清理用。下一章查询治理会看到这些索引如何被命中。",
    },
    {
      type: "quiz",
      question: "为什么 log_entries 需要 UNIQUE(project_id, batch_id, batch_sequence),而不仅仅靠 ingest_batches 的主键去重?",
      options: [
        "为了支持同一批数据跨多个 project 存储",
        "作为数据库级最后防线:即使应用层 InsertBatch 判断漏了,entry 也不会双写",
        "为了让 entries 表能做分页查询",
        "为了在删除 batch 时级联删除 entries",
      ],
      answer: 1,
      explanation:
        "这是纵深防御。第一层(ingest_batches 主键)正常挡住重复批,但万一应用逻辑出错(比如同一批被 InsertEntries 两次),第二层 UNIQUE 约束会让第二次插入抛唯一冲突并回滚整个事务——「不重」由数据库保证,不依赖应用代码永远正确。",
    },
    {
      type: "keypoints",
      items: [
        "ingest_batches 主键 (project_id, id) = 幂等第一锁;应用层用 ON CONFLICT DO NOTHING 探测。",
        "log_entries UNIQUE(project_id, batch_id, batch_sequence) = 第二层,DB 级兜底。",
        "复合外键让跨租户脏数据在 SQL 层不可能。",
        "CHECK 约束把状态机合法性(committed↔committed_at)也变成数据库约束。",
      ],
    },
  ],
};
