// t("...") / tr("...") 로 감싼 한국어 문구 중 영어 사전(lib/en.ts)에 없는 것을 찾는다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (["node_modules", ".next", "out", "scripts"].includes(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mjs)$/.test(n) && !p.endsWith("lib/en.ts") && !p.endsWith("lib/i18n.ts")) files.push(p);
  }
};
walk(root);

const enSrc = readFileSync(join(root, "lib/en.ts"), "utf8");
const keys = new Set();
for (const m of enSrc.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) keys.add(JSON.parse(`"${m[1]}"`));

const missing = new Map();
// t( / tr( / k( 호출 안의 문자열을 모두 모은다 (삼항 t(a ? "x" : "y") 포함, {vars} 객체 안은 제외)
function stringsInCalls(src) {
  const out = [];
  const re = /\b(?:tr|t|k)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1, brace = 0;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        let j = i + 1;
        while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
        if (ch === '"' && depth === 1 && brace === 0) out.push(JSON.parse(src.slice(i, j + 1)));
        i = j + 1;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "{") brace++;
      else if (ch === "}") brace--;
      i++;
    }
  }
  return out;
}
for (const f of files) {
  for (const k of stringsInCalls(readFileSync(f, "utf8"))) {
    if (!/[가-힣]/.test(k)) continue;
    if (!keys.has(k)) missing.set(k, f.replace(root, ""));
  }
}
if (missing.size) {
  console.error(`영어 번역이 없는 문구 ${missing.size}개:`);
  for (const [k, f] of missing) console.error(`  ${JSON.stringify(k)}  (${f})`);
  process.exit(1);
}
console.log(`i18n OK (${keys.size}개 문구)`);
