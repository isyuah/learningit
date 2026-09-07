/* ==================================================================
 * 课时：告警模型：规则、实例与状态机（gline-server-alerting-model）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * 前置：已学摄取(ingest)与查询治理(query)章——告警直接在这两层之上。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-alerting-model",
  courseSlug: "gline-server",
  title: "告警模型：规则、实例与状态机",
  summary: "告警系统怎么描述「什么时候该报警」？normal/pending/firing 三态与 ForSeconds 如何把抖动变成确定事件？",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面学的摄取与查询解决「日志进来、能查」。告警系统解决「日志里出现了问题,主动通知你」。Gline 的 alerting 是 0006 迁移新增的子系统,完全建在你已学的两层之上:评估时直接对 log_entries 做 COUNT(类似查询但更简单),命中阈值就把通知可靠地送进 webhook。这一课先建模型:规则长什么样、实例状态机怎么转、为什么需要 pending 过渡。",
    },
    {
      type: "heading",
      text: "三张核心表:通道、规则、实例",
    },
    {
      type: "paragraph",
      text: "migrations/0006_alerting.up.sql 建了五张表,核心三张:",
    },
    {
      type: "table",
      caption: "告警核心表",
      headers: ["表", "一行是什么", "关键约束"],
      rows: [
        ["alert_channels", "一个通知目的地(目前只有 webhook)", "kind ∈ {webhook};URL 当凭据:create 响应全量返回一次,其余掩码"],
        ["alert_rules", "一条「什么条件下报警」的规则", "metric ∈ {count, error_ratio};window ∈ {60,300,900,3600};threshold > 0"],
        ["alert_instances", "一条规则的运行状态(每规则恰好一行)", "status ∈ {normal,pending,firing};带 lease 与 version"],
      ],
    },
    {
      type: "paragraph",
      text: "alert_channels.config 存 webhook URL,注释明确「URL 像 credential 一样对待」——存储原文,但只有 create 响应返回完整 URL,列表/详情一律掩码成 scheme://host/****(mirrors api_keys.secret_hash behaviour,0006:8-10)。删除被规则引用的通道会触发外键 23503 → 409(channel 无 ON DELETE 动作)。",
    },
    {
      type: "heading",
      text: "规则:描述「何时报警」",
    },
    {
      type: "paragraph",
      text: "一条规则的完整字段(domain/alerting.go:66-88 + 0006:13-43):",
    },
    {
      type: "code",
      title: "AlertRule 的关键字段",
      language: "text",
      code: "metric: count | error_ratio        # 数条目数 / 错误率\nfilter_services/hosts/levels/message  # 完全镜像日志检索的过滤模型\nwindow_seconds: 60/300/900/3600       # 聚合窗口(闭集,DB CHECK)\nthreshold: e.g. 10                    # 触发:指标 >= threshold\nrecovery_threshold: e.g. 3            # 恢复:指标 < recovery_threshold\nfor_seconds: e.g. 300                 # 连续满足多久才真正 firing\nstatus: enabled | paused | disabled   # 规则自身开关\nversion: 1..                          # 每次配置更新自增",
    },
    {
      type: "callout",
      variant: "warning",
      title: "两种指标语义(count 与 error_ratio)",
      body: "count:统计匹配日志条数,触发 = 条数 ≥ threshold。error_ratio:分子永远是 level=ERROR 的条数,分母是规则过滤下的总条数,触发 = 比值 ≥ threshold(如 0.5 = 50% 错误率)。注意 error_ratio 的分子「忽略规则自身 levels 过滤」——规则 levels 若不含 ERROR,分子需要单独一趟 ERROR-only 查询(service_eval.go:232-268)。",
    },
    {
      type: "paragraph",
      text: "窗口为什么是闭集 {60,300,900,3600}?因为窗口决定了评估节奏:每个窗口恰好评估一次(见投递课的 last_eval_at 门控)。闭集让「一窗口一次」的调度与 for_seconds 的墙钟语义可预测——这是把「聚合窗口」和「评估周期」绑死成一个概念的设计。",
    },
    {
      type: "heading",
      text: "实例状态机:normal → pending → firing",
    },
    {
      type: "paragraph",
      text: "alert_instances 是规则的对偶:每规则一行,记录它当前的告警状态。状态机(domain/alerting.go:290-318 的 TransitionStatus)是 alerting 的核心逻辑:",
    },
    {
      type: "code",
      title: "TransitionStatus 的精确规则",
      language: "text",
      code: "对一次评估结果(窗口内指标值):\n\n1. 健康不是 ok(no_data / error):\n   pending -> normal       # 未达 firing 的候选回落(不算恢复,不发事件)\n   firing  -> 保持 firing    # 数据空洞绝不能伪装成恢复!streak 清零\n\n2. ok 且未触发(value < threshold):\n   -> normal, streak 清零\n\n3. ok 且触发(value >= threshold):\n   streak + 1\n   normal  -> pending        # 开始计数连续满足\n   pending -> 若 streak*窗口秒数 >= for_seconds 则 firing\n             否则停留 pending\n   firing  -> 保持 firing",
    },
    {
      type: "callout",
      variant: "tip",
      title: "为什么需要 pending:抗抖动",
      body: "没有 pending,一次瞬时抖动(比如某分钟恰好 10 个 ERROR)就会立刻报警,恢复后又立刻消停——通知轰炸。pending + for_seconds 的意思是:「这个条件必须连续成立 for_seconds 秒,我才认为真的出事了」。窗口级门控保证每窗口恰好评估一次,所以「满足的窗口数 × 窗口秒数」就是真实的墙钟时长——for_seconds=300、窗口=60 意味着连续 5 个窗口都触发才 firing。",
    },
    {
      type: "heading",
      text: "no_data 与 error:健康是独立维度",
    },
    {
      type: "paragraph",
      text: "实例有两个正交状态:status(告警三态)与 eval_health(ok/no_data/error)。0 条日志 = no_data,**不算满足、不算比值、也不算恢复**(domain/alerting.go:247-260 NewEvalResult 注释;storage 注释「绝不从 zero total 伪造恢复」)。查询失败 = error 健康,同样不触发不恢复,只记 eval_health=error、streak 清零。设计意图:数据源消失(日志停了/查询坏了)不该被误判成「问题解决了」——那是两件不同的事。",
    },
    {
      type: "heading",
      text: "事件与通知的边界",
    },
    {
      type: "paragraph",
      text: "状态**进入** firing 时写一条 fired 事件;离开 firing(恢复)写 resolved 事件。pending 直接回落 normal **不发事件**——它从未真正报警过。events 表是可查的历史;真正的对外通知走 outbox(下一课)。注意 alert_events.type 允许 no_data/error,但当前服务从不写这两种事件——CHECK 允许、路径预留(下一课 delivery 会看到 outbox 只投 fired/resolved)。",
    },
    {
      type: "exercise",
      title: "推演一个完整的告警生命周期",
      description:
        "规则:count 指标、window=60s、threshold=10、for_seconds=300。某时刻起每分钟 ERROR 数:0, 12, 15, 8, 20, 20, 20, 3, 0。逐分钟写出实例状态(normal/pending/firing)、streak、是否发 fired/resolved 事件、何时发通知。",
      hint: "第 1 分钟 no_data(健康维度,状态不动);第 2 分钟触发但才 streak=1 未达 for;8 那分钟未触发会清零 streak。firing 后 3 和 0 那两分钟:3 < recovery_threshold?注意触发和恢复阈值不同。",
    },
    {
      type: "quiz",
      question: "一条规则处于 pending(连续 2 个窗口触发,for_seconds=300、window=60),下一个窗口查询返回 0 条日志(no_data)。实例会怎样?",
      options: [
        "pending → normal,因为数据消失了",
        "保持 pending,streak 清零,不发任何事件",
        "pending → firing,因为已经满足过触发条件",
        "保持 firing,因为 no_data 不算恢复",
      ],
      answer: 1,
      explanation:
        "TransitionStatus 规则:健康不是 ok 时,pending → normal(未达 firing 的候选回落),streak 清零,不发事件(只有 firing 离开才发 resolved)。no_data 既不算满足也不算恢复——它只是把「差一点就 firing」的候选打回 normal,避免数据空洞累积成误报。",
    },
    {
      type: "keypoints",
      items: [
        "alert_channels(webhook URL 当凭据)/ alert_rules(条件)/ alert_instances(每规则一行运行态)。",
        "规则:metric + filter + 闭集 window + threshold/recovery_threshold + for_seconds。",
        "实例状态机:normal→pending→firing;连续满足 for_seconds 才 firing。",
        "no_data/error 是独立健康维度:不触发、不恢复、不发事件。",
        "进入/离开 firing 才写事件;pending 回落不发事件。",
      ],
    },
  ],
};
