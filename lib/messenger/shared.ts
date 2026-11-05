// --------------------------------------------------
// MESSENGER: types and limits shared by the server
// (lib/messenger/server.ts) and the floating chat
// (app/(studio)/_messenger)
// --------------------------------------------------

export const MESSAGE_MAX = 2000;
// Messages per page when scrolling back
export const PAGE_SIZE = 40;
// Conversations in the Chats list
export const CONVERSATION_LIMIT = 50;
export const GROUP_NAME_MAX = 60;
// Everyone in a group, its creator included
export const GROUP_MAX_MEMBERS = 50;

export type Person = {
  id: string;
  name: string;
  username: string;
};

export type Member = Person & { disabled: boolean };

export type PublicMessage = {
  id: string;
  body: string;
  senderId: string;
  // Current name (groups show who wrote what)
  senderName: string;
  mine: boolean;
  // A group event ("Priya added Bob"), shown centred
  system: boolean;
  createdAt: string;
};

export type GroupInfo = {
  name: string;
  members: Member[];
  createdBy: string;
  // Can rename, add, remove and delete (an admin in it,
  // or the super admin)
  canManage: boolean;
};

export type PublicConversation = {
  id: string;
  // A direct chat: the other person. A group: its name
  // (id = the group's), so lists and avatars treat both
  // alike
  other: Member;
  // Set for groups
  group: GroupInfo | null;
  last: { body: string; mine: boolean; at: string; sender: string } | null;
  // Others' messages the viewer hasn't read
  unread: number;
  // When the other person last read it (direct chats,
  // for "Seen")
  otherReadAt: string | null;
};

export type ConversationList = {
  conversations: PublicConversation[];
  unread: number;
};

export type MessagePage = {
  messages: PublicMessage[];
  // Older messages remain (paging back)
  hasMore: boolean;
  otherReadAt: string | null;
  // Groups: who else has read it, and when (for "Seen by")
  readers: { id: string; name: string; readAt: string }[];
  // Messages the super admin deleted (recent ones), for
  // windows that already show them
  deleted: string[];
};

// Super admin's read-only view of anyone's chat
export type AuditConversation = {
  id: string;
  // Set for groups
  name: string | null;
  members: Member[];
  last: { body: string; senderId: string; at: string } | null;
};

export type AuditList = { conversations: AuditConversation[] };
