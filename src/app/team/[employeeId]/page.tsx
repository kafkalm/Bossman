"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send,
  Trash2,
  Loader2,
  User,
  Bot,
  Search,
  ImagePlus,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmployeeInfo {
  id: string;
  name: string;
  status: string;
  role: {
    id: string;
    name: string;
    title: string;
  };
  inputModalities?: string[];
  outputModalities?: string[];
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  images?: string[]; // base64 data URLs for attached images
}

interface TeamMember {
  id: string;
  name: string;
  status: string;
  role: { id: string; name: string; title: string; isBuiltin: boolean };
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  idle: "bg-green-500",
  busy: "bg-yellow-500",
  offline: "bg-gray-400",
};

const statusLabels: Record<string, string> = {
  idle: "空闲",
  busy: "忙碌中",
  offline: "离线",
};

// ─── Contact Sidebar ──────────────────────────────────────────────────────────

function ContactSidebar({
  members,
  activeId,
  onSelect,
}: {
  members: TeamMember[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.role.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r bg-card overflow-hidden">
      {/* Sidebar Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold flex-1">对话</h2>
        <Badge variant="secondary" className="text-xs">
          {members.length}
        </Badge>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Contact List */}
      <ScrollArea className="flex-1 h-0">
        <div className="px-2 pb-2">
          {filtered.map((member) => {
            const isActive = member.id === activeId;
            return (
              <button
                key={member.id}
                onClick={() => onSelect(member.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent text-foreground"
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full font-bold text-sm ${
                      isActive
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {member.name[0]}
                  </div>
                  <div
                    className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card ${statusColors[member.status] ?? "bg-gray-400"}`}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">
                      {member.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                      {statusLabels[member.status] ?? member.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {member.role.title}
                  </div>
                </div>
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              未找到成员
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({
  employeeId,
  employee,
  messages,
  sending,
  input,
  onInputChange,
  onSend,
  onClear,
  onKeyDown,
  scrollRef,
  loading,
  pendingImages,
  onAddImages,
  onRemoveImage,
}: {
  employeeId: string;
  employee: EmployeeInfo | null;
  messages: ChatMsg[];
  sending: boolean;
  input: string;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onClear: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  pendingImages: string[];
  onAddImages: (files: FileList) => void;
  onRemoveImage: (index: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">未找到该员工</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
              {employee.name[0]}
            </div>
            <div
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${statusColors[employee.status] ?? "bg-gray-400"}`}
            />
          </div>
          <div>
            <div className="font-semibold">{employee.name}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{employee.role.title}</span>
              <span>·</span>
              <span>
                {statusLabels[employee.status] ?? employee.status}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {employee.status === "busy" && (
            <Badge
              variant="outline"
              className="text-xs text-yellow-600 border-yellow-300"
            >
              正在忙其他任务，但可以对话
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClear}
            disabled={messages.length === 0}
            title="清除对话"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 h-0" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
                <Bot className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium">
                开始和 {employee.name} 对话
              </h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                {employee.name} 是你的 {employee.role.title}
                ，你可以和 ta 讨论工作、寻求建议，或者只是随便聊聊。
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              {/* Avatar */}
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  msg.role === "user"
                    ? "bg-blue-500/10 text-blue-600"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {msg.role === "user" ? (
                  <User className="h-4 w-4" />
                ) : (
                  employee.name[0]
                )}
              </div>

              {/* Bubble */}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-500 text-white rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
                }`}
              >
                {!msg.content && !msg.images?.length ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    正在思考...
                  </span>
                ) : msg.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-blockquote:my-2 prose-code:before:content-none prose-code:after:content-none prose-code:bg-black/10 prose-code:dark:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-pre:bg-black/5 prose-pre:dark:bg-white/5 prose-pre:rounded-lg prose-pre:p-3 prose-a:text-primary prose-img:rounded-lg prose-table:text-sm prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div>
                    {/* User message images */}
                    {msg.images && msg.images.length > 0 && (
                      <div className={`flex flex-wrap gap-2 ${msg.content ? "mb-2" : ""}`}>
                        {msg.images.map((imgUrl, idx) => (
                          <a
                            key={idx}
                            href={imgUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <img
                              src={imgUrl}
                              alt={`Attached image ${idx + 1}`}
                              className="max-w-[240px] max-h-[240px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t bg-card p-4">
        <div className="mx-auto max-w-3xl">
          {/* Image previews */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img}
                    alt={`Upload ${i + 1}`}
                    className="h-16 w-16 object-cover rounded-lg border"
                  />
                  <button
                    onClick={() => onRemoveImage(i)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            {/* Image upload button - only if model supports image input */}
            {employee.inputModalities?.includes("image") && (
              <>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  id="chat-image-upload"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      onAddImages(e.target.files);
                      e.target.value = "";
                    }
                  }}
                  disabled={sending}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  onClick={() => document.getElementById("chat-image-upload")?.click()}
                  disabled={sending}
                  title="上传图片"
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
              </>
            )}
            <Textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`给 ${employee.name} 发消息...`}
              rows={1}
              className="min-h-[44px] max-h-[120px] resize-none"
              disabled={sending}
            />
            <Button
              onClick={onSend}
              disabled={(!input.trim() && pendingImages.length === 0) || sending}
              size="icon"
              className="h-11 w-11 shrink-0"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="mx-auto max-w-3xl mt-2 text-xs text-muted-foreground">
          Enter 发送，Shift + Enter 换行
          {employee.inputModalities?.includes("image") && " · 支持上传图片"}
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.employeeId as string;

  // Team members for sidebar
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // Chat state
  const [employee, setEmployee] = useState<EmployeeInfo | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingImages, setPendingImages] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]'
      );
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, []);

  // Fetch team members for sidebar
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/team");
        if (res.ok) {
          const data = await res.json();
          setTeamMembers(data);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Fetch chat history
  const fetchChat = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/team/${employeeId}/chat`);
      if (res.ok) {
        const data = await res.json();
        setEmployee(data.employee);
        setMessages(data.messages);
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    fetchChat();
  }, [fetchChat]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Add images from file input
  const handleAddImages = (files: FileList) => {
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setPendingImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Send message with streaming response
  const handleSend = async () => {
    const text = input.trim();
    const images = [...pendingImages];
    if ((!text && images.length === 0) || sending) return;

    setInput("");
    setPendingImages([]);
    setSending(true);

    const tempUserMsg: ChatMsg = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content: text || (images.length > 0 ? "请看这些图片" : ""),
      createdAt: new Date().toISOString(),
      images: images.length > 0 ? images : undefined,
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const tempAssistantMsg: ChatMsg = {
      id: tempAssistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempAssistantMsg]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/team/${employeeId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text || "请看这些图片",
          images: images.length > 0 ? images : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send message");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempAssistantId
              ? { ...msg, content: accumulated }
              : msg
          )
        );
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempAssistantId
            ? {
                ...msg,
                content: `⚠️ ${error instanceof Error ? error.message : "发送失败，请重试"}`,
              }
            : msg
        )
      );
    } finally {
      setSending(false);
      setStreaming(false);
      fetchChat();
    }
  };

  // Clear chat history
  const handleClear = async () => {
    if (!confirm("确定要清除所有对话记录吗？")) return;
    try {
      await fetch(`/api/team/${employeeId}/chat`, { method: "DELETE" });
      setMessages([]);
    } catch {
      /* ignore */
    }
  };

  // Handle keyboard shortcut
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Switch to a different team member
  const handleSelectMember = (id: string) => {
    if (id !== employeeId) {
      router.push(`/team/${id}`);
    }
  };

  return (
    <div className="absolute inset-0 flex">
      {/* Contact Sidebar */}
      <ContactSidebar
        members={teamMembers}
        activeId={employeeId}
        onSelect={handleSelectMember}
      />

      {/* Chat Panel */}
      <ChatPanel
        employeeId={employeeId}
        employee={employee}
        messages={messages}
        sending={sending}
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        onClear={handleClear}
        onKeyDown={handleKeyDown}
        scrollRef={scrollRef}
        loading={loading}
        pendingImages={pendingImages}
        onAddImages={handleAddImages}
        onRemoveImage={handleRemoveImage}
      />
    </div>
  );
}
