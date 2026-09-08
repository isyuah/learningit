/* ==================================================================
 * 课时：卷的心智模型：emptyDir 与 hostPath（k8s-storage-mental-model）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "容器文件系统随容器消亡；卷是挂在 Pod 上的目录——先用 emptyDir 与 hostPath 建立「数据随 Pod 生命周期」的心智模型。",
  blocks: [
    {
      type: "paragraph",
      text: "第 3 章《StatefulSet：有状态应用的秩序》把书店数据库 shop-db 装进了 StatefulSet：副本有序、网络身份稳定，清单看起来相当完整。但还差最关键的一块——PostgreSQL 的数据写在容器的可写层里，只要 Pod 被删除重建，整家书店的数据就归零了。容器可以随时重建，数据不行。这一章的三节课解决同一个问题：「数据如何活过 Pod」。本课先建立卷（Volume）的心智模型，认识两类最简单的卷 emptyDir 与 hostPath；下一课把存储抽象成 PV/PVC/StorageClass；再下一课看 CSI 标准与有状态应用上生产的责任边界。",
    },
    {
      type: "heading",
      text: "容器文件系统：随容器生，随容器死",
    },
    {
      type: "paragraph",
      text: "回忆第 2 章《Pod 与容器：解剖一个 YAML》：容器由只读的镜像层加一层可写层组成，应用写进自己文件系统的任何文件，都落在这层可写层上——它的寿命和容器实例一样长。容器实例一消失（崩溃后被 restartPolicy 重启、被删除重建、节点故障后在别处重新拉起），kubelet 就用镜像重新创建容器，旧的可写层直接丢弃。你在 Docker 时代就知道「别把数据写进容器」；到了 k8s 这层约束更严峻：不仅容器不固定，连运行容器的节点都不固定——数据若只存在于容器文件系统里，滚动更新、节点故障这类「正常操作」，每一次都等于一次静默的数据丢失。",
    },
    {
      type: "heading",
      text: "卷：把存储从容器提升到 Pod",
    },
    {
      type: "definition",
      term: "卷（Volume）",
      definition:
        "挂载在 Pod 上的存储单元：先于容器创建，容器通过 volumeMounts 把它挂到自己文件系统的某个路径；同一 Pod 的多个容器可共享同一个卷；卷的寿命不短于 Pod。",
    },
    {
      type: "paragraph",
      text: "卷带来的关键变化是所有权转移：目录的所有权从容器上升到了 Pod。由此得到两个推论。第一，同一个 Pod 里的多个容器可以把同一个卷挂到各自路径下互相交换数据——第 2 章预告过 initContainers 与主容器共享卷的用法。第二，卷的寿命以 Pod 为界：容器重启只是换了一个挂载者，卷里的内容还在；Pod 被删除，卷才随之消失。k8s 的卷种类很多，但有一条主线值得记住：emptyDir（Pod 级临时）→ hostPath（绑定某台节点）→ PV/PVC（集群级、可跨节点迁移）。越往后，数据活得越久、离具体某台机器越远——本章三课就沿这条线展开。",
    },
    {
      type: "heading",
      text: "emptyDir：Pod 级临时目录",
    },
    {
      type: "paragraph",
      text: "emptyDir 是最简单的卷：Pod 创建时，kubelet 在节点上为它分配一个空目录；Pod 存活期间目录一直存在。名字里的 empty 指「初始为空」，不是「随时清空」。它的用途画像很明确：同 Pod 的容器之间交换数据、应用缓存与临时文件——一句话，需要共享、或需要比容器活得更久、但不需要比 Pod 活得更久的临时数据。典型的例子是日志转发边车：主容器把日志写进 emptyDir，sidecar 容器读走并转发到采集端。下面用一个双容器 Pod 演示「卷作为中间人」的机制。",
    },
    {
      type: "code",
      title: "cache-demo.yaml：两个容器通过 emptyDir 交换数据",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: cache-demo
  namespace: shop
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date > /scratch/now.txt; sleep 3; done"]
      volumeMounts:
        - name: scratch
          mountPath: /scratch
    - name: reader
      image: busybox:1.36
      command: ["sh", "-c", "while true; do cat /scratch/now.txt; sleep 3; done"]
      volumeMounts:
        - name: scratch
          mountPath: /scratch
  volumes:
    - name: scratch
      emptyDir: {}`,
    },
    {
      type: "paragraph",
      text: "writer 每 3 秒把当前时间写进 /scratch/now.txt，reader 每 3 秒读出来。两个容器没有直接通信，中间人是挂载到同一路径的 emptyDir 卷——容器的 /scratch 其实是同一个目录的两扇门。注意两个细节：command 覆盖了 busybox 镜像的默认命令（第 2 章讲过镜像 CMD 与清单 command 的覆盖关系）；如果把 volumes 一节删掉，这个 Pod 立刻无法工作——「共享」是卷带来的，不是容器自带的。想体验「容器重启而数据不丢」，正好把 emptyDir 与容器可写层对比：同样一份临时文件，写在容器可写层里，容器一重启就丢；写在 emptyDir 里，容器重启后还在——卷属于 Pod，不属于某个容器实例。",
    },
    {
      type: "paragraph",
      text: "emptyDir 还可以挂在内存里：把 volumes 里的 emptyDir: {} 换成 emptyDir: { medium: Memory }，目录就变成内存文件系统（tmpfs）。读写快、不占磁盘，适合缓存类数据；代价是占用节点内存，且 Pod 消失时内容直接蒸发。记住判断标准：medium: Memory 适合「丢了也无所谓、但想要快」的数据。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "emptyDir 不是持久化",
      body: "名字容易误导人。emptyDir 解决的是「容器重启后数据还在」和「同 Pod 容器间共享」，不是「数据活过 Pod」。Pod 一旦被删除——Deployment 滚动更新、节点故障后在别处重建——目录连同内容一起清零。判断一个卷能不能承载业务数据，只需问一句：Pod 没了，它还在吗？emptyDir 的回答是不在。想要「还在」，就要沿主线往下一层走。",
    },
    {
      type: "heading",
      text: "hostPath：把节点目录直通进 Pod",
    },
    {
      type: "paragraph",
      text: "hostPath 卷把节点文件系统上的一个真实路径直接挂进 Pod——容器里看到的目录，就是运行它的那台机器上的目录。它有两个正当用途。一是单机调试与学习：想模拟「数据重启后还在」最省事，kind 里常拿它充当临时盘，下一课实操就用它。二是读取节点自身的文件：第 3 章《DaemonSet：每个节点恰好一个》设想的日志采集器，就得用 hostPath 读节点上的容器日志目录——这种「读机器状态」的场景天然属于 hostPath。下面是一个只读挂载节点日志目录的示例。",
    },
    {
      type: "code",
      title: "node-log-reader.yaml：用 hostPath 读节点上的容器日志",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: node-log-reader
  namespace: shop
spec:
  containers:
    - name: reader
      image: busybox:1.36
      command: ["sh", "-c", "ls /var/log/containers; sleep 3600"]
      volumeMounts:
        - name: node-logs
          mountPath: /var/log/containers
          readOnly: true
  volumes:
    - name: node-logs
      hostPath:
        path: /var/log/containers
        type: Directory`,
    },
    {
      type: "paragraph",
      text: "hostPath 的声明只有两个关键点：path 是节点上的真实路径；type 是 kubelet 对路径存在性的检查方式——Directory 要求路径已存在且是目录，DirectoryOrCreate 则允许 kubelet 在路径不存在时先创建目录。加上 readOnly: true，容器就只能读不能写，符合「读节点状态」的用途。如果你在 kind 上 apply 这个清单，ls 输出的正是该节点上所有容器的日志软链接——kubelet 把容器日志统一放在这里。",
    },
    {
      type: "paragraph",
      text: "那为什么没人把数据库直接放在 hostPath 上？回到本课开头的问题：数据要的是「活过 Pod 还能跟着走」。hostPath 的数据活得比 Pod 长，但它被焊死在某台节点上。比如本课程的 kind 集群有两个 worker：假设 Pod 第一次被调度到 worker-1，往节点目录写入了数据；滚动更新或节点维护后 Pod 在 worker-2 重建，挂上的是 worker-2 上的同名目录——里面空空如也。数据没丢，它还在 worker-1 的目录里，只是你的应用已经够不着它了。多副本场景更危险：两个副本同时读写同一节点目录，互相覆盖，连基本的并发保护都没有；目录权限、残留清理还得人肉管理。hostPath 把应用的命运重新绑回某台机器，而这恰恰是 k8s 想帮你摆脱的东西。结论一句话：hostPath 适合单机调试与节点级系统组件，不适合承载业务数据。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "kind 里的「节点路径」",
      body: "在 kind 中，hostPath 的 path 指的是节点容器内部的路径（如 /var/log/containers、/mnt/...），不是宿主机的路径。挂载后可用 docker exec k8s-course-worker ls /var/log/containers 进节点容器验证同一个目录。type: DirectoryOrCreate 会让 kubelet 在路径不存在时先建目录，单机演练时省去手工 mkdir。",
    },
    {
      type: "quiz",
      question:
        "shop-api 的一个 Pod 把处理中的临时文件写进了 emptyDir 卷。下面哪种情况一定会让这些数据消失？",
      options: [
        "应用容器崩溃，kubelet 按 restartPolicy 把它重启成新容器",
        "同 Pod 的另一个容器发生重启",
        "Deployment 滚动更新：旧 Pod 被删除，新 Pod 被创建",
        "集群里另一个无关命名空间的 Pod 被删除",
      ],
      answer: 2,
      explanation:
        "emptyDir 的寿命等于 Pod：选项 A、B 只是容器级别的新旧交替，Pod 与卷都还在——这正是卷优于容器可写层的地方；选项 D 与这个 Pod 毫无关系。选项 C 是整个 Pod 被替换，旧卷随旧 Pod 删除，若新 Pod 被调度到别的节点，挂载的更是全新的空目录，数据必然清零。",
    },
    {
      type: "keypoints",
      items: [
        "容器可写层随容器实例消失；在 k8s 里 Pod 与节点都不固定，业务数据不能只存在于容器文件系统里。",
        "卷挂在 Pod 上：同 Pod 容器可共享、生命周期以 Pod 为界（容器重启不丢，Pod 没了才丢）。",
        "emptyDir：Pod 级临时目录，解决共享与跨容器重启；medium: Memory 走内存。它不是持久化。",
        "hostPath：绑定节点真实目录，适合单机调试与读节点文件（如日志采集）；不能当生产数据卷——数据不随 Pod 迁移、多副本互相踩。",
        "主线：emptyDir → hostPath → PV/PVC，越往后数据活得越久、离具体机器越远。要数据「活过 Pod 且能迁移」，看下一课。",
      ],
    },
  ],
};
