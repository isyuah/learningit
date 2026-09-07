/* ==================================================================
 * 课时：SLO 与错误预算（obs-slo）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-slo",
  courseSlug: "observability",
  title: "SLO 与错误预算",
  summary: "把「用户体验」翻译成可审计的目标，让告警从噪音回归北极星：SLI、SLO、错误预算与 burn rate。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面几课把「怎么度量、怎么查询、怎么告警」都搭好了，但有一个问题悬而未决：规则越来越多，阈值各拍各的脑袋，告警响了到底该不该紧张？规则越多，每条被认真对待的概率越低——告警疲劳不是人的态度问题，而是目标体系缺位：你没法判断一条告警和「用户真的受损」之间是什么关系。这一课补上缺位的锚：SLI、SLO 与错误预算。它不引入新工具，而是给整套观测体系一个以用户体验为中心的决策框架。",
    },
    {
      type: "definition",
      term: "SLI（Service Level Indicator，服务等级指标）",
      definition: "对用户可感知质量维度的可量化测量，必须能用计数器或直方图算出来。例如 shop 的支付回调（POST /payments）：「延迟 ≤ 1s 的请求占全部回调请求的比例」。选 SLI 的判据是「用户在乎什么」，而不是「我们恰好监控了什么」。",
    },
    {
      type: "definition",
      term: "SLO（Service Level Objective，服务等级目标）",
      definition: "对某个 SLI 给出的、带时间窗口的目标数值承诺，例如「30 天滚动窗口内，支付回调中延迟 ≤ 1s 的请求占比 ≥ 99.9%」。没有时间窗口的 SLO 无法验证也无法告警；SLO 是把「体验还不错」这种主观判断翻译成可审计数字的那一步。",
    },
    {
      type: "definition",
      term: "Error Budget（错误预算）",
      definition: "1 − SLO 对应的容忍量：30 天窗口配 99.9% 的 SLO，意味着约 43 分钟（0.001 × 43200 分钟）可以不达标而不算违约。预算没烧完时，可靠性与特性开发按正常节奏竞争；预算耗尽则停止发布、把恢复可靠性作为第一优先级——它让「这次能不能上线」有了可争论的客观依据，而不是两个团队各凭感觉。",
    },
    {
      type: "paragraph",
      text: "三者的关系可以这样记：SLI 是仪表读数，SLO 是你在仪表盘上画的那条红线，错误预算则是红线背后的「可挥霍额度」。算一笔账：30 天 = 43200 分钟，99.9% 意味着允许 0.1% 不达标，也就是 43.2 分钟——这就是「99.9% 只允许每月坏 43 分钟」说法的来源。注意预算的单位是时间量级而不是条数：一次连续 43 分钟的大故障把预算烧光，和长期稳定保持 0.1% 坏请求在窗口末尾恰好耗尽，在 SLO 眼里是等价的。错误预算的本质是承认「不完美是默认状态」，并把剩余额度变成产品与可靠性之间可谈判的货币。",
    },
    {
      type: "paragraph",
      text: "为什么说 SLO 是告警的北极星？传统阈值告警的每个数字都是独立拍脑袋的：CPU 90% 要响、错误率 5% 要响、队列长度 100 要响——没人能回答最关键的问题：「这条告警和用户受损之间到底是什么关系？」绑定错误预算后，告警的意义被重新定义：不是「有异常」，而是「按当前速度烧下去，窗口结束前会违约」。判断速度的核心直觉叫消耗速率（burn rate）——它回答「错误预算以几倍速度在被烧」：burn rate = 观测到的坏请求占比 ÷ (1 − SLO)。以 99.9% 的 SLO 为例，分母是 0.1%：如果观测到 1% 的坏请求，burn rate = 10，30 天的预算大约 3 天就会烧完，这必须立即处理；如果只有 0.1%，burn rate = 1，恰好够覆盖整个窗口，属于「可以接受但不舒服」。于是 burn rate ≥ 1 不值得打扰人，远大于 1 才值得。工程上常用多窗口（multiwindow）法：一个长窗口（如 1 小时）判断持续消耗，一个短窗口（如 5 分钟）捕捉陡增，两个窗口同时越界才升级，避免瞬时抖动误报——具体参数以 SRE Workbook 的方法为准，这里不展开全部数学。规则本身的求值与告警治理，沿用第 8 课（obs-alerting）讲过的框架。",
    },
    {
      type: "paragraph",
      text: "把流程在 shop 上完整走一遍，以支付回调延迟作为示例 SLI。第一步，定义 SLI：支付回调是「用户付了钱、系统给回执」的直接链路，用户能感知的失败只有两种——回调失败、回调太慢，于是把 SLI 定义为好请求占比，好请求 = 延迟 ≤ 1s（对应直方图 le=\"1\" 的桶），坏请求 = 慢请求；演示环境先用纯延迟口径，把 5xx 并入口径的做法见后文表格。第二步，量化当前：目标不能拍脑袋，先看现状。用第 7 课（obs-promql）讲过的写法，查最近 5 分钟的好请求占比和 p95：",
    },
    {
      type: "code",
      title: "量化当前：支付回调好请求占比与 p95（PromQL）",
      language: "promql",
      code: "# 好请求占比：延迟 ≤ 1s 的请求 / 全部支付回调请求（5 分钟速率）\nsum(rate(shop_http_request_duration_seconds_bucket{route=\"/payments\", le=\"1\"}[5m]))\n  / sum(rate(shop_http_request_duration_seconds_count{route=\"/payments\"}[5m]))\n\n# 换个视角看同一件事：当前 p95 延迟（应明显低于 1s 才说明有余量）\nhistogram_quantile(0.95,\n  sum by (le) (rate(shop_http_request_duration_seconds_bucket{route=\"/payments\"}[5m])))\n",
    },
    {
      type: "paragraph",
      text: "第三步，设 SLO 并让它可见：假设量化结果是 p95 约 420ms、坏请求占比约 0.02%——现状远好于可接受的下限，有余量。把目标定在「30 天滚动窗口内好请求占比 ≥ 99.9%」，等于为 30 天留出约 43 分钟的不达标额度；同时在 Grafana 放一块错误预算面板，把「30 天累计坏请求占比」和 0.1% 参考线画在一起——不可见的预算不会被任何决策尊重。第四步，接告警：不要盯着原始错误率拍阈值，而是盯 burn rate。下面这条规则在「1 小时窗口内坏请求占比超过 0.5%」时告警，0.5% 对 0.1% 的分母正好是 5× burn rate，也就是 30 天预算约 6 天就会烧完：",
    },
    {
      type: "code",
      title: "按 burn rate 告警：1 小时窗口 ≥5× 消耗（Prometheus rules）",
      language: "yaml",
      code: "groups:\n  - name: shop-slo\n    rules:\n      - alert: PaymentCallbackSLOFastBurn\n        # 5× burn rate：坏请求占比 > 0.5%（SLO 99.9% 时 5× = 5 × 0.1%）\n        expr: |\n          (\n            1 - sum(rate(shop_http_request_duration_seconds_bucket{route=\"/payments\", le=\"1\"}[1h]))\n                / sum(rate(shop_http_request_duration_seconds_count{route=\"/payments\"}[1h]))\n          ) > 0.005\n        for: 15m\n        labels:\n          severity: warning\n        annotations:\n          summary: \"支付回调 SLO 错误预算消耗过快\"\n          description: \"近 1 小时坏请求占比约 {{ $value | humanizePercentage }}，30 天预算将以 5 倍以上速度烧完。\"\n          runbook_url: \"https://runbooks.internal/shop/payment-callback\"\n        # 生产可再配一条更短窗口、更高 burn 的页面级规则，两窗口同时越界才升级（multiwindow）\n",
    },
    {
      type: "paragraph",
      text: "上面以延迟为例走完了全程，但「选哪个 SLI」本身值得多说几句——它是整个体系里最容易出错的一步。RED 指标（第 6 课 obs-prometheus-instrumentation 在 shop 上落地过）是现成的原料库，Rate、Errors、Duration 恰好覆盖用户请求的三个面，但 SLI ≠ RED 面板，要做减法：健康检查要排除——GET /healthz 的流量来自负载均衡器的探测，不是用户请求，混进 SLI 会让预算被「我们自己的监控」污染；后台批处理也不算用户请求，除非把 SLI 定义成「任务在时限内完成的比例」；内部组件不直接进 SLI——stock 的 SQLite 写慢只有拖慢 /payments 时才成为用户可感知的问题，那时它会通过支付延迟 SLI 反映出来，而它自身的锁等待属于组件饱和度（USE 里的 S，第 6 课讲过），应该用另一类组件告警盯着，而不是挤占宝贵的用户 SLO 名额。一句话：从用户能感知的失败出发，宁可少而准，不要多而杂。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "三个常见反模式",
      body: "一，SLO 设 100%：1 − 1 = 0，没有任何错误预算可言，任何一次故障都直接违约，等于没有目标还天天挨打——正确做法是接受少量不完美，并把额度显式管理起来。二，把内部组件当 SLI：「SQLite 写延迟 99.9% 低于 100ms」看起来很工程，但用户根本不感知 SQLite，它应该作为 USE 饱和度指标去告警，而不是占据宝贵的用户 SLO。三，SLO 定了不看：预算面板没人看、季度不复盘、burn rate 告警静默——SLO 的全部价值都在「消费它的决策」里，定了不消费比不定更糟，因为大家会误以为系统真有承诺。",
    },
    {
      type: "table",
      caption: "常见 SLI 类型对比（shop 示例）",
      headers: ["SLI 类型", "怎么算（shop 示例）", "优点 / 注意"],
      rows: [
        ["可用性", "非 5xx 请求占比：1 - sum(rate(shop_http_requests_total{status=~\"5..\"}[5m])) / sum(rate(shop_http_requests_total[5m]))", "与错误率告警同源、直观；但「慢但成功」的降级不算失败，单独使用会漏掉一类故障"],
        ["延迟", "好请求 = 延迟 ≤ 阈值，取直方图 le 桶占比（如支付回调 ≤ 1s）", "直接反映用户体验；阈值口径必须全局一致（≤ X 的比例 vs p95 数值），否则面板与 SLO 对不上"],
        ["吞吐", "业务计数速率：rate(shop_orders_created_total[5m]) 等", "吞吐下降通常是结果而非原因，更适合当业务指标盯；易与促销、流量波动混淆，慎做 SLO"],
        ["饱和度", "资源接近上限的程度：连接池占用、队列长度、写锁等待等", "预警性强，先于错误出现；但它是内部维度而非用户维度，按 USE 做组件告警，不塞进用户 SLO"],
      ],
    },
    {
      type: "quiz",
      question: "假设 shop 支付回调的 SLO 为 99.9%（30 天窗口，约 43 分钟错误预算）。若从今天起系统以 1% 的坏请求占比持续运行，错误预算大约会在多少天后耗尽？",
      options: [
        "约 10 天后",
        "约 3 天后：burn rate = 1% ÷ 0.1% = 10，30 天预算 ÷ 10",
        "约 43 分钟后",
        "约 30 天后（窗口结束才耗尽）",
      ],
      answer: 1,
      explanation: "burn rate = 观测坏请求占比 ÷ (1 − SLO) = 1% ÷ 0.1% = 10，即预算以 10 倍速度被烧，30 天窗口的预算约 3 天耗尽——这正是「该立即处理」的情形；只有 0.1% 的坏请求占比才是 1× burn rate，恰好覆盖整个窗口。",
    },
  ],
};
