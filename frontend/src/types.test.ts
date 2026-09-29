import { describe, expect, it } from "vitest";
import { hasCompanyRiskRing, normalizedRisk, safeHttpUrl } from "./types";

describe("external risk data normalization", () => {
  it("maps backend color levels to the correct visual severity", () => {
    expect(normalizedRisk("red")).toBe("critical");
    expect(normalizedRisk("orange")).toBe("high");
    expect(normalizedRisk("yellow")).toBe("medium");
    expect(normalizedRisk("green")).toBe("low");
    expect(normalizedRisk("gray")).toBe("unknown");
  });

  it("only opens HTTP source links", () => {
    expect(safeHttpUrl("https://example.org/news")).toBe(
      "https://example.org/news",
    );
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("file:///tmp/news")).toBeNull();
  });

  it("keeps a company-wide alert visually separate from local site risk", () => {
    expect(
      hasCompanyRiskRing({ risk_level: "green", supplier_risk_level: "red" }),
    ).toBe(true);
    expect(
      hasCompanyRiskRing({ risk_level: "red", supplier_risk_level: "red" }),
    ).toBe(false);
    expect(
      hasCompanyRiskRing({ risk_level: "gray", supplier_risk_level: "gray" }),
    ).toBe(false);
  });
});
