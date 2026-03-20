import { createHighlighter, type BundledLanguage } from "shiki";

type DiffViewProps = {
  patch: string;
  filename: string;
};

type DiffKind = "add" | "remove" | "context" | "hunk";

type ParsedLine = {
  key: string;
  kind: DiffKind;
  text: string;
};

type HighlightedToken = {
  content: string;
  color?: string;
  fontStyle: number;
};

const supportedLangs: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "markdown",
  "yaml",
  "toml",
  "sql",
  "bash",
  "shellscript",
  "css",
  "scss",
  "html",
  "xml",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
];

const highlighterPromise = createHighlighter({
  themes: ["github-dark"],
  langs: supportedLangs,
});

function inferLanguage(filename: string): BundledLanguage | null {
  const normalized = filename.toLowerCase();
  const base = normalized.split("/").pop() ?? normalized;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";

  if (base === "dockerfile") return "bash";
  if (ext === "ts") return "typescript";
  if (ext === "tsx") return "tsx";
  if (ext === "js") return "javascript";
  if (ext === "jsx") return "jsx";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "mdx") return "markdown";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "toml") return "toml";
  if (ext === "sql") return "sql";
  if (ext === "sh" || ext === "bash") return "bash";
  if (ext === "zsh") return "shellscript";
  if (ext === "css") return "css";
  if (ext === "scss") return "scss";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "xml") return "xml";
  if (ext === "py") return "python";
  if (ext === "go") return "go";
  if (ext === "rs") return "rust";
  if (ext === "java") return "java";
  if (ext === "c") return "c";
  if (ext === "cc" || ext === "cpp" || ext === "cxx" || ext === "hpp" || ext === "h") return "cpp";

  return null;
}

async function highlightLineTokens(
  line: string,
  language: BundledLanguage | null,
): Promise<HighlightedToken[]> {
  const content = line.length === 0 ? " " : line;

  if (!language) {
    return [{ content, fontStyle: 0 }];
  }

  const highlighter = await highlighterPromise;
  const result = highlighter.codeToTokens(content, {
    lang: language,
    theme: "github-dark",
  });

  return (result.tokens[0] ?? []).map((token) => ({
    content: token.content,
    color: token.color,
    fontStyle: token.fontStyle ?? 0,
  }));
}

function isHunkHeader(line: string): boolean {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line);
}

function parsePatch(patch: string): ParsedLine[] {
  const rows: ParsedLine[] = [];
  const lines = patch.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\r$/, "");

    if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("---") || raw.startsWith("+++")) {
      continue;
    }

    if (isHunkHeader(raw)) {
      rows.push({ key: `${index}-hunk`, kind: "hunk", text: raw });
      continue;
    }

    if (raw.startsWith("+")) {
      rows.push({ key: `${index}-add`, kind: "add", text: raw.slice(1) });
      continue;
    }

    if (raw.startsWith("-")) {
      rows.push({ key: `${index}-remove`, kind: "remove", text: raw.slice(1) });
      continue;
    }

    rows.push({
      key: `${index}-context`,
      kind: "context",
      text: raw.startsWith(" ") ? raw.slice(1) : raw,
    });
  }

  return rows;
}

function rowStyle(kind: DiffKind): {
  backgroundColor?: string;
  color?: string;
  boxShadow?: string;
} {
  if (kind === "add") {
    return {
      backgroundColor: "rgba(46, 160, 67, 0.40)",
      boxShadow: "inset 3px 0 0 rgba(46,160,67,0.95)",
    };
  }
  if (kind === "remove") {
    return {
      backgroundColor: "rgba(248, 81, 73, 0.40)",
      boxShadow: "inset 3px 0 0 rgba(248,81,73,0.95)",
    };
  }
  if (kind === "hunk") {
    return { backgroundColor: "rgba(56, 139, 253, 0.20)", color: "#60a5fa" };
  }
  return {};
}

function tokenStyle(fontStyle: number): {
  color?: string;
  fontStyle?: "italic";
  fontWeight?: number;
  textDecoration?: "underline";
} {
  if (fontStyle === 0) {
    return {};
  }

  return {
    fontStyle: (fontStyle & 1) === 0 ? undefined : "italic",
    fontWeight: (fontStyle & 2) === 0 ? undefined : 700,
    textDecoration: (fontStyle & 4) === 0 ? undefined : "underline",
  };
}

export async function DiffView(props: DiffViewProps) {
  const rows = parsePatch(props.patch);
  const language = inferLanguage(props.filename);
  const highlightedRows = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      tokens: await highlightLineTokens(row.text, row.kind === "hunk" ? null : language),
    })),
  );

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border-subtle bg-base">
      {highlightedRows.map((row) => (
        <div
          key={row.key}
          className="min-w-[720px] whitespace-pre px-3 py-0.5 font-mono text-xs leading-5 text-heading"
          style={{ ...rowStyle(row.kind), tabSize: 2 }}
        >
          {row.tokens.map((token, index) => (
            <span
              key={`${row.key}-${index}`}
              style={{ color: token.color, ...tokenStyle(token.fontStyle) }}
            >
              {token.content}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
