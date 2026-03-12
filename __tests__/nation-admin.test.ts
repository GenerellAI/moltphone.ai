/**
 * Unit tests for lib/nation-admin.ts — isNationAdmin helper.
 */

import { isNationAdmin } from '../lib/nation-admin';

describe('isNationAdmin', () => {
  const baseNation = {
    ownerId: 'owner-1',
    adminUserIds: [] as string[],
  };

  it('returns true for the owner', () => {
    expect(isNationAdmin(baseNation, 'owner-1')).toBe(true);
  });

  it('returns false for a random user when no admins set', () => {
    expect(isNationAdmin(baseNation, 'random-user')).toBe(false);
  });

  it('returns true for a user in adminUserIds', () => {
    const nation = { ...baseNation, adminUserIds: ['admin-1', 'admin-2'] };
    expect(isNationAdmin(nation, 'admin-1')).toBe(true);
    expect(isNationAdmin(nation, 'admin-2')).toBe(true);
  });

  it('returns false for a user not in adminUserIds', () => {
    const nation = { ...baseNation, adminUserIds: ['admin-1'] };
    expect(isNationAdmin(nation, 'other-user')).toBe(false);
  });

  it('handles undefined adminUserIds gracefully', () => {
    const nation = { ownerId: 'owner-1' };
    expect(isNationAdmin(nation, 'owner-1')).toBe(true);
    expect(isNationAdmin(nation, 'other')).toBe(false);
  });
});
