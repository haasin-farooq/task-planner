import { describe, it, expect } from "vitest";
import { formatDuration } from "../format-duration";

describe("formatDuration", () => {
  it('returns "{N} min" for values under 60', () => {
    expect(formatDuration(1)).toBe("1 min");
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(59)).toBe("59 min");
  });

  it('returns "{H}h" for exact hour values', () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(180)).toBe("3h");
  });

  it('returns "{H}h {M}m" for hours with remainder', () => {
    expect(formatDuration(61)).toBe("1h 1m");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(1439)).toBe("23h 59m");
  });
});
