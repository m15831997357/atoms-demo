import { getOwner } from "@/lib/supabase";

export const maxDuration = 300;

const SYSTEM_PROMPT = `你是一名资深前端工程师。根据用户需求生成一个可直接运行的网页应用。
严格遵守：
1. 只输出一个完整的单文件 HTML（以 <!doctype html> 开头），CSS 和 JS 全部内联。
2. 不要输出任何解释文字，不要使用 markdown 代码块。
3. 不要引用任何外部资源（图片、字体、脚本、CDN 都不行）。
4. 界面要美观、有真实交互，处理好空状态和输入校验。
5. 页面运行在沙箱 iframe 中，localStorage 可能不可用，凡是用到必须用 try/catch 包裹，失败时退回内存变量。
6. 如果用户提供了现有代码，必须在其基础上修改：保留已有功能和界面风格，只改动需求涉及的部分，数据结构变化时要兼容旧数据，并输出修改后的完整 HTML。
7. 代码要精简：整个 HTML 控制在约 400 行以内，少写注释，样式用紧凑写法，避免重复代码。
8. 沙箱限制：不要使用 alert()、confirm()、prompt()（会被直接屏蔽），提示和输入都用页面内的元素完成；不要依赖 <form> 的默认提交，用按钮的点击事件处理；脚本放在 body 末尾，确保元素存在后再绑定事件。`;
const MAX_CHARS = 60000;

// 简单的内存限流：部署在多实例环境时只是尽力而为，真正的兜底是 OpenRouter key 的额度上限
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  if (hits.size > 5000) hits.clear();
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return true;
  }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

export async function POST(req: Request) {
  const owner = getOwner(req);
  if (!owner) return Response.json({ error: "缺少用户标识，请刷新页面重试" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const messages = body?.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 20 ||
    !messages.every((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
  ) {
    return Response.json({ error: "请求内容不合法" }, { status: 400 });
  }
  const total = messages.reduce((n: number, m: { content: string }) => n + m.content.length, 0);
  if (total > MAX_CHARS) {
    return Response.json({ error: "内容太长，请把需求拆小一点" }, { status: 413 });
  }

  if (limited(`o:${owner}`, 30, 10 * 60 * 1000) || limited("global", 300, 60 * 60 * 1000)) {
    return Response.json({ error: "请求太频繁，请稍等几分钟再试" }, { status: 429 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.MODEL_NAME;
  if (!apiKey || !model) {
    return Response.json({ error: "服务端未配置模型，请联系管理员" }, { status: 500 });
  }

  const payload = JSON.stringify({
    model,
    stream: true,
    max_tokens: 8000,
    reasoning: { effort: "low" },
    provider: { sort: "throughput", ignore: ["DekaLLM", "AkashML"] },
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
  });

  let upstream: Response | null = null;
  for (let i = 0; i < 2 && !upstream; i++) {
    try {
      upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: payload,
      });
    } catch (e) {
      console.warn(`openrouter fetch failed (第${i + 1}次):`, (e as { cause?: unknown }).cause ?? e);
    }
  }
  if (!upstream) {
    return Response.json({ error: "无法连接模型服务，请稍后重试" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 300);
    console.error("upstream error", upstream.status, detail);
    return Response.json({ error: `模型服务返回 ${upstream.status}` }, { status: 502 });
  }

  const reader = upstream.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let provider = "";
  let bytes = 0;
  const t0 = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let failed = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (!provider) {
            const m = decoder.decode(value, { stream: true }).match(/"provider":"([^"]+)"/);
            if (m) provider = m[1];
          }
          controller.enqueue(value);
        }
      } catch (e) {
        failed = String((e as Error)?.message ?? e);
        const msg = { error: { message: "模型服务中途断开连接，请重试或换一个模型" } };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
      } finally {
        console.info(
          `[chat] 提供商=${provider || "未知"} 字节=${bytes} 耗时=${Date.now() - t0}ms 结果=${failed ? "失败：" + failed : "成功"}`
        );
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}