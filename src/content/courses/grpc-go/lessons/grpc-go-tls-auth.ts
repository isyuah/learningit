import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-tls-auth",
  courseSlug: "grpc-go",
  title: "TLS、认证与信任边界",
  summary:
    "区分加密、对端身份验证和业务授权，用 Go 配置 TLS，并知道 insecure credentials 只能留在本地练习。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "“启用 TLS”不是完整的认证方案。TLS 解决传输保密性、完整性和证书层面的对端身份；业务认证决定调用者是谁；授权决定这个调用者能做什么。把三件事混在一起，常见结果是服务传输加密了，却仍然信任客户端自报的 user_id 或 tenant_id。",
    },
    {
      type: "table",
      caption: "安全边界的三层职责",
      headers: ["层", "回答的问题", "常见实现"],
      rows: [
        ["传输安全", "中间人能否读取或篡改字节？连接到了哪个服务？", "TLS、证书、主机名校验"],
        ["身份认证", "这次调用代表哪个主体？", "OAuth/JWT、API token、mTLS 身份"],
        ["授权", "这个主体能否访问这个资源或执行这个动作？", "租户、角色、资源级策略"],
      ],
    },
    {
      type: "heading",
      text: "服务端配置 TLS",
    },
    {
      type: "code",
      title: "server/main.go",
      language: "go",
      code: 'cert, err := tls.LoadX509KeyPair("server.crt", "server.key")\nif err != nil {\n  return err\n}\n\ntlsConfig := &tls.Config{\n  Certificates: []tls.Certificate{cert},\n  MinVersion:   tls.VersionTLS13,\n}\n\nserver := grpc.NewServer(\n  grpc.Creds(credentials.NewTLS(tlsConfig)),\n)\npb.RegisterCatalogServiceServer(server, &catalogServer{})',
    },
    {
      type: "paragraph",
      text: "生产环境还要配置证书链、密钥存储、轮换和主机名校验。示例只展示 gRPC-Go 的边界 API，不代表把证书文件放在工作目录就是合适的密钥管理方案。",
    },
    {
      type: "heading",
      text: "客户端校验服务端身份",
    },
    {
      type: "code",
      title: "client/main.go",
      language: "go",
      code: 'tlsConfig := &tls.Config{\n  MinVersion: tls.VersionTLS13,\n  ServerName: "catalog.internal.example",\n  RootCAs:    trustedRoots,\n}\n\nconn, err := grpc.NewClient(\n  "catalog.internal.example:443",\n  grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)),\n)\nif err != nil {\n  return err\n}\ndefer conn.Close()',
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要用 InsecureSkipVerify 绕过问题",
      body: "InsecureSkipVerify 会削弱客户端对服务端身份的校验，适合诊断实验，不应作为生产修复。证书域名、信任根、SNI 和服务发现地址应被修正，而不是把验证关掉。",
    },
    {
      type: "heading",
      text: "mTLS 与业务 token 的取舍",
    },
    {
      type: "paragraph",
      text: "mTLS 让客户端也用证书向服务端证明身份，适合服务到服务的强身份边界，但证书签发、轮换和映射策略会增加运维复杂度。JWT 或 API token 更容易表达用户和权限，但依赖 token 验证、过期和撤销策略。两者可以组合：mTLS 证明工作负载身份，metadata 中的 token 表达用户委托。",
    },
    {
      type: "heading",
      text: "本地与生产的明确分界",
    },
    {
      type: "list",
      items: [
        "本地单机练习可以使用 insecure.NewCredentials，减少证书准备成本。",
        "测试环境应至少验证证书加载、主机名校验和过期失败路径。",
        "生产环境不能把 token、私钥或完整认证 metadata 写入普通日志。",
        "服务端仍需做授权检查，TLS 成功不表示调用者有权读写资源。",
      ],
    },
    {
      type: "quiz",
      question: "TLS 已经启用时，为什么仍然需要业务授权？",
      options: [
        "因为 TLS 只负责把 protobuf 改成 JSON",
        "因为 TLS 主要保护连接与对端身份，不会决定主体能否访问某本书",
        "因为启用 TLS 会自动删除所有 metadata",
        "因为授权只对浏览器请求有效",
      ],
      answer: 1,
      explanation:
        "TLS 保护传输并验证证书层面的对端，授权是业务层判断主体与资源关系，两者解决不同问题。",
    },
    {
      type: "exercise",
      title: "画出 CatalogService 的信任边界",
      description:
        "分别标注客户端、服务端、证书颁发方、身份 token 颁发方和数据库。说明每条边界验证什么，以及哪些字段绝不能只相信客户端传入的值。",
      hint:
        "至少区分“连接到了谁”“调用者是谁”“调用者能做什么”三个问题。",
    },
    {
      type: "keypoints",
      items: [
        "TLS、身份认证和授权是三个不同的安全问题。",
        "客户端应校验证书链和服务名，不要用 InsecureSkipVerify 规避配置错误。",
        "mTLS 和 token 各有运维与表达能力取舍，也可以组合。",
        "insecure credentials 只适合本地练习；生产日志和配置不能泄露密钥与凭证。",
      ],
    },
  ],
};
