import { useState } from "react";

function renderInlineFormatting(text) {
  if (!text) return null;

  // Split by inline code: `code`
  const codeParts = text.split(/(`[^`]+`)/g);

  return codeParts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={i}
          style={{
            background: "rgba(255, 255, 255, 0.12)",
            color: "#60a5fa",
            padding: "2px 6px",
            borderRadius: "4px",
            fontFamily: "Consolas, Monaco, monospace",
            fontSize: "12px",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Split by bold: **bold**
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bPart, j) => {
      if (bPart.startsWith("**") && bPart.endsWith("**") && bPart.length > 4) {
        return (
          <strong key={`${i}-${j}`} style={{ color: "#f3f4f6", fontWeight: "600" }}>
            {bPart.slice(2, -2)}
          </strong>
        );
      }
      return <span key={`${i}-${j}`}>{bPart}</span>;
    });
  });
}

/**
 * Formats a block of text into headings, lists, and paragraphs.
 */
function TextBlock({ text }) {
  const lines = text.split("\n");

  return (
    <div style={{ lineHeight: "1.6", fontSize: "13.5px", color: "#d1d5db" }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <div key={idx} style={{ height: "6px" }} />;
        }

        // Heading 3: ### Heading
        if (trimmed.startsWith("### ")) {
          return (
            <h4
              key={idx}
              style={{
                color: "#93c5fd",
                fontSize: "15px",
                fontWeight: "600",
                marginTop: idx === 0 ? "0px" : "12px",
                marginBottom: "6px",
              }}
            >
              {renderInlineFormatting(trimmed.slice(4))}
            </h4>
          );
        }

        // Heading 4: #### Heading
        if (trimmed.startsWith("#### ")) {
          return (
            <h5
              key={idx}
              style={{
                color: "#e2e8f0",
                fontSize: "14px",
                fontWeight: "600",
                marginTop: "10px",
                marginBottom: "4px",
              }}
            >
              {renderInlineFormatting(trimmed.slice(5))}
            </h5>
          );
        }

        // Unordered list item: - item or * item
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                marginLeft: "4px",
                marginBottom: "4px",
              }}
            >
              <span style={{ color: "#38bdf8", fontSize: "14px", lineHeight: "1.4" }}>•</span>
              <span style={{ flex: 1 }}>{renderInlineFormatting(trimmed.slice(2))}</span>
            </div>
          );
        }

        // Ordered list item: 1. item
        const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (orderedMatch) {
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                marginLeft: "4px",
                marginBottom: "4px",
              }}
            >
              <span style={{ color: "#38bdf8", fontWeight: "600", fontSize: "12px", minWidth: "16px" }}>
                {orderedMatch[1]}.
              </span>
              <span style={{ flex: 1 }}>{renderInlineFormatting(orderedMatch[2])}</span>
            </div>
          );
        }

        // Normal paragraph
        return (
          <p key={idx} style={{ margin: "0 0 6px 0" }}>
            {renderInlineFormatting(line)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Fenced code block with Language Tag, Copy, and Insert into Editor actions.
 */
function CodeSnippetBlock({ language, code, onInsertCode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleInsert = () => {
    if (onInsertCode) {
      onInsertCode(code);
    }
  };

  return (
    <div
      style={{
        margin: "12px 0",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #374151",
        background: "#0f172a",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
      }}
    >
      {/* Code Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 12px",
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          fontSize: "12px",
        }}
      >
        <span
          style={{
            color: "#94a3b8",
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontFamily: "monospace",
          }}
        >
          {language || "code"}
        </span>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleCopy}
            type="button"
            style={{
              padding: "3px 8px",
              background: copied ? "#059669" : "#334155",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: "pointer",
              transition: "background 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {copied ? "✓ Copied!" : "📋 Copy"}
          </button>

          {onInsertCode && (
            <button
              onClick={handleInsert}
              type="button"
              style={{
                padding: "3px 8px",
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "11px",
                cursor: "pointer",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              📥 Insert
            </button>
          )}
        </div>
      </div>

      {/* Code Content */}
      <pre
        style={{
          margin: 0,
          padding: "12px",
          overflowX: "auto",
          fontFamily: "Consolas, Monaco, 'Courier New', monospace",
          fontSize: "12.5px",
          color: "#e2e8f0",
          lineHeight: "1.5",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Main CodePilot AI Message Component.
 * Parses raw AI reply text containing fenced code blocks and Markdown.
 */
export default function CodePilotMessage({ content, onInsertCode }) {
  if (!content) return null;

  // Split into alternating text and fenced code blocks
  // Regex matches ```[optional language]\n[code]```
  const regex = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: content.slice(lastIndex, match.index),
      });
    }

    parts.push({
      type: "code",
      language: match[1] || "text",
      code: match[2].trim(),
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({
      type: "text",
      content: content.slice(lastIndex),
    });
  }

  return (
    <div style={{ width: "100%" }}>
      {parts.map((part, index) => {
        if (part.type === "code") {
          return (
            <CodeSnippetBlock
              key={index}
              language={part.language}
              code={part.code}
              onInsertCode={onInsertCode}
            />
          );
        }
        return <TextBlock key={index} text={part.content} />;
      })}
    </div>
  );
}
