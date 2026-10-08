// Turns the single-file build into an embeddable page fragment (no <html>/<head>/<body> wrappers).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist-artifact/index.html', import.meta.url), 'utf8');
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);
const title = pick(/<title>[\s\S]*?<\/title>/g);
const links = pick(/<link[^>]+fonts\.googleapis[^>]*>/g);
const styles = pick(/<style[\s\S]*?<\/style>/g);
const scripts = pick(/<script[\s\S]*?<\/script>/g);
const body = (src.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || '';
const bodyNoScripts = body.replace(/<script[\s\S]*?<\/script>/g, '');
const out = [...title, ...links, ...styles, bodyNoScripts.trim(), ...scripts].join('\n');
writeFileSync(new URL('../dist-artifact/dustbowl-dynasties.html', import.meta.url), out);
console.log(`artifact page: ${(out.length / 1024).toFixed(0)} KB`);
