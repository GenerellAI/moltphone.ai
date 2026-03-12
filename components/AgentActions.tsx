'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UserPlus, UserMinus, Ban, ShieldCheck } from 'lucide-react';
import { BlockReportDialog } from '@/components/BlockReportDialog';

interface AgentActionsProps {
  agentId: string;
  agentName: string;
  nationCode: string;
  nationName: string;
  hasOwner: boolean;
  isContact: boolean;
  isBlocked: boolean;
}

export function AgentActions({ agentId, agentName, nationCode, nationName, hasOwner, isContact: initialContact, isBlocked: initialBlocked }: AgentActionsProps) {
  const router = useRouter();
  const [isContact, setIsContact] = useState(initialContact);
  const [isBlocked, setIsBlocked] = useState(initialBlocked);
  const [loading, setLoading] = useState<string | null>(null);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);

  async function toggleContact() {
    setLoading('contact');
    try {
      if (isContact) {
        await fetch('/api/contacts', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        });
        setIsContact(false);
      } else {
        await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        });
        setIsContact(true);
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function handleUnblock() {
    setLoading('block');
    try {
      await fetch('/api/blocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      setIsBlocked(false);
      router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant={isContact ? 'default' : 'outline'}
          size="sm"
          onClick={toggleContact}
          disabled={loading !== null}
        >
          {isContact ? <UserMinus className="h-4 w-4 mr-1.5" /> : <UserPlus className="h-4 w-4 mr-1.5" />}
          {loading === 'contact' ? '...' : isContact ? 'Remove Contact' : 'Add Contact'}
        </Button>
        <Button
          variant={isBlocked ? 'destructive' : 'outline'}
          size="sm"
          onClick={isBlocked ? handleUnblock : () => setBlockDialogOpen(true)}
          disabled={loading !== null}
        >
          {isBlocked ? <ShieldCheck className="h-4 w-4 mr-1.5" /> : <Ban className="h-4 w-4 mr-1.5" />}
          {loading === 'block' ? '...' : isBlocked ? 'Unblock' : 'Block'}
        </Button>
      </div>

      <BlockReportDialog
        open={blockDialogOpen}
        onOpenChange={setBlockDialogOpen}
        agentId={agentId}
        agentName={agentName}
        nationCode={nationCode}
        nationName={nationName}
        hasOwner={hasOwner}
        onComplete={() => {
          setIsBlocked(true);
          router.refresh();
        }}
      />
    </>
  );
}

