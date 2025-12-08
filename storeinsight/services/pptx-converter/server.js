import express from "express";
import { Storage } from "@google-cloud/storage";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import util from "node:util";

const app = express();
const port = process.env.PORT || 8080;
app.use(express.json({ limit: "10mb" }));

const storage = new Storage();
const execFileAsync = util.promisify(execFile);

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const runSoffice = async (inputPath, outputDir) => {
  await ensureDir(outputDir);
  const userInstall = `-env:UserInstallation=file:///tmp/lo-profile`;
  const pdfArgs = ["--headless", userInstall, "--convert-to", "pdf:impress_pdf_Export", "--outdir", outputDir, inputPath];
  const pngArgs = ["--headless", userInstall, "--convert-to", "png:draw_png_Export", "--outdir", outputDir, inputPath];
  await execFileAsync("soffice", pdfArgs);
  await execFileAsync("soffice", pngArgs);
};

const uploadOutputs = async (bucket, outputDir, outputBasePath, baseName) => {
  const entries = await fs.readdir(outputDir);
  const pdfFiles = entries.filter((f) => f.toLowerCase().endsWith(".pdf"));
  const pngFiles = entries.filter((f) => f.toLowerCase().endsWith(".png"));

  let pdfPath = "";
  const slidePngPaths = [];

  for (const file of pdfFiles) {
    const dest = `${outputBasePath}/${baseName}.pdf`;
    await bucket.upload(path.join(outputDir, file), {
      destination: dest,
      metadata: { contentType: "application/pdf", cacheControl: "public,max-age=86400" },
      resumable: false,
    });
    pdfPath = dest;
  }

  pngFiles.sort().forEach((file, idx) => {
    const dest = `${outputBasePath}/${baseName}-${idx + 1}.png`;
    slidePngPaths.push(dest);
  });

  for (let i = 0; i < pngFiles.length; i += 1) {
    const file = pngFiles[i];
    await bucket.upload(path.join(outputDir, file), {
      destination: slidePngPaths[i],
      metadata: { contentType: "image/png", cacheControl: "public,max-age=86400" },
      resumable: false,
    });
  }

  return { pdfPath, slidePngPaths };
};

app.post("/convert-pptx", async (req, res) => {
  try {
    const { storageBucket, pptxPath, outputBasePath } = req.body || {};
    if (!storageBucket || !pptxPath || !outputBasePath) {
      return res.status(400).json({ error: "storageBucket, pptxPath, and outputBasePath are required" });
    }

    const bucket = storage.bucket(storageBucket);
    const tmpDir = await fs.mkdtemp("/tmp/pptx-");
    const inputPath = path.join(tmpDir, "input.pptx");
    const outputDir = path.join(tmpDir, "output");

    await ensureDir(outputDir);
    await bucket.file(pptxPath).download({ destination: inputPath });

    await runSoffice(inputPath, outputDir);

    const baseName = path.basename(pptxPath, path.extname(pptxPath)) || "flash";
    const { pdfPath, slidePngPaths } = await uploadOutputs(bucket, outputDir, outputBasePath.replace(/\/+$/, ""), baseName);

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);

    return res.json({ pdfPath, slidePngPaths });
  } catch (err) {
    console.error("[pptx-converter] failed", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "conversion failed" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(`pptx-converter listening on port ${port}`);
});
