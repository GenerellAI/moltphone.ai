'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Download, Plus, Trash2, BookOpen, ArrowRightLeft } from 'lucide-react';

interface LexiconEntry {
  id: string;
  type: 'vocabulary' | 'correction';
  term: string;
  variant: string;
}

interface LexiconPanelProps {
  agentId: string;
  initialEntries: LexiconEntry[];
  isOwner: boolean;
}

export function LexiconPanel({ agentId, initialEntries, isOwner }: LexiconPanelProps) {
  const [entries, setEntries] = useState<LexiconEntry[]>(initialEntries);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<'vocabulary' | 'correction'>('vocabulary');
  const [newTerm, setNewTerm] = useState('');
  const [newVariant, setNewVariant] = useState('');
  const [saving, setSaving] = useState(false);

  const vocabEntries = entries.filter(e => e.type === 'vocabulary');
  const correctionEntries = entries.filter(e => e.type === 'correction');

  async function handleAdd() {
    if (!newTerm.trim()) return;
    if (newType === 'correction' && !newVariant.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/lexicon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [{ type: newType, term: newTerm.trim(), variant: newType === 'correction' ? newVariant.trim() : '' }],
        }),
      });
      if (res.ok) {
        // Refresh entries
        const listRes = await fetch(`/api/agents/${agentId}/lexicon`);
        if (listRes.ok) {
          const data = await listRes.json();
          setEntries(data.entries);
        }
        setNewTerm('');
        setNewVariant('');
        setAdding(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entryId: string) {
    const res = await fetch(`/api/agents/${agentId}/lexicon/${entryId}`, { method: 'DELETE' });
    if (res.ok) {
      setEntries(prev => prev.filter(e => e.id !== entryId));
    }
  }

  function handleExport(format: string) {
    window.open(`/api/agents/${agentId}/lexicon/export?format=${format}`, '_blank');
  }

  if (entries.length === 0 && !isOwner) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" /> Lexicon Pack
          </CardTitle>
          {entries.length > 0 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => handleExport('wispr-vocab')} title="Download vocabulary CSV for Wispr">
                <Download className="h-3.5 w-3.5 mr-1" /> Vocab
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport('wispr-corrections')} title="Download corrections CSV for Wispr">
                <Download className="h-3.5 w-3.5 mr-1" /> Corrections
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Vocabulary section */}
        {vocabEntries.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Vocabulary</div>
            <div className="flex flex-wrap gap-1.5">
              {vocabEntries.map(e => (
                <Badge key={e.id} variant="secondary" className="text-xs group">
                  {e.term}
                  {isOwner && (
                    <button onClick={() => handleDelete(e.id)} className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Corrections section */}
        {correctionEntries.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Corrections</div>
            <div className="space-y-1">
              {correctionEntries.map(e => (
                <div key={e.id} className="flex items-center gap-2 text-sm group">
                  <code className="text-muted-foreground text-xs">{e.variant}</code>
                  <ArrowRightLeft className="h-3 w-3 text-muted-foreground/50" />
                  <code className="text-primary text-xs font-semibold">{e.term}</code>
                  {isOwner && (
                    <button onClick={() => handleDelete(e.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No lexicon entries yet.</p>
        )}

        {/* Add entry form (owner only) */}
        {isOwner && !adding && (
          <>
            <Separator />
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Entry
            </Button>
          </>
        )}

        {isOwner && adding && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setNewType('vocabulary')}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${newType === 'vocabulary' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
                >
                  Vocabulary
                </button>
                <button
                  onClick={() => setNewType('correction')}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${newType === 'correction' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
                >
                  Correction
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  placeholder={newType === 'vocabulary' ? 'Term (e.g. MoltNumber)' : 'Correct term'}
                  value={newTerm}
                  onChange={e => setNewTerm(e.target.value)}
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
                  maxLength={100}
                />
                {newType === 'correction' && (
                  <input
                    type="text"
                    placeholder="Misspelling (e.g. moltnumber)"
                    value={newVariant}
                    onChange={e => setNewVariant(e.target.value)}
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
                    maxLength={100}
                  />
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={saving || !newTerm.trim()}>
                  {saving ? 'Saving...' : 'Add'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setNewTerm(''); setNewVariant(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
