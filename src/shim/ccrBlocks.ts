export interface CcrBlockRow {
  principalId: string;
  hash: string;
  content: string;
  bytes: number;
  chars: number;
  lines: number;
  contentType: string;
  source: string;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
}

const store = new Map<string, CcrBlockRow>();

function key(principalId: string, hash: string): string {
  return `${principalId} ${hash}`;
}

export function persistCcrBlock(row: CcrBlockRow): void {
  store.set(key(row.principalId, row.hash), { ...row });
}

export function touchCcrBlock(principalId: string, hash: string, lastAccessedAt: number): void {
  const row = store.get(key(principalId, hash));
  if (row) row.lastAccessedAt = lastAccessedAt;
}

export function deleteCcrBlockRow(principalId: string, hash: string): void {
  store.delete(key(principalId, hash));
}

export function deleteAllCcrBlocks(): void {
  store.clear();
}

/** Returns the block only while it is unexpired; an expired row is deleted and read as a miss. */
export function loadCcrBlock(principalId: string, hash: string, now: number): CcrBlockRow | null {
  const row = store.get(key(principalId, hash));
  if (!row) return null;
  if (row.expiresAt <= now) {
    store.delete(key(principalId, hash));
    return null;
  }
  return { ...row };
}
