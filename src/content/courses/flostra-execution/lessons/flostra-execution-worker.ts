import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-worker",
  courseSlug: "flostra-execution",
  title: "Worker 生命周期：消费、ACK、NACK、心跳与终态事件",
  summary: "从 RabbitMQ 消息进入 Python worker 开始，理解什么时候确认消息、什么时候重投，以及控制面如何裁决结果。",
  minutes: 45,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前几节主要站在 gback 控制面看问题。现在换到 worker 视角：RabbitMQ 把 task 送来之后，worker 什么时候 ACK？如果节点执行失败，是发 workflow_completed(error) 还是直接 NACK？如果终态事件发布失败，execution 会不会永远 RUNNING？这些答案藏在 `backend/mq_worker.py` 的消费循环和事件 emitter 中，不能只看 `workflow_engine.py`。",
    },
    {
      type: "heading",
      text: "一条 task 消息的四个阶段",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "接收并解析 RabbitMQ body，校验 executionId、attemptId、workflow graph 等协议字段。",
        "向控制面发 workflow_started；只有当前 attempt 接受后，worker 才把自己视为这次运行的拥有者。",
        "运行 workflow_engine.run_workflow，并用独立协程发送 workflow_heartbeat。",
        "确保 workflow_completed 已成功发出后再 ACK；若终态事件无法送达，则 NACK/requeue，让消息有机会恢复。",
      ],
    },
    {
      type: "code",
      title: "消费确认的教学版决策",
      language: "python",
      code: `async def handle_message(message):
    try:
        task = parse_task(message.body)
        await emit_started(task)       # attemptId + workerId
        await run_workflow(task)
        await emit_completed(task)     # 必须送达控制面
    except InvalidProtocolData:
        await message.ack()            # 重试不会修复坏消息
    except TerminalEventPublishError:
        await message.nack(requeue=True)
    else:
        await message.ack()            # 终态已被可靠送出`,
    },
    {
      type: "paragraph",
      text: "这段逻辑里有一个容易忽视的顺序：worker 不是“收到消息就 ACK”，也不是“业务函数抛异常就 NACK”这么简单。协议错误（缺字段、未知节点类型、坏 JSON）是永久错误，ACK 可以避免死循环；终态事件发送失败是基础设施错误，NACK/requeue 才能让控制面稍后看到结果。",
    },
    {
      type: "table",
      caption: "ACK/NACK 的决策表",
      headers: ["场景", "是否有业务执行", "事件是否可恢复", "动作", "原因"],
      rows: [
        ["消息 JSON 损坏", "没有", "否", "ACK", "重投仍然是同一份坏数据"],
        ["attemptId/workerId 缺失", "没有", "否", "ACK/记录协议错误", "无法通过 fencing，不能安全执行"],
        ["旧 attempt 的事件被拒绝", "可能已经执行", "否", "ACK", "stale 是永久无效身份，不应无限重投"],
        ["节点业务失败，但 completed(error) 成功送达", "是", "是，作为业务结果", "ACK", "控制面已经知道 FAILED"],
        ["completed 事件发布失败", "可能已经执行", "是，作为投递问题", "NACK/requeue", "需要让控制面最终看到终态"],
      ],
    },
    {
      type: "heading",
      text: "AttemptId 和 WorkerId 必须原样回声",
    },
    {
      type: "paragraph",
      text: "dispatcher 在 task 中注入 attemptId；worker 消费时把它和自己的 workerId 一起带回每个控制面事件。这里不是普通的 correlation id：correlation id 方便查日志，attemptId 决定数据库是否接受写入。worker 不能自己生成一个新的 attemptId，也不能在重试时省略它，否则控制面无法判断事件来自哪个 delivery。",
    },
    {
      type: "callout",
      variant: "note",
      title: "Heartbeat 有两个层次",
      body: "Python worker 一方面有 worker 级心跳，用于告诉控制面“这个 worker 进程在线”；另一方面有 execution 级 heartbeat，携带 runId 并在具体任务运行期间续租。前者不能替代后者：一个进程活着，不代表它仍然在处理某个 execution。",
    },
    {
      type: "subheading",
      text: "为什么 Redis 故障不会让健康 workflow 自动失败",
    },
    {
      type: "paragraph",
      text: "`mq_worker.py` 检查取消 marker 时，如果 Redis 不可用，会记录 warning 并返回“未请求取消”；这样 Redis 的短暂故障不会把正常业务变成 FAILED。相反，控制面在真正接受取消前会先确认取消依赖可用。这里体现的是能力分层：取消是可选协作信号，workflow 的成功/失败必须通过最终事件和数据库裁决。",
    },
    {
      type: "heading",
      text: "共享 worker 的代码执行边界",
    },
    {
      type: "paragraph",
      text: "当前 worker 进程不是任意 Python 代码的沙箱。gback 在 Spawn 阶段拒绝包含 `code` 节点的图，Python 的节点注册表也没有把 `code_node` 注册进共享 worker。阅读这条边界时，不要把“仓库里存在 code_node.py”误读为“用户可以在共享 worker 执行任意代码”；是否可达取决于控制面校验和运行时注册。",
    },
    {
      type: "exercise",
      title: "练习：为四种异常选择 ACK 还是 NACK",
      description: "判断以下异常的消费动作：A. worker 发 completed 时 RabbitMQ 连接断开；B. task 缺少 attemptId；C. 节点返回 RetryableNodeError 但还没达到 maxAttempts；D. 当前 attempt 已被 watchdog 标记超时。请写出消息动作和控制面最终能看到的状态。",
      hint: "A 是终态事件投递失败，应该允许重投；B 是永久协议错误；C 在 worker 内部重试，不应提前结束消息；D 事件会被 fencing 判 stale，继续 requeue 没有意义。",
    },
    {
      type: "quiz",
      question: "为什么 worker 必须在 workflow_completed 成功发送后才 ACK RabbitMQ 消息？",
      options: [
        "因为 ACK 会增加 Python 的 CPU 使用率",
        "因为 ACK 过早会在终态事件丢失时让消息消失，控制面可能永远停在 RUNNING",
        "因为 RabbitMQ 不允许 worker 发送心跳",
        "因为 workflow_completed 只是日志，不影响状态",
      ],
      answer: 1,
      explanation: "ACK 表示消费者不再需要 broker 重投这条 task。如果终态事件还没被控制面接收就 ACK，进程或网络故障会让业务副作用已经发生但数据库没有终态。延迟 ACK 把“结果已送达”纳入消息生命周期。",
    },
    {
      type: "keypoints",
      items: [
        "worker 的主线是 parse → started → run + heartbeat → completed → ACK。",
        "永久协议错误和可恢复基础设施故障必须分开决定 ACK/NACK。",
        "attemptId 是写入资格，不是普通日志 correlation id；worker 必须原样回声。",
        "worker 级在线心跳不能替代 execution 级 lease heartbeat。",
        "共享 worker 不是任意代码沙箱，控制面图校验和节点注册共同形成可达边界。",
      ],
    },
  ],
};
