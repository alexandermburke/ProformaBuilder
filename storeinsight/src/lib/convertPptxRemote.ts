export type ConvertPptxParams = {
  convertUrl: string;
  storageBucket: string;
  pptxPath: string;
  outputBasePath: string;
  pptxBuffer?: Buffer;
  pptxFilename?: string;
};

export type ConvertPptxResult = {
  pdfPath?: string;
  slidePngPaths?: string[];
  pdfBuffer?: Buffer;
  slidePngBuffers?: Buffer[];
};

function resolveConvertEndpoint(convertUrl: string): string {
  const trimmed = convertUrl.trim();
  if (!trimmed) {
    throw new Error("convertUrl is empty");
  }
  const normalized = trimmed.replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  // Allow callers to pass the full endpoint (e.g., https://svc/convert or .../convert-pptx)
  if (lower.endsWith("/convert-pptx") || lower.endsWith("/convert")) {
    return normalized;
  }
  // Default to the service's /convert endpoint
  return `${normalized}/convert`;
}

const normalizeResultFromJson = (data: unknown): ConvertPptxResult => {
  if (!data || typeof data !== "object") return {};
  const obj = data as Record<string, unknown>;
  const pdfPath = typeof obj.pdfPath === "string" ? obj.pdfPath : undefined;
  const slidePngPaths = Array.isArray(obj.slidePngPaths)
    ? (obj.slidePngPaths as unknown[]).filter((p): p is string => typeof p === "string")
    : undefined;
  const pdfBase64 = typeof obj.pdfBase64 === "string" ? obj.pdfBase64 : undefined;
  const slidePngBase64 = Array.isArray(obj.slidePngBase64)
    ? (obj.slidePngBase64 as unknown[]).filter((p): p is string => typeof p === "string")
    : undefined;
  return {
    pdfPath,
    slidePngPaths,
    pdfBuffer: pdfBase64 ? Buffer.from(pdfBase64, "base64") : undefined,
    slidePngBuffers: slidePngBase64?.map((b) => Buffer.from(b, "base64")),
  };
};

async function convertViaUpload(params: ConvertPptxParams, endpoint: string): Promise<ConvertPptxResult> {
  if (!params.pptxBuffer || params.pptxBuffer.length === 0) {
    throw new Error("pptxBuffer is required for upload conversion");
  }

  const fileName =
    params.pptxFilename ||
    (params.pptxPath ? params.pptxPath.split("/").pop() || "flash.pptx" : "flash.pptx");

  const form = new FormData();
  const blob = new Blob([params.pptxBuffer], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  form.append("file", blob, fileName);

  const res = await fetch(endpoint, {
    method: "POST",
    body: form,
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Remote PPTX convert failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
    }
    return normalizeResultFromJson(json);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Remote PPTX convert failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream") || !contentType) {
    return { pdfBuffer: buffer };
  }
  if (contentType.includes("image/png")) {
    return { slidePngBuffers: [buffer] };
  }

  // Fallback: return raw buffer as PDF if content type is unexpected
  return { pdfBuffer: buffer };
}

export async function convertPptxRemote(params: ConvertPptxParams): Promise<ConvertPptxResult> {
  const endpoint = resolveConvertEndpoint(params.convertUrl);
  if (params.pptxBuffer && params.pptxBuffer.length > 0) {
    try {
      return await convertViaUpload(params, endpoint);
    } catch (uploadErr) {
      // If upload mode fails, fall back to JSON (legacy converter) so callers still get an error message
      console.warn("[convertPptxRemote] upload mode failed, attempting legacy body", uploadErr);
    }
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      storageBucket: params.storageBucket,
      pptxPath: params.pptxPath,
      outputBasePath: params.outputBasePath,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Remote PPTX convert failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as unknown;
  return normalizeResultFromJson(data);
}
