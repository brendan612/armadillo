export type GooglePasswordCsvEntry = {
  name: string
  url: string
  username: string
  password: string
  note: string
}

export type GooglePasswordCsvParseResult = {
  entries: GooglePasswordCsvEntry[]
  skippedRows: number
}

const REQUIRED_HEADER_ALIASES = {
  name: ['name', 'title', 'site'],
  url: ['url', 'website', 'origin', 'loginuri'],
  username: ['username', 'user', 'login', 'email'],
  password: ['password', 'pass'],
} as const

const OPTIONAL_HEADER_ALIASES = {
  note: ['note', 'notes', 'comment'],
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

export function parseGooglePasswordCsv(csvTextRaw: string): GooglePasswordCsvParseResult {
  const csvText = csvTextRaw.replace(/^\uFEFF/, '')
  const parsedRows = parseCsvRows(csvText)
  const rows = parsedRows.filter((row) => !isBlankRow(row))

  if (rows.length === 0) {
    throw new Error('CSV file is empty')
  }

  const normalizedHeaders = rows[0].map((header) => normalizeHeader(header))
  const nameIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.name)
  const urlIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.url)
  const usernameIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.username)
  const passwordIndex = findHeaderIndex(normalizedHeaders, REQUIRED_HEADER_ALIASES.password)
  const noteIndex = findHeaderIndex(normalizedHeaders, OPTIONAL_HEADER_ALIASES.note)

  if (nameIndex < 0 || urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    throw new Error('CSV headers are not in Google Password Manager format (expected columns like name,url,username,password,note)')
  }

  const entries: GooglePasswordCsvEntry[] = []
  let skippedRows = 0

  for (const row of rows.slice(1)) {
    const name = readCell(row, nameIndex)
    const url = readCell(row, urlIndex)
    const username = readCell(row, usernameIndex)
    const password = readCell(row, passwordIndex)
    const note = readCell(row, noteIndex)
    if (!name.trim() && !url.trim() && !username.trim() && !password.trim() && !note.trim()) {
      skippedRows += 1
      continue
    }
    entries.push({ name, url, username, password, note })
  }

  return { entries, skippedRows }
}
