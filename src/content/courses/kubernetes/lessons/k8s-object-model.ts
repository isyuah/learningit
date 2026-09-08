/* ==================================================================
 * 课时：对象模型：声明式、spec 与调谐循环（k8s-object-model）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把「一切皆对象」讲透：对象五要素、声明式与命令式的分野、控制器调谐循环，以及 labels 与 namespace 如何组织关联与边界。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的旅程里反复出现一个词：对象。Deployment 是对象，ReplicaSet 是对象，Pod 是对象，连集群里的节点、你的访问凭据都以对象形态存在。这一课把「一切皆对象」这件事讲透：一个对象长什么样、你与系统各写哪一部分、系统凭什么知道下一步该干什么。这是整门课程的地基——此后你写的每一份清单，都是按这里的规则构造的一个对象。",
    },
    {
      type: "heading",
      text: "一个对象的五要素",
    },
    {
      type: "paragraph",
      text: "Kubernetes 里任何对象都遵循同一套骨架：apiVersion、kind、metadata、spec、status。前两个字段回答「这是什么」——版本化的类型名；metadata 是身份与附属信息；spec 是你声明的期望状态；status 是系统回写的实际状态。对绝大多数对象来说，spec 由你写、status 由系统写——这两半的分离是理解一切后续机制的钥匙。",
    },
    {
      type: "table",
      caption: "对象五要素",
      headers: ["部分", "内容", "由谁写"],
      rows: [
        ["apiVersion", "API 组与版本（如 v1、apps/v1），决定类型与字段含义", "你"],
        ["kind", "对象类型名（如 Pod、Deployment、Namespace）", "你"],
        ["metadata", "name（命名空间内唯一）、namespace、labels 等身份与附属信息", "你"],
        ["spec", "期望状态：描述「最终要什么样」", "你"],
        ["status", "实际状态：系统观测到的事实（当前副本数、容器是否就绪等）", "系统"],
      ],
    },
    {
      type: "definition",
      term: "期望状态（desired state）",
      definition:
        "对象 spec 中你声明的目标：几个副本、用什么镜像、开哪个端口。它是「静态的愿望」，不会自己变成现实，但它是系统一切动作的参照物。",
    },
    {
      type: "definition",
      term: "实际状态（current state）",
      definition:
        "集群当下的真实情况，由系统组件写入对象的 status：正在运行几个副本、容器是否健康。控制器的职责就是持续把实际状态调谐到期望状态。",
    },
    {
      type: "heading",
      text: "声明式与命令式：kubectl apply 与 docker run 的分野",
    },
    {
      type: "paragraph",
      text: "docker run 是命令式（imperative）操作：你描述一步步怎么做——启动容器、映射端口、挂载目录，命令执行一次就结束，重复执行会得到冲突的结果。而 kubectl apply 是第 1 课所说的声明式操作：你提交的是对象的完整期望状态，系统负责比较现状、算出差距并收敛。同一份清单 apply 一百次结果不变，这就是幂等。命令式的快捷命令（kubectl run、kubectl scale）在 kubectl 里仍然存在，但 Kubernetes 的主干是声明式的——控制器、Operator、发布回滚全都建立在这条主线上。",
    },
    {
      type: "list",
      items: [
        "可重复：同一份清单反复 apply 不会产生重复资源；「执行一百次 docker run」则会造出一百份互相冲突的容器。",
        "可审计：清单文件就是真相来源，代码评审、环境复现、回滚都围绕它展开（第 5 章发布实践会再体验一次）。",
        "可自动收敛：这是最重要的一条——正因为你给了系统一份「期望」的书面表达，它才能拿期望与现状对比并自动纠正偏差。",
      ],
    },
    {
      type: "heading",
      text: "调谐循环：控制器的看家本领",
    },
    {
      type: "paragraph",
      text: "spec 不会自己变成现实。在 spec 与现状之间站着一类永不退出的程序：控制器（controller）。它的工作循环可以概括为四步：观察相关对象的实际状态 → 与 spec 里的期望状态对比 → 发现偏差就执行动作把它拉回来 → 更新 status，然后回到第一步。这个循环称为调谐（reconcile）。",
    },
    {
      type: "paragraph",
      text: "举个具体例子：你在 spec 里声明副本数为 3。有人误删了一个 Pod，控制器在下一轮观察中发现「实际 2 个 ≠ 期望 3 个」，于是创建一个新 Pod 补齐，直到实际等于期望。注意两个要点：一是控制器不关心「是谁删的」，只看数字对不对，所以同样的机制既能应对人为误删，也能应对节点故障；二是调谐是持续循环而不是一次性事件，系统任何时刻崩溃重启，都能靠「再跑一轮循环」自动回到正轨。第 3 章《Deployment 与 ReplicaSet》会把这个例子完整展开——上一课里「控制器管理器中的控制器」指的就是这类循环。",
    },
    {
      type: "heading",
      text: "labels 与 selectors：一切关联的基石",
    },
    {
      type: "paragraph",
      text: "一个控制器怎么知道哪些 Pod 归它管？答案不是「把 Pod 写进 Deployment 的清单里」——Pod 对象是独立创建的，Deployment 并不嵌套包含它们。关联靠的是标签（label）与选择器（selector）：你在对象的 metadata.labels 里打上键值对（例如 app: shop-api、tier: backend），需要关联它的对象用选择器写出匹配条件（例如 app=shop-api）。",
    },
    {
      type: "paragraph",
      text: "这套设计是松散耦合的：只要标签匹配，对象就会被纳入管理，新增、替换、迁移对象都不需要改动引用方。代价也同样来自松散——标签拼错不会报错，只会「静默失效」：Service 挑不到后端、控制器管不到副本。后面你会反复遇到同一机制：Service 用选择器挑选提供能力的 Pod（第 4 章），Deployment 用选择器圈定自己管辖的 Pod（第 3 章），NetworkPolicy 与 HPA 也靠选择器描述作用对象。把「一切关联皆选择器」记住，读任何清单心里都有底。",
    },
    {
      type: "heading",
      text: "namespace 与身份设计",
    },
    {
      type: "paragraph",
      text: "对象的名字（metadata.name）只在它所属的命名空间（namespace）内唯一，因此同名对象可以存在于不同命名空间而互不干扰。命名空间是一道软隔离边界：它把对象分组，让配额（第 10 章）、权限控制（第 8 章 RBAC）可以按组生效；但它不是强安全边界——默认情况下不同命名空间的 Pod 网络互通，真正的隔离手段（网络策略等）要等第 4、8 章介绍。对学习者而言，先记住「命名空间 = 分组与治理单位，名字只在组内唯一」就够了。",
    },
    {
      type: "paragraph",
      text: "最后看身份与配置的分离设计。name 一旦创建就不可变——它是对象的身份，Service 选择器、DNS、日志归属都引用它，改名等于换个对象（只能删旧建新）。而 spec 是可变的：修改它不会破坏身份，只会触发控制器新一轮收敛（改镜像等于触发一次发布）。这套「身份稳定、配置可演进」的设计，保证了运行中的关联不会因为一次配置更新而断裂。",
    },
    {
      type: "quiz",
      question: "你 apply 了一份声明副本数为 3 的 Deployment 清单。关于 status 字段，下列说法正确的是？",
      options: [
        "status 由 kubectl 在 apply 时同步写入，立即反映期望",
        "status 由控制器与节点代理等系统组件在运行过程中持续回写",
        "status 由 YAML 校验器自动生成并固化",
        "对象没有 status，只有 spec",
      ],
      answer: 1,
      explanation:
        "spec 是你写的期望，status 是系统观测的实际：控制器补副本、kubelet 回报运行情况，这些动作的结果都由系统组件回写到 status，因此选 2。kubectl apply 只负责提交 spec；YAML 校验只检查格式，不产生状态；有 spec 的对象几乎都有 status，二者是同一对象的两半。",
    },
    {
      type: "keypoints",
      items: [
        "对象骨架五要素：apiVersion/kind 定类型，metadata 定身份，spec 是你要的、status 是现实。",
        "kubectl apply = 声明式（描述终态、幂等可重复）；docker run = 命令式（描述步骤、执行一次）。",
        "控制器循环 = 观察实际 → 对比期望 → 调谐 → 回写 status；这是 k8s「自愈」的引擎。",
        "关联靠 labels + selectors 而非嵌套；namespace 是软隔离与治理边界；name 是身份不可变、spec 可演进。",
      ],
    },
  ],
};
