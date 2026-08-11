# Contexto do projeto

**Responda sempre em português.**

## Objetivo

Baixar os áudios das aulas da pós-graduação em Endocrinologia Clínica
(MemberKit), transcrever e gerar **resumos completos das aulas**.

Site: `https://pos-graduacao-endocrinologia-clinica.memberkit.com.br/`

O pipeline está em [`audio-aulas/`](audio-aulas/README.md) — leia o README de
lá antes de mexer.

## Estado atual

Os scripts estão escritos mas **nunca foram executados contra o site real**.
O próximo passo é rodá-los no Mac do usuário.

```
npm run login  →  npm run mapear  →  npm run baixar  →  ./4-transcrever.sh
```

## Decisões já tomadas (não refazer a discussão)

**Roda no Mac, não na nuvem.** O ambiente remoto do Claude Code é um container
efêmero: os arquivos somem, não tem GPU (transcrever ~10 h de aula com 4 CPUs
é inviável), e a política de rede **bloqueia o domínio do MemberKit**
(`connect_rejected`, 403 no CONNECT). Verificado, não é suposição.

**Login manual, sem senha em lugar nenhum.** `1-login.mjs` abre um navegador
visível, o usuário loga com as próprias mãos e o Playwright guarda o
`storageState` em `auth.json`. Resolve 2FA/captcha e mantém a senha fora do
código e da conversa. Nunca pedir a senha ao usuário.

**Plaud foi descartado do fluxo.** Chegou a ser considerado porque o usuário já
usava a transcrição do Plaud para aulas anteriores (a conta tem as séries
"Coprologia Funcional" I–V e uma série de Tireoide, ~10 h no total, aparentemente
importadas como arquivo). Mas o conector MCP do Plaud é **somente leitura** —
`list_files`, `get_file`, `get_transcript`, `get_note`, `get_current_user`, e
nenhuma ferramenta de upload. Como o objetivo final é transcrição + resumo, o
Plaud virou intermediário desnecessário. Ele continua útil se a intenção for
**ler** o que já está lá.

## O que ainda é incerto

Não foi possível inspecionar o HTML do MemberKit (rede bloqueada), então os
padrões de URL em `audio-aulas/config.mjs` (`PADROES_AULA`) são uma aposta
razoável, não um fato.

Se `npm run mapear` não achar mídia, o plano B é `npm run sniff` (o usuário
navega e dá play, o script captura o tráfego). Nesse caso, peça o
`links-descobertos.json`, ajuste `PADROES_AULA` com os links reais e o modo
automático passa a funcionar.

Também não se sabe ainda em que formato o MemberKit entrega o áudio — arquivo
direto (`.mp3`/`.m4a`), HLS (`.m3u8`) ou só a trilha do vídeo. O
`3-baixar.mjs` cobre os três casos, mas só a execução real confirma.

## Regras

- `auth.json`, `audios/` e `transcricoes/` **nunca** vão para o repositório
  (já estão no `.gitignore`). São credencial de sessão e material de curso pago.
- Branch de trabalho: `claude/deepagents-social-media-skill-q0kf8z`.

## Outros conteúdos do repositório

`.claude/skills/social-media/` — skill instalada de `langchain-ai/deepagents`.
Não tem relação com o pipeline de áudio, e **não funciona como está**: depende
de um subagente `researcher` e de uma ferramenta de geração de imagem que não
existem no Claude Code. Além disso ela se contradiz internamente, citando
`generate_image` numa linha e `generate_social_image` em outra. Precisa de
adaptação antes de qualquer uso.
