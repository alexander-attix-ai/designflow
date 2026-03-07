import Anthropic from "@anthropic-ai/sdk";
import { parseFigmaUrl, fetchFigmaDesign } from "@/lib/figma";
import { SYSTEM_PROMPT } from "@/lib/prompts";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { figmaUrl, prompt, figmaToken, anthropicKey } = body as {
      figmaUrl: string;
      prompt?: string;
      figmaToken?: string;
      anthropicKey?: string;
    };

    if (!figmaUrl) {
      return Response.json({ error: "Figma URL is required" }, { status: 400 });
    }

    const figmaAccessToken = figmaToken || process.env.FIGMA_ACCESS_TOKEN;
    const apiKey = anthropicKey || process.env.ANTHROPIC_API_KEY;

    if (!figmaAccessToken) {
      return Response.json(
        { error: "Figma access token is required. Set FIGMA_ACCESS_TOKEN or provide it in the request." },
        { status: 400 }
      );
    }
    if (!apiKey) {
      return Response.json(
        { error: "Anthropic API key is required. Set ANTHROPIC_API_KEY or provide it in the request." },
        { status: 400 }
      );
    }

    // 1. Parse Figma URL
    const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

    // 2. Fetch design data from Figma
    const design = await fetchFigmaDesign(fileKey, nodeId, figmaAccessToken);

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
    userParts.push("Generate a React component that faithfully recreates this design.");

    // Build messages array — include image if available
    const contentParts: Anthropic.Messages.ContentBlockParam[] = [];

    if (design.imageUrl) {
      contentParts.push({
        type: "image",
        source: { type: "url", url: design.imageUrl },
      });
    }

    contentParts.push({ type: "text", text: userParts.join("\n") });

    // 4. Stream Claude response
    const client = new Anthropic({ apiKey });

    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: contentParts }],
    });

    // Convert to ReadableStream for the response
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
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
