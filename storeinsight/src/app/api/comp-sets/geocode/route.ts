import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/compSets/geocode";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").trim();
  if (!address) {
    return NextResponse.json({ ok: false, status: "invalid", error: "address is required" }, { status: 400 });
  }

  if (address.length > 220) {
    return NextResponse.json(
      { ok: false, status: "invalid", error: "Address is too long. Try a shorter format: Street, City, State ZIP." },
      { status: 400 },
    );
  }

  const result = await geocodeAddress(address);
  return NextResponse.json({
    ok: result.status === "matched",
    status: result.status,
    distanceMode: "address-only",
    query: result.query,
    lat: result.point?.lat ?? null,
    lon: result.point?.lon ?? null,
  });
}
