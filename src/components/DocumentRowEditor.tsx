"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DocumentRow } from "@/lib/rules";

type Patch = { status?: string; date_received?: string | null; notes?: string };

export default function DocumentRowEditor({
  doc,
  statuses,
  expired,
  derivedExpired,
  expiringSoon,
  expiresLabel,
  asOf,
}: {
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

  // Pick up server-side changes (auto-filled dates, recalculated expiry) after a refresh.
  useEffect(() => {
    setStatus(doc.status);
    setReceived(doc.date_received ?? "");
    setNotes(doc.notes ?? "");
  }, [doc.status, doc.date_received, doc.notes]);

  async function save(patch: Patch) {
    setMessage(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error ?? "Could not save. Please try again." });
        // Put back only the fields this save tried to change; typed notes are kept.
        if (patch.status !== undefined) setStatus(doc.status);
        if (patch.date_received !== undefined) setReceived(doc.date_received ?? "");
        return;
      }
      setMessage({ kind: "saved", text: "Saved" });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Please try again." });
    }
  }

  return (
    <tr className={expired ? "attention" : undefined}>
      <td>
        <strong>{doc.document_type}</strong>
        {message && (
          <div className={message.kind === "error" ? "row-error" : "row-saved"} role="status">
            {message.text}
          </div>
        )}
      </td>
      <td>
        <select
          aria-label={`Status for ${doc.document_type}`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            save({ status: e.target.value });
          }}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {derivedExpired && (
          <div className="row-error">Counts as expired: past its expiry date</div>
        )}
      </td>
      <td>
        <input
          type="date"
          aria-label={`Received date for ${doc.document_type}`}
          value={received}
          max={asOf}
          onChange={(e) => setReceived(e.target.value)}
          onBlur={() => {
            if (received !== (doc.date_received ?? "")) save({ date_received: received || null });
          }}
        />
      </td>
      <td>
        {expiresLabel ? (
          <div className="badges">
            <span>{expiresLabel}</span>
            {expired && <span className="badge red">Expired</span>}
            {expiringSoon && <span className="badge amber">Expiring soon</span>}
          </div>
        ) : expired ? (
          <span className="badge red">Expired</span>
        ) : (
          <span className="subtle">—</span>
        )}
      </td>
      <td>
        <textarea
          aria-label={`Notes for ${doc.document_type}`}
          rows={2}
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (doc.notes ?? "")) save({ notes });
          }}
        />
      </td>
    </tr>
  );
}
