import { describe, it, expect } from "vitest";
import { getPriorityConfig } from "../priority-config";

describe("getPriorityConfig", () => {
  it('returns "High" with red color for priority 4', () => {
    const config = getPriorityConfig(4);
    expect(config.label).toBe("High");
    expect(config.colorClass).toBe("text-red-500");
    expect(config.icon).toBeTruthy();
  });

  it('returns "High" with red color for priority 5', () => {
    const config = getPriorityConfig(5);
    expect(config.label).toBe("High");
    expect(config.colorClass).toBe("text-red-500");
    expect(config.icon).toBeTruthy();
  });

  it('returns "Medium" with yellow color for priority 3', () => {
    const config = getPriorityConfig(3);
    expect(config.label).toBe("Medium");
    expect(config.colorClass).toBe("text-amber-600");
    expect(config.icon).toBeTruthy();
  });

  it('returns "Low" with green color for priority 2', () => {
    const config = getPriorityConfig(2);
    expect(config.label).toBe("Low");
    expect(config.colorClass).toBe("text-green-600");
    expect(config.icon).toBeTruthy();
  });

  it('returns "Low" with green color for priority 1', () => {
    const config = getPriorityConfig(1);
    expect(config.label).toBe("Low");
    expect(config.colorClass).toBe("text-green-600");
    expect(config.icon).toBeTruthy();
  });

  it("returns non-empty colorClass and icon for all valid priorities", () => {
    for (let p = 1; p <= 5; p++) {
      const config = getPriorityConfig(p);
      expect(config.colorClass).not.toBe("");
      expect(config.icon).not.toBe("");
    }
  });
});
