/** Distinguish a key-only paste from an assignment, including an explicitly empty value. */
export const getKeyValue = (pastedContent: string, delimiters: string[]) => {
  if (!pastedContent) {
    return { key: "", value: "", hasAssignment: false };
  }

  let firstDelimiterIndex = -1;
  let foundDelimiter = "";

  delimiters.forEach((delimiter) => {
    if (!delimiter) return;
    const index = pastedContent.indexOf(delimiter);
    if (index !== -1 && (firstDelimiterIndex === -1 || index < firstDelimiterIndex)) {
      firstDelimiterIndex = index;
      foundDelimiter = delimiter;
    }
  });

  if (firstDelimiterIndex === -1) {
    return { key: pastedContent.trim(), value: "", hasAssignment: false };
  }

  const key = pastedContent.substring(0, firstDelimiterIndex);
  const value = pastedContent.substring(firstDelimiterIndex + foundDelimiter.length);

  return {
    key: key.trim(),
    value: value.trim(),
    hasAssignment: true
  };
};
