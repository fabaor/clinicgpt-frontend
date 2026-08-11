// PASSO 1 - Login manual.
//
// Abre um navegador de verdade, VOCE loga com o mouse e o teclado,
// e o script guarda os cookies da sessao em auth.json.
//
// Por que manual:
//   - sua senha nunca aparece em codigo, em log, nem em conversa
//   - resolve 2FA, captcha e "confirme seu e-mail" sem gambiarra
//
// Uso:  npm run login

import { chromium } from "playwright";
import { BASE_URL, AUTH_FILE } from "./config.mjs";
import { existsSync } from "node:fs";

const navegador = await chromium.launch({
  headless: false, // precisa ser visivel: voce vai digitar aqui
  args: ["--start-maximized"],
});

const contexto = await navegador.newContext({ viewport: null });
const pagina = await contexto.newPage();

console.log("\n=====================================================");
console.log("  PASSO 1 - LOGIN MANUAL");
console.log("=====================================================");
console.log(`\nAbrindo: ${BASE_URL}`);
console.log("\n  1. Faca login normalmente na janela que abriu.");
console.log("  2. Navegue ate ver a lista de aulas (area de membro).");
console.log("  3. Volte AQUI no terminal e aperte ENTER.\n");
console.log("A janela do navegador NAO deve ser fechada por voce.\n");

await pagina.goto(BASE_URL, { waitUntil: "domcontentloaded" });

// Espera o ENTER no terminal.
await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", () => {
    process.stdin.pause();
    resolve();
  });
});

await contexto.storageState({ path: AUTH_FILE });
await navegador.close();

if (existsSync(AUTH_FILE)) {
  console.log(`\n[OK] Sessao salva em ${AUTH_FILE}`);
  console.log("     Esse arquivo da acesso a sua conta. Ele ja esta no");
  console.log("     .gitignore - nao comite e nao compartilhe.\n");
  console.log("Proximo passo:  npm run mapear\n");
} else {
  console.error("\n[ERRO] Nao consegui salvar a sessao. Tente de novo.\n");
  process.exit(1);
}
