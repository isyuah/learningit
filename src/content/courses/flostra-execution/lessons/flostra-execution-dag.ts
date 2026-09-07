import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-dag",
  courseSlug: "flostra-execution",
  title: "DAG 执行器：就绪批次、端口输入与节点级重试",
  summary: "把 workflow_engine.run_workflow 拆成构图、可达性、调度、输入合并和 retry 五个可学习的概念。",
  minutes: 42,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "`workflow_engine.py` 之所以显得复杂，是因为一个函数同时承担了图校验后的运行时调度、控制边判断、输入合并、节点执行、事件发布、失败短路和结果收集。不要按 550 行从上读到下；先把它分成五个问题：这张图是否合法？本次真的可达哪些节点？哪些节点现在 ready？输入从哪里来？节点失败后是否重试？",
    },
    {
      type: "heading",
      text: "第一步：构建两种边和一个拓扑序",
    },
    {
      type: "table",
      caption: "DAG 运行时需要的索引",
      headers: ["索引", "用途", "阅读时要问什么"],
      rows: [
        ["node_map", "node_id → 节点定义", "如何找到 type、params、port_constants？"],
        ["in_edges_data / out_edges_data", "数据输入输出关系", "上游哪个端口提供了哪个值？"],
        ["in_edges_ctl / out_edges_ctl", "控制流门槛与分支", "哪些控制边被触发后才允许执行？"],
        ["topo_order", "全局拓扑顺序", "如何保证依赖先于下游？"],
        ["sink_nodes / end_nodes", "默认结果目标", "没有显式 targets 时返回什么？"],
      ],
    },
    {
      type: "paragraph",
      text: "数据边传递端口值，控制边传递“是否允许走这条分支”的信号。一个节点可能因为没有可用数据输入而被跳过，也可能因为控制入边还没全部触发而等待。只看 node_id 的拓扑关系会漏掉控制语义，这也是 `_execute_node` 后半段要处理 `controlSignals` 的原因。",
    },
    {
      type: "heading",
      text: "第二步：计算本次 execution 的可达子图",
    },
    {
      type: "code",
      title: "entry_nodes 到 effective_order",
      language: "python",
      code: `if entry_nodes is provided:
    validate every entry node exists
    reachable = BFS(entry_nodes, data_edges + control_edges)
else:
    reachable = all_nodes

effective_order = [
    node_id for node_id in topo_order
    if node_id in reachable
]`,
    },
    {
      type: "paragraph",
      text: "可达性是一个很好的学习切入口，因为它把“整张 workflow 图”和“这次请求真正要跑的部分”分开了。没有 entry_nodes 时，代码会从 trigger 节点推导默认入口，并在没有 HTTP request 的上下文中排除 HTTP trigger；显式传入空列表则表示本次没有任何可达节点。课程练习时先画 reachable set，再看调度循环，很多分支会变得直观。",
    },
    {
      type: "heading",
      text: "第三步：每轮找 ready 节点，并行执行",
    },
    {
      type: "code",
      title: "ready batch 的核心",
      language: "python",
      code: `remaining = set(effective_order)
while remaining and failed_node is None:
    ready = [
        node_id for node_id in effective_order
        if node_id in remaining
        and not should_skip_node(node_id)
    ]
    if not ready:
        emit node_skipped(reason="no_input")
        break

    await asyncio.gather(
        *(run_one(node_id) for node_id in ready),
        return_exceptions=True,
    )
    remaining -= set(ready)`,
    },
    {
      type: "paragraph",
      text: "这里的并发不是“所有节点一起跑”。`should_skip_node` 会检查控制门槛、数据入边、常量和 overrides；只有依赖已经满足的节点进入 ready。当前实现用 `asyncio.gather` 并行执行同一批 ready 节点，但事件发布仍由节点函数按逻辑顺序发出，前端看到的时间线更稳定。任一节点失败会设置 failed_node，后续批次不再调度；同一批已经开始的协程则由 gather 等待结束。",
    },
    {
      type: "heading",
      text: "第四步：端口输入是覆盖关系，不是神秘上下文",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "先复制 node.port_constants，作为没有连线时的默认值。",
        "遍历数据入边，从 context_outputs[source_node] 取 source_port_id。",
        "把上游值写入 target_port_id，所以连线输入覆盖同名常量。",
        "最后应用 overrides，允许本次 run 的显式覆盖再改变基准输入。",
        "只对作者定义的 params/port_constants 做 secret 替换；上游 inputs 被视为不可信数据，不做替换。",
      ],
    },
    {
      type: "callout",
      variant: "example",
      title: "一个端口推导例子",
      body: "节点 B 的 port_constants 是 {url: 'default'}，上游节点 A 的输出在端口 result 上得到 'https://example.test'，边 A.result → B.url。执行 B 时，最终 url 是上游值，而不是 default；如果本次 run 又提供 overrides，overrides 只对 B 的输入做最后一层覆盖。",
    },
    {
      type: "heading",
      text: "第五步：节点级 retry 不等于整张图重跑",
    },
    {
      type: "code",
      title: "RetryableNodeError 的语义",
      language: "python",
      code: `policy = parse_retry_policy(node.params.get("retryPolicy"))
for attempt in range(1, policy["maxAttempts"] + 1):
    try:
        outputs = await node_cls.run(inputs, params)
        break
    except RetryableNodeError:
        if attempt < policy["maxAttempts"]:
            await asyncio.sleep(
                policy["backoffMs"] / 1000 * 2 ** (attempt - 1)
            )
            continue
        raise
    except Exception as exc:
        raise NodeExecutionError(str(exc)) from exc`,
    },
    {
      type: "paragraph",
      text: "只有显式的 `RetryableNodeError` 会进入指数退避；普通异常直接让 workflow 失败。`maxAttempts` 被限制在 1 到 10，`backoffMs` 被限制在 0 到 30 秒，说明运行时会对用户传入的 retryPolicy 做边界保护。节点重试完成后，输出写入 context_outputs，控制信号决定哪些控制边被触发，最后才发 node_completed(success)。",
    },
    {
      type: "exercise",
      title: "练习：手动模拟一轮 DAG 调度",
      description: "画四个节点：A、B 无依赖；C 依赖 A；D 通过控制边依赖 B 的 true 信号。第一轮 ready 是谁？如果 A 失败，B 是否必须停止？如果 B 成功但 controlSignals.B=false，D 会发生什么？",
      hint: "A/B 可以在同一 gather 批次并发；失败会阻止后续新批次，但同批任务会等待；D 的控制门槛没有满足时会被跳过，而不是凭空执行。",
    },
    {
      type: "quiz",
      question: "`asyncio.gather` 在当前 DAG 执行器中的作用最准确是什么？",
      options: [
        "让所有节点忽略依赖并同时运行",
        "并行运行同一轮已经满足依赖的 ready 节点，并在失败后阻止后续批次",
        "把所有节点重试十次",
        "代替拓扑排序，直接决定最终结果",
      ],
      answer: 1,
      explanation: "拓扑序和 should_skip_node 先筛出依赖已满足的 ready batch，gather 只并行这一批。它不会绕过依赖，也不负责 retry policy；失败节点设置 failed_node 后，后续批次停止。",
    },
    {
      type: "keypoints",
      items: [
        "读 DAG 执行器先拆五件事：构图、可达性、ready 批次、输入合并、节点 retry。",
        "数据边传值，控制边决定是否允许分支；只看拓扑顺序会漏掉控制语义。",
        "同一 ready 批次可以并发，依赖未满足的节点不会进入批次。",
        "常量 → 上游连线 → overrides 是输入覆盖顺序，secret 替换只针对受信的 params/constants。",
        "RetryableNodeError 是节点级重试；普通异常直接失败，不能把整张图隐式重跑。",
      ],
    },
  ],
};
