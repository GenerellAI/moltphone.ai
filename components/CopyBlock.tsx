'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

type CopyBlockLanguage =
  | 'auto'
  | 'text'
  | 'typescript'
  | 'python'
  | 'bash'
  | 'json'
  | 'yaml';

const TOKEN_CLASS = {
  plain: 'text-slate-100',
  comment: 'text-slate-500 italic',
  keyword: 'text-[#ff8a6c]',
  string: 'text-cyan-300',
  number: 'text-sky-300',
  key: 'text-[#7dd3fc]',
  command: 'text-[#93c5fd]',
  flag: 'text-[#fdba74]',
  builtin: 'text-[#c4b5fd]',
  variable: 'text-[#f9a8d4]',
};

const LANGUAGE_PATTERN: Record<Exclude<CopyBlockLanguage, 'auto' | 'text'>, RegExp> = {
  typescript:
    /\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|from|as|const|let|var|async|await|return|if|else|for|while|new|function|class|export|default|try|catch|throw|interface|type|extends|implements)\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b/gm,
  python:
    /#.*$|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|class|import|from|if|elif|else|for|while|try|except|return|with|as|in|pass)\b|\b(?:True|False|None)\b|\b\d+(?:\.\d+)?\b/gm,
  bash:
    /#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$\([^)]+\)|\$[A-Z_][A-Z0-9_]*|--?[a-zA-Z][\w-]*|\b(?:curl|npm|npx|pip|python3|node|export|echo|cat|tsx|date|openssl|install)\b|\b\d+\b/gm,
  json:
    /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b/gm,
  yaml:
    /#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_.-]*(?=\s*:)/gm,
};

const LANGUAGE_LABEL = {
  text: 'text',
  typescript: 'ts',
  python: 'py',
  bash: 'sh',
  json: 'json',
  yaml: 'yaml',
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function detectLanguage(code: string): Exclude<CopyBlockLanguage, 'auto'> {
  const trimmed = code.trim();

  if (!trimmed) return 'text';
  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    /":\s*|"\s*,|\btrue\b|\bfalse\b|\bnull\b/.test(trimmed)
  ) {
    return 'json';
  }
  if (
    /(^|\n)\s*[A-Za-z_][A-Za-z0-9_.-]*:\s/m.test(trimmed) &&
    /(services:|image:|ports:|environment:|volumes:|command:)/.test(trimmed)
  ) {
    return 'yaml';
  }
  if (/^curl\b|^npm\b|^npx\b|^pip\b|^\s*-\w|^\s*-H\b/m.test(trimmed)) {
    return 'bash';
  }
  if (/\bdef\b|\bfrom\s+\w+\s+import\b|\bHTTPServer\b/.test(trimmed)) {
    return 'python';
  }
  if (
    /\bimport\b|\bconst\b|\blet\b|\basync\b|\bawait\b|\binterface\b|\btype\b/.test(
      trimmed
    )
  ) {
    return 'typescript';
  }

  return 'text';
}

function getTokenClass(
  language: Exclude<CopyBlockLanguage, 'auto' | 'text'>,
  token: string,
  code: string,
  index: number
) {
  if (
    token.startsWith('//') ||
    token.startsWith('/*') ||
    token.startsWith('#') ||
    token.startsWith('"""') ||
    token.startsWith("'''")
  ) {
    return TOKEN_CLASS.comment;
  }

  if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
    if (language === 'json' || language === 'yaml') {
      const nextChunk = code.slice(index + token.length);
      const nextNonWhitespace = nextChunk.match(/\S/)?.[0];
      if (nextNonWhitespace === ':') {
        return TOKEN_CLASS.key;
      }
    }
    return TOKEN_CLASS.string;
  }

  if (/^-?\d/.test(token)) {
    return TOKEN_CLASS.number;
  }

  if (language === 'bash') {
    if (token.startsWith('--') || (token.startsWith('-') && token.length > 1)) {
      return TOKEN_CLASS.flag;
    }
    if (token.startsWith('$')) {
      return TOKEN_CLASS.variable;
    }
    if (
      /^(curl|npm|npx|pip|python3|node|export|echo|cat|tsx|date|openssl|install)$/.test(
        token
      )
    ) {
      return TOKEN_CLASS.command;
    }
  }

  if (language === 'typescript') {
    if (
      /^(import|from|as|const|let|var|async|await|return|if|else|for|while|new|function|class|export|default|try|catch|throw|interface|type|extends|implements)$/.test(
        token
      )
    ) {
      return TOKEN_CLASS.keyword;
    }
    if (/^(true|false|null|undefined)$/.test(token)) {
      return TOKEN_CLASS.builtin;
    }
  }

  if (language === 'python') {
    if (
      /^(def|class|import|from|if|elif|else|for|while|try|except|return|with|as|in|pass)$/.test(
        token
      )
    ) {
      return TOKEN_CLASS.keyword;
    }
    if (/^(True|False|None)$/.test(token)) {
      return TOKEN_CLASS.builtin;
    }
  }

  if (language === 'json' || language === 'yaml') {
    if (/^(true|false|null)$/.test(token)) {
      return TOKEN_CLASS.builtin;
    }
    if (language === 'yaml') {
      return TOKEN_CLASS.key;
    }
  }

  return TOKEN_CLASS.plain;
}

function highlightCode(code: string, language: CopyBlockLanguage) {
  const resolvedLanguage =
    language === 'auto' ? detectLanguage(code) : language;

  if (resolvedLanguage === 'text') {
    return {
      language: resolvedLanguage,
      html: escapeHtml(code),
    };
  }

  const pattern = LANGUAGE_PATTERN[resolvedLanguage];
  let html = '';
  let lastIndex = 0;

  for (const match of code.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    html += escapeHtml(code.slice(lastIndex, index));
    html += `<span class="${getTokenClass(
      resolvedLanguage,
      token,
      code,
      index
    )}">${escapeHtml(token)}</span>`;
    lastIndex = index + token.length;
  }

  html += escapeHtml(code.slice(lastIndex));

  return {
    language: resolvedLanguage,
    html,
  };
}

/**
 * A code block with a copy-to-clipboard button.
 * Use as a drop-in replacement for <pre> in server-rendered pages.
 */
export function CopyBlock({
  code,
  className,
  language = 'auto',
}: {
  code: string;
  className?: string;
  language?: CopyBlockLanguage;
}) {
  const [copied, setCopied] = useState(false);
  const highlighted = highlightCode(code, language);
  const showLanguageLabel = highlighted.language !== 'text';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group overflow-hidden rounded-xl border border-primary/15 bg-[linear-gradient(180deg,rgba(7,20,37,0.96),rgba(4,12,24,0.98))] shadow-[0_16px_40px_rgba(3,10,25,0.35)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      {showLanguageLabel ? (
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/75">
            {LANGUAGE_LABEL[highlighted.language]}
          </span>
        </div>
      ) : null}
      <pre
        className={`overflow-x-auto px-4 py-4 text-sm font-mono leading-relaxed [tab-size:2] ${className ?? ''}`}
      >
        <code dangerouslySetInnerHTML={{ __html: highlighted.html }} />
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2.5 right-3 p-1.5 rounded-md bg-[#0b1b33]/85 border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#102443]"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-400" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
