"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
type Project = { id: string; title: string; updated_at: string };
type Version = { id: string; prompt: string; html: string; created_at: string };
type Tab = "preview" | "code" | "history";
type Chunk = {
  error?: { message?: string };
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
};

const GREETING: Msg = { role: "assistant", content: "你好！描述你想做的应用，我来帮你生成。" };
const TABS: { key: Tab; label: string }[] = [
  { key: "preview", label: "预览" },
  { key: "code", label: "代码" },
  { key: "history", label: "版本" },
];
const EXAMPLES = [
  "做一个待办清单，可以添加、完成、删除任务",
  "做一个番茄钟，25 分钟专注加 5 分钟休息",
  "做一个记账本，支持分类和统计",
];
const IDLE_TIMEOUT_MS = 90000;

let memId = "";
function getOwnerId() {
  try {
    let id = localStorage.getItem("ownerId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("ownerId", id);
    }
    return id;
  } catch {
    return (memId ||= crypto.randomUUID());
  }
}

function api(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", "x-owner-id": getOwnerId() },
  });
}

function extractHtml(text: string) {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)(```|$)/);
  let code = fence ? fence[1] : text;
  const start = code.search(/<!doctype html|<html/i);
  if (start > 0) code = code.slice(start);
  return code.trim();
}

function friendlyError(msg: string) {
  if (/failed to fetch|network|load failed/i.test(msg)) return "网络连接失败，请检查网络";
  return msg;
}

// 注入到预览 iframe 的脚本：把页面里的运行时错误报告给外层。只用于展示，不会存进数据库
const GUARD = `<script>(function(){function r(m){try{parent.postMessage({type:"iframe-error",message:String(m).slice(0,300)},"*")}catch(e){}}window.addEventListener("error",function(e){r(e.message||(e.error&&e.error.message)||"未知错误")});window.addEventListener("unhandledrejection",function(e){r((e.reason&&e.reason.message)||e.reason)})})();</script>`;
function withGuard(html: string) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + GUARD);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + GUARD);
  return GUARD + html;
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<Tab>("preview");
  const [html, setHtml] = useState("");
  const [baseHtml, setBaseHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [viewing, setViewing] = useState<{ v: Version; n: number } | null>(null);
  const [runtimeError, setRuntimeError] = useState("");

  async function refreshProjects() {
    try {
      const res = await api("/api/projects");
      if (res.ok) setProjects(await res.json());
    } catch {}
  }

  async function loadVersions(pid: string | null) {
    if (!pid) {
      setVersions([]);
      return;
    }
    try {
      const res = await api(`/api/projects/${pid}/versions`);
      if (res.ok) setVersions(await res.json());
    } catch {}
  }

  function selectTab(t: Tab) {
    setTab(t);
    setRuntimeError("");
    if (t === "history") {
      setViewing(null);
      loadVersions(currentId);
    }
  }

  async function openProject(id: string) {
    if (loading) return;
    try {
      const res = await api(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setCurrentId(id);
      setMessages([GREETING, ...data.messages]);
      setHtml(data.html);
      setBaseHtml(data.html);
      setVersions([]);
      setViewing(null);
      setRuntimeError("");
      setTab("preview");
    } catch {}
  }

  function newProject() {
    if (loading) return;
    setCurrentId(null);
    setMessages([GREETING]);
    setHtml("");
    setBaseHtml("");
    setVersions([]);
    setViewing(null);
    setRuntimeError("");
    setTab("preview");
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await api("/api/projects");
        if (!res.ok) return;
        const list: Project[] = await res.json();
        setProjects(list);
        if (list.length) openProject(list[0].id);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === "iframe-error") setRuntimeError((prev) => prev || String(e.data.message));
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function save(userMessage: string, assistantMessage: string, htmlDone: string) {
    try {
      let pid = currentId;
      if (!pid) {
        const r = await api("/api/projects", {
          method: "POST",
          body: JSON.stringify({ title: userMessage.slice(0, 20) }),
        });
        if (!r.ok) {
          console.error("create project failed", r.status, await r.text());
          return false;
        }
        pid = (await r.json()).id as string;
        setCurrentId(pid);
      }
      const doSave = () =>
        api(`/api/projects/${pid}`, {
          method: "POST",
          body: JSON.stringify({ userMessage, assistantMessage, html: htmlDone }),
        });
      let r2 = await doSave();
      if (!r2.ok) {
        await new Promise((res) => setTimeout(res, 800));
        r2 = await doSave();
      }
      if (!r2.ok) {
        console.error("save project failed", r2.status, await r2.text());
        return false;
      }
      refreshProjects();
      return true;
    } catch (e) {
      console.error("save error", e);
      return false;
    }
  }

  async function restore(v: Version, n: number) {
    if (loading || !currentId) return;
    const userMsg = `回滚到版本 ${n}`;
    const aiMsg = `已恢复到版本 ${n}。`;
    const ok = await save(userMsg, aiMsg, v.html);
    if (!ok) {
      setMessages((m) => [...m, { role: "assistant", content: "恢复失败，请重试。" }]);
      setTab("preview");
      return;
    }
    setMessages((m) => [...m, { role: "user", content: userMsg }, { role: "assistant", content: aiMsg }]);
    setHtml(v.html);
    setBaseHtml(v.html);
    setViewing(null);
    setRuntimeError("");
    setTab("preview");
  }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessages((m) => [...m, { role: "assistant", content: "当前处于离线状态，请检查网络后重试。" }]);
      return;
    }
    const isEdit = baseHtml !== "";
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: isEdit ? "正在修改…" : "正在生成…" },
    ]);
    setInput("");
    setRuntimeError("");
    setLoading(true);
    setTab("code");

    const finish = (content: string) =>
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content }]);
    const fail = (content: string) => {
      setHtml(baseHtml);
      setTab("preview");
      finish(content);
    };

    const prompt = isEdit
      ? `这是当前应用的完整代码：\n\n${baseHtml}\n\n请在此基础上按下面的要求修改，保留已有功能，只输出修改后的完整 HTML：\n${text}`
      : text;

    const controller = new AbortController();
    abortRef.current = controller;
    const state = { received: false, finishReason: "", streamError: "", timedOut: false };

    async function generate() {
      state.received = false;
      state.finishReason = "";
      state.streamError = "";
      let lastActivity = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
          state.timedOut = true;
          controller.abort();
        }
      }, 5000);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-owner-id": getOwnerId() },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lastActivity = Date.now();
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "[DONE]") continue;
              let json: Chunk;
              try {
                json = JSON.parse(data);
              } catch {
                continue;
              }
              if (json.error) throw new Error(json.error.message ?? "模型服务出错");
              const choice = json.choices?.[0];
              if (choice?.finish_reason) state.finishReason = choice.finish_reason;
              const delta = choice?.delta?.content;
              if (delta) {
                full += delta;
                state.received = true;
                setHtml(extractHtml(full));
              }
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          state.streamError = (e as Error).message;
        }
        if (!full && state.streamError) throw new Error(state.streamError);
        return full;
      } finally {
        clearInterval(watchdog);
      }
    }

    try {
      let full: string | null = null;
      let lastError = "";
      for (let attempt = 0; attempt < 3 && full === null; attempt++) {
        try {
          if (attempt > 0) finish("连接中断，正在自动重试…");
          full = await generate();
        } catch (e) {
          if ((e as Error).name === "AbortError") {
            fail(
              state.timedOut
                ? "模型长时间没有响应，已自动停止，已保留上一版本。请重试或简化需求。"
                : "已停止生成，已保留上一版本。"
            );
            return;
          }
          console.warn("generate failed", e);
          lastError = (e as Error).message;
          if (state.received) break;
        }
      }
      if (full === null) {
        fail(`生成失败：${friendlyError(lastError || "未知错误")}，请重试。`);
        return;
      }

      const complete =
        /<\/html>/i.test(full) ||
        (state.finishReason === "stop" && /<html|<!doctype/i.test(full));

      if (complete) {
        const done = extractHtml(full);
        setHtml(done);
        setBaseHtml(done);
        setTab("preview");
        const doneMsg = isEdit ? "已按要求修改，请在右侧查看。" : "已生成，请在右侧预览。";
        const saved = await save(text, doneMsg, done);
        finish(saved ? doneMsg : doneMsg + "（保存失败，刷新后会丢失）");
      } else if (full) {
        fail(
          state.finishReason === "length"
            ? "输出达到长度上限被截断，已保留上一版本。请把需求拆小一点，分几次提出。"
            : state.streamError
              ? `生成中途中断（${state.streamError}），已保留上一版本，请重试。`
              : "生成不完整，已保留上一版本，请重试。"
        );
      } else {
        fail(
          state.finishReason === "length"
            ? "模型把输出额度都用在了思考上，没来得及写代码。请换非推理模型，或简化需求。"
            : "模型没有返回内容，请重试或换一个模型。"
        );
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  const busyTip = loading ? "生成中，请等待完成或点「停止」" : undefined;

  return (
    <div className="flex h-screen bg-white text-gray-900">
      {/* 最左：项目列表 */}
      <div className="flex w-52 flex-col border-r border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <span className="font-semibold">Atoms Demo</span>
          <button
            onClick={newProject}
            disabled={loading}
            title={busyTip}
            className="text-xs text-blue-600 hover:underline disabled:opacity-40"
          >
            + 新建
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {projects.length === 0 && <div className="p-2 text-xs text-gray-400">还没有项目</div>}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => openProject(p.id)}
              disabled={loading}
              title={busyTip}
              className={
                "mb-1 block w-full truncate rounded-md px-3 py-2 text-left text-sm " +
                (p.id === currentId ? "bg-white shadow-sm" : "hover:bg-gray-100")
              }
            >
              {p.title}
            </button>
          ))}
        </div>
      </div>

      {/* 中：聊天区 */}
      <div className="flex w-[360px] flex-col border-r border-gray-200">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <span
                className={
                  "inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-sm " +
                  (m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100")
                }
              >
                {m.content}
              </span>
            </div>
          ))}
          {messages.length === 1 && !loading && (
            <div className="space-y-2 pt-2">
              <div className="text-xs text-gray-400">试试这些：</div>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="block w-full rounded-md border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 border-t border-gray-200 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder="描述你想做的应用…"
            className="flex-1 resize-none rounded-md border border-gray-300 p-2 text-sm outline-none focus:border-blue-500"
          />
          {loading ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded-md bg-red-600 px-4 text-sm text-white hover:bg-red-700"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send()}
              className="rounded-md bg-blue-600 px-4 text-sm text-white hover:bg-blue-700"
            >
              发送
            </button>
          )}
        </div>
      </div>

      {/* 右：预览 / 代码 / 版本 */}
      <div className="flex flex-1 flex-col">
        <div className="flex gap-1 border-b border-gray-200 p-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              className={
                "rounded-md px-3 py-1 text-sm " +
                (tab === t.key ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto bg-gray-50">
          {tab === "history" ? (
            <div className="flex h-full">
              <div className="w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-2">
                {versions.length === 0 && <div className="p-2 text-xs text-gray-400">还没有版本</div>}
                {versions
                  .map((v, i) => ({ v, n: i + 1 }))
                  .reverse()
                  .map(({ v, n }) => (
                    <button
                      key={v.id}
                      onClick={() => setViewing({ v, n })}
                      className={
                        "mb-1 block w-full rounded-md px-3 py-2 text-left " +
                        (viewing?.v.id === v.id ? "bg-gray-100" : "hover:bg-gray-50")
                      }
                    >
                      <div className="text-sm font-medium">
                        版本 {n}
                        {n === versions.length ? "（当前）" : ""}
                      </div>
                      <div className="truncate text-xs text-gray-500">{v.prompt}</div>
                      <div className="text-xs text-gray-400">{new Date(v.created_at).toLocaleString()}</div>
                    </button>
                  ))}
              </div>
              <div className="flex flex-1 flex-col">
                {viewing ? (
                  <>
                    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2 text-sm">
                      <span>正在查看版本 {viewing.n}</span>
                      {viewing.n !== versions.length && (
                        <button
                          onClick={() => restore(viewing.v, viewing.n)}
                          disabled={loading}
                          className="rounded-md bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          恢复此版本
                        </button>
                      )}
                    </div>
                    <iframe
                      title="version-preview"
                      srcDoc={viewing.v.html}
                      sandbox="allow-scripts"
                      className="w-full flex-1 border-0 bg-white"
                    />
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    点击左侧的版本进行预览
                  </div>
                )}
              </div>
            </div>
          ) : !html ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              在左侧描述需求，生成的应用会显示在这里
            </div>
          ) : tab === "preview" ? (
            <div className="flex h-full flex-col">
              {runtimeError && (
                <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="truncate">预览运行出错：{runtimeError}</span>
                  <button
                    onClick={() =>
                      send(`预览运行时报错：${runtimeError}。请修复这个问题，保持其他功能不变。`)
                    }
                    disabled={loading}
                    className="shrink-0 rounded-md bg-amber-600 px-2 py-1 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    让 AI 修复
                  </button>
                </div>
              )}
              <iframe
                ref={frameRef}
                title="preview"
                srcDoc={withGuard(html)}
                sandbox="allow-scripts"
                className="w-full flex-1 border-0 bg-white"
              />
            </div>
          ) : (
            <pre className="p-4 text-xs whitespace-pre-wrap">{html}</pre>
          )}
        </div>
      </div>
    </div>
  );
}