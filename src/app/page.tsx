"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";

const SK_KEY = "df_anthropic_key";

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function spFiles(code: string) {
  return {
    "/App.tsx": `import Component from "./Component";\nexport default function App() { return <Component />; }`,
    "/Component.tsx":
      code ||
      'export default function Component() { return <div className="p-8 text-gray-400">No preview yet</div>; }',
    "/public/index.html": `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><script src="https://cdn.tailwindcss.com"></script></head><body style="margin:0"><div id="root"></div></body></html>`,
  };
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

export default function Home() {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState(() => stored(SK_KEY));
  const [showSettings, setShowSettings] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const codeRef = useRef<HTMLPreElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => resizeTextarea(), [input, resizeTextarea]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [history, streaming]);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const valid = arr.filter((f) => {
        if (!ACCEPTED_TYPES.includes(f.type)) {
          setError(`${f.name}: unsupported format. Use PNG, JPG, GIF, or WebP.`);
          return false;
        }
        if (f.size > MAX_FILE_SIZE) {
          setError(`${f.name}: too large (max 10 MB).`);
          return false;
        }
        return true;
      });
      if (images.length + valid.length > 6) {
        setError("Max 6 images per message.");
        return;
      }
      const b64 = await Promise.all(valid.map(fileToBase64));
      setImages((prev) => [...prev, ...b64]);
    },
    [images.length]
  );

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) addImages(e.dataTransfer.files);
    },
    [addImages]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text && images.length === 0) return;

    const key = apiKey || undefined;

    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const userMsg: ChatMsg = {
      role: "user",
      content: text,
      images: images.length > 0 ? [...images] : undefined,
    };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    setInput("");
    setImages([]);
    setLoading(true);
    setStreaming("");
    setError("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newHistory,
          anthropicKey: key,
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
        setStreaming(acc);
        if (codeRef.current)
          codeRef.current.scrollTop = codeRef.current.scrollHeight;
      }

      if (!acc.trim()) throw new Error("Empty response");

      const cleaned = stripFences(acc);
      const assistantMsg: ChatMsg = { role: "assistant", content: cleaned };
      setHistory((prev) => [...prev, assistantMsg]);
      setStreaming("");
      setCode(cleaned);
      setPreview(cleaned);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "Something went wrong");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, images, apiKey, history]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStreaming("");
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

  const newChat = () => {
    setHistory([]);
    setCode("");
    setPreview("");
    setStreaming("");
    setInput("");
    setImages([]);
    setError("");
    setShowCode(false);
  };

  const saveSettings = () => {
    setStored(SK_KEY, apiKey);
    setShowSettings(false);
  };

  const displayCode = streaming || code;

  return (
    <div
      className="h-screen flex flex-col bg-white"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* ── Header ── */}
      <header className="h-11 flex items-center justify-between px-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className="text-[13px] font-semibold tracking-tight">DesignFlow</span>
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <button
              onClick={newChat}
              className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
            >
              New
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
          >
            Settings
          </button>
        </div>
      </header>

      {/* ── Settings ── */}
      {showSettings && (
        <div className="border-b bg-gray-50/60 px-4 py-3">
          <div className="max-w-md mx-auto space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">API Key</p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full h-8 rounded-md border bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <div className="flex items-center gap-2">
              <button onClick={saveSettings} className="h-7 px-3 text-[11px] font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors">Save</button>
              <button onClick={() => setShowSettings(false)} className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drop overlay ── */}
      {dragging && (
        <div className="fixed inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-gray-300 rounded-xl px-12 py-10 text-center">
            <svg viewBox="0 0 24 24" className="w-8 h-8 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <p className="text-sm font-medium text-gray-500">Drop images here</p>
          </div>
        </div>
      )}

      {/* ── Main layout: Chat | Preview (code hidden by default) ── */}
      <div className="flex-1 flex min-h-0" data-layout="chat-preview">
        {/* ── Left: Chat ── */}
        <div className="w-[380px] shrink-0 flex flex-col border-r">
          <div ref={chatRef} className="flex-1 overflow-y-auto">
            {history.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center h-full px-8 text-center">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-4">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900 mb-1">Describe any UI</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Describe a component in plain English or drop a screenshot to replicate it.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-3">
                {history.map((msg, i) => (
                  <div key={i}>
                    {msg.role === "user" ? (
                      <div className="flex flex-col gap-1.5">
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {msg.images.map((src, j) => (
                              <img key={j} src={src} alt="" className="w-16 h-16 object-cover rounded-md border" />
                            ))}
                          </div>
                        )}
                        {msg.content && (
                          <div className="bg-gray-900 text-white text-[13px] rounded-lg rounded-bl-sm px-3 py-2 max-w-[90%] leading-relaxed">
                            {msg.content}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-400 py-1">
                        Component generated
                        <button
                          onClick={() => { setCode(msg.content); setPreview(msg.content); }}
                          className="ml-2 text-gray-500 hover:text-gray-900 underline underline-offset-2 transition-colors"
                        >
                          view
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-[11px] text-gray-400 py-1">
                    <div className="w-3 h-3 border border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                    Generating...
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="mx-3 mb-2 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-600">
              <span className="truncate">{error}</span>
              <button onClick={() => setError("")} className="ml-2 text-red-300 hover:text-red-500 shrink-0">
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {images.length > 0 && (
            <div className="px-3 pb-1.5 flex flex-wrap gap-1.5">
              {images.map((src, i) => (
                <div key={i} className="relative group">
                  <img src={src} alt="" className="w-14 h-14 object-cover rounded-md border" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 text-white rounded-full text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="p-3 border-t">
            <div className="flex items-end gap-2 rounded-lg border bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-gray-900/10 transition-shadow">
              <button onClick={() => fileRef.current?.click()} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 mb-0.5" title="Upload images">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!loading) send();
                  }
                }}
                placeholder={history.length === 0 ? "Describe a UI... or drop a screenshot" : "Refine the design..."}
                rows={1}
                className="flex-1 text-[13px] leading-relaxed placeholder:text-gray-400 resize-none focus:outline-none min-h-[24px] max-h-[200px]"
              />
              {loading ? (
                <button onClick={cancel} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 mb-0.5" title="Cancel">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button onClick={send} disabled={!input.trim() && images.length === 0} className="text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-25 shrink-0 mb-0.5" title="Send">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden" onChange={(e) => { if (e.target.files) addImages(e.target.files); e.target.value = ""; }} />
          </div>
        </div>

        {/* ── Right: Preview (full width) with optional code drawer ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="h-9 flex items-center justify-between px-4 border-b shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowCode(false)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded transition-colors ${
                  !showCode
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => setShowCode(true)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded transition-colors ${
                  showCode
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Code
              </button>
            </div>
            {code && (
              <div className="flex items-center gap-1">
                <button onClick={copy} className="text-[11px] text-gray-400 hover:text-gray-900 px-2 py-0.5 rounded transition-colors">
                  {copied ? "Copied!" : "Copy code"}
                </button>
                <button onClick={download} className="text-[11px] text-gray-400 hover:text-gray-900 px-2 py-0.5 rounded transition-colors">
                  Download
                </button>
              </div>
            )}
          </div>

          {/* Panel content — flex child, no absolute positioning */}
          {showCode ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <pre
                ref={codeRef}
                className="h-full overflow-auto p-4 text-[12px] leading-relaxed font-mono text-gray-600 bg-white"
              >
                {displayCode || (
                  <span className="text-gray-400">
                    {loading ? "Generating code..." : "Code will appear here"}
                  </span>
                )}
              </pre>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden" data-panel="preview">
              {preview ? (
                <SandpackProvider
                  template="react-ts"
                  files={spFiles(preview)}
                  theme="light"
                  options={{ externalResources: ["https://cdn.tailwindcss.com"] }}
                >
                  <SandpackLayout
                    style={{
                      height: "100%",
                      border: "none",
                      borderRadius: 0,
                    }}
                  >
                    <SandpackPreview
                      style={{ height: "100%" }}
                      showOpenInCodeSandbox={false}
                      showRefreshButton
                    />
                  </SandpackLayout>
                </SandpackProvider>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-gray-400">
                  {loading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
                      <span className="text-xs">Building preview...</span>
                    </div>
                  ) : (
                    <span className="text-xs">Preview appears after generation</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <span className="fixed bottom-2 right-3 text-[10px] text-gray-300 select-none pointer-events-none" data-version="v1.1.0">v1.1.0</span>
    </div>
  );
}
