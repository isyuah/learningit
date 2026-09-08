/* ==================================================================
 * 课时：从零部署：分层落地与验证（k8s-capstone-deploy）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "按依赖顺序把 shop 的八份清单分层落地：每层 apply 后先验证再进下一层，最后打通 Ingress 端到端访问，完成部署类成功标准的验收。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课产出的对象清单只是图纸，本课把它变成运行中的系统。落地顺序就是依赖顺序：命名空间先于一切；配置与口令先于引用它们的应用；存储先于有状态的数据库；数据库、缓存就绪后，无状态的店面与接口才有完整的依赖底座；Ingress 最后把流量引进来。每层遵循同一节奏：apply → 用该层自己的验证命令确认「预期特征」→ 出现偏差就按第 11 章的方法定位并修复 → 再进下一层。所有清单按序号放在同一个目录（例如 manifests/），这份「磁盘上的声明式源」在后面的发布与故障课里会被反复修改、重放，正是声明式工作流（第 1 章《对象模型：声明式、spec 与调谐循环》）的用武之地。",
    },
    {
      type: "callout",
      variant: "note",
      title: "从干净状态开始",
      body: "前面章节的练习可能已在同一集群留下同名对象（如 shop-web、shop-db 这类名字出现在第 3 章与第 5 章的练习里）。对同名对象，kubectl apply 会按本课清单做声明式合并收敛；但若旧对象带不可变字段（例如已经绑定的 PV），apply 会直接报错。遇到冲突就删掉旧对象再 apply；最省心的做法是新建集群后按 01–08 顺序重放本课清单——这正是「清单即真相」的又一次体现。另注意：第 8 章《工作负载加固》若已给 shop 命名空间开启 PSA enforce=restricted，本课的数据库与无状态应用清单（root 运行、无 securityContext）会在准入阶段被拒——先 `kubectl get ns shop -o yaml` 查看 pod-security.kubernetes.io/enforce 标签，必要时移除该标签，或改用第 31 课提供的加固形态（postgres 官方镜像的非 root 化需要额外适配）。",
    },
    {
      type: "heading",
      text: "第 1 层：命名空间、配额与默认值",
    },
    {
      type: "paragraph",
      text: "Namespace 是治理边界，也是后面每一层命令的 -n shop 的落点。ResourceQuota 的数字要与第 47 课清单对账：四类工作负载各取最大规模（api 被 HPA 撑到 5 副本）时，requests.cpu 峰值约 0.75、requests.memory 约 1.1Gi，留出余量给调试 Pod，所以预算定为 cpu 1、内存 1.5Gi。配额按 requests 计账而不是按实际用量计（第 10 章《命名空间治理：配额与多团队》），这一点到第 50 课「扩容被拒」演练时会再次出现。LimitRange 的意义是：有了配额之后，一个没写 requests/limits 的裸 Pod 会被拒收，它给这类 Pod（比如临时调试用的 busybox）补上默认值，让配额账目总是可算的。",
    },
    {
      type: "code",
      title: "manifests/01-namespace.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: Namespace
metadata:
  name: shop
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: shop-quota
  namespace: shop
spec:
  hard:
    requests.cpu: "1"
    requests.memory: 1.5Gi
    limits.cpu: "2"
    limits.memory: 3Gi
---
apiVersion: v1
kind: LimitRange
metadata:
  name: shop-defaults
  namespace: shop
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 64Mi
      default:
        cpu: 200m
        memory: 128Mi`,
    },
    {
      type: "code",
      title: "第 1 层验证",
      language: "bash",
      code: `kubectl apply -f manifests/01-namespace.yaml
kubectl get ns shop
# 预期：STATUS 为 Active

kubectl -n shop get resourcequota
# 预期：存在 shop-quota；REQUEST/LIMIT 列为 0 或空
# 提示：随着后续各层落地，这个配额的使用量会逐层增长——这是正常的，也是观察配额计账的好时机

kubectl -n shop get limitrange`,
    },
    {
      type: "heading",
      text: "第 2 层：ConfigMap 与 Secret",
    },
    {
      type: "paragraph",
      text: "两个对象分别服务两类消费方：shop-web-html 的 index.html 会被整卷挂载进 nginx 的 html 目录（键名即文件名，第 5 章《ConfigMap：配置与镜像分离》的形态）；shop-db-credentials 集中放数据库凭据（用户、库名、口令三个键），postgres 容器用 envFrom 一次注入——与第 3 章《StatefulSet：有状态应用的秩序》、第 5 章《Secret：敏感数据与信任边界》建立的共享对象完全一致（第 5 章练习里的 shop-web-nginx 是 immutable server 配置的专项演示对象，本清单不再使用）。清单里故意用了 stringData——它让你能写明文，apiserver 写入时再编码，但这只是写法便利：对象里存的仍是 base64，而 base64 只是编码不是加密（第 5 章《Secret：敏感数据与信任边界》）。这里写死口令是教学简化，生产环境的口令应来自 kubectl create secret 或外部管理，绝不进 Git。",
    },
    {
      type: "code",
      title: "manifests/02-config-secret.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-web-html
  namespace: shop
data:
  index.html: |
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>shop 书店</title></head>
    <body>
      <h1>shop 书店</h1>
      <p>欢迎光临 shop 书店——首页文案由 ConfigMap 提供。</p>
    </body>
    </html>
---
apiVersion: v1
kind: Secret
metadata:
  name: shop-db-credentials
  namespace: shop
type: Opaque
stringData:
  POSTGRES_USER: shop
  POSTGRES_DB: shop
  POSTGRES_PASSWORD: Shop-db-pass-2026`,
    },
    {
      type: "code",
      title: "第 2 层验证",
      language: "bash",
      code: `kubectl apply -f manifests/02-config-secret.yaml
kubectl -n shop get cm,secret
# 预期：ConfigMap shop-web-html 与 Secret shop-db-credentials 均存在；Secret 的 DATA 列显示 3 项

kubectl -n shop get secret shop-db-credentials -o jsonpath="{.data.POSTGRES_PASSWORD}"
# 预期：输出一串 base64 文本，把它解回原文就是清单里写的口令
# 这个实验再次说明：能读到 Secret 的人就等于拿到了明文`,
    },
    {
      type: "heading",
      text: "第 3 层：shop-db——有状态的一层",
    },
    {
      type: "paragraph",
      text: "数据库是唯一「数据必须活过 Pod」的组件，所以这一层有三个配合对象：PV 提供静态供给的物理卷（老版本 kind 没有默认存储类；2026 年起的较新 kind 自带 local-path 默认类——本课 PVC 显式声明空 storageClassName，只绑定无类静态 PV，任何 kind 版本行为一致；机制见第 6 章《PV、PVC 与 StorageClass：存储的声明式抽象》）；headless Service 给 StatefulSet 的 Pod 稳定 DNS 身份；StatefulSet 负责「一个副本、一个独立 PVC、固定名字 shop-db-0」的秩序。hostPath 目录在节点上，所以先用节点标签把数据库钉在选定的 worker 上，StatefulSet 用 nodeSelector 跟随——这既保证卷一定存在，也顺带复习了第 7 章《亲和、反亲和与污点容忍》的 nodeSelector。探针用 postgres 自带的 pg_isready：初始化完成、能接受连接之前它返回失败，readiness 与 liveness 双双卡住新 Pod，天然防止「库没起来就接流量」。镜像只在数据目录首次初始化时用 POSTGRES_USER/POSTGRES_DB/POSTGRES_PASSWORD 建库建用户，之后以数据目录为准（镜像行为以官方文档为准）。",
    },
    {
      type: "code",
      title: "把数据库钉在一个 worker 上（按你机器上实际的 worker 名调整）",
      language: "bash",
      code: `kubectl get nodes
# worker 名以 kubectl get nodes 为准；kind 按集群名 k8s-course 生成
# k8s-course-worker 与 k8s-course-worker2，若不同请替换
kubectl label node k8s-course-worker shop-db=hosted
# 预期：node/k8s-course-worker labeled`,
    },
    {
      type: "code",
      title: "manifests/03-shop-db.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-shop-db
spec:
  capacity:
    storage: 2Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /mnt/shop-db
    type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: shop-db
  namespace: shop
spec:
  clusterIP: None
  selector:
    app: shop-db
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: shop-db
  namespace: shop
spec:
  serviceName: shop-db
  replicas: 1
  selector:
    matchLabels:
      app: shop-db
  template:
    metadata:
      labels:
        app: shop-db
    spec:
      nodeSelector:
        shop-db: hosted
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: shop-db-credentials
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 200m
              memory: 512Mi
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "shop", "-d", "shop"]
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "shop", "-d", "shop"]
            initialDelaySeconds: 60
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ""
        resources:
          requests:
            storage: 1Gi`,
    },
    {
      type: "paragraph",
      text: "StatefulSet 的 volumeClaimTemplate 名为 data，所以生成的 PVC 叫 data-shop-db-0（模板名 + 对象名 + 序号）。它是集群里唯一的静态 PV，PVC 会与它绑定；pod 序号 0、固定主机名、headless DNS——shop-db-0 这套身份在第 50 课「误删 Secret 后数据库重建」的演练里还要靠它证明「Pod 没了、卷还在」。reclaimPolicy 用 Retain：万一 PVC 被删，PV 不会自动清空，而是等管理员手动回收（第 6 章讲过 Retain 的回收流程）。",
    },
    {
      type: "code",
      title: "第 3 层验证",
      language: "bash",
      code: `kubectl apply -f manifests/03-shop-db.yaml
kubectl -n shop rollout status statefulset/shop-db
# 预期：滚动推进到 1 个副本 ready，命令以成功结束

kubectl -n shop get pod -l app=shop-db -o wide
# 预期：Pod 名为 shop-db-0，Running，READY 1/1，NODE 是打了 shop-db=hosted 标签的节点

kubectl -n shop get pvc
# 预期：data-shop-db-0 存在且 STATUS 为 Bound

kubectl -n shop get pv pv-shop-db
# 预期：pv-shop-db 的 STATUS 为 Bound（被 data-shop-db-0 占用）

kubectl -n shop describe pod shop-db-0
# 预期：Events 里能看到镜像拉取、容器创建成功；
# 若失败，先看事件原文，再回第 11 章《Pod 排障：从 Pending 到 CrashLoop》`,
    },
    {
      type: "heading",
      text: "第 4 层：shop-cache",
    },
    {
      type: "paragraph",
      text: "缓存是「无状态可重建」的典型：数据丢了可以重灌，所以单副本 Deployment 足够，不需要 StatefulSet 的稳定身份与逐副本卷（第 3 章《StatefulSet：有状态应用的秩序》的选型判断在这里复用）。redis:7.4-alpine 镜像自带 redis-cli，readiness 探针直接执行 redis-cli ping——服务能应答 PONG 才算就绪。Service 用普通 ClusterIP，端口 6379。",
    },
    {
      type: "code",
      title: "manifests/04-shop-cache.yaml",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-cache
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: shop-cache
  template:
    metadata:
      labels:
        app: shop-cache
    spec:
      containers:
        - name: redis
          image: redis:7.4-alpine
          ports:
            - containerPort: 6379
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: shop-cache
  namespace: shop
spec:
  selector:
    app: shop-cache
  ports:
    - port: 6379
      targetPort: 6379`,
    },
    {
      type: "code",
      title: "第 4 层验证",
      language: "bash",
      code: `kubectl apply -f manifests/04-shop-cache.yaml
kubectl -n shop rollout status deployment/shop-cache
kubectl -n shop get pod -l app=shop-cache
# 预期：READY 1/1

kubectl -n shop get pod -l app=shop-cache -o name
# 复制输出的 Pod 名，然后执行（把下面的名字换成实际 Pod 名）：
kubectl -n shop exec shop-cache-<实际 Pod 名> -- redis-cli ping
# 预期：回复 PONG（redis-cli 的正常应答），说明容器内服务可用`,
    },
    {
      type: "heading",
      text: "第 5 层：shop-web 与 shop-api（含 PDB）",
    },
    {
      type: "paragraph",
      text: "无状态应用层一次落地三个文件。shop-web 把 shop-web-html 整卷挂到 nginx 的 html 目录：ConfigMap 的键 index.html 变成目录里的同名文件，nginx 的 / 自然就返回它——配置与镜像分离，改文案不用重建镜像（第 5 章《ConfigMap：配置与镜像分离》）。readiness/liveness 用 httpGet 打 /，nginx 返回 200 即就绪；minReadySeconds 设为 10，新副本要稳定就绪 10 秒才算可用，第 49 课的滚动观察就靠它把节奏放慢（第 3 章《滚动更新、回滚与发布策略》）。shop-api 的形态相同，只是镜像换成 echoserver（监听 8080，对任何路径回 200 并回显请求），Service 直接暴露 8080 端口（与容器端口一致）——Ingress 的 /api 后端指向 shop-api 服务的 8080。两个 Deployment 各配一份 PDB：minAvailable=1，声明「自愿中断时至少要有一个副本可用」（第 10 章《节点维护：cordon、drain 与故障自愈》）。",
    },
    {
      type: "code",
      title: "manifests/05-shop-web.yaml",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-web
  namespace: shop
spec:
  replicas: 2
  minReadySeconds: 10
  selector:
    matchLabels:
      app: shop-web
  template:
    metadata:
      labels:
        app: shop-web
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
          volumeMounts:
            - name: content
              mountPath: /usr/share/nginx/html
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 15
      volumes:
        - name: content
          configMap:
            name: shop-web-html
---
apiVersion: v1
kind: Service
metadata:
  name: shop-web
  namespace: shop
spec:
  selector:
    app: shop-web
  ports:
    - port: 80
      targetPort: 80`,
    },
    {
      type: "code",
      title: "manifests/06-shop-api.yaml",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: shop
spec:
  replicas: 2
  minReadySeconds: 10
  selector:
    matchLabels:
      app: shop-api
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: api
          image: registry.k8s.io/echoserver:1.10
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /
              port: 8080
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 15
---
apiVersion: v1
kind: Service
metadata:
  name: shop-api
  namespace: shop
spec:
  selector:
    app: shop-api
  ports:
    - port: 8080
      targetPort: 8080`,
    },
    {
      type: "code",
      title: "manifests/07-pdb.yaml",
      language: "yaml",
      code: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: shop-web-pdb
  namespace: shop
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: shop-web
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: shop-api-pdb
  namespace: shop
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: shop-api`,
    },
    {
      type: "code",
      title: "第 5 层验证",
      language: "bash",
      code: `kubectl apply -f manifests/05-shop-web.yaml
kubectl apply -f manifests/06-shop-api.yaml
kubectl apply -f manifests/07-pdb.yaml
kubectl -n shop rollout status deployment/shop-web
kubectl -n shop rollout status deployment/shop-api
# 预期：两个滚动都以成功结束；注意 minReadySeconds=10 会让就绪节奏放慢一拍

kubectl -n shop get pods -l app=shop-web
kubectl -n shop get pods -l app=shop-api
# 预期：各 2 个副本，全部 Running 且 READY 1/1

kubectl -n shop get pdb
# 预期：两个 PDB 存在，ALLOWED DISRUPTIONS 显示为 1（2 个副本、minAvailable=1）

# 从集群内部验证 Service 与 DNS（一次性 Pod，跑完即删）：
kubectl -n shop run net-check --image=busybox:1.36 --restart=Never --rm -- wget -qO- http://shop-web/
# 预期：输出就是 shop-web-html 里 index.html 的 HTML 内容

kubectl -n shop run api-check --image=busybox:1.36 --restart=Never --rm -- wget -qO- http://shop-api:8080/hello
# 预期：输出是 echoserver 的回显文本，其中能看到你请求的路径 /hello

kubectl -n shop run dns-check --image=busybox:1.36 --restart=Never --rm -- nslookup shop-api
# 预期：解析到集群 Service 网段内的一个 ClusterIP（如 10.96.x.x，具体以集群配置为准）

kubectl -n shop run dns-db --image=busybox:1.36 --restart=Never --rm -- nslookup shop-db
# 预期：解析结果不是虚拟 IP，而是 shop-db-0 的 Pod IP——headless Service 的特征（第 4 章《Service：稳定的访问入口与 DNS》）`,
    },
    {
      type: "heading",
      text: "第 6 层：Ingress 与端到端验收",
    },
    {
      type: "paragraph",
      text: "前五层完成的是集群内部可达，最后一层把流量从外面引进来。前提是集群创建时带 80/443 端口映射、且装好了 ingress-nginx 控制器——如果第 4 章《Ingress 与 Gateway API：七层入口》的实操没有留下这两样，按 kind 官方文档（kind.sigs.k8s.io/docs/user/ingress）重建或补装：控制器镜像版本要与集群版本匹配，以官方文档为准。重建集群也不可怕：把 manifests/01 到 07 按序重放一遍即可，这就是把清单留在磁盘上的回报。kind 集群配置文件需要这样一段端口映射：",
    },
    {
      type: "code",
      title: "kind-config.yaml（含 Ingress 端口映射）",
      language: "yaml",
      code: `kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: k8s-course
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
      - containerPort: 443
        hostPort: 443
  - role: worker
  - role: worker`,
    },
    {
      type: "paragraph",
      text: "Ingress 清单本身很短：声明 IngressClass（这里是 nginx）、一个 host、两条路径规则。shop.example.com 是示例域名，不会真实解析，本地验证时用 Host 请求头冒充即可。路径 /api 写在 / 前面，nginx 控制器按最长前缀匹配，/api/… 交给 shop-api，其余交给 shop-web。这里没有配 TLS——生产环境要在这里挂证书 Secret 并让 Ingress 终止 TLS（回指第 4 章《Ingress 与 Gateway API：七层入口》与第 5 章《Secret：敏感数据与信任边界》）。",
    },
    {
      type: "code",
      title: "manifests/08-ingress.yaml",
      language: "yaml",
      code: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop-ingress
  namespace: shop
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: shop-api
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: shop-web
                port:
                  number: 80`,
    },
    {
      type: "code",
      title: "第 6 层验证与端到端验收（成功标准 1–3）",
      language: "bash",
      code: `kubectl apply -f manifests/08-ingress.yaml
kubectl -n shop get ingress
# 预期：shop-ingress 存在，CLASS 为 nginx，HOSTS 为 shop.example.com

curl -sS -H "Host: shop.example.com" http://127.0.0.1/
# 预期：返回 shop-web 的首页 HTML，能看到 ConfigMap 里的那句欢迎文案

curl -sS -H "Host: shop.example.com" http://127.0.0.1/api/books
# 预期：返回 echoserver 的回显文本，其中能看到你请求的路径 /api/books
# 若返回 404/连接失败：先查 Ingress 控制器是否 Ready、路径是否写对，
# 再按第 11 章《Service 与网络排障》的检查链逐级缩小（回指第 4 章《Ingress 与 Gateway API：七层入口》）`,
    },
    {
      type: "heading",
      text: "失败时按层定位",
    },
    {
      type: "table",
      caption: "分层部署的失败定位速查",
      headers: ["症状", "大概率根因", "去哪找证据"],
      rows: [
        ["db Pod 停在 Pending/ContainerCreating", "节点标签没打、PV/PVC 未绑定、Secret/ConfigMap 缺失", "kubectl -n shop describe pod shop-db-0 的事件；第 11 章《Pod 排障：从 Pending 到 CrashLoop》"],
        ["web/api 副本起不来", "ConfigMap/Secret 引用缺失、镜像拉取失败、探针路径不对", "events + kubectl logs（--previous）；同上回指"],
        ["Service 访问不通", "selector 拼错、targetPort 与容器端口不一致、Pod 没 Ready", "kubectl -n shop get endpoints + describe service；第 11 章《Service 与网络排障》"],
        ["Ingress 404/超时", "控制器没装、ingressClassName 不对、host 与 curl 的 Host 头不一致", "kubectl get ingressclass、控制器 Pod 日志；回指第 4 章 Ingress 课"],
        ["对象 apply 被拒", "配额不足、字段校验不过", "apply 的报错原文 + kubectl -n shop get resourcequota；回指第 10 章《命名空间治理：配额与多团队》"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "云上差异只有一句话",
      body: "以上清单在云托管集群上基本原样可用，差异只在「谁提供卷与入口」：数据卷换成 StorageClass 动态供给、入口换成云负载均衡（LoadBalancer）或托管的 Ingress，控制面运维交给云厂商（回指第 10 章《集群从哪来：安装方式全景》）。",
    },
    {
      type: "exercise",
      title: "练习：分层落地与验收记录",
      description:
        "按本课六层顺序逐层执行：apply → 运行该层验证命令 → 在笔记里记下「预期特征是否出现」。要求：1) 每层完成时把 ResourceQuota 的 REQUEST 列抄下来，观察它如何随层数增长；2) 任一层失败时，抄下你看到的第一个事件或报错原文，并对照「失败定位速查表」找到对应回指；3) 全部六层完成后，用第 47 课成功标准 1–3 逐条自测，把 curl 的输出特征贴在记录里；4) 把 manifests/ 目录留在磁盘上，后续两课还要改它。",
      hint: "顺序即依赖：第 3 层之前先打节点标签；第 6 层的前提是控制器与端口映射，缺失时先看 ingressclass 是否存在。不要跳过单层验证直接全部 apply——分层的意义就是让「哪一层坏了」一望可知。",
    },
    {
      type: "keypoints",
      items: [
        "依赖顺序 = 落地顺序：命名空间与预算 → 配置与口令 → 存储与有状态库 → 缓存 → 无状态应用 → 入口，每层验证通过才进下一层。",
        "验证看「预期特征」而不是背输出：PVC Bound、Pod 序号固定、headless 解析出 Pod IP、配额 REQUEST 增长，每个特征都对应一条前面学过的机制。",
        "清单留在磁盘就是声明式源：后面的发布、回滚、故障恢复，全部靠重放和修改这份清单完成。",
      ],
    },
  ],
};
