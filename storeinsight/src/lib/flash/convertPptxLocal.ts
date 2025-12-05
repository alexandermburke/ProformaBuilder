import { execFile } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

const resolveSofficePath = (): string => {
  const envPath = process.env.LIBREOFFICE_PATH;
  if (envPath) return envPath;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files\\LibreOffice\\program\\soffice.com",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  } else {
    const candidates = ["/usr/bin/soffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice"];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "soffice";
};

export async function convertPptxBufferToPngLocal(pptBuffer: Buffer): Promise<Buffer> {
  if (!pptBuffer || pptBuffer.length === 0) {
    throw new Error("PPTX buffer is empty");
  }
  const sofficePath = resolveSofficePath();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "flash-ppt-"));
  const pptPath = path.join(tempDir, "flash.pptx");
  try {
    await fsp.writeFile(pptPath, pptBuffer);
    await new Promise<void>((resolve, reject) => {
      execFile(
        sofficePath,
        ["--headless", "--convert-to", "png", "--outdir", tempDir, pptPath],
        (error, stdout, stderr) => {
          if (error) {
            error.message += `; stdout: ${stdout}; stderr: ${stderr}`;
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
    const files = await fsp.readdir(tempDir);
    const pngName = files.find((f) => f.toLowerCase().endsWith(".png"));
    if (!pngName) {
      throw new Error("LibreOffice convert did not produce a PNG");
    }
    const pngBuffer = await fsp.readFile(path.join(tempDir, pngName));
    return pngBuffer;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function convertPptxBufferToPdfLocal(pptBuffer: Buffer): Promise<Buffer> {
  if (!pptBuffer || pptBuffer.length === 0) {
    throw new Error("PPTX buffer is empty");
  }
  const sofficePath = resolveSofficePath();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "flash-pdf-"));
  const pptPath = path.join(tempDir, "flash.pptx");
  try {
    await fsp.writeFile(pptPath, pptBuffer);
    await new Promise<void>((resolve, reject) => {
      execFile(
        sofficePath,
        ["--headless", "--convert-to", "pdf", "--outdir", tempDir, pptPath],
        (error, stdout, stderr) => {
          if (error) {
            error.message += `; stdout: ${stdout}; stderr: ${stderr}`;
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
    const files = await fsp.readdir(tempDir);
    const pdfName = files.find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdfName) {
      throw new Error("LibreOffice convert did not produce a PDF");
    }
    const pdfBuffer = await fsp.readFile(path.join(tempDir, pdfName));
    return pdfBuffer;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
