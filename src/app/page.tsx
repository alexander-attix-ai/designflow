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
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function setStored(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
  }
}

function stripFences(code: string): string {
  let c = code.trim();
  if (c.startsWith("```")) {
    c = c.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
  }
  return c;
}

function isValidFigmaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "www.figma.com" || u.hostname === "figma.com"
    ) && /\/(file|design)\/[a-zA-Z0-9]+/.test(u.pathname);
  } catch {
    return false;
  }
}

function sandpackFiles(componentCode: string) {
  return {
    "/App.tsx": `import Component from "./Component";\nexport default function App() {\n  return <Component />;\n}`,
    "/Component.tsx":
      componentCode ||
      `export default function Component() {\n  return <div className="p-8 text-gray-400">Generate a component to see the preview</div>;\n}`,
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
  const [figmaToken, setFigmaToken] = useState(() =>
    getStored(STORAGE_KEY_FIGMA)
  );
  const [anthropicKey, setAnthropicKey] = useState(() =>
    getStored(STORAGE_KEY_ANTHROPIC)
  );
  const [showSettings, setShowSettings] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewCode, setPreviewCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const codeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!getStored(STORAGE_KEY_FIGMA) && !getStored(STORAGE_KEY_ANTHROPIC)) {
      setShowSettings(true);
    }
  }, []);

  const saveSettings = () => {
    setStored(STORAGE_KEY_FIGMA, figmaToken);
    setStored(STORAGE_KEY_ANTHROPIC, anthropicKey);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    setShowSettings(false);
  };

  const generate = useCallback(async () => {
    const url = figmaUrl.trim();
    if (!url) return;

    if (!isValidFigmaUrl(url)) {
      setError(
        "Please enter a valid Figma URL (e.g. https://www.figma.com/design/...)"
      );
      return;
    }

    const token = figmaToken || undefined;
    const apiKey = anthropicKey || undefined;

    if (!token && !process.env.NEXT_PUBLIC_HAS_FIGMA_TOKEN) {
      setError("Figma access token is required. Add it in Settings.");
      setShowSettings(true);
      return;
    }

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
          figmaUrl: url,
          prompt: prompt.trim() || undefined,
          figmaToken: token,
          anthropicKey: apiKey,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(errBody.error || `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream received");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setCode(accumulated);
        if (codeRef.current) {
          codeRef.current.scrollTop = codeRef.current.scrollHeight;
        }
      }

      if (!accumulated.trim()) {
        throw new Error("Empty response from API — the model returned no code");
      }

      const cleaned = stripFences(accumulated);
      setCode(cleaned);
      setPreviewCode(cleaned);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "An unexpected error occurred");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [figmaUrl, prompt, figmaToken, anthropicKey]);

  const cancelGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setLoading(false);
    }
  }, []);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy — please select and copy manually");
    }
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
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-primary-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">
            DesignFlow
          </h1>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
            MVP
          </span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          Settings
        </button>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b border-border bg-card px-6 py-5">
          <div className="max-w-2xl mx-auto space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              API Keys
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Figma Personal Access Token
                </label>
                <input
                  type="password"
                  value={figmaToken}
                  onChange={(e) => setFigmaToken(e.target.value)}
                  placeholder="figd_..."
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveSettings}
                className="text-sm bg-primary text-primary-foreground px-5 py-2 rounded-lg hover:bg-primary/90 transition-colors font-medium shadow-sm"
              >
                {settingsSaved ? "Saved!" : "Save"}
              </button>
              <span className="text-xs text-muted-foreground">
                Stored locally in your browser
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Input Bar */}
        <div className="px-6 py-4 border-b border-border space-y-3 shrink-0 bg-white">
          <div className="flex gap-3">
            <input
              value={figmaUrl}
              onChange={(e) => {
                setFigmaUrl(e.target.value);
                if (error) setError("");
              }}
              placeholder="Paste Figma URL — https://www.figma.com/design/..."
              className="flex-1 bg-muted/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary placeholder:text-muted-foreground transition-colors"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && generate()}
            />
            {loading ? (
              <button
                onClick={cancelGeneration}
                className="bg-foreground/10 text-foreground px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-foreground/15 transition-colors flex items-center gap-2 shrink-0"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="currentColor"
                >
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </button>
            ) : (
              <button
                onClick={generate}
                disabled={!figmaUrl.trim()}
                className="bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0 shadow-sm"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                Generate
              </button>
            )}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Additional instructions (optional) — e.g., "Make it responsive, use a card layout"'
            rows={2}
            className="w-full bg-muted/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary placeholder:text-muted-foreground resize-none transition-colors"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-danger-light border border-danger-border rounded-lg text-danger text-sm flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError("")}
              className="text-danger/60 hover:text-danger shrink-0"
            >
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Output Area */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Code Panel */}
          <div className="flex-1 flex flex-col border-r border-border min-w-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Generated Code
              </span>
              {code && (
                <div className="flex gap-1">
                  <button
                    onClick={copyCode}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md hover:bg-muted font-medium"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={downloadCode}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md hover:bg-muted font-medium"
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
            <pre
              ref={codeRef}
              className="flex-1 overflow-auto p-4 text-sm leading-relaxed font-mono text-foreground/80 bg-white"
            >
              {code || (
                <span className="text-muted-foreground">
                  {loading
                    ? "Waiting for Figma data..."
                    : "Paste a Figma URL and click Generate"}
                </span>
              )}
            </pre>
          </div>

          {/* Preview Panel */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center px-4 py-2 border-b border-border bg-muted/30 shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Live Preview
              </span>
            </div>
            <div className="flex-1 overflow-hidden bg-white">
              {previewCode ? (
                <SandpackProvider
                  template="react-ts"
                  files={sandpackFiles(previewCode)}
                  theme="light"
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
                      <svg
                        className="animate-spin w-8 h-8 text-primary"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      <span>Generating component...</span>
                    </div>
                  ) : (
                    <span className="text-center px-8">
                      Preview will appear here after generation
                    </span>
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
