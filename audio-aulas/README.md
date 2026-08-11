# Áudios das aulas — MemberKit → transcrição → resumo

Pipeline para baixar os áudios da pós de Endocrinologia Clínica, transcrever e
gerar resumos completos. **Roda no seu Mac**, não na nuvem.

Site: `https://pos-graduacao-endocrinologia-clinica.memberkit.com.br/`

---

## Por que no Mac e não aqui

- Os arquivos ficam no seu disco (na nuvem o container é apagado e some tudo).
- O Apple Silicon transcreve com a GPU — ordens de grandeza mais rápido que os
  4 CPUs sem GPU do container remoto.
- Você loga na mão no navegador: resolve 2FA e captcha, e sua senha nunca
  aparece em código nem em conversa.
- O ambiente remoto tem a rede bloqueada para este domínio de qualquer forma
  (a política do proxy nega a conexão).

---

## Instalação (uma vez)

```bash
# 1. ffmpeg — necessário se as aulas vierem em streaming (HLS) ou vídeo
brew install ffmpeg

# 2. dependências do projeto
cd audio-aulas
npm install
npx playwright install chromium

# 3. motor de transcrição (Apple Silicon — recomendado)
pip install mlx-whisper
# alternativa, qualquer Mac:  pip install whisper-ctranslate2
```

---

## Uso

```bash
npm run login      # 1. abre o navegador, VOCÊ loga, ele guarda a sessão
npm run mapear     # 2. varre o site e acha as URLs de áudio
npm run baixar     # 3. baixa para ./audios/
./4-transcrever.sh # 4. transcreve para ./transcricoes/
```

Depois abra o Claude Code nesta pasta e peça:

> leia as transcrições e faça o resumo completo das aulas

---

## Se o passo 2 não achar nada

O modo automático depende de adivinhar como o MemberKit monta as URLs, e eu
**não consegui inspecionar o site** para confirmar (a rede do container remoto
bloqueia o domínio). Então existe um plano B que sempre funciona:

```bash
npm run sniff
```

Abre o navegador, **você navega e dá play em cada aula**, e o script captura
toda mídia que passar pela rede. Menos automático, mas imune a mudança de
layout.

Se isso acontecer, me mande o arquivo `links-descobertos.json` na próxima
conversa — com os links reais eu ajusto os padrões em `config.mjs` e o modo
automático passa a funcionar.

---

## Comandos extras

```bash
npm run baixar -- --tudo    # inclui vídeos (extrai só a faixa de áudio)
./4-transcrever.sh medium   # modelo menor, mais rápido, menos preciso
```

Todos os passos são **retomáveis**: o que já foi baixado ou transcrito é
pulado numa nova execução. Pode interromper e continuar depois.

---

## Segurança

`auth.json` guarda os cookies da sua sessão — quem tiver esse arquivo entra na
sua conta. Ele está no `.gitignore`. Não comite, não compartilhe.

Os áudios e transcrições também estão no `.gitignore`: é material de curso
pago, fica só na sua máquina.

---

## Arquivos

| Arquivo | Função |
|---|---|
| `config.mjs` | URLs, pastas e padrões — ajuste aqui |
| `1-login.mjs` | login manual, salva a sessão |
| `2-mapear.mjs` | descobre as aulas e as URLs de mídia |
| `3-baixar.mjs` | baixa (ffmpeg para HLS/vídeo) |
| `4-transcrever.sh` | whisper local |
