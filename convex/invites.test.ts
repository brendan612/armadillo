import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInviteEmailContent,
  buildPendingInviteMemberId,
  isValidInviteEmail,
  normalizeInviteEmail,
} from './invites.ts'

test('invite helpers normalize invite email addresses', () => {
  assert.equal(normalizeInviteEmail('  Member@Example.com '), 'member@example.com')
  assert.equal(buildPendingInviteMemberId('Member@Example.com'), 'invite:member@example.com')
  assert.equal(isValidInviteEmail('member@example.com'), true)
  assert.equal(isValidInviteEmail('memberexample.com'), false)
})

test('invite email content includes org, role, app url, and sign-in instructions', () => {
  const content = buildInviteEmailContent({
    appUrl: 'https://app.armadillo.test/',
    orgName: 'Acme Security',
    inviterLabel: 'Pat Admin',
    inviteeEmail: 'member@example.com',
    role: 'admin',
  })

  assert.equal(content.subject, "You're invited to join Acme Security on Armadillo")
  assert.match(content.text, /sign in with member@example\.com/i)
  assert.match(content.text, /https:\/\/app\.armadillo\.test/i)
  assert.match(content.html, /Acme Security/)
  assert.match(content.html, /Pat Admin/)
  assert.match(content.html, /member@example\.com/)
  assert.match(content.html, /Open Armadillo/)
})
