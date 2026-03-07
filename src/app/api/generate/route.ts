import Anthropic from "@anthropic-ai/sdk";
import { parseFigmaUrl, fetchFigmaDesign } from "@/lib/figma";
import { SYSTEM_PROMPT } from "@/lib/prompts";

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const { figmaUrl, prompt, figmaToken, anthropicKey } = body as {
    figmaUrl: string;
    prompt?: string;
    figmaToken?: string;
    anthropicKey?: string;
  };

  if (!figmaUrl || typeof figmaUrl !== "string") {
    return Response.json(
      { error: "Figma URL is required" },
      { status: 400 }
    );
  }

  const figmaAccessToken = figmaToken || process.env.FIGMA_ACCESS_TOKEN;
  const apiKey = anthropicKey || process.env.ANTHROPIC_API_KEY;

  if (!figmaAccessToken) {
    return Response.json(
      {
        error:
          "Figma access token is required. Add it in Settings or set FIGMA_ACCESS_TOKEN.",
      },
      { status: 400 }
    );
  }
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Anthropic API key is required. Add it in Settings or set ANTHROPIC_API_KEY.",
      },
      { status: 400 }
    );
  }

  // 1. Parse Figma URL
  let fileKey: string;
  let nodeId: string | undefined;
  try {
    ({ fileKey, nodeId } = parseFigmaUrl(figmaUrl));
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Invalid Figma URL format",
      },
      { status: 400 }
    );
  }

  // 2. Fetch design data from Figma
  let design;
  try {
    design = await fetchFigmaDesign(fileKey, nodeId, figmaAccessToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Figma error";
    const status = message.includes("403")
      ? 403
      : message.includes("404")
        ? 404
        : 502;
    return Response.json(
      { error: `Figma API: ${message}` },
      { status }
    );
  }

  // 3. Build the prompt for Claude
  const userParts: string[] = [];

  userParts.push(`## Figma Design: "${design.fileName}"`);
  userParts.push("");
  userParts.push("### Design Structure");
  userParts.push("```");
  userParts.push(design.nodeTree);
  userParts.push("```");

  if (design.colors.length > 0) {
    userParts.push("");
    userParts.push(`### Color Palette: ${design.colors.join(", ")}`);
  }

  if (design.fonts.length > 0) {
    userParts.push("");
    userParts.push(`### Fonts Used: ${design.fonts.join(", ")}`);
  }

  if (prompt) {
    userParts.push("");
    userParts.push(`### Additional Instructions`);
    userParts.push(prompt);
  }

  userParts.push("");
  userParts.push(
    "Generate a React component that faithfully recreates this design."
  );

  const contentParts: Anthropic.Messages.ContentBlockParam[] = [];

  if (design.imageUrl) {
    contentParts.push({
      type: "image",
      source: { type: "url", url: design.imageUrl },
    });
  }

  contentParts.push({ type: "text", text: userParts.join("\n") });

  // 4. Stream Claude response
  let client: Anthropic;
  try {
    client = new Anthropic({ apiKey });
  } catch (err) {
    return Response.json(
      {
        error: `Invalid Anthropic API key: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 401 }
    );
  }

  let stream;
  try {
    stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: contentParts }],
    });
  } catch (err) {
    return Response.json(
      {
        error: `Failed to start Claude stream: ${err instanceof Error ? err.message : "unknown error"}`,
      },
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
        const message =
          err instanceof Error ? err.message : "Stream interrupted";
        controller.enqueue(
          encoder.encode(`\n\n// Error: ${message}`)
        );
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
