/**
 * Replaces `{name}` placeholders in a dictionary string.
 *
 * Keeps parameterised copy in the dictionaries (so translators see the whole
 * sentence and its placeholders together) without forcing a full ICU
 * MessageFormat dependency for the handful of interpolations the app needs.
 */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}