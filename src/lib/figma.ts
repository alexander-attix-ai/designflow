export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
}

export interface FigmaDesignData {
  fileName: string;
  nodeTree: string;
  imageUrl?: string;
  colors: string[];
  fonts: string[];
}

export function parseFigmaUrl(url: string): ParsedFigmaUrl {
  const u = new URL(url);
  // Supports: /file/KEY/... and /design/KEY/...
  const match = u.pathname.match(/\/(file|design)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error("Invalid Figma URL");

  const fileKey = match[2];
  const rawNodeId = u.searchParams.get("node-id");
  // Figma URLs use X-Y format, API uses X:Y
  const nodeId = rawNodeId ? rawNodeId.replace("-", ":") : undefined;

  return { fileKey, nodeId };
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  characters?: string;
  style?: Record<string, unknown>;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: Array<{ type: string; color?: { r: number; g: number; b: number; a: number } }>;
  cornerRadius?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  effects?: Array<{ type: string; radius?: number; color?: { r: number; g: number; b: number; a: number } }>;
  strokes?: Array<{ type: string; color?: { r: number; g: number; b: number; a: number } }>;
  strokeWeight?: number;
}

function rgbaToHex(c: { r: number; g: number; b: number; a: number }): string {
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}${c.a < 1 ? toHex(c.a) : ""}`;
}

function simplifyNode(node: FigmaNode, depth = 0): string {
  if (depth > 8) return ""; // prevent excessive nesting

  const indent = "  ".repeat(depth);
  const parts: string[] = [];

  let line = `${indent}[${node.type}] "${node.name}"`;

  if (node.absoluteBoundingBox) {
    const b = node.absoluteBoundingBox;
    line += ` (${Math.round(b.width)}x${Math.round(b.height)})`;
  }

  if (node.layoutMode) {
    line += ` layout=${node.layoutMode}`;
    if (node.itemSpacing) line += ` gap=${node.itemSpacing}`;
    if (node.primaryAxisAlignItems) line += ` mainAxis=${node.primaryAxisAlignItems}`;
    if (node.counterAxisAlignItems) line += ` crossAxis=${node.counterAxisAlignItems}`;
  }

  if (node.cornerRadius) line += ` radius=${node.cornerRadius}`;

  if (node.paddingLeft || node.paddingTop) {
    line += ` padding=${node.paddingTop ?? 0},${node.paddingRight ?? 0},${node.paddingBottom ?? 0},${node.paddingLeft ?? 0}`;
  }

  if (node.fills?.length) {
    const solidFills = node.fills.filter((f) => f.type === "SOLID" && f.color);
    if (solidFills.length) {
      line += ` fills=[${solidFills.map((f) => rgbaToHex(f.color!)).join(",")}]`;
    }
  }

  if (node.strokes?.length) {
    const solidStrokes = node.strokes.filter((f) => f.type === "SOLID" && f.color);
    if (solidStrokes.length) {
      line += ` stroke=${solidStrokes.map((f) => rgbaToHex(f.color!)).join(",")}`;
      if (node.strokeWeight) line += ` strokeWidth=${node.strokeWeight}`;
    }
  }

  if (node.effects?.length) {
    const shadows = node.effects.filter((e) => e.type === "DROP_SHADOW");
    if (shadows.length) line += ` shadow=true`;
  }

  if (node.characters) {
    line += ` text="${node.characters.slice(0, 100)}"`;
  }

  if (node.style) {
    const s = node.style as Record<string, unknown>;
    if (s.fontFamily) line += ` font=${s.fontFamily}`;
    if (s.fontSize) line += ` size=${s.fontSize}`;
    if (s.fontWeight) line += ` weight=${s.fontWeight}`;
  }

  parts.push(line);

  if (node.children) {
    for (const child of node.children) {
      const childStr = simplifyNode(child, depth + 1);
      if (childStr) parts.push(childStr);
    }
  }

  return parts.join("\n");
}

function extractColors(node: FigmaNode, colors: Set<string>) {
  if (node.fills) {
    for (const fill of node.fills) {
      if (fill.type === "SOLID" && fill.color) {
        colors.add(rgbaToHex(fill.color));
      }
    }
  }
  if (node.children) {
    for (const child of node.children) {
      extractColors(child, colors);
    }
  }
}

function extractFonts(node: FigmaNode, fonts: Set<string>) {
  if (node.style) {
    const fontFamily = (node.style as Record<string, unknown>).fontFamily;
    if (typeof fontFamily === "string") fonts.add(fontFamily);
  }
  if (node.children) {
    for (const child of node.children) {
      extractFonts(child, fonts);
    }
  }
}

export async function fetchFigmaDesign(
  fileKey: string,
  nodeId: string | undefined,
  token: string
): Promise<FigmaDesignData> {
  const headers = { "X-FIGMA-TOKEN": token };

  // Fetch file or specific node
  let targetNode: FigmaNode;
  let fileName: string;

  if (nodeId) {
    const res = await fetch(
      `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
      { headers }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Figma API error (${res.status}): ${text}`);
    }
    const data = await res.json();
    fileName = data.name || "Untitled";
    const nodeData = data.nodes?.[nodeId];
    if (!nodeData?.document) throw new Error(`Node ${nodeId} not found`);
    targetNode = nodeData.document;
  } else {
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=4`, {
      headers,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Figma API error (${res.status}): ${text}`);
    }
    const data = await res.json();
    fileName = data.name || "Untitled";
    // Use first page's children
    const firstPage = data.document?.children?.[0];
    if (!firstPage) throw new Error("Empty Figma file");
    targetNode = firstPage;
  }

  const nodeTree = simplifyNode(targetNode);

  const colors = new Set<string>();
  extractColors(targetNode, colors);

  const fonts = new Set<string>();
  extractFonts(targetNode, fonts);

  // Try to get an image of the target node
  let imageUrl: string | undefined;
  const imageNodeId = nodeId || targetNode.id;
  try {
    const imgRes = await fetch(
      `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(imageNodeId)}&format=png&scale=2`,
      { headers }
    );
    if (imgRes.ok) {
      const imgData = await imgRes.json();
      imageUrl = imgData.images?.[imageNodeId] || undefined;
    }
  } catch {
    // Image export is optional, continue without it
  }

  return {
    fileName,
    nodeTree,
    imageUrl,
    colors: Array.from(colors),
    fonts: Array.from(fonts),
  };
}
