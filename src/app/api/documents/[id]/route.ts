import { NextResponse } from "next/server";
import { AS_OF_DATE } from "@/lib/config";
import { getDb, getDocument, updateDocument } from "@/lib/db";
import { applyDocumentEdit } from "@/lib/rules";

export const dynamic = "force-dynamic";

/** Update one document's status, received date and/or notes. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  if (!/^[1-9]\d*$/.test(rawId)) {
    return NextResponse.json({ error: "That document could not be found." }, { status: 404 });
  }
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) {
    return NextResponse.json({ error: "That document could not be found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The change could not be read. Please try again." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "The change could not be read. Please try again." }, { status: 400 });
  }

  const db = getDb();
  const current = getDocument(db, id);
  if (!current) {
    return NextResponse.json({ error: "That document could not be found." }, { status: 404 });
  }

  const { status, date_received, notes } = body as Record<string, unknown>;
  const result = applyDocumentEdit(current, { status, date_received, notes }, AS_OF_DATE);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const updated = updateDocument(db, id, result.fields);
  return NextResponse.json({ document: updated });
}
