'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center justify-center rounded-md p-1 transition-colors hover:bg-blue-400/20 ${className ?? ''}`}
      title="Copy MoltNumber"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-blue-300/60 hover:text-blue-200" />
      )}
    </button>
  );
}
