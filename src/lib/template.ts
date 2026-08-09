export function renderTemplate(
  template: string,
  vars: Record<string, { question: string; answer: string }>,
  meta: { date: string; day_of_week: string; day_number: string }
): string {
  // Identifiers are user-editable (settings > questions), so escape them before
  // building the RegExp — an identifier like "Q1." or ".*" must be literal text.
  let result = template;

  result = result.replace(/\{date\}/g, meta.date);
  result = result.replace(/\{day_of_week\}/g, meta.day_of_week);
  result = result.replace(/\{day_number\}/g, meta.day_number);

  for (const [key, value] of Object.entries(vars)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\{${esc}\\.question\\}`, "g"), value.question);
    result = result.replace(new RegExp(`\\{${esc}\\.answer\\}`, "g"), value.answer);
  }

  return result;
}