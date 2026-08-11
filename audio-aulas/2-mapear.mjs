// PASSO 2 - Mapear as aulas e descobrir as URLs de audio.
//
// Dois modos:
//
//   npm run mapear   -> automatico. Varre o site sozinho, entra em cada
//                       aula e escuta o trafego de rede atras de audio.
//
//   npm run sniff    -> manual. Abre o navegador, VOCE navega pelas aulas,
//                       e ele anota toda midia que passar. Use se o
//                       automatico nao achar nada.
//
// Saida: catalogo.json (as midias) e links-descobertos.json (todos os links,
//        util para eu ajustar os padroes na proxima conversa).

import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";
import {
  BASE_URL,
  AUTH_FILE,
  CATALOGO,
  LINKS_DESCOBERTOS,
  AUDIO_EXT,
  AUDIO_MIME,
  HLS_EXT,
  PADROES_AULA,
  ESPERA_MIDIA_MS,
  MAX_PAGINAS,
} from "./config.mjs";

const MODO_SNIFF = process.argv.includes("--sniff");

if (!existsSync(AUTH_FILE)) {
  console.error(`\n[ERRO] ${AUTH_FILE} nao existe. Rode antes:  npm run login\n`);
  process.exit(1);
}

const origem = new URL(BASE_URL).origin;
const midias = new Map(); // url -> registro
const linksVistos = new Set();
const paginasVisitadas = new Set();

function classificar(url, contentType = "") {
  const semQuery = url.split("?")[0].toLowerCase();
  if (HLS_EXT.some((e) => semQuery.endsWith(e))) return "hls";
  if (AUDIO_EXT.some((e) => semQuery.endsWith(e))) return "audio";
  if (AUDIO_MIME.test(contentType)) return "audio";
  // video tambem serve: da para extrair a faixa de audio com ffmpeg
  if (semQuery.endsWith(".mp4") || /^video\//i.test(contentType)) return "video";
  return null;
}

function registrarMidia(url, contentType, paginaOrigem, tituloPagina) {
  if (midias.has(url)) return;
  const tipo = classificar(url, contentType);
  if (!tipo) return;
  midias.set(url, {
    url,
    tipo,
    contentType: contentType || null,
    paginaOrigem,
    tituloPagina,
    descobertoEm: new Date().toISOString(),
  });
  console.log(`   [+] ${tipo.toUpperCase()}  ${url.slice(0, 110)}`);
}

const navegador = await chromium.launch({ headless: !MODO_SNIFF });
const contexto = await navegador.newContext({
  storageState: AUTH_FILE,
  viewport: MODO_SNIFF ? null : { width: 1440, height: 900 },
});

let paginaAtual = BASE_URL;
let tituloAtual = "";

// Escuta no nivel do contexto: pega tambem o que roda dentro de iframes
// (Panda Video, Vimeo e afins carregam a midia de dominio proprio).
contexto.on("response", (res) => {
  const ct = res.headers()["content-type"] || "";
  registrarMidia(res.url(), ct, paginaAtual, tituloAtual);
});
contexto.on("request", (req) => {
  registrarMidia(req.url(), "", paginaAtual, tituloAtual);
});

const pagina = await contexto.newPage();

// ---------------------------------------------------------------- SNIFF
if (MODO_SNIFF) {
  console.log("\n=====================================================");
  console.log("  MODO MANUAL (sniff)");
  console.log("=====================================================");
  console.log("\n  1. Navegue pelas aulas na janela que abriu.");
  console.log("  2. DE PLAY em cada aula (o audio so aparece no play).");
  console.log("  3. Quando terminar, volte aqui e aperte ENTER.\n");

  await pagina.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  pagina.on("framenavigated", async (frame) => {
    if (frame === pagina.mainFrame()) {
      paginaAtual = frame.url();
      try {
        tituloAtual = await pagina.title();
      } catch {}
    }
  });

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
} else {
  // ------------------------------------------------------------ AUTOMATICO
  console.log("\n=====================================================");
  console.log("  MODO AUTOMATICO");
  console.log("=====================================================\n");

  const fila = [BASE_URL];

  while (fila.length > 0 && paginasVisitadas.size < MAX_PAGINAS) {
    const url = fila.shift();
    if (paginasVisitadas.has(url)) continue;
    paginasVisitadas.add(url);

    paginaAtual = url;
    try {
      await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      tituloAtual = await pagina.title();
    } catch (e) {
      console.log(`   [!] falhou: ${url} (${e.message.split("\n")[0]})`);
      continue;
    }

    console.log(`[${paginasVisitadas.size}] ${tituloAtual || url}`);

    // Tenta dar play: muitos players so pedem a midia depois do play.
    try {
      await pagina.evaluate(() => {
        document.querySelectorAll("audio, video").forEach((el) => {
          el.muted = true;
          el.play?.().catch(() => {});
        });
      });
    } catch {}

    // Colhe midia declarada direto no HTML.
    try {
      const srcs = await pagina.evaluate(() =>
        Array.from(document.querySelectorAll("audio, video, source, a"))
          .map((el) => el.src || el.href)
          .filter(Boolean),
      );
      for (const s of srcs) registrarMidia(s, "", url, tituloAtual);
    } catch {}

    await pagina.waitForTimeout(ESPERA_MIDIA_MS);

    // Coleta links internos para continuar a varredura.
    let hrefs = [];
    try {
      hrefs = await pagina.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map((a) => a.href),
      );
    } catch {}

    for (const href of hrefs) {
      let u;
      try {
        u = new URL(href, url);
      } catch {
        continue;
      }
      if (u.origin !== origem) continue;
      u.hash = "";
      const limpa = u.toString();
      linksVistos.add(limpa);
      if (paginasVisitadas.has(limpa)) continue;
      if (PADROES_AULA.some((p) => p.test(limpa))) fila.push(limpa);
    }
  }
}

// ---------------------------------------------------------------- SAIDA
await navegador.close();

const catalogo = [...midias.values()];
// Audio primeiro, depois HLS, video por ultimo.
const ordem = { audio: 0, hls: 1, video: 2 };
catalogo.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]);

writeFileSync(CATALOGO, JSON.stringify(catalogo, null, 2));
writeFileSync(
  LINKS_DESCOBERTOS,
  JSON.stringify([...linksVistos].sort(), null, 2),
);

const contagem = catalogo.reduce((acc, m) => {
  acc[m.tipo] = (acc[m.tipo] || 0) + 1;
  return acc;
}, {});

console.log("\n=====================================================");
console.log(`  Paginas visitadas: ${paginasVisitadas.size}`);
console.log(`  Links internos:    ${linksVistos.size}`);
console.log(`  Midias achadas:    ${catalogo.length}`);
for (const [tipo, n] of Object.entries(contagem)) {
  console.log(`     ${tipo}: ${n}`);
}
console.log("=====================================================\n");

if (catalogo.length === 0) {
  console.log("Nenhuma midia encontrada. Tente:  npm run sniff");
  console.log("(no modo manual voce da play em cada aula e ele captura)\n");
} else {
  console.log(`Catalogo salvo em ${CATALOGO}.`);
  console.log("Confira o arquivo e depois rode:  npm run baixar\n");
}
