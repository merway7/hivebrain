export interface UserStats {
  total_rep: number;
  entries_count: number;
  upvotes_received: number;
  usages_received: number;
  verifications_received: number;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  check: (stats: UserStats) => boolean;
}

export const BADGES: BadgeDefinition[] = [
  { id: 'first_submit', name: 'First Submit', description: 'Submitted your first entry', icon: '\uD83C\uDF31', check: s => s.entries_count >= 1 },
  { id: 'contributor_5', name: 'Contributor', description: 'Submitted 5+ entries', icon: '\uD83D\uDCDD', check: s => s.entries_count >= 5 },
  { id: 'prolific_25', name: 'Prolific', description: 'Submitted 25+ entries', icon: '\uD83D\uDCDA', check: s => s.entries_count >= 25 },
  { id: 'helpful_10', name: 'Helpful', description: '10+ usages of your entries', icon: '\uD83E\uDD1D', check: s => s.usages_received >= 10 },
  { id: 'helpful_50', name: 'Very Helpful', description: '50+ usages of your entries', icon: '\uD83D\uDCA1', check: s => s.usages_received >= 50 },
  { id: 'popular_10', name: 'Popular', description: '10+ upvotes received', icon: '\u2B50', check: s => s.upvotes_received >= 10 },
  { id: 'verified_expert', name: 'Verified Expert', description: '5+ verifications received', icon: '\u2705', check: s => s.verifications_received >= 5 },
  { id: 'rep_100', name: 'Top Contributor', description: '100+ reputation', icon: '\uD83C\uDFC6', check: s => s.total_rep >= 100 },
  { id: 'rep_500', name: 'Elite', description: '500+ reputation', icon: '\uD83D\uDC51', check: s => s.total_rep >= 500 },
];

export function computeNewBadges(stats: UserStats, existingBadgeIds: string[]): BadgeDefinition[] {
  const existing = new Set(existingBadgeIds);
  return BADGES.filter(b => !existing.has(b.id) && b.check(stats));
}

export function getBadgeById(id: string): BadgeDefinition | undefined {
  return BADGES.find(b => b.id === id);
}
