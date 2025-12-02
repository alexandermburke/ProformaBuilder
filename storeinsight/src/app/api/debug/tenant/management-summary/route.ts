import { NextResponse } from "next/server";
import { getManagementSummary, mapManagementSummaryToTokens } from "@/lib/tenantReports";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId") || process.env.TENANT_PROPERTY_ID || "";
    const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const companyId = process.env.TENANT_COMPANY_ID || "";
    const apiKey = process.env.TENANT_APP_KEY || process.env.TENANT_API || "";
    const appId = process.env.TENANT_APP_ID || "";
    const baseUrl = process.env.TENANT_BASE_URL?.trim() || "https://api.tenantinc.com";

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required (query param or TENANT_PROPERTY_ID env)" }, { status: 400 });
    }
    if (!companyId || !apiKey || !appId) {
      return NextResponse.json({ error: "Missing Tenant credentials (TENANT_COMPANY_ID, TENANT_APP_KEY, TENANT_APP_ID)" }, { status: 400 });
    }

    const summary = await getManagementSummary({
      companyId,
      propertyId,
      date,
      apiKey,
      appId,
      baseUrl,
    });

    const tokens = mapManagementSummaryToTokens(summary);

    return NextResponse.json({ summary, tokens }, { status: 200 });
  } catch (err: any) {
    console.error("Tenant management summary test failed:", err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
