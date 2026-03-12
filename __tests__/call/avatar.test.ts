/**
 * Integration tests for POST/DELETE /call/:moltNumber/avatar.
 *
 * Tests: Ed25519 auth, file upload validation, nonce replay,
 * size limits, MIME type checks, avatar removal.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest } from 'next/server';
import {
  buildMockAgent,
  resetAgentCounter,
} from '../helpers/setup';
import { signRequest } from '../../lib/ed25519';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock storage layer
const mockUploadFile = jest.fn().mockResolvedValue('/avatars/test.png');
const mockDeleteFile = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/storage', () => ({
  uploadFile: (...args: any[]) => mockUploadFile(...args),
  deleteFile: (...args: any[]) => mockDeleteFile(...args),
}));

// Mock nonce replay check
const mockIsNonceReplay = jest.fn().mockResolvedValue(false);
jest.mock('@/lib/nonce', () => ({
  isNonceReplay: (...args: any[]) => mockIsNonceReplay(...args),
}));

// ── Import route ─────────────────────────────────────────

import { POST as uploadAvatar, DELETE as deleteAvatar } from '../../app/call/[moltNumber]/avatar/route';

// ── Helpers ──────────────────────────────────────────────

function buildSignedAvatarRequest(
  method: string,
  agent: ReturnType<typeof buildMockAgent>,
  formData?: FormData,
) {
  const moltNumber = agent.moltNumber;
  const canonicalPath = `/call/${moltNumber}/avatar`;

  const signed = signRequest({
    method,
    path: canonicalPath,
    callerAgentId: moltNumber,
    targetAgentId: moltNumber,
    body: '', // Binary upload — empty body for sig
    privateKey: agent._keyPair.privateKey,
  });

  const url = new URL(`/call/${moltNumber}/avatar`, 'http://localhost:3000');

  const init: RequestInit = {
    method,
    headers: {
      ...signed,
      // Don't set Content-Type for FormData — browser sets it with boundary
    },
  };

  if (formData) {
    init.body = formData;
  }

  return new NextRequest(url, init as any);
}

function createMockFile(
  name: string,
  sizeBytes: number,
  type: string,
): File {
  const buffer = new Uint8Array(sizeBytes).fill(0xFF);
  return new File([buffer], name, { type });
}

// ── Setup ────────────────────────────────────────────────

let testAgent: ReturnType<typeof buildMockAgent>;

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  testAgent = buildMockAgent();
  mockPrisma.agent.findUnique.mockResolvedValue(testAgent);
  mockPrisma.agent.update.mockResolvedValue({ ...testAgent, avatarUrl: `/avatars/${testAgent.id}.png` });
  mockUploadFile.mockImplementation((key: string) => Promise.resolve(`/${key}`));
  mockIsNonceReplay.mockResolvedValue(false);
});

// ══════════════════════════════════════════════════════════
// ── POST /call/:moltNumber/avatar ───────────────────────
// ══════════════════════════════════════════════════════════

describe('POST /call/:moltNumber/avatar', () => {
  it('uploads a valid PNG avatar', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('avatar.png', 1024, 'image/png'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.avatarUrl).toContain(`/avatars/${testAgent.id}`);
    expect(body.avatarUrl).toContain('.png');
  });

  it('calls uploadFile with correct key and mime type', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('avatar.png', 1024, 'image/png'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledWith(
      `avatars/${testAgent.id}.png`,
      expect.any(Buffer),
      'image/png',
    );
  });

  it('passes file buffer to uploadFile', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('avatar.png', 512, 'image/png'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    const [key, buf] = mockUploadFile.mock.calls[0];
    expect(key).toContain(testAgent.id);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(512);
  });

  it('updates avatarUrl in database', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('avatar.jpg', 1024, 'image/jpeg'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(mockPrisma.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: testAgent.id },
        data: { avatarUrl: expect.stringContaining('/avatars/') },
      }),
    );
  });

  it('accepts JPEG', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('photo.jpg', 1024, 'image/jpeg'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatarUrl).toContain('.jpg');
  });

  it('accepts WebP', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('photo.webp', 1024, 'image/webp'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatarUrl).toContain('.webp');
  });

  it('accepts GIF', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('photo.gif', 1024, 'image/gif'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatarUrl).toContain('.gif');
  });

  it('rejects files over 256 KB', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('big.png', 257 * 1024, 'image/png'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('too large');
  });

  it('rejects unsupported MIME types', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('doc.pdf', 1024, 'application/pdf'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Unsupported type');
  });

  it('rejects missing file field', async () => {
    const formData = new FormData();
    // No file appended

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Missing file');
  });

  it('rejects unknown agent (404)', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.append('file', createMockFile('avatar.png', 1024, 'image/png'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(res.status).toBe(404);
  });

  it('rejects request from different caller', async () => {
    // Agent exists, but caller header doesn't match
    const otherAgent = buildMockAgent();

    const moltNumber = testAgent.moltNumber;
    const canonicalPath = `/call/${moltNumber}/avatar`;

    const signed = signRequest({
      method: 'POST',
      path: canonicalPath,
      callerAgentId: otherAgent.moltNumber, // Different caller!
      targetAgentId: moltNumber,
      body: '',
      privateKey: otherAgent._keyPair.privateKey,
    });

    const formData = new FormData();
    formData.append('file', createMockFile('avatar.png', 1024, 'image/png'));

    const url = new URL(`/call/${moltNumber}/avatar`, 'http://localhost:3000');
    const req = new NextRequest(url, {
      method: 'POST',
      headers: { ...signed },
      body: formData,
    });

    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber }) });

    expect(res.status).toBe(403);
  });

  it('rejects nonce replay', async () => {
    mockIsNonceReplay.mockResolvedValue(true);

    const formData = new FormData();
    formData.append('file', createMockFile('avatar.png', 1024, 'image/png'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    const res = await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(res.status).toBe(401);
  });

  it('checks nonce replay on every request', async () => {
    const formData = new FormData();
    formData.append('file', createMockFile('avatar.png', 1024, 'image/png'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(mockIsNonceReplay).toHaveBeenCalledTimes(1);
    expect(mockIsNonceReplay).toHaveBeenCalledWith(expect.stringContaining(':'));
  });

  it('deletes old avatar when replacing', async () => {
    // Agent already has an avatar
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...testAgent,
      avatarUrl: '/avatars/old-avatar.png',
    });

    const formData = new FormData();
    formData.append('file', createMockFile('new.jpg', 1024, 'image/jpeg'));

    const req = buildSignedAvatarRequest('POST', testAgent, formData);
    await uploadAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(mockDeleteFile).toHaveBeenCalledWith('/avatars/old-avatar.png');
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════
// ── DELETE /call/:moltNumber/avatar ─────────────────────
// ══════════════════════════════════════════════════════════

describe('DELETE /call/:moltNumber/avatar', () => {
  it('removes avatar via storage and clears database', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...testAgent,
      avatarUrl: `/avatars/${testAgent.id}.png`,
    });

    const req = buildSignedAvatarRequest('DELETE', testAgent);
    const res = await deleteAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.avatarUrl).toBeNull();
    expect(mockDeleteFile).toHaveBeenCalledWith(`/avatars/${testAgent.id}.png`);
    expect(mockPrisma.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { avatarUrl: null },
      }),
    );
  });

  it('succeeds even if no avatar exists (idempotent)', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      ...testAgent,
      avatarUrl: null,
    });

    const req = buildSignedAvatarRequest('DELETE', testAgent);
    const res = await deleteAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(res.status).toBe(200);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('requires Ed25519 authentication', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildSignedAvatarRequest('DELETE', testAgent);
    const res = await deleteAvatar(req, { params: Promise.resolve({ moltNumber: testAgent.moltNumber }) });

    expect(res.status).toBe(404);
  });
});
