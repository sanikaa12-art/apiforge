import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { KeyValueEditor } from "./KeyValueEditor";
import { AssertionEditor } from "./AssertionEditor";
import { Markdown } from "./Markdown";
import { CodeView } from "./CodeView";
import type { Assertion, KeyValue } from "../lib/types";

function KVHarness({ onChange }: { onChange: (r: KeyValue[]) => void }) {
  const [rows, setRows] = useState<KeyValue[]>([{ key: "Accept", value: "application/json", enabled: true }]);
  return <KeyValueEditor rows={rows} onChange={(r) => { setRows(r); onChange(r); }} keyPlaceholder="Header" />;
}

describe("KeyValueEditor", () => {
  it("adds a row when typing in the ghost row, toggles and removes rows", () => {
    const spy = vi.fn();
    render(<KVHarness onChange={spy} />);
    fireEvent.change(screen.getByLabelText("Header 2"), { target: { value: "X-Trace" } });
    expect(spy).toHaveBeenLastCalledWith([
      { key: "Accept", value: "application/json", enabled: true },
      { key: "X-Trace", value: "", enabled: true },
    ]);
    fireEvent.click(screen.getAllByLabelText("Enabled")[0]!);
    expect(spy.mock.lastCall![0][0].enabled).toBe(false);
    fireEvent.click(screen.getAllByLabelText("Remove row")[0]!);
    expect(spy.mock.lastCall![0]).toHaveLength(1);
  });
});

describe("AssertionEditor", () => {
  it("parses comma lists for the `in` operator into numbers", () => {
    const spy = vi.fn();
    function H() {
      const [v, setV] = useState<Assertion[]>([{ type: "status", operator: "in", expected: [] }]);
      return <AssertionEditor value={v} onChange={(n) => { setV(n); spy(n); }} />;
    }
    render(<H />);
    fireEvent.change(screen.getByLabelText("Expected value"), { target: { value: "400, 422" } });
    expect(spy.mock.lastCall![0][0].expected).toEqual([400, 422]);
  });
});

describe("Markdown", () => {
  it("renders formatting without injecting HTML", () => {
    const { container } = render(<Markdown text={"**Bold** and `code`\n- item <img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("CodeView", () => {
  it("pretty prints JSON with line numbers", () => {
    render(<CodeView text='{"ok":true,"n":1}' />);
    expect(screen.getByTestId("code-view").textContent).toBe('{\n  "ok": true,\n  "n": 1\n}');
  });
});
