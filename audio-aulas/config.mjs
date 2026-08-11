// Configuracao central. Ajuste aqui depois do primeiro mapeamento.

export const BASE_URL =
  "https://pos-graduacao-endocrinologia-clinica.memberkit.com.br/";

// Arquivo com os cookies da sessao (gerado por 1-login.mjs).
// NUNCA comitar: da acesso a sua conta paga.
export const AUTH_FILE = "auth.json";

// Onde tudo e salvo.
export const DIR_AUDIO = "audios";
export const DIR_TRANSCRICOES = "transcricoes";
export const DIR_RESUMOS = "resumos";
export const CATALOGO = "catalogo.json";
export const LINKS_DESCOBERTOS = "links-descobertos.json";

// Extensoes/tipos considerados audio.
export const AUDIO_EXT = [".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav"];
export const AUDIO_MIME = /^audio\//i;

// Playlists HLS (streaming). Precisam de ffmpeg para virar arquivo.
export const HLS_EXT = [".m3u8"];

// Padroes de URL que costumam ser pagina de aula no MemberKit.
// Se o mapeamento nao achar nada, rode `npm run sniff` e ajuste isto.
export const PADROES_AULA = [
  /\/courses?\//i,
  /\/lessons?\//i,
  /\/aulas?\//i,
  /\/modules?\//i,
  /\/classroom\//i,
];

// Quanto esperar (ms) em cada pagina de aula para o player carregar a midia.
export const ESPERA_MIDIA_MS = 8000;

// Paginas visitadas no maximo (trava de seguranca contra loop infinito).
export const MAX_PAGINAS = 500;
