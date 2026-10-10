"use client";
import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

// 假数据：先用它验证界面，第 2 步再换成模型生成的结果
const FAKE_HTML = `<!doctype html>
<html><body style="font-family:sans-serif;text-align:center;padding:40px">
<h1>示例页面</h1>
<p id="n">0</p>
<button onclick="document.getElementById('n').textContent=++window.c||(window.c=1)">点我 +1</button>
</body></html>`;

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "你好！描述你想做的应用，我来帮你生成。" },
  ]);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [html, setHtml] = useState("");

const [loading, setLoading] = useState(false);
const [baseHtml, setBaseHtml] = useState("");

function extractHtml(text: string) {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)(```|$)/);
  let code = fence ? fence[1] : text;
  const start = code.search(/<!doctype html|<html/i);
  if (start > 0) code = code.slice(start);
  return code.trim();
}

async function send() {
  const text = input.trim();
  if (!text || loading) return;
  const isEdit = baseHtml !== "";
  setMessages((m) => [
    ...m,
    { role: "user", content: text },
    { role: "assistant", content: isEdit ? "正在修改…" : "正在生成…" },
  ]);
  setInput("");
  setLoading(true);
  setTab("code");

  const finish = (content: string) =>
    setMessages((m) => [...m.slice(0, -1), { role: "assistant", content }]);
  const fail = (content: string) => {
    setHtml(baseHtml); // 回到上一个完整版本
    finish(content);
  };

  const prompt = isEdit
    ? `这是当前应用的完整代码：\n\n${baseHtml}\n\n请在此基础上按下面的要求修改，保留已有功能，只输出修改后的完整 HTML：\n${text}`
    : text;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      fail(`生成失败：${err.error ?? res.status}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            setHtml(extractHtml(full));
          }
        } catch {}
      }
    }
    if (full.includes("</html>")) {
      const done = extractHtml(full);
      setHtml(done);
      setBaseHtml(done);
      setTab("preview");
      finish(isEdit ? "已按要求修改，请在右侧查看。" : "已生成，请在右侧预览。");
    } else if (full) {
      fail("生成不完整（可能被截断），已保留上一版本，请重试。");
    } else {
      fail("模型没有返回内容，请重试或换一个模型。");
    }
  } catch {
    fail("网络错误，请重试。");
  } finally {
    setLoading(false);
  }
}
  return (
    <div className="flex h-screen bg-white text-gray-900">
      {/* 左：聊天区 */}
      <div className="flex w-[380px] flex-col border-r border-gray-200">
        <div className="border-b border-gray-200 p-4 font-semibold">Atoms Demo</div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <span
                className={
                  "inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm " +
                  (m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100")
                }
              >
                {m.content}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 border-t border-gray-200 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 中文输入法选字时按回车不应触发发送
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="描述你想做的应用…"
            className="flex-1 resize-none rounded-md border border-gray-300 p-2 text-sm outline-none focus:border-blue-500"
          />
          <button onClick={send} className="rounded-md bg-blue-600 px-4 text-sm text-white hover:bg-blue-700">
            发送
          </button>
        </div>
      </div>

      {/* 右：预览 / 代码 */}
      <div className="flex flex-1 flex-col">
        <div className="flex gap-1 border-b border-gray-200 p-2">
          {(["preview", "code"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "rounded-md px-3 py-1 text-sm " +
                (tab === t ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")
              }
            >
              {t === "preview" ? "预览" : "代码"}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto bg-gray-50">
          {!html ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              在左侧描述需求，生成的应用会显示在这里
            </div>
          ) : tab === "preview" ? (
            <iframe title="preview" srcDoc={html} sandbox="allow-scripts" className="h-full w-full border-0 bg-white" />
          ) : (
            <pre className="p-4 text-xs whitespace-pre-wrap">{html}</pre>
          )}
        </div>
      </div>
    </div>
  );
}