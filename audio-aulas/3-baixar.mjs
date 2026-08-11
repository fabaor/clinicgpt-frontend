// PASSO 3 - Baixar as midias do catalogo.
//
//   npm run baixar              -> baixa tudo que for audio
//   npm run baixar -- --tudo    -> inclui video (extrai so a faixa de audio)
//
// Audio direto (.mp3/.m4a) baixa via HTTP com os cookies da sessao.
// HLS (.m3u8) e video passam pelo ffmpeg.

import { request } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUTH_FILE, CATALOGO, DIR_AUDIO } from "./config.mjs";

const INCLUIR_VIDEO = process.argv.includes("--tudo");

for (const f of [CATALOGO, AUTH_FILE]) {
  if (!existsSync(f)) {
    console.error(`\n[ERRO] ${f} nao existe. Rode os passos 1 e 2 antes.\n`);
    process.exit(1);
  }
}

mkdirSync(DIR_AUDIO, { recursive: true });

const catalogo = JSON.parse(readFileSync(CATALOGO, "utf8"));
const auth = JSON.parse(readFileSync(AUTH_FILE, "utf8"));

// Header Cookie para o ffmpeg (ele nao le o storageState do Playwright).
const cookieHeader = (auth.cookies || [])
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");

function temFfmpeg() {
  return new Promise((res) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => res(false));
    p.on("close", (code) => res(code === 0));
  });
}

function nomeSeguro(texto, fallback) {
  const base = (texto || fallback || "aula")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 90);
  return base || fallback || "aula";
}

function rodarFfmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let erro = "";
    p.stderr.on("data", (d) => (erro += d.toString()));
    p.on("error", rej);
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(erro.split("\n").slice(-6).join("\n"))),
    );
  });
}

const ffmpegOk = await temFfmpeg();

const alvos = catalogo.filter(
  (m) => m.tipo === "audio" || m.tipo === "hls" || (INCLUIR_VIDEO && m.tipo === "video"),
);

if (alvos.length === 0) {
  console.log("\nNada para baixar. Se o catalogo so tem video, rode:");
  console.log("   npm run baixar -- --tudo\n");
  process.exit(0);
}

if (!ffmpegOk && alvos.some((m) => m.tipo !== "audio")) {
  console.error("\n[ERRO] ffmpeg nao encontrado, e ha HLS/video no catalogo.");
  console.error("       Instale com:  brew install ffmpeg\n");
  process.exit(1);
}

const ctx = await request.newContext({ storageState: AUTH_FILE });

console.log(`\nBaixando ${alvos.length} item(ns) para ./${DIR_AUDIO}/\n`);

const relatorio = [];
let i = 0;

for (const midia of alvos) {
  i++;
  const rotulo = `[${i}/${alvos.length}]`;
  const nomeBase = nomeSeguro(midia.tituloPagina, `aula-${String(i).padStart(3, "0")}`);

  try {
    if (midia.tipo === "audio") {
      const ext = (midia.url.split("?")[0].match(/\.[a-z0-9]+$/i) || [".mp3"])[0];
      const destino = join(DIR_AUDIO, `${String(i).padStart(3, "0")}-${nomeBase}${ext}`);

      if (existsSync(destino) && statSync(destino).size > 0) {
        console.log(`${rotulo} ja existe, pulando: ${destino}`);
        relatorio.push({ ...midia, destino, status: "ja-existia" });
        continue;
      }

      console.log(`${rotulo} ${nomeBase}${ext}`);
      const res = await ctx.get(midia.url, {
        headers: { Referer: midia.paginaOrigem || "" },
        timeout: 300000,
      });
      if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
      writeFileSync(destino, await res.body());
      relatorio.push({ ...midia, destino, status: "ok" });
    } else {
      // HLS ou video -> ffmpeg, extraindo apenas o audio em m4a.
      const destino = join(DIR_AUDIO, `${String(i).padStart(3, "0")}-${nomeBase}.m4a`);

      if (existsSync(destino) && statSync(destino).size > 0) {
        console.log(`${rotulo} ja existe, pulando: ${destino}`);
        relatorio.push({ ...midia, destino, status: "ja-existia" });
        continue;
      }

      console.log(`${rotulo} ${nomeBase}.m4a  (via ffmpeg, ${midia.tipo})`);
      await rodarFfmpeg([
        "-headers",
        `Cookie: ${cookieHeader}\r\nReferer: ${midia.paginaOrigem || ""}\r\n`,
        "-i",
        midia.url,
        "-vn", // descarta video
        "-acodec",
        "aac",
        "-b:a",
        "96k", // suficiente para transcrever
        "-y",
        destino,
      ]);
      relatorio.push({ ...midia, destino, status: "ok" });
    }
  } catch (e) {
    console.log(`${rotulo} [FALHOU] ${e.message.split("\n")[0]}`);
    relatorio.push({ ...midia, status: "falhou", erro: e.message });
  }
}

await ctx.dispose();
writeFileSync("relatorio-download.json", JSON.stringify(relatorio, null, 2));

const ok = relatorio.filter((r) => r.status === "ok").length;
const pulados = relatorio.filter((r) => r.status === "ja-existia").length;
const falhas = relatorio.filter((r) => r.status === "falhou").length;

console.log("\n=====================================================");
console.log(`  Baixados: ${ok}   Ja existiam: ${pulados}   Falhas: ${falhas}`);
console.log("=====================================================\n");
if (falhas) console.log("Detalhes das falhas em relatorio-download.json\n");
console.log("Proximo passo:  ./4-transcrever.sh\n");
