import { describe, expect, it } from 'vitest';
import type { GroupEntryPayload, GroupInvitationPayload, GroupManagePayload, GroupResultPayload } from '../src/shared/contracts';
import { issueGroupEntry, issueGroupInvitation, issueGroupManage, issueGroupResult, readGroupEntry, readGroupInvitation, readGroupManage, readGroupResult } from '../src/worker/capabilities/tokens';

const secret = 'test-secret-that-is-longer-than-thirty-two-characters';
const video = { source: 'bilibili' as const, bvid: 'BV1B7411m7LV', cid: 12, page: 1, title: '群组视频', description: '', cover: '', duration: 60 };
const invitation: GroupInvitationPayload = { v: 1, kind: 'group-invitation', groupId: 'group-1', video, createdAt: 100, expiresAt: 200, resultExpiresAt: 300, nonce: 'invite', mode: 'group' };
const result: GroupResultPayload = { v: 1, kind: 'group-result', groupId: invitation.groupId, video, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, resultExpiresAt: invitation.resultExpiresAt, nonce: 'result' };
const manage: GroupManagePayload = { v: 1, kind: 'group-manage', groupId: invitation.groupId, video, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, resultExpiresAt: invitation.resultExpiresAt, nonce: 'manage' };
const entry: GroupEntryPayload = { v: 1, kind: 'group-entry', groupId: invitation.groupId, video, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, resultExpiresAt: invitation.resultExpiresAt, nonce: 'entry', mode: 'group', initiator: '发起者', message: '一起看' };

describe('group capabilities', () => {
  it('round-trips separate invitation, result and manage namespaces', async () => {
    const invitationToken = await issueGroupInvitation(invitation, secret);
    const resultToken = await issueGroupResult(result, secret);
    const manageToken = await issueGroupManage(manage, secret);
    await expect(readGroupInvitation(invitationToken, secret, 150)).resolves.toEqual(invitation);
    await expect(readGroupResult(resultToken, secret, 250)).resolves.toEqual(result);
    await expect(readGroupManage(manageToken, secret)).resolves.toEqual(manage);
    await expect(readGroupResult(invitationToken, secret, 150)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(readGroupInvitation(resultToken, secret, 150)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('keeps a universal entry capability public through result retention without making it an invitation', async () => {
    const entryToken = await issueGroupEntry(entry, secret);
    await expect(readGroupEntry(entryToken, secret, 250)).resolves.toEqual(entry);
    await expect(readGroupEntry(entryToken, secret, 300)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    await expect(readGroupInvitation(entryToken, secret, 150)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(readGroupResult(entryToken, secret, 150)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('keeps the result window available after the participation window', async () => {
    const invitationToken = await issueGroupInvitation(invitation, secret);
    const resultToken = await issueGroupResult(result, secret);
    await expect(readGroupInvitation(invitationToken, secret, 200)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    await expect(readGroupResult(resultToken, secret, 200)).resolves.toMatchObject({ groupId: invitation.groupId });
    await expect(readGroupResult(resultToken, secret, 300)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
});
