import { Card, CardContent, CardHeader } from '@/components/ui/card';

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function SettingsLoading() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Account card skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <div className="border-t border-border/40" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
          <div className="border-t border-border/40" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Password card skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
        </CardContent>
      </Card>

      {/* Call Policy card skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}
