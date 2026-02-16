type KeePassXmlEntry = {
  title: string
  username: string
  password: string
  url: string
  note: string
  group: string
}

type KeePassXmlParseResult = {
  entries: KeePassXmlEntry[]
  skippedRows: number
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function getDirectChildText(parent: Element, tagName: string) {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tagName) {
      return child.textContent?.trim() ?? ''
    }
  }
  return ''
}

function normalizeGroupPath(rawSegments: string[]) {
  const segments = rawSegments.map((segment) => segment.trim()).filter(Boolean)
  if (segments.length === 0) return ''
  if (segments[0]?.toLowerCase() === 'database') {
    segments.shift()
  }
  return segments.join('/')
}

function parseEntry(entryNode: Element, groupPath: string): KeePassXmlEntry | null {
  let title = ''
  let username = ''
  let password = ''
  let url = ''
  let note = ''

  for (const child of Array.from(entryNode.children)) {
    if (child.tagName !== 'String') continue
    const rawKey = getDirectChildText(child, 'Key')
    const value = getDirectChildText(child, 'Value')
    if (!rawKey) continue

    const key = normalizeKey(rawKey)
    if (key === 'title' || key === 'name') {
      title = value
      continue
    }
    if (key === 'username' || key === 'user' || key === 'userid' || key === 'login' || key === 'loginname') {
      username = value
      continue
    }
    if (key === 'password' || key === 'pass') {
      password = value
      continue
    }
    if (key === 'url' || key === 'website' || key === 'webaddress' || key === 'loginurl') {
      url = value
      continue
    }
    if (key === 'notes' || key === 'note' || key === 'comment') {
      note = value
    }
  }

  // Skip metadata/plugin rows that don't contain credential content.
  if (!username.trim() && !password.trim() && !url.trim() && !note.trim()) {
    return null
  }

  return {
    title,
    username,
    password,
    url,
    note,
    group: groupPath,
  }
}

function collectGroupEntries(groupNode: Element, parentSegments: string[], result: KeePassXmlParseResult) {
  const groupName = getDirectChildText(groupNode, 'Name')
  const nextSegments = groupName ? [...parentSegments, groupName] : [...parentSegments]
  const groupPath = normalizeGroupPath(nextSegments)

  for (const child of Array.from(groupNode.children)) {
    if (child.tagName === 'Entry') {
      const parsed = parseEntry(child, groupPath)
      if (!parsed) {
        result.skippedRows += 1
        continue
      }
      result.entries.push(parsed)
      continue
    }
    if (child.tagName === 'Group') {
      collectGroupEntries(child, nextSegments, result)
    }
  }
}

export function parseKeePassXml(xmlTextRaw: string): KeePassXmlParseResult {
  const xmlText = xmlTextRaw.replace(/^\uFEFF/, '').trim()
  if (!xmlText) {
    throw new Error('XML file is empty')
  }

  if (typeof DOMParser === 'undefined') {
    throw new Error('XML parsing is unavailable in this runtime')
  }

  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml')
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Malformed XML')
  }

  const rootNode = xmlDoc.getElementsByTagName('Root')[0]
  if (!rootNode) {
    throw new Error('XML is not in KeePass export format (missing <Root>)')
  }

  const result: KeePassXmlParseResult = {
    entries: [],
    skippedRows: 0,
  }

  const topLevelGroups = Array.from(rootNode.children).filter((child) => child.tagName === 'Group')
  if (topLevelGroups.length === 0) {
    throw new Error('XML is not in KeePass export format (no <Group> entries found)')
  }

  for (const groupNode of topLevelGroups) {
    collectGroupEntries(groupNode, [], result)
  }

  return result
}
