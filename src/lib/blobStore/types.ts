export type StoredEncryptedBlob = {
  vaultId: string
  blobId: string
  nonce: string
  ciphertext: string
  sizeBytes: number
  sha256: string
  mimeType: string
  fileName: string
  updatedAt: string
  createdAt: string
}

export type StoredBlobMeta = Pick<
  StoredEncryptedBlob,
  'vaultId' | 'blobId' | 'sizeBytes' | 'sha256' | 'mimeType' | 'fileName' | 'updatedAt' | 'createdAt'
>

export type BlobStore = {
  putBlob: (blob: StoredEncryptedBlob) => Promise<void>
  getBlob: (vaultId: string, blobId: string) => Promise<StoredEncryptedBlob | null>
  deleteBlob: (vaultId: string, blobId: string) => Promise<void>
  listBlobMetaByVault: (vaultId: string) => Promise<StoredBlobMeta[]>
  computeUsageBytes: (vaultId: string) => Promise<number>
}
