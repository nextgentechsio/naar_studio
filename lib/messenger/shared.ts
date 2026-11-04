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

export type Person = {
  id: string;
  name: string;
  username: string;
};

export type PublicMessage = {
  id: string;
  body: string;
  senderId: string;
  mine: boolean;
  createdAt: string;
};

export type PublicConversation = {
  id: string;
  // The other person
  other: Person & { disabled: boolean };
  last: { body: string; mine: boolean; at: string } | null;
  // Their messages the viewer hasn't read
  unread: number;
  // When the other person last read it (for "Seen")
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
};

// Super admin's read-only view of anyone's chat
export type AuditConversation = {
  id: string;
  // Both people, as stored (sorted by id)
  members: (Person & { disabled: boolean })[];
  last: { body: string; senderId: string; at: string } | null;
};

export type AuditList = { conversations: AuditConversation[] };
