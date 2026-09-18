import MarkdownIt from "markdown-it";

export interface ExportShape {
  title: string;
  /** F-028: a user-given display name set via PATCH /api/runs/:id; may be
   * the same as `title` (we already used it there) but kept separately so
   * downstream tools can tell "user renamed this" from "the run was always
   * called that". */
  display_name?: string | null;
  /** Original upstream agent name (e.g. `code-agent`, `agent.turn`). */
  event_name?: string | null;
  model?: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    ts?: number;
  }>;
}

const md = MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
}).enable(["table", "strikethrough"]);

export function neutralizeRemoteImages(html: string): string {
  // Replace <img src="..."> where src is not a data URI with an inert code span.
  // Handles both double and single quotes.
  return html.replace(
    /<img\s+[^>]*src\s*=\s*["'](?!data:)([^"']+)["'][^>]*>/gi,
    (_match, url: string) => {
      const escaped = url
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<code>[image: ${escaped}]</code>`;
    },
  );
}

function preNeutralizeRawImgTags(text: string): string {
  // Convert raw <img src="https://..."> in source text to inert placeholders
  // BEFORE markdown-it escapes them (so the user still sees the neutralised form).
  return text.replace(
    /<img\s+[^>]*src\s*=\s*["'](?!data:)([^"']+)["'][^>]*>/gi,
    (_match, url: string) => `[image: ${url}]`,
  );
}

function flattenLinksInImagePlaceholders(html: string): string {
  // After markdown-it linkify turns URLs inside [image: ...] into <a> tags,
  // collapse them back to plain text wrapped in <code>.
  return html.replace(
    /\[image:\s*<a\s+[^>]*href="([^"]+)"[^>]*>[^<]*<\/a>\s*\]/gi,
    (_match, url: string) => `<code>[image: ${url}]</code>`,
  );
}

export function renderMarkdown(text: string): string {
  const preprocessed = preNeutralizeRawImgTags(text);
  const rendered = md.render(preprocessed);
  return neutralizeRemoteImages(flattenLinksInImagePlaceholders(rendered));
}

export function contentToText(
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    } else if (item.type === "image_url" && item.image_url?.url) {
      const url = String(item.image_url.url)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      parts.push(`[image: ${url}]`);
    }
  }
  return parts.join("");
}

export function fmtTs(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const SAFE_CSS_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_CSS_VALUE_RE = /^[a-zA-Z0-9_\s#.,()%+-]+$/;
const FORBIDDEN_CSS_RE = /url\(|expression\(|\{|\}|:|\/|['"]/i;

export function paletteToCss(palette: Record<string, string>): string {
  const entries: string[] = [];
  for (const [rawName, rawValue] of Object.entries(palette)) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name || !value) continue;
    if (name.length > 128 || value.length > 512) continue;
    if (!SAFE_CSS_NAME_RE.test(name)) continue;
    if (FORBIDDEN_CSS_RE.test(value)) continue;
    if (!SAFE_CSS_VALUE_RE.test(value)) continue;
    entries.push(`  ${name}: ${value};`);
  }
  if (entries.length === 0) return "";
  return `:root {\n${entries.join("\n")}\n}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BUILTIN_LIGHT_CSS = `
:root {
  --bg: #f6f8fa;
  --fg: #1f2328;
  --fg-secondary: #656d76;
  --border: #d0d7de;
  --accent: #5a8ab0;
  --accent-soft: rgba(90,138,176,0.12);
  --user-bg: rgba(90,138,176,0.08);
  --assistant-bg: #ffffff;
  --code-bg: #f0f2f5;
  --code-fg: #1f2328;
  --details-bg: #f0f2f5;
}
`;

const BUILTIN_DARK_CSS = `
:root.dark {
  --bg: #0d1117;
  --fg: #c9d1d9;
  --fg-secondary: #8b949e;
  --border: #30363d;
  --accent: #79b8ff;
  --accent-soft: rgba(121,184,255,0.12);
  --user-bg: rgba(121,184,255,0.08);
  --assistant-bg: #161b22;
  --code-bg: #21262d;
  --code-fg: #c9d1d9;
  --details-bg: #21262d;
}
`;

const BUILTIN_SHARED_CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
}
header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
.meta { font-size: 12px; color: var(--fg-secondary); }
.message { margin-bottom: 16px; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border); }
.message.user { background: var(--user-bg); }
.message.assistant { background: var(--assistant-bg); }
.message.system { background: var(--details-bg); font-style: italic; }
.message.tool { background: var(--details-bg); }
.role { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); margin-bottom: 6px; }
.content { font-size: 14px; }
.content pre { background: var(--code-bg); color: var(--code-fg); padding: 12px; border-radius: 6px; overflow-x: auto; }
.content code { background: var(--code-bg); color: var(--code-fg); padding: 2px 4px; border-radius: 4px; font-size: 12px; }
.content blockquote { margin: 0; padding-left: 12px; border-left: 3px solid var(--accent); color: var(--fg-secondary); }
.content table { border-collapse: collapse; width: 100%; font-size: 13px; }
.content th, .content td { border: 1px solid var(--border); padding: 6px 10px; }
.content th { background: var(--accent-soft); }
.content details { background: var(--details-bg); padding: 10px 12px; border-radius: 6px; margin-top: 8px; }
.content summary { font-weight: 600; cursor: pointer; }
footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--fg-secondary); }
`;

export function renderSessionHtml(
  exportShape: ExportShape,
  theme: "light" | "dark" = "dark",
  palette?: Record<string, string>,
): string {
  const title = escapeHtml(exportShape.title);
  const model = exportShape.model ? escapeHtml(exportShape.model) : null;
  const provider = exportShape.provider ? escapeHtml(exportShape.provider) : null;
  const created = fmtTs(exportShape.createdAt);
  const updated = fmtTs(exportShape.updatedAt);

  const paletteCss = palette ? paletteToCss(palette) : "";
  const builtinCss = BUILTIN_LIGHT_CSS + (theme === "dark" ? BUILTIN_DARK_CSS : "") + BUILTIN_SHARED_CSS;

  const messagesHtml = exportShape.messages
    .map((m) => {
      const role = escapeHtml(m.role);
      const ts = m.ts ? `<span style="font-size:11px;color:var(--fg-secondary);margin-left:8px;">${escapeHtml(fmtTs(m.ts))}</span>` : "";
      const content = renderMarkdown(m.content);
      return `<div class="message ${role}"><div class="role">${role}${ts}</div><div class="content">${content}</div></div>`;
    })
    .join("\n");

  const noMessages = exportShape.messages.length === 0
    ? `<div class="message"><div class="content" style="color:var(--fg-secondary);">No messages in this run.</div></div>`
    : "";

  const htmlClass = theme === "dark" ? ' class="dark"' : "";
  // F-028: when a user renamed the run, surface that explicitly next to the
  // upstream event_name so the export is honest about both. Skip either line
  // when missing/identical to the title.
  const displayName = exportShape.display_name?.trim();
  const eventName = exportShape.event_name?.trim();
  const showDisplayName =
    displayName && displayName !== exportShape.title
      ? `<div class="meta">Renamed: ${escapeHtml(displayName)}</div>`
      : "";
  const showEventName =
    eventName && eventName !== exportShape.title && eventName !== displayName
      ? `<div class="meta">Agent: ${escapeHtml(eventName)}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en"${htmlClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${builtinCss}${paletteCss ? "\n" + paletteCss : ""}</style>
</head>
<body>
<header>
<h1>${title}</h1>
${showDisplayName}${showEventName}
<div class="meta">
${model ? `Model: ${model}` : ""}${model && provider ? " · " : ""}${provider ? `Provider: ${provider}` : ""}${model || provider ? " · " : ""}Created: ${created}${created !== updated ? ` · Updated: ${updated}` : ""}
</div>
</header>
<main>
${messagesHtml}${noMessages}
</main>
<footer>Exported from Raindrop Workshop</footer>
</body>
</html>`;
}
