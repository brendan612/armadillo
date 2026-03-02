import type { BlobStore, StoredBlobMeta, StoredEncryptedBlob } from './types'

const DB_NAME = 'armadillo-blob-cache'
const DB_VERSION = 1
const STORE_NAME = 'blobs'
const VAULT_INDEX = 'by_vault'

type BlobRow = StoredEncryptedBlob & { id: string }

function buildRowId(vaultId: string, blobId: string) {
  return `${vaultId}:${blobId}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Failed opening blob cache'))
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME)
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      store.createIndex(VAULT_INDEX, 'vaultId', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb()
  try {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const result = await run(store)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Blob store transaction failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Blob store transaction aborted'))
    })
    return result
  } finally {
    db.close()
  }
}

function toMeta(row: BlobRow): StoredBlobMeta {
  return {
    vaultId: row.vaultId,
    blobId: row.blobId,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    mimeType: row.mimeType,
    fileName: row.fileName,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }
}

export const indexedDbBlobStore: BlobStore = {
  async putBlob(blob) {
    const row: BlobRow = {
      ...blob,
      id: buildRowId(blob.vaultId, blob.blobId),
    }
    await withStore('readwrite', async (store) => {
      store.put(row)
      return undefined
    })
  },
  async getBlob(vaultId, blobId) {
    const id = buildRowId(vaultId, blobId)
    return withStore('readonly', async (store) => {
      const row = await new Promise<BlobRow | null>((resolve, reject) => {
        const request = store.get(id)
        request.onsuccess = () => resolve((request.result as BlobRow | undefined) ?? null)
        request.onerror = () => reject(request.error ?? new Error('Failed reading blob row'))
      })
      if (!row) return null
      return {
        vaultId: row.vaultId,
        blobId: row.blobId,
        nonce: row.nonce,
        ciphertext: row.ciphertext,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        mimeType: row.mimeType,
        fileName: row.fileName,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      }
    })
  },
  async deleteBlob(vaultId, blobId) {
    const id = buildRowId(vaultId, blobId)
    await withStore('readwrite', async (store) => {
      store.delete(id)
      return undefined
    })
  },
  async listBlobMetaByVault(vaultId) {
    return withStore('readonly', async (store) => {
      const index = store.index(VAULT_INDEX)
      return new Promise<StoredBlobMeta[]>((resolve, reject) => {
        const request = index.getAll(IDBKeyRange.only(vaultId))
        request.onsuccess = () => {
          const rows = ((request.result as BlobRow[]) ?? []).map(toMeta)
          resolve(rows.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)))
        }
        request.onerror = () => reject(request.error ?? new Error('Failed listing blob metadata'))
      })
    })
  },
  async computeUsageBytes(vaultId) {
    const rows = await this.listBlobMetaByVault(vaultId)
    return rows.reduce((total, row) => total + Math.max(0, row.sizeBytes), 0)
  },
}
