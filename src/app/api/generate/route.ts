import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/prompts";

export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[]; // base64 data URLs
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages, anthropicKey } = body as {
    messages: ChatMessage[];
    anthropicKey?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Messages are required" }, { status: 400 });
  }

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user") {
    return Response.json(
      { error: "Last message must be from the user" },
      { status: 400 }
    );
  }

  if (!lastMsg.content.trim() && (!lastMsg.images || lastMsg.images.length === 0)) {
    return Response.json(
      { error: "Provide a description or upload an image" },
      { status: 400 }
    );
  }

  const apiKey = anthropicKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Anthropic API key is required. Add it in Settings or set ANTHROPIC_API_KEY." },
      { status: 400 }
    );
  }

  // Build Claude messages from chat history
  const claudeMessages: Anthropic.Messages.MessageParam[] = messages.map(
    (msg) => {
      if (msg.role === "assistant") {
        return { role: "assistant" as const, content: msg.content };
      }

      // User message — may include images
      const parts: Anthropic.Messages.ContentBlockParam[] = [];

      if (msg.images && msg.images.length > 0) {
        for (const dataUrl of msg.images) {
          const match = dataUrl.match(
            /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/
          );
          if (match) {
            parts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: match[1] as
                  | "image/png"
                  | "image/jpeg"
                  | "image/gif"
                  | "image/webp",
                data: match[3],
              },
            });
          }
        }
      }

      if (msg.content.trim()) {
        parts.push({ type: "text", text: msg.content });
      }

      return { role: "user" as const, content: parts };
    }
  );

  // Stream response
  let client: Anthropic;
  try {
    client = new Anthropic({ apiKey });
  } catch {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }

  let stream;
  try {
    stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16384,
      system: SYSTEM_PROMPT,
      messages: claudeMessages,
    });
  } catch (err) {
    return Response.json(
      { error: `Failed to start generation: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream interrupted";
        controller.enqueue(encoder.encode(`\n\n// Error: ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
