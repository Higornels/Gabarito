/*
 * Folha de respostas imprimível (A4, unidades em mm), no mesmo formato dos cartões
 * que o leitor reconhece: blocos de questões com as letras dentro das bolinhas.
 */
(function (root) {
  'use strict';

  var LETTERS = 'ABCDE';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function f(v) { return Math.round(v * 100) / 100; }

  // prova: { nome, turma, blocos, questoesPorBloco, alternativas, numeracao, nomesBlocos }
  function renderSVG(prova, rotulo) {
    var nB = prova.blocos, nQ = prova.questoesPorBloco, nA = prova.alternativas;
    // Com muitos blocos, mais estreitos para caberem 4 por fileira.
    var pitchX = nB > 6 ? 5.6 : 6.2, numW = 9, padX = 2;
    var blockW = numW + nA * pitchX + padX * 2;
    var perRow = Math.max(1, Math.min(nB, Math.floor(184 / (blockW + 3))));
    var tiers = Math.ceil(nB / perRow);
    var top = 72, bottom = 288, headH = 7;
    // Fileiras de blocos bem separadas (≥ 3 linhas): o leitor não emenda as colunas.
    var gapTier = tiers > 1 ? 14 : 0;
    var tierH = (bottom - top + gapTier) / tiers;
    var pitchY = Math.min(7.5, (tierH - headH - 3 - gapTier) / nQ);
    // Bolinhas grandes e de contorno grosso: a foto costuma pegar a folha inteira.
    var r = Math.min(2.5, (Math.min(pitchX, pitchY) - 1.2) / 2);
    var gapX = (180 - perRow * blockW) / (perRow + 1);

    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm" font-family="Arial, Helvetica, sans-serif">');
    o.push('<rect width="210" height="297" fill="#fff"/>');

    // Cabeçalho
    o.push('<rect x="15" y="12" width="180" height="52" fill="none" stroke="#000" stroke-width="0.4"/>');
    o.push('<text x="105" y="21" font-size="5.2" font-weight="bold" text-anchor="middle">' + esc(prova.nome || 'Simulado') + '</text>');
    if (prova.turma) o.push('<text x="105" y="27.5" font-size="3.6" text-anchor="middle">' + esc(prova.turma) + '</text>');
    o.push('<text x="105" y="34" font-size="3.6" font-weight="bold" text-anchor="middle">CARTÃO-RESPOSTA</text>');
    o.push('<text x="19" y="44" font-size="3.6">Aluno(a):</text>');
    o.push('<line x1="35" y1="44.6" x2="190" y2="44.6" stroke="#000" stroke-width="0.25"/>');
    o.push('<text x="19" y="53" font-size="3.6">Turma:</text>');
    o.push('<line x1="31" y1="53.6" x2="90" y2="53.6" stroke="#000" stroke-width="0.25"/>');
    o.push('<text x="95" y="53" font-size="3.6">Nº:</text>');
    o.push('<line x1="101" y1="53.6" x2="125" y2="53.6" stroke="#000" stroke-width="0.25"/>');
    o.push('<text x="130" y="53" font-size="3.6">Data:</text>');
    o.push('<line x1="140" y1="53.6" x2="190" y2="53.6" stroke="#000" stroke-width="0.25"/>');
    o.push('<text x="19" y="60.5" font-size="2.8">Preencha toda a bolinha com caneta preta ou azul. Marque só uma alternativa por questão. Não rasure.</text>');

    for (var b = 0; b < nB; b++) {
      var col = b % perRow, tier = Math.floor(b / perRow);
      var x0 = 15 + gapX + col * (blockW + gapX);
      var y0 = top + tier * tierH;
      var h = headH + nQ * pitchY + 2;
      o.push('<rect x="' + f(x0) + '" y="' + f(y0) + '" width="' + f(blockW) + '" height="' + f(h) + '" fill="none" stroke="#000" stroke-width="0.4"/>');
      o.push('<rect x="' + f(x0) + '" y="' + f(y0) + '" width="' + f(blockW) + '" height="' + headH + '" fill="#ddd" stroke="#000" stroke-width="0.4"/>');
      o.push('<text x="' + f(x0 + blockW / 2) + '" y="' + f(y0 + 4.9) + '" font-size="3.2" font-weight="bold" text-anchor="middle">' +
        esc(rotulo(b)) + '</text>');
      o.push('<line x1="' + f(x0 + numW) + '" y1="' + f(y0 + headH) + '" x2="' + f(x0 + numW) + '" y2="' + f(y0 + h) + '" stroke="#000" stroke-width="0.3"/>');
      for (var q = 0; q < nQ; q++) {
        var y = y0 + headH + 1 + (q + 0.5) * pitchY;
        var num = prova.numeracao === 'bloco' ? q + 1 : b * nQ + q + 1;
        o.push('<text x="' + f(x0 + numW - 1.5) + '" y="' + f(y + 1.2) + '" font-size="3.3" font-weight="bold" text-anchor="end">' + num + '</text>');
        for (var a = 0; a < nA; a++) {
          var cx = x0 + numW + padX + (a + 0.5) * pitchX;
          o.push('<circle cx="' + f(cx) + '" cy="' + f(y) + '" r="' + f(r) + '" fill="#fff" stroke="#000" stroke-width="0.45"/>');
          o.push('<text x="' + f(cx) + '" y="' + f(y + r * 0.42) + '" font-size="' + f(r * 1.1) + '" fill="#666" text-anchor="middle">' + LETTERS[a] + '</text>');
        }
      }
    }
    o.push('</svg>');
    return o.join('');
  }

  var api = { renderSVG: renderSVG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SheetLayout = api;
})(this);
