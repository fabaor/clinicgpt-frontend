# Gerador de STL

Descreva a peça em português, veja o resultado em 3D e baixe o STL pronto para o fatiador.

```
"uma caixa 100 × 60 × 40 mm com tampa deslizante e furo de 8 mm na lateral"
        ↓
código JSCAD parametrizado  →  sólido fechado  →  peca.stl
```

## Como funciona

O modelo não desenha triângulos — ele escreve **código paramétrico**, que o app executa. Isso muda
tudo na prática: o resultado sai sempre fechado (o CSG garante), você ajusta as medidas por sliders
sem gastar outra chamada de API, e dá para ler e corrigir o que foi feito.

1. Sua descrição vai para a API da Anthropic com um prompt de engenharia de CAD: milímetros, Z para
   cima, peça apoiada em Z=0, parede mínima de 1,2 mm, folga de encaixe, sem balanço acima de 45°.
2. A resposta volta numa ferramenta estruturada (`emitir_modelo`) com nome, notas de impressão, a
   lista de parâmetros e o código.
3. O código roda num **Web Worker**, com a API do [JSCAD](https://openjscad.xyz/) no escopo e mais
   nada — sem DOM, sem rede, sem `import`. Se travar, o worker é morto em 20 s e recriado.
4. A malha é medida (dimensões, volume, massa estimada) e checada antes de virar arquivo.
5. `@jscad/stl-serializer` gera o STL binário; o ASCII fica disponível para inspeção.

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
npm run test:examples   # constrói cada exemplo com mínimos, máximos e padrões; checa fechamento
npm run test:smoke      # navegador de verdade: renderiza, mexe em parâmetro, baixa e valida o STL
npm run test:proxy      # build de produção: campo de chave some, código errado barra, certo gera
npm test                # os três
```

O smoke test valida o cabeçalho do STL binário (`84 + 50 × triângulos` bytes) e falha se qualquer
erro aparecer no console.

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `src/lib/prompt.ts` | O prompt de CAD: API disponível, regras de geometria e de impressão |
| `src/lib/anthropic.ts` | Chamada da API e normalização da resposta |
| `src/lib/cad.worker.ts` | Executa o código, mede, verifica o fechamento e serializa o STL |
| `src/lib/cadClient.ts` | Ponte com o worker, com timeout e recriação |
| `src/components/Viewer.tsx` | Cena three.js com a mesa da impressora em escala |
| `src/data/examples.ts` | Peças prontas que funcionam sem chave |

## Limites conhecidos

- **Confira no fatiador.** As checagens pegam malha aberta e peça fora da mesa, não julgam se a peça
  serve para o que você quer.
- **Sem roscas nem engrenagens de verdade.** Dá para pedir, mas saem aproximações — para isso ainda
  compensa uma biblioteca dedicada.
- **Peças orgânicas não são o forte.** O JSCAD é CSG: sólidos, furos e extrusões. Para escultura, um
  gerador de malha é o caminho.
- O código gerado roda no worker com `new Function`. O isolamento é de estabilidade (worker sem DOM,
  timeout), não uma sandbox de segurança — não cole código de terceiros no editor.
