import { NextRequest, NextResponse } from "next/server";
import { firestore } from "@/server/firebaseAdmin";

export async function GET() {
  if (!firestore) {
    return NextResponse.json({ flashDevMode: false }, { status: 500 });
  }
  try {
    const doc = await firestore.collection("config").doc("flashSettings").get();
    const data = doc.data();
    const flashDevMode = data && typeof data.flashDevMode === "boolean" ? data.flashDevMode : false;
    return NextResponse.json({ flashDevMode });
  } catch (err) {
    console.warn("[flash-dev-mode] read failed", err);
    return NextResponse.json({ flashDevMode: false, error: "unable to read dev mode" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!firestore) {
    return NextResponse.json({ error: "firestore missing" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { flashDevMode?: boolean };
  const flashDevMode = body.flashDevMode === true;
  try {
    await firestore.collection("config").doc("flashSettings").set({ flashDevMode }, { merge: true });
    return NextResponse.json({ flashDevMode });
  } catch (err) {
    console.error("[flash-dev-mode] update failed", err);
    return NextResponse.json({ error: "unable to update dev mode" }, { status: 500 });
  }
}
