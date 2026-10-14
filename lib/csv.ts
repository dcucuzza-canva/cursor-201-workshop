// Builds RFC 4180 CSV. Values that start with a formula trigger are prefixed with a single quote
// so spreadsheets show them as text instead of running them.

const FORMULA_TRIGGERS = ["=", "+", "-", "@"];
const NEEDS_QUOTES = /[",\r\n]/;

export function escapeCsvField(value: string): string {
  const safe = FORMULA_TRIGGERS.some((trigger) => value.startsWith(trigger)) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(escapeCsvField).join(",")}\r\n`).join("");
}
