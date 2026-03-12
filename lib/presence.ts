export const PRESENCE_TTL_SECONDS = parseInt(process.env.PRESENCE_TTL_SECONDS || '300', 10);

export function isOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false;
  const elapsed = (Date.now() - lastSeenAt.getTime()) / 1000;
  return elapsed <= PRESENCE_TTL_SECONDS;
}
