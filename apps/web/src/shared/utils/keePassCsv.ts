export type KeePassCsvEntry = {
  title: string
  username: string
  password: string
  url: string
  note: string
  group: string
}

export type KeePassCsvParseResult = {
  entries: KeePassCsvEntry[]
  skippedRows: number
}

const REQUIRED_HEADER_ALIASES = {
  title: ['title', 'name'],
  username: ['username', 'user', 'userid', 'login', 'loginname'],
  password: ['password', 'pass'],
  url: ['url', 'website', 'webaddress', 'loginurl'],
} as const

const OPTIONAL_HEADER_ALIASES = {
  note: ['note', 'notes', 'comment'],
  group: ['group', 'groupname', 'folder', 'path'],
} as const

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function isBlankRow(row: string[]) {
  return row.every((cell) => cell.trim().length === 0)
}

function parseCsvRows(csvText: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index]

    if (inQuotes) {
      if (char === '"') {
        if (csvText[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }

    if (char === '\r' || char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (char === '\r' && csvText[index + 1] === '\n') {
        index += 1
      }
      continue
    }

    cell += char
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unmatched quote')
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function findHeaderIndex(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header))
}

function readCell(row: string[], index: number) {
  if (index < 0 || index >= row.length) return ''
  return row[index] ?? ''
}

export function parseKeePassCsv(csvTextRaw: string): KeePassCsvParseResult {
  const csvText = csvTextRaw.replace(/^\uFEFF/, '')
  const parsedRows = parseCsvRows(csvText)
  const rows = parsedRows.filter((row) => !isBlankRow(row))

  if (rows.length === 0) {
    throw new Error('CSV file is empty')
  }

  const normalizedHeaders = rows[0].map((header) => normalizeHeader(header))
  const titleIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.title)
  const usernameIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.username)
  const passwordIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.password)
  const urlIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.url)
  const noteIndex = findHeaderIndex(normalizedHeaders, OPTIONAL_HEADER_ALIASES.note)
  const groupIndex = findHeaderIndex(normalizedHeaders, OPTIONAL_HEADER_ALIASES.group)

  if (titleIndex < 0 || usernameIndex < 0 || passwordIndex < 0 || urlIndex < 0) {
    throw new Error('CSV headers are not in KeePass format (expected columns like title,user name,password,url,notes)')
  }

  const entries: KeePassCsvEntry[] = []
  let skippedRows = 0

  for (const row of rows.slice(1)) {
    const title = readCell(row, titleIndex)
    const username = readCell(row, usernameIndex)
    const password = readCell(row, passwordIndex)
    const url = readCell(row, urlIndex)
    const note = readCell(row, noteIndex)
    const group = readCell(row, groupIndex)

    if (!title.trim() && !username.trim() && !password.trim() && !url.trim() && !note.trim() && !group.trim()) {
      skippedRows += 1
      continue
    }

    entries.push({ title, username, password, url, note, group })
  }

  return { entries, skippedRows }
}
