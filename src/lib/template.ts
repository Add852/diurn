export function renderTemplate(
  template: string,
  vars: Record<string, { question: string; answer: string }>,
  meta: { date: string; day_of_week: string; day_number: string }
): string {
  let result = template;

  result = result.replace(/\{date\}/g, meta.date);
  result = result.replace(/\{day_of_week\}/g, meta.day_of_week);
  result = result.replace(/\{day_number\}/g, meta.day_number);

  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\.question\\}`, "g"), value.question);
    result = result.replace(new RegExp(`\\{${key}\\.answer\\}`, "g"), value.answer);
  }

  return result;
}