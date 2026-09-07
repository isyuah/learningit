import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  Bot,
  Check,
  Clock3,
  MessageCircleQuestion,
  Plus,
  Send,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Course, Lesson, LessonMeta } from "@/content/types";
import { cn } from "@/lib/utils";
import {
  buildStudyContext,
  createConversation,
  createMessage,
  getConversationTitle,
  loadAssistantSettings,
  loadConversations,
  requestAssistantReply,
  saveAssistantSettings,
  saveConversations,
  type AssistantMessage,
  type ReasoningEffort,
  type StudyConversation,
  type StudySection,
} from "@/lib/ai-assistant";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

const QUICK_PROMPTS = [
  "用一个例子解释这节课的核心概念",
  "这节课最容易混淆的地方是什么？",
  "帮我把当前小节总结成 3 个要点",
];

const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
}> = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

function updateConversation(
  conversations: StudyConversation[],
  id: string,
  updater: (conversation: StudyConversation) => StudyConversation,
) {
  return conversations
    .map((conversation) =>
      conversation.id === id ? updater(conversation) : conversation,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(timestamp);
}

function settingInputClass() {
  return "mt-1.5 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-night-line-strong dark:bg-night-surface-2 dark:text-night-ink dark:placeholder:text-night-faint dark:focus:border-primary-400 dark:focus:ring-primary-900";
}

export function StudyAssistant({
  course,
  lessonMeta,
  lesson,
  currentSection,
}: {
  course: Course;
  /** 大纲中的课时元信息（权威：标题等用它，勿用 lesson.title） */
  lessonMeta?: LessonMeta;
  lesson?: Lesson;
  currentSection?: StudySection | null;
}) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(loadAssistantSettings);
  const [settingsDraft, setSettingsDraft] = useState(settings);
  const [conversations, setConversations] = useState(loadConversations);
  const [activeId, setActiveId] = useState(() => loadConversations()[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId),
    [activeId, conversations],
  );
  const messages = activeConversation?.messages ?? [];
  const hasConnection = Boolean(settings.endpoint.trim() && settings.model.trim());
  const lastMessageLength = messages[messages.length - 1]?.content.length ?? 0;

  useEffect(() => {
    const timer = window.setTimeout(() => saveConversations(conversations), 120);
    if (activeId && !conversations.some((conversation) => conversation.id === activeId)) {
      setActiveId(conversations[0]?.id ?? "");
    }
    return () => window.clearTimeout(timer);
  }, [activeId, conversations]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lastMessageLength, messages.length, loading, open]);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !settingsOpen) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, settingsOpen]);

  const handleNewConversation = useCallback(() => {
    const next = createConversation();
    setConversations((current) => [next, ...current]);
    setActiveId(next.id);
    setHistoryOpen(false);
    setError(null);
    setDraft("");
  }, []);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || loading) return;

    const existing = activeConversation;
    const target = existing ?? createConversation();
    const userMessage = createMessage("user", content);
    const previousMessages = target.messages;
    const nextConversation: StudyConversation = {
      ...target,
      title:
        previousMessages.some((message) => message.role === "user")
          ? target.title
          : getConversationTitle(content),
      messages: [...previousMessages, userMessage],
      updatedAt: Date.now(),
    };
    const assistantMessage = createMessage("assistant", "");
    const conversationWithAssistant: StudyConversation = {
      ...nextConversation,
      messages: [...nextConversation.messages, assistantMessage],
    };

    if (!existing) {
      setConversations((current) => [conversationWithAssistant, ...current]);
      setActiveId(target.id);
    } else {
      setConversations((current) =>
        updateConversation(current, target.id, () => conversationWithAssistant),
      );
    }

    setDraft("");
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    let streamedAnswer = "";

    const appendAssistantDelta = (delta: string) => {
      streamedAnswer += delta;
      setConversations((current) =>
        updateConversation(current, target.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: `${message.content}${delta}`, createdAt: Date.now() }
              : message,
          ),
          updatedAt: Date.now(),
        })),
      );
    };

    try {
      const context = buildStudyContext({
        course,
        lessonMeta,
        lesson,
        query: content,
        currentSection,
        settings,
      });
      const answer = await requestAssistantReply({
        settings,
        messages: [...previousMessages, userMessage],
        context,
        signal: controller.signal,
        onDelta: appendAssistantDelta,
      });
      if (!streamedAnswer && answer) appendAssistantDelta(answer);
    } catch (requestError) {
      if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
        setError(requestError instanceof Error ? requestError.message : "请求失败，请稍后重试。");
        setDraft(content);
        if (!streamedAnswer) {
          setConversations((current) =>
            updateConversation(current, target.id, (conversation) => ({
              ...conversation,
              messages: conversation.messages.filter(
                (message) => message.id !== assistantMessage.id,
              ),
              updatedAt: Date.now(),
            })),
          );
        }
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setLoading(false);
    }
  }, [
    activeConversation,
    course,
    currentSection,
    draft,
    lesson,
    loading,
    settings,
  ]);

  const openSettings = () => {
    setSettingsDraft(settings);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const next = {
      ...settingsDraft,
      endpoint: settingsDraft.endpoint.trim(),
      model: settingsDraft.model.trim(),
    };
    saveAssistantSettings(next);
    setSettings(next);
    setSettingsOpen(false);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="打开学习助手"
          className="fixed bottom-20 right-4 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-primary-600 px-4 text-sm font-semibold text-white shadow-lift transition hover:bg-primary-700 active:scale-[0.98] sm:bottom-6"
        >
          <Bot aria-hidden className="size-4.5" />
          <span className="hidden sm:inline">学习助手</span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="学习助手"
          className="fixed inset-x-0 bottom-0 z-50 flex h-[min(42rem,calc(100dvh-4rem))] flex-col overflow-hidden border border-line bg-surface shadow-pop dark:border-night-line dark:bg-night-surface sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[min(42rem,calc(100dvh-3rem))] sm:w-[min(47rem,calc(100vw-2rem))] sm:rounded-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 dark:border-night-line">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200">
                <Bot aria-hidden className="size-4.5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-ink dark:text-night-ink">学习助手</h2>
                <p className="truncate text-xs text-ink-faint dark:text-night-faint">
                  {lessonMeta?.title ?? lesson?.title ?? course.title}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={openSettings}
                title="助手设置"
                aria-label="助手设置"
                className="rounded-md p-2 text-ink-faint transition hover:bg-canvas-2 hover:text-ink dark:text-night-faint dark:hover:bg-night-surface-2 dark:hover:text-night-ink"
              >
                <Settings2 aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="关闭学习助手"
                aria-label="关闭学习助手"
                className="rounded-md p-2 text-ink-faint transition hover:bg-canvas-2 hover:text-ink dark:text-night-faint dark:hover:bg-night-surface-2 dark:hover:text-night-ink"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <aside
              className={cn(
                "w-full shrink-0 flex-col border-r border-line dark:border-night-line sm:flex sm:w-44",
                historyOpen ? "flex" : "hidden",
              )}
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-2.5 dark:border-night-line">
                <span className="text-xs font-semibold text-ink-soft dark:text-night-soft">历史对话</span>
                <button
                  type="button"
                  onClick={handleNewConversation}
                  title="新建对话"
                  aria-label="新建对话"
                  className="rounded-md p-1.5 text-primary-700 transition hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/60"
                >
                  <Plus aria-hidden className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {conversations.length === 0 ? (
                  <p className="px-2 py-4 text-xs leading-relaxed text-ink-faint dark:text-night-faint">
                    还没有对话，开始提问后会自动保存。
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {conversations.map((conversation) => (
                      <button
                        type="button"
                        key={conversation.id}
                        onClick={() => {
                          setActiveId(conversation.id);
                          setHistoryOpen(false);
                          setError(null);
                        }}
                        className={cn(
                          "w-full rounded-md px-2.5 py-2 text-left transition",
                          conversation.id === activeId
                            ? "bg-primary-50 text-primary-900 dark:bg-primary-900/70 dark:text-primary-100"
                            : "text-ink-soft hover:bg-canvas-2 hover:text-ink dark:text-night-soft dark:hover:bg-night-surface-2 dark:hover:text-night-ink",
                        )}
                      >
                        <span className="block truncate text-xs font-medium">{conversation.title}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-ink-faint dark:text-night-faint">
                          <Clock3 aria-hidden className="size-3" />
                          {formatDate(conversation.updatedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            <div className={cn("min-w-0 flex-1 flex-col", historyOpen ? "hidden sm:flex" : "flex")}>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas-2/45 px-4 py-2 dark:border-night-line dark:bg-night-surface-2/45">
                <div className="flex min-w-0 items-center gap-2 text-[0.6875rem] text-ink-faint dark:text-night-faint">
                  <BookOpenText aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {currentSection ? `正在阅读：${currentSection.text}` : "已携带当前课时上下文"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  title="查看历史对话"
                  aria-label="查看历史对话"
                  className="shrink-0 rounded-md p-1.5 text-ink-faint transition hover:bg-canvas-2 hover:text-ink dark:text-night-faint dark:hover:bg-night-surface-2 dark:hover:text-night-ink sm:hidden"
                >
                  <MessageCircleQuestion aria-hidden className="size-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
                {messages.length === 0 ? (
                  <div className="flex min-h-full flex-col items-center justify-center py-8 text-center">
                    <div className="flex size-12 items-center justify-center rounded-xl border border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/50 dark:text-primary-200">
                      <MessageCircleQuestion aria-hidden className="size-6" />
                    </div>
                    <h3 className="mt-4 text-sm font-semibold text-ink dark:text-night-ink">从当前课时开始提问</h3>
                    <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-ink-soft dark:text-night-soft">
                      我会参考当前课程、课时和阅读位置，也会在问题涉及其他课时时先做本地匹配。
                    </p>
                    <div className="mt-5 flex max-w-sm flex-wrap justify-center gap-2">
                      {QUICK_PROMPTS.map((prompt) => (
                        <button
                          type="button"
                          key={prompt}
                          onClick={() => setDraft(prompt)}
                          className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:border-primary-300 hover:text-primary-700 dark:border-night-line dark:text-night-soft dark:hover:border-primary-600 dark:hover:text-primary-200"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      message.role === "assistant" && !message.content ? null : (
                        <MessageBubble key={message.id} message={message} />
                      )
                    ))}
                    {loading && (
                      <div className="flex items-center gap-2 text-xs text-ink-faint dark:text-night-faint">
                        <span className="size-2 animate-pulse rounded-full bg-primary-500" />
                        正在整理课程内容…
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-line px-3 py-3 dark:border-night-line">
                {error && (
                  <div className="mb-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger dark:border-danger/50 dark:bg-danger/10">
                    {error}
                  </div>
                )}
                {!hasConnection && (
                  <button
                    type="button"
                    onClick={openSettings}
                    className="mb-2 inline-flex items-center gap-1 text-xs text-primary-700 underline decoration-primary-200 underline-offset-2 dark:text-primary-300"
                  >
                    <Settings2 aria-hidden className="size-3.5" />
                    先配置接口和模型
                  </button>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSend();
                  }}
                  className="flex items-end gap-2"
                >
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    rows={2}
                    placeholder="问问当前课程…"
                    aria-label="输入问题"
                    className="min-h-10 flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-night-line-strong dark:bg-night-surface-2 dark:text-night-ink dark:placeholder:text-night-faint dark:focus:border-primary-400 dark:focus:ring-primary-900"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || loading}
                    title="发送问题"
                    aria-label="发送问题"
                    className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-600 text-white transition hover:bg-primary-700 disabled:pointer-events-none disabled:opacity-45"
                  >
                    <Send aria-hidden className="size-4" />
                  </button>
                </form>
                <p className="mt-1.5 text-[0.6875rem] text-ink-faint dark:text-night-faint">
                  内容会按当前配置发送到你填写的模型接口。
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="助手设置"
        description="配置模型连接和学习者信息。配置仅保存在当前浏览器。"
        className="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              取消
            </Button>
            <Button variant="primary" icon={<Check aria-hidden className="size-4" />} onClick={saveSettings}>
              保存配置
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <section>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-night-ink">
              <Settings2 aria-hidden className="size-4 text-primary-600 dark:text-primary-300" />
              模型连接
            </div>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-medium text-ink-soft dark:text-night-soft">
                API URL
                <input
                  value={settingsDraft.endpoint}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, endpoint: event.target.value }))}
                  className={settingInputClass()}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="url"
                />
                <span className="mt-1 block text-[0.6875rem] font-normal text-ink-faint dark:text-night-faint">
                  可填写 API 根地址，也可直接填写 `/chat/completions` 地址。
                </span>
              </label>
              <label className="block text-xs font-medium text-ink-soft dark:text-night-soft">
                API Key
                <input
                  type="password"
                  value={settingsDraft.apiKey}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, apiKey: event.target.value }))}
                  className={settingInputClass()}
                  placeholder="sk-…"
                  autoComplete="off"
                />
                <span className="mt-1 block text-[0.6875rem] font-normal text-ink-faint dark:text-night-faint">
                  只保存在此浏览器的 localStorage；生产环境建议改为服务端代理。
                </span>
              </label>
              <label className="block text-xs font-medium text-ink-soft dark:text-night-soft">
                模型名称
                <input
                  value={settingsDraft.model}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, model: event.target.value }))}
                  className={settingInputClass()}
                  placeholder="例如：gpt-4o-mini、deepseek-chat"
                  autoComplete="off"
                />
              </label>
              <label className="block text-xs font-medium text-ink-soft dark:text-night-soft">
                思考强度
                <span className="mt-1.5 block">
                  <Select
                    value={settingsDraft.reasoningEffort}
                    onChange={(value) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        reasoningEffort: value as ReasoningEffort,
                      }))
                    }
                    options={REASONING_EFFORT_OPTIONS}
                  />
                </span>
                <span className="mt-1 block text-[0.6875rem] font-normal text-ink-faint dark:text-night-faint">
                  发送 `reasoning_effort`；普通模型不支持时请选择“自动”。
                </span>
              </label>
            </div>
          </section>

          <section className="border-t border-line pt-5 dark:border-night-line">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-night-ink">
              <UserRound aria-hidden className="size-4 text-primary-600 dark:text-primary-300" />
              学习者信息
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint dark:text-night-faint">
              这些信息会作为学习上下文发送给模型，填写你愿意提供的内容即可。
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink-soft dark:text-night-soft">
                我希望被怎样称呼
                <input
                  value={settingsDraft.userName}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, userName: event.target.value }))}
                  className={settingInputClass()}
                  placeholder="例如：小林"
                />
              </label>
              <label className="block text-xs font-medium text-ink-soft dark:text-night-soft">
                当前基础
                <input
                  value={settingsDraft.experience}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, experience: event.target.value }))}
                  className={settingInputClass()}
                  placeholder="例如：会一点 JavaScript"
                />
              </label>
            </div>
            <label className="mt-3 block text-xs font-medium text-ink-soft dark:text-night-soft">
              学习目标
              <textarea
                value={settingsDraft.goal}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, goal: event.target.value }))}
                rows={2}
                className="mt-1.5 w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-night-line-strong dark:bg-night-surface-2 dark:text-night-ink dark:placeholder:text-night-faint dark:focus:border-primary-400 dark:focus:ring-primary-900"
                placeholder="例如：能独立写出一个可维护的后端服务"
              />
            </label>
          </section>
        </div>
      </Dialog>
    </>
  );
}

function MessageBubble({ message }: { message: AssistantMessage }) {
  const isUser = message.role === "user";
  const markdown = useMemo(() => {
    if (isUser || !message.content) return "";
    const html = marked.parse(message.content, {
      async: false,
      breaks: true,
      gfm: true,
    });
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["embed", "form", "iframe", "object", "script", "style"],
    });
  }, [isUser, message.content]);

  return (
    <div className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200">
          <Bot aria-hidden className="size-3.5" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[86%] rounded-lg px-3 py-2 text-sm leading-6",
          isUser
            ? "bg-primary-600 text-white"
            : "border border-line bg-surface-2 text-ink dark:border-night-line dark:bg-night-surface-2 dark:text-night-ink",
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : message.content ? (
          <div
            className="study-markdown"
            dangerouslySetInnerHTML={{ __html: markdown }}
          />
        ) : null}
      </div>
    </div>
  );
}
