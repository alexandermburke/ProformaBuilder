export type ConvertPptxParams = {
  convertUrl: string;
  storageBucket?: string; // legacy support
  pptxPath?: string; // legacy support
  outputBasePath?: string; // legacy support
  pptxBuffer?: Buffer;
  pptxFilename?: string;
};

export type ConvertPptxResult = {
  pdfBuffer: Buffer | null;
  pngBuffer: Buffer | null;
  pdfFilename: string | null;
  pngFilename: string | null;
};

function resolveConvertEndpoints(convertUrl: string): { primary: string; fallback: string } {
  const trimmed = convertUrl.trim();
  if (!trimmed) {
    throw new Error("convertUrl is empty");
  }
  const normalized = trimmed.replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  const primary = lower.endsWith("/convert-pptx") ? normalized : `${normalized}/convert-pptx`;
  const fallback = normalized;
  return { primary, fallback };
}

const emptyResult = (): ConvertPptxResult => ({
  pdfBuffer: null,
  pngBuffer: null,
  pdfFilename: null,
  pngFilename: null,
});

const normalizeResultFromJson = (data: unknown): ConvertPptxResult => {
  if (!data || typeof data !== "object") return emptyResult();
  const obj = data as Record<string, unknown>;
  const pdfBase64 = typeof obj.pdfBase64 === "string" ? obj.pdfBase64 : undefined;
  const pngBase64 = typeof obj.pngBase64 === "string" ? obj.pngBase64 : undefined;
  const pdfFilename = typeof obj.pdfFilename === "string" ? obj.pdfFilename : null;
  const pngFilename = typeof obj.pngFilename === "string" ? obj.pngFilename : null;
  return {
    pdfBuffer: pdfBase64 ? Buffer.from(pdfBase64, "base64") : null,
    pngBuffer: pngBase64 ? Buffer.from(pngBase64, "base64") : null,
    pdfFilename,
    pngFilename,
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
  const blob = new Blob([new Uint8Array(params.pptxBuffer)], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  form.append("file", blob, fileName);
  form.append("quality", "high");
  form.append("exportProfile", "impress_pdf_Export");

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
    return { pdfBuffer: buffer, pngBuffer: null, pdfFilename: null, pngFilename: null };
  }
  if (contentType.includes("image/png")) {
    return { pdfBuffer: null, pngBuffer: buffer, pdfFilename: null, pngFilename: null };
  }

  // Fallback: return raw buffer as PDF if content type is unexpected
  return { pdfBuffer: buffer, pngBuffer: null, pdfFilename: null, pngFilename: null };
}

export async function convertPptxRemote(params: ConvertPptxParams): Promise<ConvertPptxResult> {
  const { primary, fallback } = resolveConvertEndpoints(params.convertUrl);
  if (params.pptxBuffer && params.pptxBuffer.length > 0) {
    // Try preferred endpoint first, then fallback if it fails
    try {
      return await convertViaUpload(params, primary);
    } catch (uploadErr) {
      if (fallback !== primary) {
        console.warn("[convertPptxRemote] upload primary failed, retrying fallback endpoint", uploadErr);
        try {
          return await convertViaUpload(params, fallback);
        } catch (fallbackErr) {
          console.warn("[convertPptxRemote] upload fallback failed, attempting legacy body", fallbackErr);
        }
      } else {
        console.warn("[convertPptxRemote] upload failed, attempting legacy body", uploadErr);
      }
    }
  }

  // Legacy JSON body path for older converter deployments
  const res = await fetch(primary, {
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
