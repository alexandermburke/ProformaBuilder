import path from "node:path";
import { registerFont } from "canvas";

const fontPath = path.join(process.cwd(), "fonts", "Inter-Regular.ttf");

// Register "Inter" as a canvas font family so Chart.js can use it
registerFont(fontPath, { family: "Inter" });
