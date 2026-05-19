import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../../schemas/agent-cv.schema.json");

describe("agent-cv schema", () => {
  let validate: ValidateFunction;

  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    validate = ajv.compile(schema);
  });

  describe("required fields", () => {
    const validBase = {
      schema_version: "0.1",
      github_username: "alicelu",
      cc_experience_months: 12,
      evidence_url: "https://github.com/alicelu/proj/pull/42",
      contact_mode: "public",
      contact_value: "alice@example.com",
    };

    it("accepts a minimal valid candidate (5 required + schema_version)", () => {
      expect(validate(validBase)).toBe(true);
      expect(validate.errors).toBeNull();
    });

    it.each([
      "schema_version",
      "github_username",
      "cc_experience_months",
      "evidence_url",
      "contact_mode",
      "contact_value",
    ])("rejects when %s is missing", (field) => {
      const copy = { ...validBase } as Record<string, unknown>;
      delete copy[field];
      expect(validate(copy)).toBe(false);
      expect(JSON.stringify(validate.errors)).toContain(field);
    });
  });

  describe("field type validation", () => {
    const valid = {
      schema_version: "0.1",
      github_username: "alicelu",
      cc_experience_months: 12,
      evidence_url: "https://github.com/alicelu/proj/pull/42",
      contact_mode: "public" as const,
      contact_value: "alice@example.com",
    };

    it("rejects non-numeric cc_experience_months", () => {
      const bad = { ...valid, cc_experience_months: "twelve" };
      expect(validate(bad)).toBe(false);
    });

    it("rejects negative cc_experience_months", () => {
      const bad = { ...valid, cc_experience_months: -3 };
      expect(validate(bad)).toBe(false);
    });

    it("rejects evidence_url that is not a URL", () => {
      const bad = { ...valid, evidence_url: "not a url" };
      expect(validate(bad)).toBe(false);
    });

    it("rejects contact_mode outside enum", () => {
      const bad = { ...valid, contact_mode: "semi-public" };
      expect(validate(bad)).toBe(false);
    });

    it("rejects github_username with invalid characters", () => {
      const bad = { ...valid, github_username: "alice lu" };
      expect(validate(bad)).toBe(false);
    });

    it("rejects github_username over 39 chars (GitHub max)", () => {
      const bad = { ...valid, github_username: "a".repeat(40) };
      expect(validate(bad)).toBe(false);
    });
  });

  describe("schema_version enum", () => {
    const valid = {
      github_username: "alicelu",
      cc_experience_months: 12,
      evidence_url: "https://github.com/alicelu/proj/pull/42",
      contact_mode: "public" as const,
      contact_value: "alice@example.com",
    };

    it("accepts schema_version 0.1", () => {
      expect(validate({ ...valid, schema_version: "0.1" })).toBe(true);
    });

    it("rejects unknown schema_version", () => {
      expect(validate({ ...valid, schema_version: "99.0" })).toBe(false);
    });
  });

  describe("optional fields", () => {
    const required = {
      schema_version: "0.1",
      github_username: "alicelu",
      cc_experience_months: 12,
      evidence_url: "https://github.com/alicelu/proj/pull/42",
      contact_mode: "public" as const,
      contact_value: "alice@example.com",
    };

    it("accepts bio_zh + bio_en", () => {
      expect(
        validate({
          ...required,
          bio_zh: "一名喜欢用 cc 干活的全栈工程师",
          bio_en: "A fullstack engineer who ships with cc",
        }),
      ).toBe(true);
    });

    it("accepts looking_for enum values", () => {
      for (const v of ["full-time", "contract", "open-to-talk", "not-looking"]) {
        expect(validate({ ...required, looking_for: v })).toBe(true);
      }
    });

    it("rejects looking_for outside enum", () => {
      expect(validate({ ...required, looking_for: "freelance" })).toBe(false);
    });

    it("accepts referrer fields together", () => {
      expect(
        validate({
          ...required,
          referrer_github: "bob",
          referrer_evidence_pr_url: "https://github.com/bob/proj/pull/1",
        }),
      ).toBe(true);
    });

    it("rejects unknown top-level fields (additionalProperties false)", () => {
      expect(validate({ ...required, sneaky_field: "x" })).toBe(false);
    });
  });

  describe("hidden mode constraint", () => {
    it("accepts hidden mode with relay-pending sentinel", () => {
      expect(
        validate({
          schema_version: "0.1",
          github_username: "alicelu",
          cc_experience_months: 12,
          evidence_url: "https://github.com/alicelu/proj/pull/42",
          contact_mode: "hidden",
          contact_value: "relay-pending",
        }),
      ).toBe(true);
    });

    it("accepts hidden mode with issued relay alias", () => {
      expect(
        validate({
          schema_version: "0.1",
          github_username: "alicelu",
          cc_experience_months: 12,
          evidence_url: "https://github.com/alicelu/proj/pull/42",
          contact_mode: "hidden",
          contact_value: "relay-alicelu@hireic.dev",
        }),
      ).toBe(true);
    });
  });
});
