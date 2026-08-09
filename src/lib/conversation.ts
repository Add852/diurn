import { getDb } from "./db";

export type ChatRole = "system" | "user" | "assistant";

export function appendMessage(sessionId: string, role: ChatRole, content: string) {
  getDb()
    .prepare("INSERT INTO conversation_messages (session_id, role, content) VALUES (?, ?, ?)")
    .run(sessionId, role, content);
}

export function getMessages(sessionId: string): { role: ChatRole; content: string }[] {
  return getDb()
    .prepare("SELECT role, content FROM conversation_messages WHERE session_id = ? ORDER BY id")
    .all(sessionId) as { role: ChatRole; content: string }[];
}

export function getFullMessages(sessionId: string) {
  return getDb().prepare("SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY id").all(sessionId);
}