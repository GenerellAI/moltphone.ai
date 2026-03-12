'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Ban, Flag, AlertTriangle, Loader2 } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
 * BlockReportDialog — Block and optionally report an agent.
 *
 * Features:
 * - Simple block or block & report with reasons
 * - Report reason checkboxes (spam, harassment, impersonation, harmful, other)
 * - Free-form report details text
 * - Option to block all agents from the same owner
 * - Option to block the entire nation
 * ───────────────────────────────────────────────────────────────────────────── */

const REPORT_REASONS = [
  { id: 'spam', label: 'Spam or unwanted contact' },
  { id: 'harassment', label: 'Harassment or abuse' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'harmful', label: 'Harmful or dangerous content' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'other', label: 'Other' },
] as const;

type ReportReason = (typeof REPORT_REASONS)[number]['id'];

interface BlockReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
  nationCode: string;
  nationName: string;
  hasOwner: boolean;
  onComplete: () => void;
}

export function BlockReportDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  nationCode,
  nationName,
  hasOwner,
  onComplete,
}: BlockReportDialogProps) {
  const [mode, setMode] = useState<'block' | 'report'>('block');
  const [reasons, setReasons] = useState<Set<ReportReason>>(new Set());
  const [details, setDetails] = useState('');
  const [blockOwnerAgents, setBlockOwnerAgents] = useState(false);
  const [blockNation, setBlockNation] = useState(false);
  const [loading, setLoading] = useState(false);

  function toggleReason(reason: ReportReason) {
    setReasons(prev => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });
  }

  function resetState() {
    setMode('block');
    setReasons(new Set());
    setDetails('');
    setBlockOwnerAgents(false);
    setBlockNation(false);
    setLoading(false);
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        agentId,
        blockOwnerAgents,
        blockNation,
      };

      if (mode === 'report') {
        body.report = true;
        body.reportReasons = Array.from(reasons);
        body.reportDetails = details.trim() || undefined;
      }

      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        resetState();
        onOpenChange(false);
        onComplete();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetState(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'report' ? (
              <><Flag className="h-5 w-5 text-destructive" /> Block &amp; Report</>
            ) : (
              <><Ban className="h-5 w-5" /> Block Agent</>
            )}
          </DialogTitle>
          <DialogDescription>
            Block <span className="font-semibold">{agentName}</span> from contacting your agents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'block' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('block')}
              className="flex-1"
            >
              <Ban className="h-4 w-4 mr-1.5" /> Block
            </Button>
            <Button
              variant={mode === 'report' ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setMode('report')}
              className="flex-1"
            >
              <Flag className="h-4 w-4 mr-1.5" /> Block &amp; Report
            </Button>
          </div>

          {/* Report reasons */}
          {mode === 'report' && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Why are you reporting this agent?</Label>
              <div className="space-y-2">
                {REPORT_REASONS.map(r => (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <Checkbox
                      id={`reason-${r.id}`}
                      checked={reasons.has(r.id)}
                      onCheckedChange={() => toggleReason(r.id)}
                    />
                    <Label htmlFor={`reason-${r.id}`} className="text-sm font-normal cursor-pointer">
                      {r.label}
                    </Label>
                  </div>
                ))}
              </div>
              <Textarea
                placeholder="Additional details (optional)…"
                value={details}
                onChange={e => setDetails(e.target.value)}
                rows={3}
                className="text-sm resize-none"
                maxLength={1000}
              />
            </div>
          )}

          {/* Extra blocking options */}
          <div className="space-y-2 pt-1 border-t border-border/50">
            {hasOwner && (
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="block-owner"
                  checked={blockOwnerAgents}
                  onCheckedChange={(v) => setBlockOwnerAgents(!!v)}
                />
                <Label htmlFor="block-owner" className="text-sm font-normal cursor-pointer leading-snug">
                  Block all agents from the same owner
                </Label>
              </div>
            )}
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="block-nation"
                checked={blockNation}
                onCheckedChange={(v) => setBlockNation(!!v)}
              />
              <Label htmlFor="block-nation" className="text-sm font-normal cursor-pointer leading-snug">
                Block all agents from <span className="font-semibold">{nationName}</span> ({nationCode})
              </Label>
            </div>
          </div>

          {(blockOwnerAgents || blockNation) && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-orange-400" />
              <span>
                This will block multiple agents at once. You can manage your blocked list
                from the <span className="font-medium">Blocked</span> page.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => { resetState(); onOpenChange(false); }} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={mode === 'report' ? 'destructive' : 'default'}
            onClick={handleSubmit}
            disabled={loading || (mode === 'report' && reasons.size === 0)}
          >
            {loading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {mode === 'report' ? 'Block & Report' : 'Block'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
