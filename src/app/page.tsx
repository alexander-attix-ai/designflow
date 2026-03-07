"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";

const SK_FIGMA = "df_figma_token";
const SK_ANTHROPIC = "df_anthropic_key";

function stored(key: string): string {
  try {
    return typeof window !== "undefined"
      ? localStorage.getItem(key) ?? ""
      : "";
  } catch {
    return "";
  }
}

function setStored(key: string, v: string) {
  try {
    v ? localStorage.setItem(key, v) : localStorage.removeItem(key);
  } catch {}
}

function stripFences(code: string): string {
  let c = code.trim();
  if (c.startsWith("```")) {
    c = c.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
  }
  return c;
}

function validFigmaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "www.figma.com" || u.hostname === "figma.com") &&
      /\/(file|design)\/[a-zA-Z0-9]+/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

function spFiles(code: string) {
  return {
    "/App.tsx": `import Component from "./Component";\nexport default function App() { return <Component />; }`,
    "/Component.tsx":
      code ||
      'export default function Component() { return <div className="p-8 text-gray-400">No preview yet</div>; }',
    "/public/index.html": `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div></body></html>`,
  };
}

export default function Home() {
  const [figmaUrl, setFigmaUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [figmaToken, setFigmaToken] = useState(() => stored(SK_FIGMA));
  const [anthropicKey, setAnthropicKey] = useState(() => stored(SK_ANTHROPIC));
  const [showSettings, setShowSettings] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const codeRef = useRef<HTMLPreElement>(null);

  // No auto-open settings — hidden by default
  useEffect(() => {
    // Check if keys exist but don't auto-open
  }, []);

  const saveSettings = () => {
    setStored(SK_FIGMA, figmaToken);
    setStored(SK_ANTHROPIC, anthropicKey);
    setShowSettings(false);
  };

  const generate = useCallback(async () => {
    const url = figmaUrl.trim();
    if (!url) return;
    if (!validFigmaUrl(url)) {
      setError("Enter a valid Figma URL (https://www.figma.com/design/...)");
      return;
    }
    if (!figmaToken && !anthropicKey) {
      setError("Add your API keys in Settings first.");
      setShowSettings(true);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError("");
    setCode("");
    setPreview("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          figmaUrl: url,
          prompt: prompt.trim() || undefined,
          figmaToken: figmaToken || undefined,
          anthropicKey: anthropicKey || undefined,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setCode(acc);
        if (codeRef.current)
          codeRef.current.scrollTop = codeRef.current.scrollHeight;
      }

      if (!acc.trim()) throw new Error("Empty response from API");
      const cleaned = stripFences(acc);
      setCode(cleaned);
      setPreview(cleaned);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "Something went wrong");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [figmaUrl, prompt, figmaToken, anthropicKey]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const download = () => {
    const blob = new Blob([code], { type: "text/typescript" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = "Component.tsx";
    a.click();
    URL.revokeObjectURL(u);
  };

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* ── Header ── */}
      <header className="h-12 flex items-center justify-between px-5 border-b shrink-0">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className="text-sm font-semibold tracking-tight">DesignFlow</span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Settings
        </button>
      </header>

      {/* ── Settings (hidden by default) ── */}
      {showSettings && (
        <div className="border-b bg-muted/40 px-5 py-4">
          <div className="max-w-xl mx-auto space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">API Keys</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="password"
                value={figmaToken}
                onChange={(e) => setFigmaToken(e.target.value)}
                placeholder="Figma token — figd_..."
                className="h-9 rounded-md border bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10"
              />
              <input
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="Anthropic key — sk-ant-..."
                className="h-9 rounded-md border bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveSettings}
                className="h-8 px-4 text-xs font-medium bg-foreground text-white rounded-md hover:bg-foreground/90 transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <span className="text-[11px] text-muted-foreground">Keys are stored in your browser only.</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Input ── */}
      <div className="px-5 py-3 border-b shrink-0 space-y-2">
        <div className="flex gap-2">
          <input
            value={figmaUrl}
            onChange={(e) => {
              setFigmaUrl(e.target.value);
              if (error) setError("");
            }}
            placeholder="Paste a Figma URL..."
            className="flex-1 h-9 rounded-md border bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && generate()}
          />
          {loading ? (
            <button
              onClick={cancel}
              className="h-9 px-4 text-xs font-medium rounded-md border text-foreground hover:bg-gray-50 transition-colors shrink-0"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={generate}
              disabled={!figmaUrl.trim()}
              className="h-9 px-5 text-xs font-medium bg-foreground text-white rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              Generate
            </button>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Additional instructions (optional)..."
          rows={1}
          className="w-full rounded-md border bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 resize-none"
        />
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mx-5 mt-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-600 shrink-0">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Panels ── */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Code */}
        <div className="flex-1 flex flex-col min-w-0 border-r">
          <div className="h-9 flex items-center justify-between px-4 border-b shrink-0">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Code</span>
            {code && (
              <div className="flex gap-1">
                <button onClick={copy} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded transition-colors">
                  {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={download} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded transition-colors">
                  Download
                </button>
              </div>
            )}
          </div>
          <pre ref={codeRef} className="flex-1 overflow-auto p-4 text-[13px] leading-relaxed font-mono text-gray-700 bg-white">
            {code || (
              <span className="text-gray-400">
                {loading ? "Fetching design data..." : "Paste a Figma URL and click Generate"}
              </span>
            )}
          </pre>
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-9 flex items-center px-4 border-b shrink-0">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Preview</span>
          </div>
          <div className="flex-1 bg-white overflow-hidden">
            {preview ? (
              <SandpackProvider
                template="react-ts"
                files={spFiles(preview)}
                theme="light"
                options={{ externalResources: ["https://cdn.tailwindcss.com"] }}
              >
                <SandpackLayout style={{ height: "100%", border: "none", borderRadius: 0 }}>
                  <SandpackPreview style={{ height: "100%" }} showOpenInCodeSandbox={false} showRefreshButton />
                </SandpackLayout>
              </SandpackProvider>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                {loading ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
                    <span>Generating...</span>
                  </div>
                ) : (
                  "Preview appears after generation"
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
