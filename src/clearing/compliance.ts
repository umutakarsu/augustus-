import type { PaymentInstruction, ComplianceResult, ComplianceCheck } from "./types.js";

const SANCTIONED_JURISDICTIONS = new Set(["KP", "IR", "SY", "CU", "RU"]);

const SANCTIONED_ENTITIES = [
  "BANK OF DANDONG",
  "SBERBANK",
  "SEPAH BANK",
];

const KNOWN_CURRENCIES = new Set(["EUR", "USD", "GBP", "CHF", "JPY", "USDC"]);

const ISO_ALPHA2 = /^[A-Z]{2}$/;

function checkSanctions(
  party: { name: string; jurisdiction: string },
  label: string,
): { clear: boolean; check: ComplianceCheck } {
  const jurisdictionHit = SANCTIONED_JURISDICTIONS.has(party.jurisdiction);
  const nameUpper = party.name.toUpperCase();
  const entityHit = SANCTIONED_ENTITIES.some((e) => nameUpper.includes(e));

  if (jurisdictionHit || entityHit) {
    const reasons: string[] = [];
    if (jurisdictionHit) reasons.push(`jurisdiction ${party.jurisdiction} sanctioned`);
    if (entityHit) reasons.push(`entity name matches sanctioned list`);
    return {
      clear: false,
      check: { name: `sanctions_${label}`, result: "fail", detail: reasons.join("; ") },
    };
  }

  return {
    clear: true,
    check: { name: `sanctions_${label}`, result: "pass", detail: "no sanctions match" },
  };
}

function checkAml(amount: string): { flag: "none" | "review"; reason: string | null; check: ComplianceCheck } {
  const value = parseFloat(amount);

  if (value > 100_000) {
    return {
      flag: "review",
      reason: "Amount exceeds $100,000 — enhanced due diligence required",
      check: { name: "aml_threshold", result: "review", detail: `amount ${amount} exceeds high-value threshold` },
    };
  }

  if (value >= 10_000) {
    return {
      flag: "review",
      reason: "Amount in $10K-$100K range — enhanced due diligence recommended",
      check: { name: "aml_threshold", result: "review", detail: `amount ${amount} in elevated monitoring range` },
    };
  }

  return {
    flag: "none",
    reason: null,
    check: { name: "aml_threshold", result: "pass", detail: `amount ${amount} below reporting threshold` },
  };
}

function checkJurisdictions(from: string, to: string): ComplianceCheck {
  if (!from || !to) {
    return { name: "jurisdiction_pair", result: "fail", detail: "missing jurisdiction on one or both parties" };
  }
  if (!ISO_ALPHA2.test(from) || !ISO_ALPHA2.test(to)) {
    return { name: "jurisdiction_pair", result: "fail", detail: `invalid ISO 3166-1 alpha-2: from=${from} to=${to}` };
  }
  return { name: "jurisdiction_pair", result: "pass", detail: `${from} <> ${to}` };
}

function checkCurrencies(source: string, target: string): ComplianceCheck {
  const unknowns: string[] = [];
  if (!KNOWN_CURRENCIES.has(source)) unknowns.push(source);
  if (!KNOWN_CURRENCIES.has(target)) unknowns.push(target);

  if (unknowns.length > 0) {
    return { name: "currency_reasonableness", result: "review", detail: `unknown currency: ${unknowns.join(", ")}` };
  }
  return { name: "currency_reasonableness", result: "pass", detail: `${source} -> ${target}` };
}

export async function runComplianceChecks(instruction: PaymentInstruction): Promise<ComplianceResult> {
  const checks: ComplianceCheck[] = [];

  const fromSanctions = checkSanctions(instruction.from, "from");
  const toSanctions = checkSanctions(instruction.to, "to");
  checks.push(fromSanctions.check, toSanctions.check);

  const aml = checkAml(instruction.amount);
  checks.push(aml.check);

  const jurisdictionCheck = checkJurisdictions(instruction.from.jurisdiction, instruction.to.jurisdiction);
  checks.push(jurisdictionCheck);

  const currencyCheck = checkCurrencies(instruction.source_currency, instruction.target_currency);
  checks.push(currencyCheck);

  const cleared = fromSanctions.clear && toSanctions.clear;

  return {
    cleared,
    sanctions: { from_clear: fromSanctions.clear, to_clear: toSanctions.clear },
    aml: { flag: aml.flag, reason: aml.reason },
    checks,
    checked_at: new Date().toISOString(),
  };
}
