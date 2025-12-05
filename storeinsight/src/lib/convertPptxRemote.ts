export type ConvertPptxParams = {
  convertUrl: string;
  storageBucket: string;
  pptxPath: string;
  outputBasePath: string;
};

export type ConvertPptxResult = {
  pdfPath: string;
  slidePngPaths: string[];
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

export async function convertPptxRemote(params: ConvertPptxParams): Promise<ConvertPptxResult> {
  const endpoint = resolveConvertEndpoint(params.convertUrl);
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
  const data = (await res.json()) as ConvertPptxResult;
  return data;
}
