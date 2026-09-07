/* ==================================================================
 * 课时：告警与告警治理（obs-alerting）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：Prometheus 3.14（2026-08）；规则文件格式与 2.x 兼容。
 * 本课只讲 Prometheus 内置告警规则的评估与 Prometheus↔Alertmanager
 * 职责边界，不部署 Alertmanager（部署见 obs-full-stack-deploy）。
 * 指标均为 shop 示例服务指标，PromQL 见上一课（obs-promql）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-alerting",
  courseSlug: "observability",
  title: "告警与告警治理",
  summary: "把 PromQL 变成「需要人决策」的通知：规则结构、for 的语义、Prometheus 与 Alertmanager 的分工，以及不会破产的告警设计。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课（obs-promql）教会我们把原始序列算成能回答问题的数字，但数字不会自己喊人。错误率超过 1% 时，值班工程师不会恰好盯着曲线——告警（alerting）就是那道「曲线到人」的最后一段：系统按规则评估指标，只在**需要人决策**的时刻主动通知。判断「需不需要人」可以借用两个问题：这件事用户正在受影响吗？人收到通知后有事可做吗？——单次 500 错误通常两个答案都是否（可能是重试即可的偶发抖动，人收到也做不了什么），而「全站 5xx 占比超过 1% 持续 5 分钟」两个答案都是是。反过来说，如果一条告警触发后收信人只会说「哦」然后关掉，它就违背了目的——它只是在制造噪声。这一课先讲清告警最常见的失效方式，再解剖规则文件里 expr / for / labels / annotations 每一段的含义（for 的语义最容易被误解，值得单独较真），然后划清 Prometheus 与 Alertmanager 的职责边界，最后给出一套让收信人「立刻能行动」的告警设计准则。学完你应能为 shop 写出携带完整上下文的告警规则，并理解为什么很多团队的告警最终会被所有人静音。",
    },
    {
      type: "heading",
      text: "告警的反模式：疲劳、噪声与无指引",
    },
    {
      type: "list",
      items: [
        "告警疲劳（alert fatigue）：每个抖动都响。CPU 每 5 分钟冲高一次就 page 一次、任何错误计数增长就响——系统很快就教会所有人忽略它，等到真故障来临，通知已被当作日常噪声处理，这是告警体系最常见的破产方式。",
        "把日志错误当告警：日志里的 ERROR 是常态噪声（重试、用户取消、上游偶发失败都可能记 ERROR），直接把「ERROR 条数 > 0」变成告警等于一天几百条。告警应当基于**对用户的影响**（错误率、延迟、饱和度），而不是内部实现细节的文本。",
        "无行动指引的告警：通知只有「CPU 高」没有下文。收信人不知道影响面多大、不知道该看哪张图、不知道下一步做什么，只能焦虑地转发——告警缺少「怎么查」就等于把排障第一阶段的活扔给被吵醒的人。",
      ],
    },
    {
      type: "heading",
      text: "规则解剖：expr、for、labels、annotations",
    },
    {
      type: "paragraph",
      text: "告警规则写在与 Prometheus 主配置分离的**规则文件**里，顶层是 `groups`（组只是组织单元），组内是规则。一条 alerting rule 有五个字段：`alert` 是规则名（会变成 `ALERTS` 系列上的 `alertname` 标签）；`expr` 是上一课的 PromQL 表达式——告警规则与面板共用同一套查询语言，只是多了阈值比较；`for` 是触发前的持续时间；`labels` 会被附加到这条告警上，是 Alertmanager 做路由分组的依据；`annotations` 是给人看的补充信息（summary / description / runbook 链接等）。Prometheus 按配置的 `evaluation_interval`（规则求值周期，常见 15s～1m，具体以你的配置文件为准）周期性求值每条 expr：当结果存在满足条件的序列时，这条告警进入 **pending**（待定）；此后每次求值都保持为真、累计满 `for` 的时长才转为 **firing**（触发）——期间只要有一次求值为假，pending 计时就清零重来。也就是说 `for: 5m` 的含义是「**连续** 5 分钟都超过阈值才响」，而不是「5 分钟里出现过一次就响」。状态可以在 Prometheus 网页的 Alerts 页实时看到。规则文件里还有另一种规则——**记录规则（recording rule）**：用 `record:` 代替 `alert:`，把高成本或高频使用的表达式按求值周期预先算好存成新指标（如把整条错误率表达式存成一条 `...:errors_ratio_5m`），面板与告警直接引用结果，一句话概括就是「把慢查询变成预计算指标」，本课不深入。",
    },
    {
      type: "code",
      title: "shop 的告警规则文件（rules/shop_alerts.yml 片段）",
      language: "yaml",
      code: "groups:\n  - name: shop_http_alerts\n    rules:\n      # 主线示例：全站 5xx 占比 > 1% 且持续 5 分钟才触发。\n      # expr 复用上一课的错误率查询，末尾加上 > 0.01 的比较。\n      - alert: ShopHighErrorRate\n        expr: |\n          sum(rate(shop_http_requests_total{status=~\"5..\"}[5m]))\n            / sum(rate(shop_http_requests_total[5m])) > 0.01\n        for: 5m\n        labels:\n          severity: page\n        annotations:\n          summary: \"shop 全站 5xx 错误率超过 1%（当前 {{ $value | humanizePercentage }}）\"\n          runbook: \"https://wiki.example/shop/runbooks/high-error-rate\"\n\n      # 第二例：支付链路 p90 延迟 > 5s 持续 5m。\n      # 表达式内部 [5m] 是 rate 的范围向量窗口；for: 5m 是另一回事，见下。\n      - alert: ShopPaymentsLatencyHigh\n        expr: |\n          histogram_quantile(0.9,\n            sum by (le) (rate(shop_http_request_duration_seconds_bucket{route=\"/payments\"}[5m]))\n          ) > 5\n        for: 5m\n        labels:\n          severity: page\n        annotations:\n          summary: \"支付回调 p90 延迟超过 5 秒\"\n          runbook: \"https://wiki.example/shop/runbooks/payments-latency\"",
    },
    {
      type: "callout",
      variant: "note",
      title: "两个「5m」不是一回事",
      body: "延迟规则里 `histogram_quantile(...)` 内部的 `[5m]` 是传给 rate 的**范围向量窗口**：每次求值时，Prometheus 取过去 5 分钟的桶样本算每秒速率，瞬间压成一条即时向量再比较 `> 5`——窗口是「往前看多久的数据」。而 `for: 5m` 作用在**规则求值周期**的维度：它不改变 expr 的计算方式，只是规定「这个布尔结果为真需要连续保持多久」——窗口是「往前累计多少个求值周期都成立」。求值周期常见为 15s～1m，若周期是 15s，`for: 5m` 约等于要求连续 20 次求值全部超阈值。很多误配的告警把两者混为一谈：以为 `for: 5m` 是在等「5 分钟窗口里的数据」慢慢滑出，其实规则每周期都在用最近 5 分钟的数据求值，`for` 只负责滤掉「偶尔超一次」的毛刺。",
    },
    {
      type: "heading",
      text: "谁来发通知：Prometheus 与 Alertmanager 的边界",
    },
    {
      type: "paragraph",
      text: "Prometheus 自己**不发**邮件、IM、电话——它只做两件事：周期性地求值规则，以及把进入 firing（和解除 firing）的告警通过 HTTP 推送给下游。真正负责「怎么通知人」的是 **Alertmanager**：一个独立组件，接收所有 Prometheus（可多套）推来的告警，统一处理后交给 receiver（邮件、IM、PagerDuty 等）发送。中间为什么要隔一层？因为生产里的故障是成片的——支付链路一慢，延迟、错误率、实例 down 的规则会同时触发几十条，若每条直接发一条通知就是通知风暴；Alertmanager 的四种机制正是为「成片故障」设计的。职责边界请记牢：**Prometheus 判定「出事了没有」，Alertmanager 决定「怎么让对的人知道」**。本课不部署 Alertmanager（本地全栈部署与配置见 obs-full-stack-deploy 一课），先把边界与机制讲清。另提一句替代方案：如果团队已统一在 Grafana 工作，Grafana Alerting 提供界面化的告警编辑与内置的通知路由，可作为 Prometheus 内置告警的替代；本课程主线仍以 Prometheus 规则为准。",
    },
    {
      type: "table",
      caption: "Alertmanager 的四种机制",
      headers: ["机制", "解决的问题", "效果"],
      rows: [
        ["分组（grouping）", "同一时刻触发的几十条相关告警", "按共享标签（如 alertname、cluster）合并成一条通知，收信人一次看到一批，而不是被轰炸"],
        ["抑制（inhibition）", "父故障与它派生的次级告警同时响", "更严重的告警（如实例 down）在响时，抑制其派生的次要告警（如该实例 CPU 高），减少重复轰炸"],
        ["静默（silence）", "发版、演练等已知维护窗口", "按标签匹配屏蔽指定时间段内的告警，相当于声明「这段时间我不想知道」"],
        ["路由（routing）", "不同告警该由不同团队、不同渠道接收", "按标签匹配把告警送达对应 receiver（邮件 / IM / 电话），让对的人收到对的告警"],
      ],
    },
    {
      type: "heading",
      text: "告警设计：让收信人立刻能行动",
    },
    {
      type: "paragraph",
      text: "写一条告警前，用三个问题过一遍：**谁受影响**（哪些用户、哪条链路）、**多严重**（要不要立刻叫醒人）、**怎么查**（第一步看什么）。这三个答案分别落到规则的两个字段上：`labels` 决定路由与分级——`severity: page` 表示需要立刻打扰值班人（电话 / PagerDuty），`severity: ticket` 表示记录在案、工作时间内处理，分级标准由团队的 on-call 政策定，核心原则是 page 只能留给「用户正在受影响且需要人决策」的事件；`annotations` 决定收信人体验——summary 用一句人话讲清发生了什么，再附 runbook 链接或排障指引（如「打开按 route 拆分的错误率面板，用最近的 5xx trace_id 过滤日志」），让人醒来第一分钟就知道去哪。两个直觉值得现在就建立：其一，告警疲劳的根源多半不是阈值低，而是收信人不知道每条告警要他干什么——无行动指引的告警会透支告警系统的信用；其二，只盯瞬时错误率会漏掉「错误率不高但持续吃掉错误预算」的慢性故障——成熟做法用多窗口 burn rate（燃烧速率）衡量预算消耗速度，短窗口负责「现在炸没炸」、长窗口负责「是不是在持续恶化」，具体机制由 SLO 课时（obs-slo）详解，这里先记住告警窗口要有长有短。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "for: 0 与 for 过长：两端的代价",
      body: "`for: 0`（或漏写）意味着任何一次求值瞬时超过阈值就触发：一次慢样本、发布瞬间的抖动、某个上游的偶发超时都会直接 page，频繁误报会迅速教会值班人忽略通知——告警信用一旦破产很难重建。反过来 `for` 设得过长（比如 30 分钟）代价同样真实：故障从第一分钟起就在伤害用户，系统却要等半小时才响，等于主动拉长 MTTR。权衡的方法：`for` 至少要覆盖几个求值周期，让窗口内的 rate 平滑掉采样毛刺；具体长度按「误报代价」与「故障代价」的相对大小取——毛刺多的信号要长一些，用户直接受损的关键路径可以短但要配好指引。记住一个原则：宁可阈值保守一点、指引完善一点，也不要靠 `for: 0` 追求「不漏报」——被忽略的告警比没有告警更危险。",
    },
    {
      type: "exercise",
      title: "为 shop 定义三条告警规则",
      description:
        "按本课规则文件的结构，为 shop 设计三条告警（用文字描述即可，不必写完整 YAML，但请写出 alert 名、expr 大意、for、severity，以及 annotations 里的行动指引）：1）全站 5xx 错误率告警（主线示例式），severity 设为 page，指引里写明第一步打开按 route 拆分的错误率面板、再用高延迟/错误请求的 trace 定位；2）支付链路 /payments 的 p90 延迟 > 5s 告警，severity 设为 page，指引写明这是用户直接感知的链路，先看支付组件与 SQLite 的耗时；3）订单失败数告警——用 `increase(shop_orders_failed_total[10m])` 表达「最近 10 分钟失败了多少单」，阈值取一个明显高于正常基线的值，severity 设为 ticket（下单失败可能有上游或业务原因，未必需要半夜叫醒人），annotations 里写清谁受影响（正在下单的用户、对账流程）与第一步查什么。每条都检查三问：谁受影响？多严重？怎么查？",
      hint: "labels.severity 决定路由与是否 page；annotations 里写 summary（一句人话）+ runbook 链接或排障步骤。阈值要与正常基线拉开距离（如错误率基线 0.1% 时阈值取 1%），for 至少覆盖几个求值周期以滤掉毛刺。",
    },
  ],
};
