"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Pill, TONE_CLASSES } from "@/components/ui";
import { documentStatusTone, unsavedChanges, type DocumentPatch, type DocumentRow } from "@/lib/rules";

/** Notes save this long after the last keystroke, so they're kept even if the field never loses focus. */
const NOTES_AUTOSAVE_MS = 800;

function sendPatch(id: number, patch: DocumentPatch) {
  // keepalive lets a save started as the page closes still reach the server.
  return fetch(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    keepalive: true,
  });
}

export default function DocumentRowEditor({
  striped,
  doc,
  statuses,
  expired,
  derivedExpired,
  expiringSoon,
  expiresLabel,
  asOf,
}: {
  striped: boolean;
  doc: DocumentRow;
  statuses: string[];
  expired: boolean;
  derivedExpired: boolean;
  expiringSoon: boolean;
  expiresLabel: string;
  asOf: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(doc.status);
  const [received, setReceived] = useState(doc.date_received ?? "");
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [message, setMessage] = useState<{ kind: "error" | "saved"; text: string } | null>(null);
  const notesFocused = useRef(false);
  // The notes value most recently sent, so autosave and blur don't send the same text twice.
  const sentNotes = useRef(doc.notes ?? "");
  // Saves for this row run one at a time, in order, so an older save can't overwrite a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ doc, shown: { status, date_received: received, notes } });

  // Pick up server-side changes (auto-filled dates, recalculated expiry) after a refresh. One effect per
  // field, so a refresh from one field's save never overwrites something still being typed in another.
  useEffect(() => setStatus(doc.status), [doc.status]);
  useEffect(() => setReceived(doc.date_received ?? ""), [doc.date_received]);
  useEffect(() => {
    sentNotes.current = doc.notes ?? "";
    if (!notesFocused.current) setNotes(doc.notes ?? "");
  }, [doc.notes]);

  useEffect(() => {
    latest.current = { doc, shown: { status, date_received: received, notes } };
  });

  // Save notes after a pause in typing.
  useEffect(() => {
    if (notes === sentNotes.current) return;
    const t = setTimeout(() => saveNotes(notes), NOTES_AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [notes]);

  // Send anything not yet saved when the tab is hidden or closed, or the row unmounts.
  useEffect(() => {
    function flush() {
      const { doc: saved, shown } = latest.current;
      const patch = unsavedChanges(saved, shown);
      if (Object.keys(patch).length > 0) sendPatch(saved.id, patch).catch(() => {});
    }
    const onHidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, [doc.id]);

  function saveNotes(value: string) {
    if (value === sentNotes.current) return;
    sentNotes.current = value;
    save({ notes: value });
  }

  function save(patch: DocumentPatch) {
    queue.current = queue.current.then(() => send(patch));
  }

  async function send(patch: DocumentPatch) {
    setMessage(null);
    try {
      const res = await sendPatch(doc.id, patch);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error ?? "Could not save. Please try again." });
        // Put back only the fields this save tried to change; typed notes are kept so they can be retried.
        const saved = latest.current.doc;
        if (patch.status !== undefined) setStatus(saved.status);
        if (patch.date_received !== undefined) setReceived(saved.date_received ?? "");
        if (patch.notes !== undefined) sentNotes.current = saved.notes ?? "";
        return;
      }
      setMessage({ kind: "saved", text: "Saved" });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Please try again." });
      if (patch.notes !== undefined) sentNotes.current = latest.current.doc.notes ?? "";
    }
  }

  const field =
    "rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
  const cell = "border-b border-line px-[18px] py-2 align-middle";

  return (
    <tr className={striped ? "bg-surface-alt" : "bg-surface"}>
      <td className={`${cell} ${expired ? "shadow-[inset_3px_0_0_var(--color-red-fg)]" : ""}`}>
        <div className="font-semibold text-text">{doc.document_type}</div>
        {message && (
          <div
            className={`mt-1 ${message.kind === "error" ? "text-red-fg" : "text-green-fg"}`}
            role="status"
          >
            {message.text}
          </div>
        )}
      </td>
      <td className={cell}>
        <select
          aria-label={`Status for ${doc.document_type}`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            save({ status: e.target.value });
          }}
          className={`select-chevron h-[27px] w-[124px] cursor-pointer rounded-full border-0 pl-2.5 [--chevron-x:10px] text-[11px] font-semibold outline-none focus:ring-2 focus:ring-brand/30 ${TONE_CLASSES[documentStatusTone(status)]}`}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {derivedExpired && <div className="mt-1 text-red-fg">Counts as expired: past its expiry date</div>}
      </td>
      <td className={cell}>
        <input
          type="date"
          aria-label={`Received date for ${doc.document_type}`}
          value={received}
          max={asOf}
          onChange={(e) => setReceived(e.target.value)}
          onBlur={() => {
            if (received !== (doc.date_received ?? "")) save({ date_received: received || null });
          }}
          className={field}
        />
      </td>
      <td className={cell}>
        <div className="flex flex-wrap items-center gap-1.5">
          {expiresLabel ? <span>{expiresLabel}</span> : !expired && <span className="text-muted">—</span>}
          {expired && <Pill tone="red">Expired</Pill>}
          {expiringSoon && <Pill tone="amber">Expiring soon</Pill>}
        </div>
      </td>
      <td className={cell}>
        <textarea
          aria-label={`Notes for ${doc.document_type}`}
          rows={1}
          value={notes}
          maxLength={2000}
          placeholder="Add a note"
          onChange={(e) => setNotes(e.target.value)}
          onFocus={() => {
            notesFocused.current = true;
          }}
          onBlur={() => {
            notesFocused.current = false;
            saveNotes(notes);
          }}
          className={`${field} min-w-[180px] w-full resize-y placeholder:text-muted/70`}
        />
      </td>
    </tr>
  );
}
