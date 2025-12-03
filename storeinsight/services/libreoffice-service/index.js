import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

app.post("/convert", upload.single("file"), async (req, res) => {
  const format = (req.body?.format || "").toLowerCase();
  if (!["pdf", "png"].includes(format)) {
    return res.status(400).json({ error: 'Invalid format; expected "pdf" or "png"' });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Missing file" });
  }

  const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), "libre-convert-"));
  const inputPath = path.join(tempBase, req.file.originalname || "input.pptx");

  try {
    await fs.writeFile(inputPath, req.file.buffer);

    await new Promise((resolve, reject) => {
      execFile(
        "soffice",
        ["--headless", "--convert-to", format, "--outdir", tempBase, inputPath],
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

    const files = await fs.readdir(tempBase);
    const targetExt = format === "pdf" ? ".pdf" : ".png";
    const outputName =
      files.find((f) => f.toLowerCase().endsWith(targetExt)) ||
      files.find((f) => f.toLowerCase().includes(targetExt));
    if (!outputName) {
      return res.status(500).json({ error: "Conversion succeeded but no output file found" });
    }

    const outputPath = path.join(tempBase, outputName);
    const outputBuffer = await fs.readFile(outputPath);

    res.status(200);
    if (format === "pdf") {
      res.contentType("application/pdf");
    } else {
      res.contentType("image/png");
    }
    res.send(outputBuffer);
  } catch (err) {
    console.error("[libre-service] conversion failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Conversion failed" });
  } finally {
    // Clean up temp directory
    await fs.rm(tempBase, { recursive: true, force: true }).catch(() => undefined);
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[libre-service] listening on port ${PORT} (cwd=${__dirname})`);
});
