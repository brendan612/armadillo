export type LastPassCsvEntry = {
  title: string
  url: string
  username: string
  password: string
  note: string
  group: string
}

export type LastPassCsvParseResult = {
  entries: LastPassCsvEntry[]
  skippedRows: number
}

const REQUIRED_HEADER_ALIASES = {
  url: ['url', 'uri', 'website'],
  username: ['username', 'user', 'login'],
  password: ['password', 'pass'],
} as const

const OPTIONAL_HEADER_ALIASES = {
  title: ['name', 'title', 'site'],
  note: ['extra', 'note', 'notes', 'comment'],
  group: ['grouping', 'group', 'folder'],
  totp: ['totp', 'otp'],
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

export function parseLastPassCsv(csvTextRaw: string): LastPassCsvParseResult {
  const csvText = csvTextRaw.replace(/^\uFEFF/, '')
  const parsedRows = parseCsvRows(csvText)
  const rows = parsedRows.filter((row) => !isBlankRow(row))

  if (rows.length === 0) {
    throw new Error('CSV file is empty')
  }

  const normalizedHeaders = rows[0].map((header) => normalizeHeader(header))
  const urlIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.url)
  const usernameIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.username)
  const passwordIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.password)
  const titleIndex = findHeaderIndex(normalizedHeaders, OPTIONAL_HEADER_ALIASES.title)
  const noteIndex = findHeaderIndex(normalizedHeaders, OPTIONAL_HEADER_ALIASES.note)
  const groupIndex = findHeaderIndex(normalizedHeaders, OPTIONAL_HEADER_ALIASES.group)
  const totpIndex = findHeaderIndex(normalizedHeaders, OPTIONAL_HEADER_ALIASES.totp)

  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    throw new Error('CSV headers are not in LastPass format (expected columns like url,username,password,extra,name,grouping)')
  }

  const entries: LastPassCsvEntry[] = []
  let skippedRows = 0

  for (const row of rows.slice(1)) {
    const title = readCell(row, titleIndex)
    const url = readCell(row, urlIndex)
    const username = readCell(row, usernameIndex)
    const password = readCell(row, passwordIndex)
    const note = readCell(row, noteIndex)
    const group = readCell(row, groupIndex)
    const totp = readCell(row, totpIndex)

    if (!title.trim() && !url.trim() && !username.trim() && !password.trim() && !note.trim() && !group.trim() && !totp.trim()) {
      skippedRows += 1
      continue
    }

    const normalizedNote = totp.trim()
      ? `${note.trim()}${note.trim() ? '\n\n' : ''}TOTP: ${totp.trim()}`
      : note

    entries.push({
      title,
      url,
      username,
      password,
      note: normalizedNote,
      group,
    })
  }

  return { entries, skippedRows }
}
