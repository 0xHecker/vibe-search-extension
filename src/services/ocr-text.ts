export const normalizeOcrText = (text: string | undefined): string =>
  (text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const appendOcrTextToTextContent = (
  textContent: string | undefined,
  ocrText: string | undefined
): string => {
  const base = (textContent || "").trim();
  const next = normalizeOcrText(ocrText);
  if (!next) return base;
  if (!base) return next;

  const normalizedBase = normalizeOcrText(base).toLowerCase();
  if (normalizedBase.includes(next.toLowerCase())) return base;

  return `${base}\n\n${next}`;
};
