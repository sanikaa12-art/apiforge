import { formatBytes, formatMs, parseQuery, prettyJson, statusTone, timeAgo } from "./format";

describe("format helpers", () => {
  it("formats bytes and durations", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
    expect(formatMs(87.4)).toBe("87 ms");
    expect(formatMs(1530)).toBe("1.53 s");
    expect(formatMs(null)).toBe("—");
  });
  it("pretty-prints JSON and leaves other text alone", () => {
    expect(prettyJson('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', isJson: true });
    expect(prettyJson("<html>")).toEqual({ text: "<html>", isJson: false });
  });
  it("splits a pasted URL into base and params", () => {
    expect(parseQuery("https://x.io/a?limit=10&q=hello%20world&flag")).toEqual({
      base: "https://x.io/a",
      params: [
        { key: "limit", value: "10", enabled: true },
        { key: "q", value: "hello world", enabled: true },
        { key: "flag", value: "", enabled: true },
      ],
    });
  });
  it("maps status codes to tones", () => {
    expect(statusTone(204)).toBe("ok");
    expect(statusTone(302)).toBe("warn");
    expect(statusTone(500)).toBe("bad");
  });
  it("renders relative times", () => {
    const now = Date.parse("2026-01-10T12:00:00Z");
    expect(timeAgo("2026-01-10T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-01-10T11:00:00Z", now)).toBe("1h ago");
    expect(timeAgo("2026-01-07T12:00:00Z", now)).toBe("3d ago");
  });
});
