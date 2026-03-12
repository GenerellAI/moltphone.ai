/**
 * Nation ownership helpers.
 *
 * Centralizes the "is this user allowed to manage this nation?" check.
 * A user is a nation admin if they are the owner OR listed in adminUserIds.
 */

interface NationLike {
  ownerId: string;
  adminUserIds?: string[];
}

/**
 * Returns true if the user is the nation owner or a nation admin.
 * Admins share management rights (settings, members, delegations, keypair,
 * domain verification) but cannot transfer ownership.
 */
export function isNationAdmin(nation: NationLike, userId: string): boolean {
  if (nation.ownerId === userId) return true;
  if (nation.adminUserIds?.includes(userId)) return true;
  return false;
}
