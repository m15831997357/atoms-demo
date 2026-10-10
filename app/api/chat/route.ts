const SYSTEM_PROMPT = `你是一名资深前端工程师。根据用户需求生成一个可直接运行的网页应用。
严格遵守：
1. 只输出一个完整的单文件 HTML（以 <!doctype html> 开头），CSS 和 JS 全部内联。
2. 不要输出任何解释文字，不要使用 markdown 代码块。
3. 不要引用任何外部资源（图片、字体、脚本、CDN 都不行）。
4. 界面要美观、有真实交互，处理好空状态和输入校验。
5. 页面运行在沙箱 iframe 中，localStorage 可能不可用，凡是用到必须用 try/catch 包裹，失败时退回内存变量。`;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.MODEL_NAME;

  if (!apiKey || !model) {
    return Response.json({ error: "服务端未配置 OPENROUTER_API_KEY 或 MODEL_NAME" }, { status: 500 });
  }

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 6000,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 300);
    return Response.json({ error: `模型服务返回 ${upstream.status}`, detail }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}