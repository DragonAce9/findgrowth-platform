export function moveRank(id: string, letters: boolean): number {
  const key = id === "friction" ? "drop" : id;
  if (letters) {
    if (key === "risk") return 0;
    if (key === "drop") return 1;
    if (key === "lost") return 2;
    return 9;
  }
  if (key === "drop") return 0;
  if (key === "risk") return 1;
  if (key === "lost") return 2;
  return 9;
}

export function rankMoves<T extends { id: string; revenue?: number }>(items: T[], letters: boolean): T[] {
  return [...items].sort((a, b) => {
    const byRank = moveRank(a.id, letters) - moveRank(b.id, letters);
    if (byRank !== 0) return byRank;
    return (b.revenue ?? 0) - (a.revenue ?? 0);
  });
}
