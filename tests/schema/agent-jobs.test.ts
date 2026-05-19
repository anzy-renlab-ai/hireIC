import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../../schemas/agent-jobs.schema.json");

describe("agent-jobs schema", () => {
  let validate: ValidateFunction;

  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    validate = ajv.compile(schema);
  });

  const valid = {
    schema_version: "0.1",
    company: "Acme",
    role_title_zh: "全栈工程师 (cc-fluent)",
    cc_required: true,
    apply_url: "https://acme.com/jobs/123",
    contact_value: "jobs@acme.com",
  };

  describe("required fields", () => {
    it("accepts a minimal valid job", () => {
      expect(validate(valid)).toBe(true);
      expect(validate.errors).toBeNull();
    });

    it.each([
      "schema_version",
      "company",
      "role_title_zh",
      "cc_required",
      "apply_url",
      "contact_value",
    ])("rejects when %s is missing", (field) => {
      const copy = { ...valid } as Record<string, unknown>;
      delete copy[field];
      expect(validate(copy)).toBe(false);
      expect(JSON.stringify(validate.errors)).toContain(field);
    });
  });

  describe("field type validation", () => {
    it("rejects non-boolean cc_required", () => {
      expect(validate({ ...valid, cc_required: "true" })).toBe(false);
    });

    it("rejects apply_url that is not a URL", () => {
      expect(validate({ ...valid, apply_url: "not a url" })).toBe(false);
    });

    it("rejects company over 200 chars", () => {
      expect(validate({ ...valid, company: "a".repeat(201) })).toBe(false);
    });

    it("rejects schema_version != 0.1", () => {
      expect(validate({ ...valid, schema_version: "1.0" })).toBe(false);
    });

    it("rejects empty role_title_zh", () => {
      expect(validate({ ...valid, role_title_zh: "" })).toBe(false);
    });
  });

  describe("optional fields", () => {
    it("accepts role_title_en", () => {
      expect(validate({ ...valid, role_title_en: "Fullstack engineer (cc-fluent)" })).toBe(true);
    });

    it("accepts salary_range_rmb", () => {
      expect(validate({ ...valid, salary_range_rmb: "50-80k/mo" })).toBe(true);
    });

    it("accepts employment_type enum values", () => {
      for (const v of ["full-time", "contract", "internship", "consulting"]) {
        expect(validate({ ...valid, employment_type: v })).toBe(true);
      }
    });

    it("rejects employment_type outside enum", () => {
      expect(validate({ ...valid, employment_type: "freelance" })).toBe(false);
    });

    it("accepts location + remote_policy", () => {
      expect(
        validate({
          ...valid,
          location: "北京",
          remote_policy: "remote-friendly",
        }),
      ).toBe(true);
    });

    it("rejects remote_policy outside enum", () => {
      expect(validate({ ...valid, remote_policy: "hybrid-sometimes" })).toBe(false);
    });

    it("accepts open_until date", () => {
      expect(validate({ ...valid, open_until: "2026-12-31" })).toBe(true);
    });

    it("rejects malformed open_until", () => {
      expect(validate({ ...valid, open_until: "soon" })).toBe(false);
    });

    it("accepts description_zh and description_en", () => {
      expect(
        validate({
          ...valid,
          description_zh: "我们招一个用 cc 干活的全栈, 真的用得好那种.",
          description_en: "Hiring a fullstack engineer who actually ships with cc.",
        }),
      ).toBe(true);
    });

    it("rejects unknown top-level fields (additionalProperties false)", () => {
      expect(validate({ ...valid, sneaky_field: "x" })).toBe(false);
    });
  });

  describe("status field", () => {
    it("accepts status: open", () => {
      expect(validate({ ...valid, status: "open" })).toBe(true);
    });

    it("accepts status: closed", () => {
      expect(validate({ ...valid, status: "closed" })).toBe(true);
    });

    it("rejects unknown status", () => {
      expect(validate({ ...valid, status: "paused" })).toBe(false);
    });
  });
});
