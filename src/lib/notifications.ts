import { createNotification, getNotificationPrefs } from './db';
import { getBadgeById } from './badges';

type NotificationType = 'upvote' | 'downvote' | 'usage' | 'verification' | 'revision' | 'badge_earned';

const TYPE_PREF_MAP: Record<string, string> = {
  upvote: 'notify_upvotes',
  downvote: 'notify_upvotes',
  usage: 'notify_usages',
  verification: 'notify_verifications',
  revision: 'notify_revisions',
  badge_earned: 'notify_badges',
};

export async function dispatchNotification(
  username: string,
  type: NotificationType,
  entryId: number | null,
  context: { sourceUsername?: string; badgeId?: string; entryTitle?: string },
): Promise<void> {
  if (!username || username === 'anonymous') return;

  // Check preferences
  const prefs = await getNotificationPrefs(username);
  const prefKey = TYPE_PREF_MAP[type] as keyof typeof prefs;
  if (prefKey && !prefs[prefKey]) return;

  // Build message
  const message = buildMessage(type, context);

  await createNotification(username, type, entryId, message);
}

function buildMessage(type: NotificationType, ctx: { sourceUsername?: string; badgeId?: string; entryTitle?: string }): string {
  const title = ctx.entryTitle ? `"${ctx.entryTitle}"` : 'your entry';
  const source = ctx.sourceUsername && ctx.sourceUsername !== 'anonymous' ? `@${ctx.sourceUsername}` : 'Someone';

  switch (type) {
    case 'upvote': return `${source} upvoted ${title}`;
    case 'downvote': return `${source} downvoted ${title}`;
    case 'usage': return `${source} used ${title} to solve a problem`;
    case 'verification': return `${source} verified ${title}`;
    case 'revision': return `${source} added a revision to ${title}`;
    case 'badge_earned': {
      const badge = ctx.badgeId ? getBadgeById(ctx.badgeId) : null;
      return badge ? `You earned the "${badge.name}" badge ${badge.icon}` : 'You earned a new badge!';
    }
    default: return 'You have a new notification';
  }
}
