# Gerador de STL

Descreva a peça em português, veja o resultado em 3D e baixe o STL pronto para o fatiador.

```
"uma caixa 100 × 60 × 40 mm com tampa deslizante e furo de 8 mm na lateral"
        ↓
código JSCAD parametrizado  →  sólido fechado  →  peca.stl
```

## Como funciona

O modelo não desenha triângulos — ele escreve **código paramétrico**, que o app executa. Isso muda
tudo na prática: o resultado sai sempre fechado (o kernel de booleanos garante), você ajusta as medidas por sliders
sem gastar outra chamada de API, e dá para ler e corrigir o que foi feito.

1. Sua descrição vai para a API da Anthropic com um prompt de engenharia de CAD: milímetros, Z para
   cima, peça apoiada em Z=0, parede mínima de 1,2 mm, folga de encaixe, sem balanço acima de 45°.
2. A resposta volta numa ferramenta estruturada (`emitir_modelo`) com nome, notas de impressão, a
   lista de parâmetros e o código.
3. O código roda num **Web Worker**, com a API do [JSCAD](https://openjscad.xyz/) no escopo e mais
   nada — sem DOM, sem rede, sem `import`. Se travar, o worker é morto em 20 s e recriado.
   Os booleanos são do [Manifold](https://github.com/elalish/manifold), não do JSCAD (veja abaixo).
4. A malha é medida (dimensões, volume, massa estimada) e checada antes de virar arquivo.
5. `@jscad/stl-serializer` gera o STL binário; o ASCII fica disponível para inspeção.

### Booleanos: Manifold, não JSCAD

`union`, `subtract` e `intersect` são substituídos no escopo do worker por versões apoiadas no
Manifold (WASM). **O código gerado não muda** — mesma assinatura, mesma API — mas o kernel por trás
passa a garantir saída manifold.

O BSP do JSCAD rasgava a malha em geometria densa. Hélice de rosca era o caso extremo (36
combinações de resolução e modificadores testadas, todas com malha aberta), mas casos mais brandos
viravam os avisos de "malha aberta" que o app mostrava. Depois da troca:

| | JSCAD (BSP) | Manifold |
| --- | --- | --- |
| Furo roscado num bloco | malha aberta, 23 pedaços | fechada, 1 peça |
| Unir rosca a um flange | malha aberta, 20 pedaços | fechada, 1 peça |
| Corte coplanar com a face | risco de malha rasgada | fechada |
| Vazamento nos exemplos | 1e-13 a 1e-16 | **exatamente 0** na maioria |
| STL do chaveiro | 103 KB / 2.116 tri | 69 KB / 1.416 tri |

`scripts/check-manifold.mjs` trava cada operação que antes falhava. Geometria 2D continua no JSCAD:
o BSP dá conta de polígono plano sem dificuldade.

A troca também revelou um bug latente meu — a engrenagem com muitos dentes gerava polígono
auto-intersectante, que o BSP engolia calado e o Manifold recusa. Um kernel que reclama é melhor
que um que entrega peça quebrada.

### A verificação que importa

Antes de liberar o download, o app confere se a superfície está **fechada**: numa malha estanque a
soma vetorial das normais ponderadas por área é zero, e um furo deixa sobrando exatamente o vetor-área
do pedaço que falta. É um teste O(n) que sobrevive às T-junctions que o CSG cria naturalmente — ao
contrário do pareamento de arestas, que acusaria buraco em quase toda peça booleana.

Também avisa quando a peça não cabe na mesa (dizendo se rodar 90° resolve), quando a base não está
em Z=0 e quando a malha ficou pesada demais para o fatiador.

## Rodando

```bash
npm install
npm run dev
```

Abra http://localhost:5173. Os quatro exemplos que já vêm carregados funcionam **sem chave de API** —
dá para ajustar parâmetros e baixar STL na hora. Para gerar peças novas, cole sua chave
(`sk-ant-...`) na barra superior; ela fica apenas no `localStorage` do navegador.

### Sem expor a chave

Com `VITE_API_PROXY_URL` definido, o app troca de modo: o campo de chave da API some da
interface e as chamadas passam por um backend que guarda a chave.

Localmente:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run proxy
echo 'VITE_API_PROXY_URL=http://localhost:8787/api/gerar' > .env.local
npm run dev
```

## Publicando no Netlify

`netlify.toml` e `netlify/functions/gerar.mts` já deixam tudo pronto: o build define
`VITE_API_PROXY_URL=/api/gerar` e a função atende nesse caminho, na mesma origem (sem CORS).

Como a conta da API é do dono do site, **gerar exige um código de acesso**. Duas variáveis de
ambiente no projeto do Netlify:

| Variável | Papel |
| --- | --- |
| `ANTHROPIC_API_KEY` | A chave. Fica só no servidor. |
| `CODIGO_ACESSO` | O que os visitantes digitam para poder gerar peças. |

A função **falha fechada**: sem as duas configuradas, ela recusa toda geração com uma mensagem
explicando o que falta. Com dinheiro em jogo, configuração pela metade não pode virar site aberto.
O código é comparado em tempo constante, e os exemplos continuam funcionando sem código nenhum.

> A proteção por senha do próprio Netlify (que bloquearia o site inteiro) exige plano Pro. O portão
> na função tem o mesmo efeito prático no plano grátis — e protege a operação que custa dinheiro,
> em vez de só a visualização da página.

`server/proxy.mjs` faz o mesmo papel fora do Netlify e serve de molde para Vercel ou Cloudflare.

## Testes

```bash
npm run test:parts      # cotas das peças normalizadas contra a tabela (ISO 261, DIN 934, DIN 912)
npm run test:manifold   # trava as operações que o BSP do JSCAD não conseguia fazer
npm run test:examples   # constrói cada exemplo com mínimos, máximos e padrões; checa fechamento
npm run test:smoke      # navegador de verdade: renderiza, mexe em parâmetro, baixa e valida o STL
npm run test:proxy      # build de produção: campo de chave some, código errado barra, certo gera
npm test                # os cinco
```

O smoke test valida o cabeçalho do STL binário (`84 + 50 × triângulos` bytes) e falha se qualquer
erro aparecer no console.

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `src/lib/prompt.ts` | O prompt de CAD: API disponível, regras de geometria e de impressão |
| `src/lib/anthropic.ts` | Chamada da API e normalização da resposta |
| `src/lib/cad.worker.ts` | Executa o código, mede, verifica o fechamento e serializa o STL |
| `src/lib/manifoldOps.ts` | Booleanos pelo Manifold, com a mesma assinatura do JSCAD |
| `src/lib/standardParts.ts` | Rosca, porca, parafuso, engrenagem e ferramentas de corte |
| `src/lib/cadClient.ts` | Ponte com o worker, com timeout e recriação |
| `src/components/Viewer.tsx` | Cena three.js com a mesa da impressora em escala |
| `src/data/examples.ts` | Peças prontas que funcionam sem chave |

## Peças normalizadas

Rosca e dente de engrenagem têm perfil exato. Um modelo improvisando os dois produz peça que
*parece* certa e não encaixa — por isso eles não são improvisados: `src/lib/standardParts.ts`
gera a geometria da norma, e `npm run test:parts` confere cada cota contra a tabela.

| Função | O que devolve |
| --- | --- |
| `parafusoSextavado({ diametro, comprimento, ... })` | Parafuso completo, cabeça + rosca ISO |
| `porcaRoscada({ tamanho, folga })` | Porca sextavada DIN 934 com rosca interna |
| `roscaMetrica({ diametro, altura })` | Barra roscada nua |
| `engrenagemReta({ modulo, dentes, largura })` | Engrenagem de perfil evolvente |
| `bolsaPorca`, `furoParafuso`, `furoInserto` | Ferramentas de corte para subtrair |
| `furoRoscado({ tamanho, profundidade, folga })` | Ferramenta para abrir rosca fêmea |

### Por que rosca é poliedro e não montagem

Rosca, porca e parafuso são descritos como **poliedro paramétrico** em vez de montados com
booleanos. Isso nasceu de necessidade (o BSP do JSCAD não conseguia) e ficou por mérito: sai fechado
por construção, dimensionalmente exato e ~20× mais rápido que montar por partes. Com os booleanos no
Manifold, essas peças também podem ser combinadas livremente com qualquer outra geometria.

Para rosca fêmea em M2–M4, `furoInserto` ainda é a escolha melhor: rosca impressa nesse tamanho
espana com pouco aperto, inserto de latão não. De M5 para cima, `furoRoscado` funciona bem.

## Limites conhecidos

- **Confira no fatiador.** As checagens pegam malha aberta e peça fora da mesa, não julgam se a peça
  serve para o que você quer.
- **Sem fillet em aresta qualquer.** CSG sobre malha não faz isso. Para arredondamento de verdade o
  caminho é um kernel B-rep (OpenCascade, via `opencascade.js` ou build123d num backend).
- **Peças orgânicas não são o forte.** Para escultura e formas fluidas, o instrumento certo é campo
  de distância (SDF) com união suave, não CSG.
- O código gerado roda no worker com `new Function`. O isolamento é de estabilidade (worker sem DOM,
  timeout), não uma sandbox de segurança — não cole código de terceiros no editor.
