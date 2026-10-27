# Corretor de Gabarito

App web para corrigir simulados a partir de fotos dos cartões-resposta tiradas com o celular.
Tudo roda no navegador: a leitura das fotos é feita no próprio aparelho e os dados ficam
salvos nele (nada é enviado para servidor).

## Como usar

1. **Provas → Nova prova**: informe o nome e o formato do cartão
   (ex.: 2 blocos de 15, 6 blocos de 15, 2 blocos de 20), as alternativas (A–D ou A–E)
   e se a numeração é contínua ou recomeça em cada bloco. Os blocos podem ter nome (Física, Química…).
   Em **Matérias** (opcional), informe uma por linha com a faixa de questões
   (ex.: `Química = 1 a 8`); a nota sai separada por matéria, mesmo que ela não coincida com os blocos.
2. **Gabarito**: toque nas respostas certas, digite a sequência (ex.: `CADBB ACDBA…`)
   ou fotografe um cartão preenchido com as respostas corretas. `X` anula a questão.
3. **Corrigir**: digite o nome do aluno e fotografe o cartão. Se ele não couber numa foto,
   tire duas: o app junta os blocos. Confira as questões em amarelo e salve.
4. **Resultados**: notas, acertos por bloco, análise por questão e exportação para planilha (CSV).

**Prova padrão para todos:** na tela da prova, toque em **Copiar como prova padrão do app** e
cole o texto dentro da lista em `js/padrao.js`. Depois de publicar, quem abrir o app já recebe essa prova.

Sem cartão-resposta próprio? Na tela da prova, use **Imprimir cartão-resposta em branco**.

### Dicas de foto
- De cima, com o cartão reto, boa luz e sem sombra do celular. A foto pode estar deitada
  ou de cabeça para baixo: o app acha o lado certo sozinho.
- Cada bloco precisa aparecer inteiro (do cabeçalho até a última questão).
- A foto com os círculos coloridos mostra o que foi lido; se a grade ficar uma linha
  deslocada, use os botões ↑ ↓.

## Como abrir no celular

O app é só um conjunto de arquivos estáticos (`index.html`, `css/`, `js/`). Para usar no
celular, publique a pasta em qualquer hospedagem estática com HTTPS, por exemplo:

- **Netlify Drop** (app.netlify.com/drop): arraste a pasta e use o link gerado.
- **GitHub Pages**: suba a pasta num repositório e ative o Pages.

No computador, também funciona abrindo `index.html` direto no navegador.

## Estrutura

- `js/omr.js`: leitura óptica (detecta as bolinhas, monta a grade de cada bloco com
  correção de perspectiva e mede o preenchimento). Independe do modelo de cartão.
- `js/layout.js`: gera o cartão-resposta imprimível (SVG A4).
- `js/app.js`: interface (provas, gabarito, correção, resultados, alunos).
