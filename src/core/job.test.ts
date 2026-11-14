import { describe, expect, it } from "vitest";
import { JobSchema, salaryPeriodFrom, type Job } from "./job";

const valid: Job = {
  source: "remoteok",
  externalId: "123",
  url: "https://remoteok.com/remote-jobs/123",
  applyUrl: null,
  title: "Senior React Developer",
  company: "Acme",
  location: "Worldwide",
  remote: true,
  tags: ["react"],
  salaryMin: 100000,
  salaryMax: 150000,
  salaryCurrency: "USD",
  salaryPeriod: "year",
  descriptionHtml: "<p>Hi</p>",
  descriptionText: "Hi",
  postedAt: "2026-11-08T16:00:15.000Z",
};

describe("JobSchema", () => {
  it("accepts a valid job", () => {
    expect(JobSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(JobSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects non-url url", () => {
    expect(JobSchema.safeParse({ ...valid, url: "not a url" }).success).toBe(false);
  });

  it("rejects lowercase or 2-letter currency", () => {
    expect(JobSchema.safeParse({ ...valid, salaryCurrency: "usd" }).success).toBe(false);
    expect(JobSchema.safeParse({ ...valid, salaryCurrency: "US" }).success).toBe(false);
  });
});

describe("salaryPeriodFrom", () => {
  it("maps known values and returns null otherwise", () => {
    expect(salaryPeriodFrom("annual")).toBe("year");
    expect(salaryPeriodFrom("Yearly")).toBe("year");
    expect(salaryPeriodFrom("year")).toBe("year");
    expect(salaryPeriodFrom("monthly")).toBe("month");
    expect(salaryPeriodFrom("MONTH")).toBe("month");
    expect(salaryPeriodFrom("hourly")).toBe("hour");
    expect(salaryPeriodFrom("weekly")).toBeNull();
    expect(salaryPeriodFrom(null)).toBeNull();
    expect(salaryPeriodFrom(undefined)).toBeNull();
  });
});
