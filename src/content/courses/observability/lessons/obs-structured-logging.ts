/* ==================================================================
 * 课时：结构化日志与事件（obs-structured-logging）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-structured-logging",
  courseSlug: "observability",
  title: "结构化日志与事件",
  summary: "trace 给出骨架、日志提供证据：把日志从 printf 字符串升级为结构化事件，并理解它与 trace、OTel Event 的关系。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "走到这里我们已经建立了两层认知：指标告诉你「服务出问题了、大概出在哪类操作上」，trace 把一次请求拆成带时间关系的调用树，指出「哪一步慢、哪一步错」（第 4 课（obs-trace-model））。但 trace 回答的是结构问题。设想 shop 的一次支付回调失败：trace 显示 order → payment → stock 的链路里，stock 对 SQLite 的那次写入耗时 3 秒后失败——可 SQLite 到底报了什么？是 `database is locked` 还是唯一约束冲突？当时订单处于什么状态、这是第几次重试、上游返回了什么？这些细节通常不会完整留在 span 属性里，它们留在应用代码写出的日志里。所以日志在排障工作流里的位置是取证层：指标负责发现，trace 负责定位，日志负责翻出最后几厘米的证据（呼应第 2 课（obs-three-pillars）讲过的信号分工）。日志不会消失，问题是怎么写，才配得上这个位置。",
    },
    {
      type: "heading",
      text: "从字符串到结构化：printf 式日志为什么不行",
    },
    {
      type: "list",
      items: [
        "不可检索：一整行是没有字段名的字符串，想查「某个订单的支付失败」只能做整行子串或正则匹配；字段加没加、格式改没改全凭当天写代码的人，跨服务更无法统一消费。",
        "无法机器处理：告警、面板、统计分析都需要「字段」。纯文本行不能按列过滤、不能做数值比较——想让「金额大于 1000 的错误触发告警」，正则都很难写稳。",
        "没有级别与上下文纪律：时间格式、是否带请求标识全看自觉，级别前缀五花八门；日志一多，连「哪些行属于同一次请求」都分不出来，与第 2 课说的「日志难以关联」互为因果。",
      ],
    },
    {
      type: "definition",
      term: "结构化日志（structured logging）与日志记录（log record）",
      definition: "一条日志不再是一行拼接的字符串，而是一组命名字段：发生时间、级别（severity）、消息或正文，以及任意多个 key-value 属性（attributes）。序列化成机器可解析的格式（JSON 或 logfmt），消费方按字段名取用、过滤、聚合。OTel 对「一条日志」的正式称呼是 log record（本课后面会看它的完整模型）。",
    },
    {
      type: "heading",
      text: "log/slog 与级别设计：结构化日志怎么写、怎么分级",
    },
    {
      type: "paragraph",
      text: "从 Go 1.21 起，标准库提供了 `log/slog`。用法是先用 `slog.New(handler)` 构造一个 Logger：handler 决定输出形态与目的地，`slog.NewTextHandler` 人类可读，`slog.NewJSONHandler` 输出 JSON——线上日志应该选 JSON，让机器好读。`HandlerOptions` 里可以设置默认级别（`slog.LevelDebug/Info/Warn/Error`，数值分别为 -4/0/4/8），也可以打开 `AddSource` 记录调用位置。Logger 的方法按级别命名：`Debug/Info/Warn/Error`，每个都提供带 context 的变体（`InfoContext(ctx, msg, args...)` 等）——ctx 之所以重要，是因为它可能携带 span 上下文，为后面的 trace 关联留好了口子。公共且固定的字段用 `With` 钉在派生 Logger 上（如路由、进程角色），相关的成组字段可以用 `WithGroup` 嵌套组织。`slog.SetDefault` 可以把 `slog.Info(...)` 这类顶层函数统一切到你自己的 handler 上，`slog.NewLogLogger` 还能把仍在用 `log.Printf` 的旧代码接进来。属性既可以按 `key, value` 成对传入，也可以用 `slog.String(\"order_id\", id)`、`slog.Int64(\"amount\", ...)` 这类带类型的 Attr 构造器传入——值的类型显式、序列化结果可控，避免依赖 `fmt` 的 `%v` 猜测。",
    },
    {
      type: "code",
      title: "shop：给支付回调打结构化日志（log/slog JSON）",
      language: "go",
      code: `package shop

import (
    "encoding/json"
    "log/slog"
    "net/http"
    "os"
)

// 进程级 logger：JSON 写到 stdout，由采集侧统一收走
// （第 13 课 obs-collector / 第 14 课 obs-full-stack-deploy）。
// 属性键统一用蛇形小写，与 OTel 语义约定的命名习惯对齐。
var logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo, // 默认只记 INFO 及以上；debug 按需开（见本课「级别设计」段落）
}))

// POST /payments 支付回调（ShopServer 与 isSettled / settleOrder 的实现省略）
func (s *ShopServer) handlePaymentCallback(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    var req struct {
        OrderID string  \`json:"order_id"\`
        Amount  float64 \`json:"amount"\`
        Token   string  \`json:"token"\` // 仅用于校验，绝不写进日志
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        // 请求都无法解析：异常路径 → error 级别
        logger.ErrorContext(ctx, "payment callback: request body invalid",
            "remote", r.RemoteAddr,
            "err", err.Error(),
        )
        w.WriteHeader(http.StatusBadRequest)
        return
    }

    if req.Amount <= 0 {
        logger.ErrorContext(ctx, "payment callback rejected",
            "order_id", req.OrderID,
            "amount", req.Amount,
            "reason", "invalid_amount",
        )
        w.WriteHeader(http.StatusUnprocessableEntity)
        return
    }

    // 预期内的重复回调：请求处理成功，但值得扫一眼 → warn，而不是 error
    if s.isSettled(ctx, req.OrderID) {
        logger.WarnContext(ctx, "payment callback ignored: order already settled",
            "order_id", req.OrderID,
        )
        w.WriteHeader(http.StatusOK)
        return
    }

    if err := s.settleOrder(ctx, req.OrderID, req.Amount); err != nil {
        logger.ErrorContext(ctx, "settle order failed",
            "order_id", req.OrderID,
            "amount", req.Amount,
            "err", err.Error(),
        )
        w.WriteHeader(http.StatusInternalServerError)
        return
    }

    logger.InfoContext(ctx, "order settled",
        "order_id", req.OrderID,
        "amount", req.Amount,
    )
}

// 上面的 ErrorContext 产出的 JSON 示意（键为 time / level / msg + 属性）：
// {"time":"2026-09-07T10:24:33.412+08:00","level":"ERROR",
//  "msg":"payment callback rejected",
//  "order_id":"20260907-001","amount":0,"reason":"invalid_amount"}`,
    },
    {
      type: "list",
      items: [
        "debug：只有开诊断时才需要的细节（SQL 文本、分支判断的中间值、内部状态快照）。默认关闭；需要时用 `slog.LevelVar` 在运行时把级别临时调到 debug，用完关掉，避免在热路径上放大日志成本——注意「诊断细节」也要先过一遍下面的红线：脱敏后再记。",
        "info：正常生命周期里「有意义的状态变化」——请求开始/完成、订单创建、支付回调到达并结算成功。它回答「系统按预期在走吗」。",
        "warn：请求仍然成功，但出现了值得注意的异常——重试、降级、重复回调被忽略、脏数据被纠正、接近阈值。值得日后扫一眼，但不必半夜叫醒人。",
        "error：功能真正失败或走了异常路径——请求体解析失败、数据库写入失败、依赖返回 5xx。它应该与「用户可感知的失败」或「需要人处理」对齐，是告警与错误统计的直接输入。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "日志红线：别把事故和敏感信息一起写进日志",
      body: "两条铁律。第一，token、密码、完整手机号/身份证号等完整 PII 绝不进日志：日志进入集中存储后就脱离你的控制，会被长期保留、被检索、被同步给更多人，宁可少记不可误记——请求头、查询串不要整包打印，确实需要诊断时只写必要的脱敏形态（掩码或哈希）。第二，级别是运维语义，不是情绪：把「预期内的分支」（金额非法被拒绝、库存不足正常拒单、上游限流后重试成功）打成 error，等于用噪声污染告警路由、错误率统计与 SLO 错误预算的可信度；反过来，把真正的异常降级成 info，等于吞掉事故证据。判据很简单：这一行会不会驱动一个正常人半夜爬起来处理？会，才是 error。",
    },
    {
      type: "heading",
      text: "日志与 Trace 关联：把同一次请求拼回来",
    },
    {
      type: "paragraph",
      text: "高并发下，多个请求的日志在时间轴上交错，单看任何一条都难以回答「它属于哪个用户、哪个订单」——这正是第 2 课（obs-three-pillars）指出日志难以关联的根源。解决办法不是改进文本格式，而是给每条记录带上 `trace_id` 与 `span_id`：它们的值取自当前请求 context 里的 span，并且跨服务时同一个 `trace_id` 已经随 W3C traceparent 传遍整条链路（第 4 课（obs-trace-model）讲过传播机制）。字段一旦落下，「这一单到底经历了什么」就变成一次廉价查询：拿 `trace_id` 过滤，把 order、payment、stock 各组件写的日志按时间拼回一棵证据树，trace 骨架上的每个点都能填充现场细节。本课只确立概念与字段语义（与 OTel log record 里的 trace_id/span_id 字段一一对应）；由哪个 handler 或 bridge 从 ctx 提取、落到哪些字段名、经过 OTel Logs 后如何保留，属于采集侧的事，到第 13 课（obs-collector）再落地——排障实战会在第 16 课（obs-troubleshooting）用上这条链路。",
    },
    {
      type: "heading",
      text: "OTel 视角：Log Record 与事件",
    },
    {
      type: "list",
      items: [
        "Log Record 是 OTel 对「一条日志」的数据模型：时间戳、严重级别（文本与数值）、正文（body，可以是字符串或结构化值）、一组属性（attributes）、可选的 trace_id/span_id，外加 Resource 描述来源进程——与上面 slog 行的字段几乎一一对应。它是 OTLP 传输 logs 时每个记录的形状，本课观察即可，不需要手写。",
        "OTel Go 的 Logs API/SDK 已随 v1.47（2026-08 底发布候选已出）升为 v1.0 稳定：稳定承诺落地后，「slog 经桥接进 OTel Logs、再经 Collector 送往后端」会成为 Go 日志接入的主路，细节见第 13 课（obs-collector）。",
        "span event（第 4 课讲过）是挂在某条 span 时间线上的小事件：名字 + 属性 + 时间戳，随 span 一起导出、与采样共命运。适合记录「这一次请求内部的关键节点」——排队开始、重试发生、缓存未命中、异常抛出点，目的是解释这条 trace 本身。",
        "应用日志（本课的结构化日志）是独立信号：独立保留、独立检索、不因某次 trace 采样而消失。适合承载需要长期留存、需要脱离单次请求检索的领域事件与取证细节。",
        "取舍一句话：要跟着单次请求时间线讲的用 span event；要离开请求仍能查、要长期留存的用应用日志。两者通过 trace_id/span_id 互链，是互补而非替代。OTel 也正在把「事件」进一步规范为带 event.name 的 Event Logs 概念（规范仍在演进，以官方文档为准）。",
      ],
    },
    {
      type: "keypoints",
      items: [
        "日志在排障工作流里是取证层：指标负责发现、trace 负责定位、日志提供细节证据",
        "结构化日志 = 时间 + 级别 + 消息 + 命名属性，JSON/logfmt 序列化，机器可按字段消费",
        "标准库 log/slog：JSONHandler 输出 JSON，With/WithGroup 组织字段，XxxContext 携带 ctx 为 trace 关联留口",
        "级别是运维语义：error 对齐「需要人处理」，预期内分支用 warn/info，debug 默认关闭按需开启",
        "token、密码、完整 PII 绝不入日志；请求头与查询串不要整包打印",
        "每条记录带上 trace_id/span_id，日志才能按请求拼接；字段注入机制属于采集侧，后续课时落地",
        "span event 属于某条 trace 的时间线、随采样共命运；应用日志是独立信号，两者互补",
      ],
    },
  ],
};
