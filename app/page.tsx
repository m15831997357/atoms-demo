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

  function send() {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "（假数据）已生成示例页面，请在右侧查看。" },
    ]);
    setHtml(FAKE_HTML);
    setInput("");
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