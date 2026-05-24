import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusTicks } from "./StatusTicks";
import { CheckResult } from "../store";

describe("StatusTicks Component Tests", () => {
  const mockHistory: CheckResult[] = [
    {
      id: "1",
      site_id: "site-1",
      checked_at: "2026-05-24T10:00:00Z",
      status: "UP",
      status_code: 200,
      response_time_ms: 120,
      ssl_valid: true,
      ssl_expiry_date: null,
      ssl_days_remaining: null,
      error_message: null,
      redirect_url: null,
      domain_expiry_date: null,
      domain_days_remaining: null,
    },
    {
      id: "2",
      site_id: "site-1",
      checked_at: "2026-05-24T10:05:00Z",
      status: "WARNING",
      status_code: 200,
      response_time_ms: 2500,
      ssl_valid: true,
      ssl_expiry_date: null,
      ssl_days_remaining: null,
      error_message: "Slow response",
      redirect_url: null,
      domain_expiry_date: null,
      domain_days_remaining: null,
    },
    {
      id: "3",
      site_id: "site-1",
      checked_at: "2026-05-24T10:10:00Z",
      status: "DOWN",
      status_code: 500,
      response_time_ms: 90,
      ssl_valid: true,
      ssl_expiry_date: null,
      ssl_days_remaining: null,
      error_message: "Internal Server Error",
      redirect_url: null,
      domain_expiry_date: null,
      domain_days_remaining: null,
    },
  ];

  test("should render the default limit (24) of status ticks", () => {
    const { container } = render(<StatusTicks history={mockHistory} />);
    const ticks = container.querySelectorAll(".rounded-sm");
    expect(ticks.length).toBe(24);
  });

  test("should render custom limit of status ticks", () => {
    const { container } = render(<StatusTicks history={mockHistory} limit={10} />);
    const ticks = container.querySelectorAll(".rounded-sm");
    expect(ticks.length).toBe(10);
  });

  test("should apply color classes based on check status", () => {
    const { container } = render(<StatusTicks history={mockHistory} limit={3} />);
    const ticks = container.querySelectorAll(".rounded-sm");

    expect(ticks.length).toBe(3);
    // Since history has [UP, WARNING, DOWN], paddedHistory.reverse() reverses it to [DOWN, WARNING, UP], and then we take the latest 3 items:
    // Actually, in StatusTicks.tsx:
    // const paddedHistory = [...history].reverse(); // converts [UP (oldest), WARNING, DOWN (latest)] -> [DOWN, WARNING, UP] (wait, that makes DOWN index 0)
    // Then unshifts padding on the left: if length < limit, unshift padding -> [pad1, pad2, ..., DOWN, WARNING, UP]
    // And returns the latest `limit` items. So the last 3 items are: DOWN, WARNING, UP.
    // Let's verify the classes of these ticks:
    // DOWN tick is first (at idx 0):
    expect(ticks[0].className).toContain("bg-red-500");
    // WARNING tick is second (at idx 1):
    expect(ticks[1].className).toContain("bg-amber-500");
    // UP tick is third (at idx 2):
    expect(ticks[2].className).toContain("bg-emerald-500");
  });

  test("should render padded ticks as gray background (bg-zinc-800)", () => {
    const { container } = render(<StatusTicks history={[]} limit={5} />);
    const ticks = container.querySelectorAll(".rounded-sm");

    expect(ticks.length).toBe(5);
    ticks.forEach((tick) => {
      expect(tick.className).toContain("bg-zinc-800");
    });
  });
});
