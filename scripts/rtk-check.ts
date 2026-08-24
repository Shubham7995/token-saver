/** Direct RTK probe: does the extracted text filter still collapse command noise? */
import { processRtkText } from "../src/engine/engines/rtk/index.ts";
import { DEFAULT_RTK_CONFIG } from "../src/engine/types.ts";

const ESC = String.fromCharCode(27);
const text = [
  `${ESC}[32mnpm${ESC}[0m install running...`,
  ...Array.from({ length: 40 }, (_, i) => `[####      ] downloading package-${i} 45%`),
  "added 2433 packages in 2m",
  "WARN deprecated glob@10.5.0: old versions are not supported",
  "found 0 vulnerabilities",
].join("\n");

const out = processRtkText(text, {
  config: { ...DEFAULT_RTK_CONFIG, enabled: true, intensity: "aggressive" },
  command: "npm install",
});

console.log("input chars:", text.length);
console.log("output chars:", JSON.stringify(out).length);
console.log("---output---");
console.log(JSON.stringify(out, null, 2).slice(0, 1200));
