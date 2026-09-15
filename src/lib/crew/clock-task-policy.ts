/** Keep field labor choices separate from office fees and material-only budgets. */
export function isFieldTask(description: string): boolean {
  const text = description.toLowerCase();
  if (/\b(permits?|administration|project management|pm fee|insurance|contingency|profit|sales tax)\b/.test(text)) return false;
  if (/\b(materials?|supply only|purchase|allowance)\b/.test(text) && !/\b(labor|install|installation|framing|repair|owner project)\b/.test(text)) return false;
  if (/\bmaterials?\b/.test(text) && !/\b(labor|install|installation|repair)\b/.test(text)) return false;
  return !!text.trim();
}
