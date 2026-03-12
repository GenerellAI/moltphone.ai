'use client';

import { useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  /** Extra classes on the outer Card */
  className?: string;
  children: ReactNode;
}

/**
 * Collapsible settings section — wraps a Card with a clickable header
 * and a chevron toggle. First section should use `defaultOpen={true}`.
 */
export function SettingsSection({ title, icon, defaultOpen = false, className, children }: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={className}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none group">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              {icon}
              {title}
              <ChevronDown className={cn(
                'h-4 w-4 ml-auto text-muted-foreground transition-transform duration-200',
                open && 'rotate-180'
              )} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
