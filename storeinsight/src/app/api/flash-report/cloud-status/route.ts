import { NextResponse } from "next/server";
import { getCloudStatus } from "@/app/api/flash-report/cloud-status/store";

export async function GET() {
  try {
    const payload = await getCloudStatus();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[flash-report/cloud-status] failed to load status", err);
    return NextResponse.json({ error: "Unable to load cloud status" }, { status: 500 });
  }
}
