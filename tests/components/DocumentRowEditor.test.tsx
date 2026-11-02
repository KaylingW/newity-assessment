// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentRowEditor from "@/components/DocumentRowEditor";
import type { DocumentRow } from "@/lib/rules";
import { doc } from "../helpers";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const TYPE = "SBA Form 1919";
const statusSelect = () => screen.getByLabelText(`Status for ${TYPE}`) as HTMLSelectElement;
const receivedInput = () => screen.getByLabelText(`Received date for ${TYPE}`) as HTMLInputElement;
const notesBox = () => screen.getByLabelText(`Notes for ${TYPE}`) as HTMLTextAreaElement;

function row(d: DocumentRow) {
  return (
    <table>
      <tbody>
        <DocumentRowEditor
          striped={false}
          doc={d}
          statuses={["Pending", "Received", "Under Review", "Approved", "Expired", "Not Required"]}
          expired={false}
          derivedExpired={false}
          expiringSoon={false}
          expiresLabel=""
          asOf="2026-02-15"
        />
      </tbody>
    </table>
  );
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

// Lets queued saves and their state updates settle.
const settle = () => act(async () => {});

function setup(d: DocumentRow = doc()) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const view = render(row(d));
  return { user, ...view };
}

beforeEach(() => {
  // Time moves only when a test advances it, so the 800ms debounce never fires on its own.
  vi.useFakeTimers();
  // Testing Library only advances fake timers in its async wrapper when it sees Jest; without this it hangs.
  vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime.bind(vi) });
  fetchMock = vi.fn(async () => reply(200, {}));
  vi.stubGlobal("fetch", fetchMock);
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("notes autosave", () => {
  it("sends one save 800ms after typing stops", async () => {
    const { user } = setup();
    await user.type(notesBox(), "abc");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(800));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodies()).toEqual([{ notes: "abc" }]);
  });

  it("does not save again when the timer fires after a blur already saved", async () => {
    const { user } = setup();
    await user.type(notesBox(), "abc");
    await user.tab();
    await act(async () => vi.advanceTimersByTime(2000));
    await settle();
    expect(bodies()).toEqual([{ notes: "abc" }]);
  });

  it("keeps typed notes after a failed save and resends them on the next blur", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { error: "Bad" }));
    const { user } = setup();
    await user.type(notesBox(), "abc");
    // The autosave fails, so no debounce timer is left pending to resend.
    await act(async () => vi.advanceTimersByTime(800));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Bad");
    expect(notesBox().value).toBe("abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(notesBox());
    await user.tab();
    await settle();
    expect(bodies()).toEqual([{ notes: "abc" }, { notes: "abc" }]);
  });

  it("resends notes on the next blur after the server could not be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { user } = setup();
    await user.type(notesBox(), "abc");
    await user.tab();
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Could not reach the server. Please try again.");

    // Timers are never advanced here, so the second save can only come from the blur.
    await user.click(notesBox());
    await user.tab();
    await settle();
    expect(bodies()).toEqual([{ notes: "abc" }, { notes: "abc" }]);
  });
});

describe("save queue", () => {
  it("sends saves one at a time, in the order they were made", async () => {
    let resolveFirst!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolveFirst = r)));
    const { user } = setup();

    await user.selectOptions(statusSelect(), "Received");
    await user.selectOptions(statusSelect(), "Approved");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveFirst(reply(200, {})));
    await settle();
    expect(bodies()).toEqual([{ status: "Received" }, { status: "Approved" }]);
  });

  it("keeps sending later saves after one fails without an error message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const { user } = setup();

    await user.selectOptions(statusSelect(), "Received");
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Could not save. Please try again.");
    expect(statusSelect().value).toBe("Pending");

    await user.selectOptions(statusSelect(), "Approved");
    await settle();
    expect(bodies()).toEqual([{ status: "Received" }, { status: "Approved" }]);
  });
});

describe("save results", () => {
  it("puts the status back and shows the server's error when a status save fails", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { error: "Bad" }));
    const { user } = setup(doc({ notes: "keep me", date_received: "2026-01-02" }));
    // An unsaved date edit (no blur) must survive the status revert.
    fireEvent.change(receivedInput(), { target: { value: "2026-02-01" } });

    await user.selectOptions(statusSelect(), "Approved");
    await settle();
    expect(statusSelect().value).toBe("Pending");
    expect(screen.getByRole("status").textContent).toBe("Bad");
    expect(receivedInput().value).toBe("2026-02-01");
    expect(notesBox().value).toBe("keep me");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts the received date back when a date save fails", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { error: "Bad" }));
    setup(doc({ date_received: "2026-01-02" }));

    fireEvent.change(receivedInput(), { target: { value: "2026-02-01" } });
    fireEvent.blur(receivedInput());
    await settle();
    expect(bodies()).toEqual([{ date_received: "2026-02-01" }]);
    expect(receivedInput().value).toBe("2026-01-02");
    expect(screen.getByRole("status").textContent).toBe("Bad");
  });

  it("says the server could not be reached when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { user } = setup();

    await user.selectOptions(statusSelect(), "Received");
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Could not reach the server. Please try again.");
  });

  it("shows Saved and refreshes the page after a successful save", async () => {
    const { user } = setup();

    await user.selectOptions(statusSelect(), "Received");
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Saved");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
  });
});

describe("server refresh", () => {
  it("keeps notes being typed when a refresh brings new notes", async () => {
    const { user, rerender } = setup(doc({ notes: "old" }));
    await user.clear(notesBox());
    await user.type(notesBox(), "typing");

    rerender(row(doc({ notes: "from server" })));
    expect(notesBox().value).toBe("typing");
  });

  it("shows the new notes when a refresh arrives and the field is not focused", () => {
    const { rerender } = setup(doc({ notes: "old" }));
    rerender(row(doc({ notes: "from server" })));
    expect(notesBox().value).toBe("from server");
  });
});

describe("flush on close", () => {
  // Types a received date without blurring, so it is still unsaved.
  function withUnsavedDate() {
    const view = setup();
    fireEvent.change(receivedInput(), { target: { value: "2026-02-01" } });
    expect(fetchMock).not.toHaveBeenCalled();
    return view;
  }

  function expectFlushed() {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ keepalive: true });
    expect(bodies()).toEqual([{ date_received: "2026-02-01" }]);
  }

  it("sends the unsaved field on pagehide", () => {
    withUnsavedDate();
    window.dispatchEvent(new Event("pagehide"));
    expectFlushed();
  });

  it("sends the unsaved field when the tab is hidden", () => {
    withUnsavedDate();
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();
    expectFlushed();
  });

  it("sends nothing when the tab becomes visible", () => {
    withUnsavedDate();
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the unsaved field when the row unmounts", () => {
    const { unmount } = withUnsavedDate();
    unmount();
    expectFlushed();
  });

  it("sends nothing when nothing is unsaved", () => {
    const { unmount } = setup(doc({ notes: "saved" }));
    window.dispatchEvent(new Event("pagehide"));
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    spy.mockRestore();
    unmount();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
