export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

export type InviteEmailContentInput = {
  appUrl: string
  orgName: string
  inviterLabel: string
  inviteeEmail: string
  role: Role
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isValidInviteEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeInviteEmail(email))
}

export function buildPendingInviteMemberId(email: string) {
  return `invite:${normalizeInviteEmail(email)}`
}

export function buildInviteEmailContent(input: InviteEmailContentInput) {
  const appUrl = normalizeUrl(input.appUrl)
  const orgName = input.orgName.trim() || 'your organization'
  const inviterLabel = input.inviterLabel.trim() || 'An Armadillo admin'
  const inviteeEmail = normalizeInviteEmail(input.inviteeEmail)
  const role = input.role
  const subject = `You're invited to join ${orgName} on Armadillo`
  const text = [
    `You've been invited to join ${orgName} on Armadillo as a ${role}.`,
    '',
    `${inviterLabel} sent this invite to ${inviteeEmail}.`,
    `Open Armadillo and sign in with ${inviteeEmail} to join automatically.`,
    '',
    `Open Armadillo: ${appUrl}`,
  ].join('\n')

  const escapedOrgName = escapeHtml(orgName)
  const escapedInviterLabel = escapeHtml(inviterLabel)
  const escapedInviteeEmail = escapeHtml(inviteeEmail)
  const escapedRole = escapeHtml(role)
  const escapedAppUrl = escapeHtml(appUrl)
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">',
    `<h2 style="margin:0 0 16px;">You're invited to join ${escapedOrgName}</h2>`,
    `<p style="margin:0 0 12px;">${escapedInviterLabel} invited <strong>${escapedInviteeEmail}</strong> to join Armadillo as a <strong>${escapedRole}</strong>.</p>`,
    `<p style="margin:0 0 16px;">Sign in with <strong>${escapedInviteeEmail}</strong> and your membership will be claimed automatically.</p>`,
    `<p style="margin:0 0 16px;"><a href="${escapedAppUrl}" style="display:inline-block;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;">Open Armadillo</a></p>`,
    `<p style="margin:0;color:#4b5563;font-size:14px;">If the button does not work, open: ${escapedAppUrl}</p>`,
    '</div>',
  ].join('')

  return { subject, text, html }
}
