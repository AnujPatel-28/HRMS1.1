// Deploy-skew guard: does the LIVE frontend bundle (entry + every chunk it references) contain a symbol?
// Usage: node scripts/tools/bundle-marker.mjs <symbol> [site]   -> prints the count, exit 0 if found.
const [symbol, site = "https://hrms.talentmeshsolutions.com"] = process.argv.slice(2);
const html = await (await fetch(`${site}/`, { cache: "no-store" })).text();
const seen = new Set();
const queue = [...html.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
let count = 0;
while (queue.length) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const js = await (await fetch(`${site}${path}`)).text();
  count += js.split(symbol).length - 1;
  for (const m of js.matchAll(/(?:\/assets\/|\.\/)([A-Za-z0-9_.-]+\.js)/g)) queue.push(`/assets/${m[1]}`);
}
console.log(`${symbol}: ${count} (in ${seen.size} files of ${site})`);
process.exitCode = count ? 0 : 1;
