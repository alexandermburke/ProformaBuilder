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
    const propertyId = (body.propertyId ?? body.tenantPropertyId ?? body.id ?? body.propertyCode ?? "").toString().trim();
    const propertyCode = (body.propertyCode ?? "").toString().trim();
    const heroImageRemove =
      body.heroImageRemove === true ||
      (typeof (body as Record<string, unknown>).heroImageRemove === "string" &&
        (body as Record<string, unknown>).heroImageRemove === "true");

    const payload: Partial<PropertyConfig> = {
      id: body.id ?? (propertyId || undefined),
      propertyCode: propertyCode || propertyId,
      propertyId: propertyId || propertyCode,
      name: body.name,
      tenantPropertyId: body.tenantPropertyId ?? propertyId,
      sendTimeLocal: body.sendTimeLocal ?? body.sendTimeMst,
      sendTimeMst: body.sendTimeMst ?? body.sendTimeLocal,
      timezone: body.timezone,
      ownerEmails,
      enabled: body.enabled,
      propertyImageData: body.propertyImageData ?? body.imagePath,
      imagePath: body.imagePath ?? body.propertyImageData,
      heroImagePath: body.heroImagePath,
      heroImageRemove,
      facilityOpenDate: body.facilityOpenDate,
      momPlaceholderMonths: body.momPlaceholderMonths,
      momPlaceholderGrossAccruedRent: body.momPlaceholderGrossAccruedRent,
      momPlaceholderOccupiedPct: body.momPlaceholderOccupiedPct,
      storeManagedMarkerMonth: body.storeManagedMarkerMonth,
      storeManagedMarkerText: body.storeManagedMarkerText,
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
