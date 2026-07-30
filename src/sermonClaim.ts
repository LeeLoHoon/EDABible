export interface SermonNoteClaim {
  sermonId: string
  ownerId: string
  claimedAt: number
}

export function shouldInheritAnonymousSermonNote(
  claim: SermonNoteClaim | undefined,
  ownerCache: unknown,
  anonymousCache: unknown,
): boolean {
  return claim === undefined && ownerCache === undefined && anonymousCache !== undefined
}
