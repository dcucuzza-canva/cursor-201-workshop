import { describe, expect, it } from "vitest";
import { escapeCsvField, toCsv } from "@/lib/csv";

describe("escapeCsvField", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvField("Kookaburra Coffee Co.")).toBe("Kookaburra Coffee Co.");
    expect(escapeCsvField("1234.50")).toBe("1234.50");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes values with commas, quotes or newlines and doubles embedded quotes", () => {
    expect(escapeCsvField("Smith, Jones & Co")).toBe('"Smith, Jones & Co"');
    expect(escapeCsvField('The "Best" Bakery')).toBe('"The ""Best"" Bakery"');
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCsvField("line one\r\nline two")).toBe('"line one\r\nline two"');
  });

  it("neutralises values that a spreadsheet would run as a formula", () => {
    expect(escapeCsvField("=1+1")).toBe("'=1+1");
    expect(escapeCsvField("+61 400 000 000")).toBe("'+61 400 000 000");
    expect(escapeCsvField("-5")).toBe("'-5");
    expect(escapeCsvField("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
    expect(escapeCsvField("a=b")).toBe("a=b");
  });

  it("neutralises first and then quotes", () => {
    expect(escapeCsvField('=HYPERLINK("http://evil.test", "x")')).toBe(`"'=HYPERLINK(""http://evil.test"", ""x"")"`);
  });
});

describe("toCsv", () => {
  it("joins fields with commas and ends every row with CRLF", () => {
    expect(
      toCsv([
        ["Customer", "Balance"],
        ["Acme, Inc", "10.00"],
      ]),
    ).toBe('Customer,Balance\r\n"Acme, Inc",10.00\r\n');
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
