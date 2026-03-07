"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";

const STORAGE_KEY_FIGMA = "df_figma_token";
const STORAGE_KEY_ANTHROPIC = "df_anthropic_key";

function getStored(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) ?? "";
}

function setStored(key: string, value: string) {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

// Strip markdown code fences if Claude wraps the output
function stripFences(code: string): string {
  let c = code.trim();
  if (c.startsWith("```")) {
    c = c.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
  }
  return c;
}

function sandpackFiles(componentCode: string) {
  return {
    "/App.tsx": `import Component from "./Component";\nexport default function App() {\n  return <Component />;\n}`,
    "/Component.tsx": componentCode || `export default function Component() {\n  return <div className="p-8 text-gray-500">Generate a component to see the preview</div>;\n}`,
    "/public/index.html": `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script src="https://cdn.tailwindcss.com"></script>
</head><body><div id="root"></div></body></html>`,
  };
}

export default function Home() {
  const [figmaUrl, setFigmaUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [figmaToken, setFigmaToken] = useState(() => getStored(STORAGE_KEY_FIGMA));
  const [anthropicKey, setAnthropicKey] = useState(() => getStored(STORAGE_KEY_ANTHROPIC));
  const [showSettings, setShowSettings] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewCode, setPreviewCode] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const codeRef = useRef<HTMLPreElement>(null);

  // Auto-open settings if no tokens configured
  useEffect(() => {
    if (!getStored(STORAGE_KEY_FIGMA) && !getStored(STORAGE_KEY_ANTHROPIC)) {
      setShowSettings(true);
    }
  }, []);

  const saveSettings = () => {
    setStored(STORAGE_KEY_FIGMA, figmaToken);
    setStored(STORAGE_KEY_ANTHROPIC, anthropicKey);
    setShowSettings(false);
  };

  const generate = useCallback(async () => {
    if (!figmaUrl.trim()) return;
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    setCode("");
    setPreviewCode("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          figmaUrl: figmaUrl.trim(),
          prompt: prompt.trim() || undefined,
          figmaToken: figmaToken || undefined,
          anthropicKey: anthropicKey || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setCode(accumulated);
        // Auto-scroll code view
        if (codeRef.current) {
          codeRef.current.scrollTop = codeRef.current.scrollHeight;
        }
      }

      // Set final code for preview
      const cleaned = stripFences(accumulated);
      setCode(cleaned);
      setPreviewCode(cleaned);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [figmaUrl, prompt, figmaToken, anthropicKey]);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
  };

  const downloadCode = () => {
    const blob = new Blob([code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Component.tsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-lg font-bold tracking-tight">DesignFlow</h1>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">MVP</span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          Settings
        </button>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="max-w-2xl mx-auto space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">API Keys</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Figma Personal Access Token</label>
                <input
                  type="password"
                  value={figmaToken}
                  onChange={(e) => setFigmaToken(e.target.value)}
                  placeholder="figd_..."
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Anthropic API Key</label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveSettings}
                className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
              >
                Save
              </button>
              <span className="text-xs text-muted-foreground">Stored in browser localStorage</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Input Bar */}
        <div className="px-6 py-4 border-b border-border space-y-3 shrink-0">
          <div className="flex gap-3">
            <input
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              placeholder="Paste Figma URL — https://www.figma.com/design/..."
              className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && generate()}
            />
            <button
              onClick={generate}
              disabled={loading || !figmaUrl.trim()}
              className="bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating...
                </>
              ) : (
                "Generate"
              )}
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Additional instructions (optional) — e.g., "Make it responsive, use a card-based layout, dark theme"'
            rows={2}
            className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Output Area */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Code Panel */}
          <div className="flex-1 flex flex-col border-r border-border min-w-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Generated Code
              </span>
              {code && (
                <div className="flex gap-2">
                  <button
                    onClick={copyCode}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                  >
                    Copy
                  </button>
                  <button
                    onClick={downloadCode}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
            <pre
              ref={codeRef}
              className="flex-1 overflow-auto p-4 text-sm leading-relaxed font-mono text-foreground/90"
            >
              {code || (
                <span className="text-muted-foreground">
                  {loading ? "Waiting for Figma data..." : "Paste a Figma URL and click Generate"}
                </span>
              )}
            </pre>
          </div>

          {/* Preview Panel */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center px-4 py-2 border-b border-border shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Live Preview
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewCode ? (
                <SandpackProvider
                  template="react-ts"
                  files={sandpackFiles(previewCode)}
                  theme="dark"
                  options={{
                    externalResources: ["https://cdn.tailwindcss.com"],
                  }}
                >
                  <SandpackLayout style={{ height: "100%", border: "none" }}>
                    <SandpackPreview
                      style={{ height: "100%" }}
                      showOpenInCodeSandbox={false}
                      showRefreshButton={true}
                    />
                  </SandpackLayout>
                </SandpackProvider>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {loading ? (
                    <div className="flex flex-col items-center gap-3">
                      <svg className="animate-spin w-8 h-8 text-primary" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>Generating component...</span>
                    </div>
                  ) : (
                    "Preview will appear here after generation"
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
