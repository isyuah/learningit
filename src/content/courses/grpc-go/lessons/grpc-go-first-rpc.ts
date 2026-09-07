import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-first-rpc",
  courseSlug: "grpc-go",
  title: "从 proto 到第一个 Go RPC",
  summary:
    "完成一个最小的 GetBook unary RPC，认识 protoc、生成代码、服务注册、客户端连接和 deadline。",
  minutes: 32,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "这一节只做一件事：让 CatalogService 的 GetBook 从 proto 变成一个可以调用的 Go 方法。先不加入数据库、认证和重试，因为第一次成功调用的价值在于看清生成代码与运行时的边界。",
    },
    {
      type: "heading",
      text: "定义服务契约",
    },
    {
      type: "code",
      title: "catalog.proto",
      language: "protobuf",
      code: 'syntax = "proto3";\n\npackage catalog.v1;\noption go_package = "example.com/catalog/gen/catalogv1";\n\nservice CatalogService {\n  rpc GetBook(GetBookRequest) returns (Book);\n}\n\nmessage GetBookRequest {\n  string isbn = 1;\n}\n\nmessage Book {\n  string isbn = 1;\n  string title = 2;\n  string author = 3;\n}',
    },
    {
      type: "paragraph",
      text: "service 声明远程能力，rpc 声明方法的输入和输出，message 声明线上消息结构。字段右侧的数字不是展示顺序，而是二进制编码中的 field number；它一旦发布就属于兼容性契约，后续会专门讨论。",
    },
    {
      type: "heading",
      text: "生成 Go 代码",
    },
    {
      type: "paragraph",
      text: "本地需要 protoc，以及与当前 Go 项目匹配的 protoc-gen-go 和 protoc-gen-go-grpc 插件。不同版本的生成命令和插件安装方式可能变化，因此应以 gRPC-Go 与 protobuf 官方文档为准；下面展示的是常见的 source_relative 目录布局。",
    },
    {
      type: "code",
      title: "生成消息与 gRPC 桩",
      language: "bash",
      code: "protoc \\\n  --go_out=. --go_opt=paths=source_relative \\\n  --go-grpc_out=. --go-grpc_opt=paths=source_relative \\\n  catalog.proto",
    },
    {
      type: "paragraph",
      text: "生成结果通常包含消息类型、序列化支持、客户端接口、服务端接口和注册函数。不要手改这些文件；如果契约变化，应修改 proto 后重新生成。编译器和生成器正是 gRPC 能保持跨语言契约一致的原因之一。",
    },
    {
      type: "heading",
      text: "实现并注册服务端",
    },
    {
      type: "code",
      title: "server/main.go",
      language: "go",
      code: 'package main\n\nimport (\n  "context"\n  "log"\n  "net"\n\n  "google.golang.org/grpc"\n  "google.golang.org/grpc/codes"\n  "google.golang.org/grpc/status"\n  pb "example.com/catalog/gen/catalogv1"\n)\n\ntype catalogServer struct {\n  pb.UnimplementedCatalogServiceServer\n}\n\nfunc (s *catalogServer) GetBook(ctx context.Context, req *pb.GetBookRequest) (*pb.Book, error) {\n  if req.GetIsbn() == "" {\n    return nil, status.Error(codes.InvalidArgument, "isbn is required")\n  }\n  return &pb.Book{\n    Isbn: req.GetIsbn(),\n    Title: "分布式系统入门",\n    Author: "知学出版社",\n  }, nil\n}\n\nfunc main() {\n  lis, err := net.Listen("tcp", ":50051")\n  if err != nil {\n    log.Fatal(err)\n  }\n\n  s := grpc.NewServer()\n  pb.RegisterCatalogServiceServer(s, &catalogServer{})\n  log.Println("catalog service listening on :50051")\n  if err := s.Serve(lis); err != nil {\n    log.Fatal(err)\n  }\n}',
    },
    {
      type: "paragraph",
      text: "嵌入 UnimplementedCatalogServiceServer 是当前 gRPC-Go 生成代码常见的向前兼容写法。具体接口细节随生成器版本变化，实际项目应以本地生成结果为准；稳定不变的部分是“实现接口并注册服务”。",
    },
    {
      type: "heading",
      text: "调用服务端",
    },
    {
      type: "code",
      title: "client/main.go",
      language: "go",
      code: 'package main\n\nimport (\n  "context"\n  "log"\n  "time"\n\n  "google.golang.org/grpc"\n  "google.golang.org/grpc/credentials/insecure"\n  pb "example.com/catalog/gen/catalogv1"\n)\n\nfunc main() {\n  conn, err := grpc.NewClient(\n    "localhost:50051",\n    grpc.WithTransportCredentials(insecure.NewCredentials()),\n  )\n  if err != nil {\n    log.Fatal(err)\n  }\n  defer conn.Close()\n\n  client := pb.NewCatalogServiceClient(conn)\n  ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)\n  defer cancel()\n\n  book, err := client.GetBook(ctx, &pb.GetBookRequest{Isbn: "978-7-000-00000-0"})\n  if err != nil {\n    log.Fatal(err)\n  }\n  log.Printf("%s - %s", book.GetTitle(), book.GetAuthor())\n}',
    },
    {
      type: "paragraph",
      text: "这里使用 insecure.NewCredentials 只表示本地练习不启用 TLS，不代表生产环境应该明文传输。NewClient 与连接复用让多个 RPC 可以共享同一个 ClientConn；每次请求都传入自己的 context，调用就有了明确的截止时间。",
    },
    {
      type: "exercise",
      title: "动手完成第一次 RPC",
      description:
        "创建 catalog.proto，生成 Go 代码，启动服务端，再写客户端请求一个存在和一个空 ISBN。让存在的请求返回 Book，让空 ISBN 返回 codes.InvalidArgument。记录客户端看到的结果。",
      hint:
        "先让 happy path 跑通，再补校验。若客户端只看到 Unknown，优先检查服务端是否把业务错误正确包装成 status.Error。",
    },
    {
      type: "quiz",
      question: "为什么客户端调用 GetBook 时应传入 context.WithTimeout 创建的 ctx？",
      options: [
        "因为 context 会把 protobuf 自动转换成 JSON",
        "因为 deadline 给这次网络调用设置了预算，避免请求无限等待",
        "因为没有 context，生成的 client stub 无法编译",
        "因为 context 会自动重试所有失败",
      ],
      answer: 1,
      explanation:
        "deadline 是一次调用的时间预算，客户端和服务端都可以据此停止无意义的等待。context 不负责序列化，也不保证自动重试。",
    },
    {
      type: "keypoints",
      items: [
        "proto 描述契约，protoc 插件生成 Go 消息类型和 client/server 桩。",
        "服务端要实现生成的接口并显式注册到 grpc.Server。",
        "客户端复用 ClientConn，并为每次 RPC 传入带 deadline 的 context。",
        "本地 insecure credentials 仅用于练习，生产服务应配置传输安全。",
      ],
    },
  ],
};
