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

export async function convertPptxRemote(params: ConvertPptxParams): Promise<ConvertPptxResult> {
  const res = await fetch(`${params.convertUrl.replace(/\/$/, "")}/convert-pptx`, {
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
