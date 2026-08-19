// Minimal CSV writer, no dependency: every value in this experiment is a plain number or
// integer id (PII guard runs before this is ever called), so RFC4180 quoting/escaping is not
// needed — keeping this dependency-free matches the task's "mantener dependencias mínimas"
// instruction (Section 21) for the TS side too.
export function toCsv(columns: readonly string[], rows: readonly Record<string, number | string>[]): string {
  const header = columns.join(',');
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const value = row[column];
        if (value === undefined || value === null) {
          throw new Error(`CSV row is missing required column: ${column}`);
        }
        return String(value);
      })
      .join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}
