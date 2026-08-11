#!/usr/bin/env bash
# PASSO 4 - Transcrever os audios (roda local, no Mac).
#
#   ./4-transcrever.sh              -> modelo large-v3 (melhor p/ termo medico)
#   ./4-transcrever.sh medium       -> mais rapido, um pouco menos preciso
#
# Prefere mlx-whisper (Apple Silicon, usa a GPU do Mac e e MUITO mais rapido).
# Cai para whisper-ctranslate2 ou openai-whisper se o mlx nao estiver instalado.

set -uo pipefail

DIR_AUDIO="audios"
DIR_SAIDA="transcricoes"
IDIOMA="pt"
TAMANHO="${1:-large-v3}"

mkdir -p "$DIR_SAIDA"

if [ ! -d "$DIR_AUDIO" ] || [ -z "$(ls -A "$DIR_AUDIO" 2>/dev/null)" ]; then
  echo "[ERRO] Pasta '$DIR_AUDIO' vazia. Rode os passos 1 a 3 antes."
  exit 1
fi

# ---------------------------------------------------- escolher o motor
MOTOR=""
if command -v mlx_whisper >/dev/null 2>&1; then
  MOTOR="mlx"
elif command -v whisper-ctranslate2 >/dev/null 2>&1; then
  MOTOR="ct2"
elif command -v whisper >/dev/null 2>&1; then
  MOTOR="openai"
else
  echo "[ERRO] Nenhum motor de transcricao encontrado."
  echo
  echo "  No Mac com Apple Silicon (recomendado, bem mais rapido):"
  echo "     pip install mlx-whisper"
  echo
  echo "  Alternativa (funciona em qualquer Mac):"
  echo "     pip install whisper-ctranslate2"
  echo
  exit 1
fi

echo "====================================================="
echo "  Motor:   $MOTOR"
echo "  Modelo:  $TAMANHO"
echo "  Idioma:  $IDIOMA"
echo "====================================================="
echo

TOTAL=$(find "$DIR_AUDIO" -type f \( -name '*.mp3' -o -name '*.m4a' -o -name '*.wav' \
        -o -name '*.aac' -o -name '*.ogg' -o -name '*.opus' \) | wc -l | tr -d ' ')
N=0
FALHAS=0

find "$DIR_AUDIO" -type f \( -name '*.mp3' -o -name '*.m4a' -o -name '*.wav' \
     -o -name '*.aac' -o -name '*.ogg' -o -name '*.opus' \) | sort | while read -r arq; do
  N=$((N + 1))
  nome="$(basename "${arq%.*}")"
  destino="$DIR_SAIDA/$nome.txt"

  if [ -s "$destino" ]; then
    echo "[$N/$TOTAL] ja transcrito, pulando: $nome"
    continue
  fi

  echo "[$N/$TOTAL] transcrevendo: $nome"
  inicio=$(date +%s)

  case "$MOTOR" in
    mlx)
      mlx_whisper "$arq" \
        --model "mlx-community/whisper-${TAMANHO}-mlx" \
        --language "$IDIOMA" \
        --output-dir "$DIR_SAIDA" \
        --output-format txt >/dev/null 2>&1
      ;;
    ct2)
      whisper-ctranslate2 "$arq" \
        --model "$TAMANHO" \
        --language "$IDIOMA" \
        --output_dir "$DIR_SAIDA" \
        --output_format txt >/dev/null 2>&1
      ;;
    openai)
      whisper "$arq" \
        --model "$TAMANHO" \
        --language Portuguese \
        --output_dir "$DIR_SAIDA" \
        --output_format txt >/dev/null 2>&1
      ;;
  esac

  fim=$(date +%s)
  if [ -s "$destino" ]; then
    echo "          OK em $((fim - inicio))s"
  else
    echo "          [FALHOU]"
    FALHAS=$((FALHAS + 1))
  fi
done

echo
echo "====================================================="
echo "  Transcricoes em ./$DIR_SAIDA/"
echo "====================================================="
echo
echo "Ultimo passo: abra o Claude Code nesta pasta e peca:"
echo '   "leia as transcricoes e faca o resumo completo das aulas"'
echo
