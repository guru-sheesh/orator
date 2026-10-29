import { db, DEFAULT_SETTINGS } from './db'

const APP = 'orator'
const FORMAT_VERSION = 1

interface BackupFile {
  app: typeof APP
  formatVersion: number
  schemaVersion: number
  exportedAt: string
  tables: Record<string, unknown[]>
}

export async function exportAllData(): Promise<Blob> {
  const tables: Record<string, unknown[]> = {}
  for (const table of db.tables) tables[table.name] = await table.toArray()

  const file: BackupFile = {
    app: APP,
    formatVersion: FORMAT_VERSION,
    schemaVersion: db.verno,
    exportedAt: new Date().toISOString(),
    tables,
  }
  await markExported()
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
}

export async function markExported() {
  const current = (await db.settings.get('user')) ?? DEFAULT_SETTINGS
  await db.settings.put({ ...current, lastExportAt: Date.now() })
}

/** Replaces everything on this device with the backup's contents. */
export async function importAllData(text: string): Promise<void> {
  let file: BackupFile
  try {
    file = JSON.parse(text)
  } catch {
    throw new Error('This file isn’t valid JSON. Choose a file exported from Orator.')
  }
  if (file?.app !== APP || typeof file.tables !== 'object') {
    throw new Error('This isn’t an Orator backup. Choose a file exported from Settings → Export all data.')
  }
  if (file.schemaVersion > db.verno) {
    throw new Error('This backup comes from a newer version of Orator. Update the app, then try again.')
  }

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
      const rows = file.tables[table.name]
      if (Array.isArray(rows) && rows.length) await table.bulkAdd(rows)
    }
  })
}

export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
}

export function backupFileName(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `orator-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
