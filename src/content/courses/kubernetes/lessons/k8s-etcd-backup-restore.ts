/* ==================================================================
 * 课时：etcd 快照与灾难恢复（k8s-etcd-backup-restore）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "etcd 是集群唯一权威状态，快照是它的备份手段。理解快照里有什么、怎么存、恢复意味着什么（回滚到快照点）、以及为什么恢复必须演练。",
  blocks: [
    {
      type: "paragraph",
      text: "第 9 章《高可用控制面：etcd 与选举》讲过：etcd 是集群唯一权威持久状态，Deployment、Secret、RBAC、命名空间……所有 API 对象都存它那里；apiserver 无状态、控制器可重建，唯独 etcd 丢了就是真丢了。这一课把结论推向操作：怎么备份、备份出来的是什么、灾难发生后恢复又意味着什么。先建立预期：etcd 快照能救回的，是「控制面里记录的一切」；救不回的，是它从未记录过的东西。",
    },
    {
      type: "heading",
      text: "快照里有什么：内容的边界",
    },
    {
      type: "paragraph",
      text: "etcd 快照是对整个键空间的点一致性拷贝——它包含集群里全部 API 对象的当前状态。这比「备份数据库」更接近「备份整个控制面的记忆」：误删了命名空间、错误 apply 覆盖了 Deployment、升级把配置改坏了，都能从快照找回。但它的边界同样清晰：Pod 里跑的业务数据不在 etcd 里。shop-db 的 PostgreSQL 数据存在 PV 背后的真实磁盘上，那部分由数据库自身的备份机制负责——第 6 章《CSI 与有状态应用的生产注意》划过的责任边界在这里兑现：Kubernetes 只管调度与挂载，不管数据备份。镜像、节点上的容器运行态同样不在快照内。",
    },
    {
      type: "table",
      caption: "etcd 快照的覆盖范围",
      headers: ["能恢复（快照内）", "不能恢复（快照外）"],
      rows: [
        ["Deployment/StatefulSet 等全部 API 对象", "PV 里的业务数据（数据库文件等）"],
        ["ConfigMap、Secret 的定义", "镜像与容器运行态"],
        ["RBAC、命名空间、配额等治理对象", "快照时间点之后对集群的所有变更"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "快照本身是敏感文件",
      body: "未启用静态加密时，etcd 里存的是可解码的 Secret 值（第 5 章《Secret：敏感数据与信任边界》讲过它只是 base64）。因此快照文件等于一份「包含全部密钥的控制面记忆」：存放要加密、传输要走安全通道、访问要最小化，别把它随手扔进谁都读得到的共享目录。",
    },
    {
      type: "heading",
      text: "备份动作：etcdctl snapshot save",
    },
    {
      type: "paragraph",
      text: "备份 etcd 的官方工具是 etcdctl，命令形态是 `snapshot save`：连上 etcd 端点，让它产出一份一致性快照文件。有三个姿势要点。第一，etcdctl 的版本必须与集群里的 etcd 匹配——用错版本的客户端可能读到无法理解的数据或直接失败，拿不准就以官方文档为准。第二，etcd 默认监听 TLS 端点，需要以 `--cacert`、`--cert`、`--key` 提供证书参数；在 kubeadm 集群里，etcd 以静态 Pod 运行，证书在控制面节点的 `/etc/kubernetes/pki/etcd` 目录，官方文档（Backing up an etcd cluster）给出了完整流程，包括在什么环境里执行、具体路径与参数——这里只给概念形态，不复制逐行命令，因为版本与发行版不同会漂移。第三，备份后要验证文件可用：`etcdctl snapshot status <文件>` 能读出的快照才是有效的。",
    },
    {
      type: "code",
      title: "快照的概念形态（具体参数以官方文档为准）",
      language: "bash",
      code: `# etcdctl 连接 etcd 端点，保存一份一致性快照到本地文件
etcdctl snapshot save /backup/etcd-snapshot-2026-09-08.db \\
  --endpoints=https://127.0.0.1:2379 \\
  --cacert=<etcd CA 证书> --cert=<客户端证书> --key=<客户端私钥>

# 校验快照可读（能输出文件信息才算备份成功）
etcdctl snapshot status /backup/etcd-snapshot-2026-09-08.db`,
    },
    {
      type: "paragraph",
      text: "频率与存放遵循一个朴素原则：你能接受的丢失窗口（RPO）决定备份间隔。快照只能救到「最近一次备份的时刻」，业务关键集群的备份间隔通常以分钟到小时计，而不是「想起来才备一次」。存放要异地、要落在对象存储之类的独立故障域——备份和集群一起被同一场事故毁掉等于没备份；保留多份历史快照，因为「昨天误删、今天才发现」需要回退到更早的点。",
    },
    {
      type: "heading",
      text: "恢复的本质：回到快照点",
    },
    {
      type: "paragraph",
      text: "恢复的流程轮廓是：停掉控制面（避免恢复期间还有组件继续写入 etcd），用快照把 etcd 数据恢复到目标目录，再启动集群。要理解的不是命令而是语义：恢复不是「修补」，而是「回到过去」——集群状态会整体回滚到快照那一刻，快照之后发生的一切变更（新部署的应用、改过的 ConfigMap、新建的命名空间）都会消失，这就是丢失窗口，也是为什么备份频率直接决定事故损失。恢复完成后，控制器会按快照里的期望状态重新调谐：快照里声明 3 副本的 Deployment 会重新补足，快照里不存在的对象不会自己冒出来。集群外的世界却不会跟着回滚——快照之后写入 PV 的数据、外部系统收到的通知都还在，恢复后集群与现实的错位需要人工核对。",
    },
    {
      type: "paragraph",
      text: "证书与配置要跟着一起备份：kubeadm 集群的 `/etc/kubernetes/pki`（CA、apiserver 与 etcd 的证书、ServiceAccount 签名密钥等）和 admin kubeconfig 是控制面身份的凭据。etcd 数据与证书是配套的——证书丢了，恢复了 etcd 数据也没法建立可信连接；ServiceAccount 签名密钥丢了，集群里既有的 ServiceAccount token 会全部失效。把它们与快照放进同一个备份体系，恢复时一起取用。",
    },
    {
      type: "heading",
      text: "必须演练：没跑过的恢复手册等于没有",
    },
    {
      type: "paragraph",
      text: "备份是「存下来」，恢复是「用得回来」，两者之间隔着一条鸿沟：没有演练过的恢复流程，在真正出事时大概率卡在某个你没想到的细节上——证书路径不对、etcdctl 版本不匹配、数据目录权限、恢复后 apiserver 起不来。业界通行做法是定期把快照恢复到演练环境（独立的虚拟机或临时集群）完整走一遍，记录步骤、耗时与坑，让恢复成为肌肉记忆而不是灾难现场考古。注意 kind 集群不适合做真实恢复演练：它的控制面跑在容器里、几秒即可重建，练习「从零重建 + 重新 apply 清单」反而更符合它的定位；要练 etcd 恢复，用 kubeadm 搭的虚拟机集群或按官方文档的演示环境。另外，云托管集群的 etcd 备份由厂商负责，但那只覆盖 API 状态——PV 数据与配置的备份依然是你的责任，别把「厂商备了 etcd」误当成「我的数据有人管」。",
    },
    {
      type: "quiz",
      question: "你从昨晚的 etcd 快照恢复了集群。以下哪项内容不可能从这次恢复中找回？",
      options: [
        "昨天误删的一个 Deployment 及其副本定义",
        "shop-db 数据库里今天下午新写入的订单记录",
        "上周创建的一个 ServiceAccount 与 RoleBinding",
        "昨晚快照时刻之后被错误覆盖的 ConfigMap 旧内容",
      ],
      answer: 1,
      explanation:
        "etcd 快照只包含 API 对象状态，不包含 PV 里的业务数据——订单记录存在 PostgreSQL 的数据文件里，由数据库备份负责，这正是第 6 章讲过的责任边界。Deployment、ServiceAccount、RoleBinding、ConfigMap 都是 API 对象，在快照内；选项 D 能找回的前提是「昨晚快照之后被覆盖」，而快照时刻的旧内容恰好被保存了。",
    },
    {
      type: "keypoints",
      items: [
        "etcd = 控制面的全部记忆；快照覆盖所有 API 对象，但不含 PV 业务数据。",
        "备份姿势三要点：etcdctl 版本与 etcd 匹配、TLS 证书参数、备份后 snapshot status 验证。",
        "恢复 = 整体回滚到快照点：快照之后的变更全部丢失，控制器按旧期望状态重新调谐。",
        "证书/kubeconfig 随快照一起备份；恢复流程必须定期演练；快照含明文 Secret，按敏感数据对待。",
      ],
    },
  ],
};
