import fs from "fs";
import path from "path";
import sharp from "sharp";

const idxPath = path.join("server", "data", "index.json");
const data = JSON.parse(fs.readFileSync(idxPath, "utf8"));
let fixed = 0, missing = 0;
for (const rec of data) {
  if (rec.width === 0 && rec.absPath) {
    if (!fs.existsSync(rec.absPath)) { missing++; continue; }
    try {
      const info = await sharp(rec.absPath).metadata();
      rec.width = info.width || 0;
      rec.height = info.height || 0;
      fixed++;
    } catch(e) {}
  }
}
fs.writeFileSync(idxPath, JSON.stringify(data, null, 2));
console.log("Fixed", fixed, "missing", missing, "total", data.length);
