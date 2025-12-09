import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";

const fontPath = path.join(process.cwd(), "fonts", "Inter-Regular.ttf");

// Register "Inter" as a canvas font family so Chart.js can use it
GlobalFonts.registerFromPath(fontPath, "Inter");
