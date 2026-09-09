// Shared prompt builders for answer generation (the "settle" pass). The
// entries route (server), the raw-context panel (client), and
// {date}-context.json all build from these so every view of "what the AI got"
// agrees byte-for-byte.

// The user's personality prompt is the system prompt — the format guardrail
// rides below it, and answer_prompt instructions always win over the default
// 1-3 sentence length.
export function settleSystem(personality: string | undefined | null): string {
  const p = (personality || "").trim();
  return (
    (p ? p + "\n\n" : "") +
    "Answer question about the user's day for their journal note"
  );
}

export function settleUser(
  q: { question: string; answer_prompt?: string },
  integrationContext: string,
  userInputText: string
): string {
  return `Question: ${q.question}\n${q.answer_prompt ? `Answering instructions: ${q.answer_prompt}\n` : ""}\n${integrationContext}\n\n--- User's input ---\n${userInputText}`;
}
