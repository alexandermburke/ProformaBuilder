import { NextRequest, NextResponse } from "next/server";
import { deleteProperty, listProperties, upsertProperty } from "@/app/api/daily-summary/store";
import type { PropertyConfig } from "@/types/dailySummary";

export async function GET() {
  try {
    const data = await listProperties();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[daily-summary] list properties failed", err);
    return NextResponse.json({ error: "Unable to list properties" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PropertyConfig> & { ownerEmails?: string | string[] };
    const ownerEmails =
      typeof body.ownerEmails === "string"
        ? body.ownerEmails
            .split(",")
            .map((email) => email.trim())
            .filter(Boolean)
        : Array.isArray(body.ownerEmails)
          ? body.ownerEmails
          : [];
    const payload: Partial<PropertyConfig> = {
      id: body.id,
      name: body.name,
      tenantPropertyId: body.tenantPropertyId,
      sendTimeLocal: body.sendTimeLocal,
      timezone: body.timezone,
      ownerEmails,
      enabled: body.enabled,
    };
    const saved = await upsertProperty(payload);
    console.info("[daily-summary] saved property config", saved);
    return NextResponse.json(saved);
  } catch (err) {
    console.error("[daily-summary] unable to save property", err);
    return NextResponse.json({ error: "Unable to save property." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = body?.id;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await deleteProperty(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[daily-summary] unable to delete property", err);
    return NextResponse.json({ error: "Unable to delete property." }, { status: 400 });
  }
}
