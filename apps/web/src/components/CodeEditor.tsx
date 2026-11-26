"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import "./CodeEditor.css";

export interface CodeEditorTab {
  readonly id: string;
  readonly filename: string;
  readonly code: string;
  readonly highlightLines?: readonly number[];
}

export interface CodeEditorProps {
  readonly tabs: readonly CodeEditorTab[];
  readonly defaultTabId?: string;
  readonly ariaLabel?: string;
  /** Drops the outer border and radius when nested inside another frame. */
  readonly embedded?: boolean;
}

type TokenKind =
  | "plain"
  | "keyword"
  | "component"
  | "prop"
  | "string"
  | "number"
  | "comment"
  | "punct";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "default",
  "function",
  "return",
  "const",
  "let",
  "type",
  "true",
  "false",
  "readonly",
  "new",
]);

/** Small TS/TSX tokenizer for syntax colors. */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    if (line[i] === "/" && line[i + 1] === "/") {
      tokens.push({ kind: "comment", text: line.slice(i) });
      break;
    }
    if (line[i] === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const slice = end === -1 ? line.slice(i) : line.slice(i, end + 2);
      tokens.push({ kind: "comment", text: slice });
      i += slice.length;
      continue;
    }
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < len && line[j] !== quote) {
        if (line[j] === "\\") j++;
        j++;
      }
      const slice = line.slice(i, Math.min(len, j + 1));
      tokens.push({ kind: "string", text: slice });
      i += slice.length;
      continue;
    }
    if (/[0-9]/.test(line[i]) && (i === 0 || !/[A-Za-z0-9_$]/.test(line[i - 1]))) {
      let j = i;
      while (j < len && /[0-9._]/.test(line[j])) j++;
      tokens.push({ kind: "number", text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(line[i])) {
      let j = i;
      while (j < len && /[A-Za-z0-9_$-]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const prevChar = i > 0 ? line[i - 1] : "";
      const nextChar = j < len ? line[j] : "";

      if (KEYWORDS.has(word)) {
        tokens.push({ kind: "keyword", text: word });
      } else if (
        (prevChar === "<" || prevChar === "/" || prevChar === ".") &&
        /^[A-Z]/.test(word)
      ) {
        tokens.push({ kind: "component", text: word });
      } else if (
        (prevChar === "<" || prevChar === "/") &&
        /^[a-z]/.test(word) &&
        (nextChar === " " || nextChar === ">" || nextChar === "/")
      ) {
        tokens.push({ kind: "component", text: word });
      } else if (nextChar === "=" || (nextChar === ":" && !word.includes("-"))) {
        tokens.push({ kind: "prop", text: word });
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && !/^[A-Z0-9_]+$/.test(word)) {
        tokens.push({ kind: "component", text: word });
      } else {
        tokens.push({ kind: "plain", text: word });
      }
      i = j;
      continue;
    }
    if (/[{}()[\]<>.,;=:+*/!?&|-]/.test(line[i])) {
      tokens.push({ kind: "punct", text: line[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < len && !/[A-Za-z0-9_$"'`/{}()[\]<>.,;=:+*/!?&|-]/.test(line[j])) j++;
    tokens.push({ kind: "plain", text: line.slice(i, j) });
    i = j;
  }

  return tokens;
}

export function CodeEditor({
  tabs,
  defaultTabId,
  ariaLabel = "Code example",
  embedded = false,
}: CodeEditorProps) {
  const editorId = useId();
  const [activeId, setActiveId] = useState(defaultTabId ?? tabs[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const activeIndex = useMemo(() => {
    const idx = tabs.findIndex((t) => t.id === activeId);
    return idx >= 0 ? idx : 0;
  }, [tabs, activeId]);

  const activeTab = tabs[activeIndex];

  const lines = useMemo(() => (activeTab?.code ?? "").split("\n"), [activeTab?.code]);
  const highlightSet = useMemo(
    () => new Set(activeTab?.highlightLines ?? []),
    [activeTab?.highlightLines],
  );

  const selectTabAt = useCallback(
    (index: number) => {
      const target = tabs[index];
      if (!target) return;
      setActiveId(target.id);
      setCopied(false);
      tabRefs.current[index]?.focus();
    },
    [tabs],
  );

  const handleTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (tabs.length < 2) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        selectTabAt((index + 1) % tabs.length);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        selectTabAt((index - 1 + tabs.length) % tabs.length);
      } else if (e.key === "Home") {
        e.preventDefault();
        selectTabAt(0);
      } else if (e.key === "End") {
        e.preventDefault();
        selectTabAt(tabs.length - 1);
      }
    },
    [selectTabAt, tabs.length],
  );

  const handleCopy = useCallback(async () => {
    if (!activeTab) return;
    try {
      await navigator.clipboard.writeText(activeTab.code);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1800);
    } catch {
      setCopied(false);
    }
  }, [activeTab]);

  if (!activeTab) return null;

  const panelId = `${editorId}-panel`;
  const activeTabDomId = `${editorId}-tab-${activeTab.id}`;

  return (
    <div
      className={`pm-editor${embedded ? " pm-editor--embedded" : ""}`}
      role="region"
      aria-label={ariaLabel}
    >
      <div className="pm-editor__bar">
        <div className="pm-editor__tabs" role="tablist" aria-label="Code files">
          {tabs.map((tab, idx) => {
            const isSelected = tab.id === activeTab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                id={`${editorId}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={panelId}
                tabIndex={isSelected ? 0 : -1}
                className={`pm-editor__tab${isSelected ? " is-active" : ""}`}
                onClick={() => {
                  setActiveId(tab.id);
                  setCopied(false);
                }}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
              >
                {tab.filename}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={`pm-editor__copy${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label={`Copy ${activeTab.filename}`}
        >
          <span className="pm-editor__copy-icons pm-swap" aria-hidden="true">
            <svg
              className="pm-editor__icon pm-swap__a"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
            >
              <rect
                x="9"
                y="9"
                width="11"
                height="11"
                rx="2.2"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path
                d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
            <svg
              className="pm-editor__icon pm-swap__b"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M4.5 12.75 9.5 17.75 19.5 6.75"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="pm-editor__copy-label pm-swap pm-swap--text" aria-hidden="true">
            <span className="pm-swap__a">Copy</span>
            <span className="pm-swap__b">Copied</span>
          </span>
        </button>
      </div>

      <span className="pm-editor__sr-status" role="status" aria-live="polite">
        {copied ? `${activeTab.filename} copied to clipboard.` : ""}
      </span>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={activeTabDomId}
        tabIndex={0}
        className="pm-editor__body"
      >
        <pre className="pm-editor__pre">
          <code className="pm-editor__code">
            {lines.map((line, idx) => {
              const lineNo = idx + 1;
              const isHighlighted = highlightSet.has(lineNo);
              const tokens = tokenizeLine(line);
              return (
                <span
                  key={lineNo}
                  className={`pm-editor__line${isHighlighted ? " is-highlighted" : ""}`}
                >
                  <span className="pm-editor__ln" aria-hidden="true">
                    {lineNo}
                  </span>
                  <span className="pm-editor__src">
                    {tokens.length === 0
                      ? " "
                      : tokens.map((tok, ti) =>
                          tok.kind === "plain" ? (
                            tok.text
                          ) : (
                            <span key={ti} className={`pm-tok--${tok.kind}`}>
                              {tok.text}
                            </span>
                          ),
                        )}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}
