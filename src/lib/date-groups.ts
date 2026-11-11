import type { Conversation } from "./types";

export interface ConversationGroup {
  label: string;
  items: Conversation[];
}

export function groupConversationsByDate(conversations: Conversation[]): ConversationGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysAgoStart = todayStart - 6 * 86400000;

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const last7Days: Conversation[] = [];
  const older: Conversation[] = [];

  for (const item of conversations) {
    const time = new Date(item.updatedAt).getTime();
    if (time >= todayStart) {
      today.push(item);
    } else if (time >= yesterdayStart) {
      yesterday.push(item);
    } else if (time >= sevenDaysAgoStart) {
      last7Days.push(item);
    } else {
      older.push(item);
    }
  }

  const groups: ConversationGroup[] = [];
  if (today.length > 0) groups.push({ label: "Today", items: today });
  if (yesterday.length > 0) groups.push({ label: "Yesterday", items: yesterday });
  if (last7Days.length > 0) groups.push({ label: "Previous 7 Days", items: last7Days });
  if (older.length > 0) groups.push({ label: "Older", items: older });

  return groups;
}
