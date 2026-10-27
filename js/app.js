/*
 * Corretor de Gabarito — interface.
 * Tudo roda no navegador (inclusive a leitura das fotos); os dados ficam no
 * armazenamento local do aparelho.
 */
(function () {
  'use strict';

  var KEY = 'corretor-gabarito.v1';
  var LET = 'ABCDE';
  var MAX_PX = 1600; // lado maior da imagem processada

  /* ---------------- estado ---------------- */

  var state = load();
  var ui = { tab: 'provas', editando: null, folha: null, foto: null };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.provas)) {
        s.resultados = s.resultados || {};
        s.alunos = s.alunos || [];
        return s;
      }
    } catch (e) { /* armazenamento indisponível: começa vazio */ }
    return { provas: [], resultados: {}, alunos: [], ativa: null };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Não foi possível salvar os dados neste aparelho.'); }
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function provaAtiva() {
    var p = state.provas.find(function (x) { return x.id === state.ativa; });
    if (!p && state.provas.length) { p = state.provas[0]; state.ativa = p.id; }
    return p || null;
  }

  function total(p) { return p.blocos * p.questoesPorBloco; }

  function numQ(p, i) { return p.numeracao === 'bloco' ? (i % p.questoesPorBloco) + 1 : i + 1; }

  function nomeBloco(p, b) {
    var nome = (p.nomesBlocos && p.nomesBlocos[b]) || '';
    var ini = b * p.questoesPorBloco;
    var faixa = numQ(p, ini) + '–' + numQ(p, ini + p.questoesPorBloco - 1);
    return nome ? nome + ' (' + faixa + ')' : 'Bloco ' + (b + 1) + ' (' + faixa + ')';
  }

  function nomeCurtoBloco(p, b) {
    return (p.nomesBlocos && p.nomesBlocos[b]) || 'Bloco ' + (b + 1);
  }

  /* Matérias: faixas de questões (posição 1..total, na ordem do cartão), independentes
   * dos blocos. Ex.: { nome: 'Química', de: 1, ate: 8 }. */

  function materiaInicio(p, i) {
    return (p.materias || []).find(function (m) { return m.de - 1 === i; }) || null;
  }

  function textoMaterias(p) {
    return (p.materias || []).map(function (m) { return m.nome + ' = ' + m.de + ' a ' + m.ate; }).join('\n');
  }

  // Aceita "Química = 1 a 8", "Química 1-8", "Física: 9 até 15"…
  function lerMaterias(txt, n) {
    var lista = [], erros = [];
    String(txt || '').split(/\r?\n/).forEach(function (linha) {
      var s = linha.trim();
      if (!s) return;
      var m = s.match(/^(.*?)[\s=:]*(\d+)\s*(?:a|ao|até|ate|-|–|—)\s*(\d+)\s*=?\s*$/i);
      var nome = m && m[1].replace(/[\s=:\-–—]+$/, '').trim();
      var de = m && +m[2], ate = m && +m[3];
      if (!m || !nome || de < 1 || ate < de || ate > n) { erros.push(s); return; }
      lista.push({ nome: nome, de: de, ate: ate });
    });
    lista.sort(function (a, b) { return a.de - b.de; });
    return { lista: lista, erros: erros };
  }

  // Resumo de acertos por matéria (se houver) ou por bloco.
  function resumo(p, c) {
    if ((p.materias || []).length) {
      return p.materias.map(function (m, k) { return { nome: m.nome, acertos: c.porMateria[k].acertos, total: c.porMateria[k].total }; });
    }
    if (p.blocos > 1) {
      return c.porBloco.map(function (pb, b) { return { nome: nomeCurtoBloco(p, b), acertos: pb.acertos, total: pb.total }; });
    }
    return [];
  }

  // Ajusta vetores ao tamanho atual da prova (quando a estrutura muda).
  function ajustar(arr, n, vazio) {
    arr = (arr || []).slice(0, n);
    while (arr.length < n) arr.push(vazio);
    return arr;
  }

  /* ---------------- correção ---------------- */

  // gabarito: 'A'..'E', 'X' (anulada: vale para todos) ou '' (não definido).
  // resposta: 'A'..'E', '' (em branco), '*' (mais de uma marcada), null (não lida).
  function corrigir(p, respostas) {
    var nQ = p.questoesPorBloco;
    var r = { acertos: 0, total: 0, brancos: 0, multiplas: 0, porBloco: [], status: [] };
    for (var b = 0; b < p.blocos; b++) r.porBloco.push({ acertos: 0, total: 0 });
    var mats = p.materias || [];
    r.porMateria = mats.map(function () { return { acertos: 0, total: 0 }; });
    for (var i = 0; i < total(p); i++) {
      var g = p.gabarito[i] || '', a = respostas[i];
      var pb = r.porBloco[Math.floor(i / nQ)];
      var pm = null;
      for (var k = 0; k < mats.length; k++) if (i + 1 >= mats[k].de && i + 1 <= mats[k].ate) { pm = r.porMateria[k]; break; }
      var st;
      if (!g) st = 'semgab';
      else {
        r.total++; pb.total++;
        if (pm) pm.total++;
        if (g === 'X') st = 'anulada';
        else if (a === g) st = 'certa';
        else if (a === '*') { st = 'multipla'; r.multiplas++; }
        else if (!a) { st = 'branco'; r.brancos++; }
        else st = 'errada';
        if (st === 'certa' || st === 'anulada') { r.acertos++; pb.acertos++; if (pm) pm.acertos++; }
      }
      r.status.push(st);
    }
    r.nota = r.total ? r.acertos / r.total * (p.valor || 10) : 0;
    return r;
  }

  function fmtNota(v) { return (Math.round(v * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

  /* ---------------- utilidades de interface ---------------- */

  var view = document.getElementById('view');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  function busy(on, msg) {
    var b = document.getElementById('busy');
    b.hidden = !on;
    if (msg) b.querySelector('p').textContent = msg;
  }

  function go(tab) {
    ui.tab = tab;
    if (tab !== 'provas') ui.editando = null;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === ui.tab);
    });
    renderSeletor();
    if (ui.tab === 'provas') ui.editando ? renderEditor() : renderProvas();
    else if (ui.tab === 'corrigir') renderCorrigir();
    else if (ui.tab === 'resultados') renderResultados();
    else renderAlunos();
  }

  function renderSeletor() {
    var sel = document.getElementById('prova-ativa');
    var p = provaAtiva();
    if (!state.provas.length) {
      sel.innerHTML = '<option>Nenhuma prova</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = state.provas.map(function (x) {
      return '<option value="' + x.id + '"' + (p && x.id === p.id ? ' selected' : '') + '>' + esc(x.nome) + (x.turma ? ' — ' + esc(x.turma) : '') + '</option>';
    }).join('');
  }

  document.getElementById('prova-ativa').addEventListener('change', function (e) {
    if (ui.folha && ui.folha.alterada && !confirm('Descartar a correção em andamento?')) { renderSeletor(); return; }
    state.ativa = e.target.value;
    ui.folha = null; ui.foto = null;
    save();
    render();
  });

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });

  /* ---------------- aba Provas ---------------- */

  function renderProvas() {
    var html = '<div class="row" style="justify-content:space-between"><h2>Provas</h2>' +
      '<button class="btn primary" data-act="nova-prova">+ Nova prova</button></div>';
    if (!state.provas.length) {
      html += '<div class="card empty"><div class="ico">📝</div><p><b>Nenhuma prova cadastrada.</b></p>' +
        '<p class="muted">Crie uma prova, informe o formato do cartão (blocos × questões) e o gabarito. ' +
        'Depois é só fotografar os cartões dos alunos.</p></div>';
    }
    state.provas.forEach(function (p) {
      var preench = p.gabarito.filter(function (g) { return g; }).length;
      var n = (state.resultados[p.id] || []).length;
      html += '<div class="card click" data-act="editar-prova" data-id="' + p.id + '">' +
        '<div class="row"><div class="grow"><div class="card-title">' + esc(p.nome) + '</div>' +
        '<div class="muted">' + (p.turma ? esc(p.turma) + ' · ' : '') + p.blocos + ' bloco' + (p.blocos > 1 ? 's' : '') + ' × ' +
        p.questoesPorBloco + ' questões · A–' + LET[p.alternativas - 1] + '</div></div>' +
        (p.id === state.ativa ? '<span class="pill ok">ativa</span>' : '') + '</div>' +
        '<div class="row small" style="margin-top:8px">' +
        (preench === total(p) ? '<span class="pill ok">gabarito completo</span>'
          : '<span class="pill warn">gabarito ' + preench + '/' + total(p) + '</span>') +
        '<span class="pill gray">' + n + ' corrigida' + (n === 1 ? '' : 's') + '</span></div></div>';
    });
    view.innerHTML = html;
  }

  function novaProva() {
    var p = {
      id: uid(), nome: 'Simulado', turma: '', blocos: 2, questoesPorBloco: 15, alternativas: 5,
      numeracao: 'continua', nomesBlocos: [], valor: 10, gabarito: [], criada: Date.now()
    };
    p.gabarito = ajustar([], total(p), '');
    return p;
  }

  function renderEditor() {
    var p = ui.editando;
    var existe = state.provas.some(function (x) { return x.id === p.id; });
    var presets = [[2, 15], [2, 20], [3, 15], [6, 15], [4, 20], [1, 20]];
    var html = '<div class="row" style="justify-content:space-between"><h2>' + (existe ? 'Editar prova' : 'Nova prova') + '</h2>' +
      '<button class="btn sm" data-act="voltar">← Voltar</button></div>';

    html += '<div class="card">' +
      '<label class="field"><span>Nome da prova</span><input data-f="nome" value="' + esc(p.nome) + '"></label>' +
      '<label class="field"><span>Turma / descrição (opcional)</span><input data-f="turma" value="' + esc(p.turma) + '" placeholder="Ex.: 3º ano A — 3º bimestre"></label>' +
      '<span class="muted">Formato do cartão-resposta</span>' +
      '<div class="chips" style="margin:6px 0 12px">' + presets.map(function (x) {
        var on = p.blocos === x[0] && p.questoesPorBloco === x[1];
        return '<button class="chip' + (on ? ' on' : '') + '" data-act="preset" data-b="' + x[0] + '" data-q="' + x[1] + '">' +
          x[0] + ' bloco' + (x[0] > 1 ? 's' : '') + ' de ' + x[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="grid2">' +
      '<label class="field"><span>Quantidade de blocos</span><input type="number" min="1" max="8" data-f="blocos" value="' + p.blocos + '"></label>' +
      '<label class="field"><span>Questões por bloco</span><input type="number" min="3" max="40" data-f="questoesPorBloco" value="' + p.questoesPorBloco + '"></label>' +
      '<label class="field"><span>Alternativas</span><select data-f="alternativas">' +
      [4, 5].map(function (n) { return '<option value="' + n + '"' + (p.alternativas === n ? ' selected' : '') + '>A–' + LET[n - 1] + ' (' + n + ')</option>'; }).join('') +
      '</select></label>' +
      '<label class="field"><span>Valor da prova</span><input type="number" min="0" step="0.5" data-f="valor" value="' + p.valor + '"></label>' +
      '</div>' +
      '<label class="field"><span>Numeração das questões</span><select data-f="numeracao">' +
      '<option value="continua"' + (p.numeracao !== 'bloco' ? ' selected' : '') + '>Contínua (1, 2, 3… até ' + total(p) + ')</option>' +
      '<option value="bloco"' + (p.numeracao === 'bloco' ? ' selected' : '') + '>Recomeça em cada bloco (1–' + p.questoesPorBloco + ')</option>' +
      '</select></label>' +
      '<details' + ((p.nomesBlocos || []).some(Boolean) ? ' open' : '') + '><summary class="muted">Nome de cada bloco (opcional, ex.: Física, Química)</summary>' +
      '<div class="grid2" style="margin-top:8px">';
    for (var b = 0; b < p.blocos; b++) {
      html += '<label class="field"><span>Bloco ' + (b + 1) + '</span><input data-nome-bloco="' + b + '" value="' + esc((p.nomesBlocos || [])[b] || '') + '" placeholder="Bloco ' + (b + 1) + '"></label>';
    }
    html += '</div></details></div>';

    // Matérias (faixas de questões). Ao redesenhar, mantém o texto que está sendo digitado.
    var txtEl = view.querySelector('[data-materias]');
    var matTxt = txtEl ? txtEl.value : textoMaterias(p);
    var mt = lerMaterias(matTxt, total(p));
    html += '<div class="card"><h3 style="margin:0 0 4px">Matérias <span class="muted small">(opcional)</span></h3>' +
      '<p class="muted small">Uma por linha, com a faixa de questões. A nota sai separada por matéria. ' +
      (p.numeracao === 'bloco' ? 'Conte as questões em sequência pelo cartão todo (1 a ' + total(p) + ').' : '') + '</p>' +
      '<textarea data-materias style="min-height:120px" placeholder="Química = 1 a 8&#10;Física = 9 a 15&#10;Biologia = 16 a 23">' + esc(matTxt) + '</textarea>';
    if (mt.erros.length) {
      html += '<div class="alert warn" style="margin-top:8px">Não entendi: <b>' + esc(mt.erros.join(' · ')) + '</b>. ' +
        'Use o formato <b>Nome = 1 a 8</b> (questões de 1 a ' + total(p) + ').</div>';
    }
    if (mt.lista.length) {
      var cob = [], sobrep = [];
      mt.lista.forEach(function (m) { for (var j = m.de; j <= m.ate; j++) { if (cob[j]) sobrep.push(j); cob[j] = 1; } });
      var sem = [];
      for (var j2 = 1; j2 <= total(p); j2++) if (!cob[j2]) sem.push(j2);
      html += '<div class="row small" style="margin-top:8px">' + mt.lista.map(function (m) {
        return '<span class="pill gray">' + esc(m.nome) + ': ' + m.de + '–' + m.ate + ' (' + (m.ate - m.de + 1) + ')</span>';
      }).join('') + '</div>';
      if (sobrep.length) html += '<div class="alert warn" style="margin-top:8px">Questões em mais de uma matéria: ' + sobrep.join(', ') + '.</div>';
      if (sem.length) html += '<div class="alert warn" style="margin-top:8px">' + sem.length + ' questão(ões) sem matéria' +
        (sem.length <= 12 ? ': ' + sem.join(', ') : '') + '. Elas contam na nota geral.</div>';
    }
    html += '</div>';

    // Gabarito
    var preench = p.gabarito.filter(function (g) { return g; }).length;
    html += '<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Gabarito</h3>' +
      '<span class="pill ' + (preench === total(p) ? 'ok' : 'warn') + '">' + preench + '/' + total(p) + '</span></div>' +
      '<p class="muted small">Toque na alternativa correta. <b>X</b> anula a questão (vale ponto para todos).</p>' +
      '<div class="row" style="margin:10px 0">' +
      '<button class="btn sm" data-act="gab-foto">📷 Ler gabarito de uma foto</button>' +
      '<button class="btn sm" data-act="gab-texto">⌨️ Digitar sequência</button>' +
      '<button class="btn sm danger" data-act="gab-limpar">Limpar</button></div>' +
      '<div class="qgrid">';
    for (b = 0; b < p.blocos; b++) {
      html += '<div class="qblock"><div class="qblock-title">' + esc(nomeBloco(p, b)) + '</div>';
      for (var q = 0; q < p.questoesPorBloco; q++) {
        var i = b * p.questoesPorBloco + q, g = p.gabarito[i];
        var mi = materiaInicio(p, i);
        if (mi) html += '<div class="qmat">' + esc(mi.nome) + '</div>';
        html += '<div class="qrow"><span class="qn">' + numQ(p, i) + '</span><span class="alts">';
        for (var a = 0; a < p.alternativas; a++) {
          html += '<button class="alt' + (g === LET[a] ? ' on' : '') + '" data-act="gab" data-i="' + i + '" data-v="' + LET[a] + '">' + LET[a] + '</button>';
        }
        html += '<button class="alt x' + (g === 'X' ? ' on' : '') + '" data-act="gab" data-i="' + i + '" data-v="X" title="Anular">X</button>';
        html += '</span></div>';
      }
      html += '</div>';
    }
    html += '</div></div>';

    html += '<div class="stack">' +
      '<button class="btn primary big" data-act="salvar-prova">Salvar prova</button>' +
      '<button class="btn big" data-act="imprimir">🖨️ Imprimir cartão-resposta em branco</button>' +
      (existe ? '<button class="btn danger big" data-act="excluir-prova">Excluir prova</button>' : '') +
      '</div>';
    view.innerHTML = html;
  }

  function lerCamposProva() {
    var p = ui.editando;
    view.querySelectorAll('[data-f]').forEach(function (el) {
      var k = el.dataset.f, v = el.value;
      if (k === 'blocos') v = Math.max(1, Math.min(8, parseInt(v, 10) || 1));
      else if (k === 'questoesPorBloco') v = Math.max(3, Math.min(40, parseInt(v, 10) || 15));
      else if (k === 'alternativas') v = parseInt(v, 10) === 4 ? 4 : 5;
      else if (k === 'valor') v = Math.max(0, parseFloat(String(v).replace(',', '.')) || 10);
      else v = String(v).trim();
      p[k] = v;
    });
    var nomes = p.nomesBlocos ? p.nomesBlocos.slice() : [];
    view.querySelectorAll('[data-nome-bloco]').forEach(function (el) { nomes[+el.dataset.nomeBloco] = el.value.trim(); });
    p.nomesBlocos = nomes.slice(0, p.blocos);
    var txtMat = view.querySelector('[data-materias]');
    if (txtMat) p.materias = lerMaterias(txtMat.value, total(p)).lista;
    p.gabarito = ajustar(p.gabarito, total(p), '');
    // letras que não existem mais (ex.: mudou de 5 para 4 alternativas)
    p.gabarito = p.gabarito.map(function (g) { return g && g !== 'X' && LET.indexOf(g) >= p.alternativas ? '' : g; });
  }

  function salvarProva() {
    lerCamposProva();
    var p = ui.editando;
    if (!p.nome) { toast('Dê um nome para a prova.'); return; }
    var i = state.provas.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) state.provas[i] = p; else state.provas.unshift(p);
    state.ativa = p.id;
    (state.resultados[p.id] || []).forEach(function (r) { r.respostas = ajustar(r.respostas, total(p), null); });
    save();
    ui.editando = null;
    ui.folha = null; ui.foto = null;
    var falta = p.gabarito.filter(function (g) { return !g; }).length;
    toast(falta ? 'Prova salva. Faltam ' + falta + ' questões no gabarito.' : 'Prova salva!');
    render();
  }

  function gabaritoTexto() {
    lerCamposProva();
    var p = ui.editando;
    var t = prompt('Digite as respostas em sequência, a partir da questão 1 (ex.: CADBB ACDBA…). ' +
      'Espaços e números são ignorados; use X para anular.', p.gabarito.map(function (g) { return g || '-'; }).join(''));
    if (t == null) return;
    var letras = t.toUpperCase().replace(/[^A-EX\-?]/g, '').split('');
    letras.forEach(function (c, i) {
      if (i >= total(p)) return;
      if (c === 'X' || LET.indexOf(c) >= 0 && LET.indexOf(c) < p.alternativas) p.gabarito[i] = c;
      else p.gabarito[i] = '';
    });
    renderEditor();
    toast(Math.min(letras.length, total(p)) + ' respostas aplicadas.');
  }

  function imprimir(p) {
    var svg = SheetLayout.renderSVG(p, function (b) { return nomeBloco(p, b); });
    document.getElementById('print-area').innerHTML = svg;
    setTimeout(function () { window.print(); }, 50);
  }

  /* ---------------- leitura de fotos ---------------- */

  function carregarImagem(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir esta imagem.')); };
      img.src = url;
    });
  }

  // Desenha a foto (girada de `rot` graus) com o lado maior em `px`.
  function prepararCanvas(img, rot, px) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var k = px / Math.max(w, h);
    var sw = Math.round(w * k), sh = Math.round(h * k);
    var turned = rot === 90 || rot === 270;
    var c = document.createElement('canvas');
    c.width = turned ? sh : sw; c.height = turned ? sw : sh;
    var ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    return c;
  }

  function esperarTela() { return new Promise(function (r) { setTimeout(r, 60); }); }

  function analisar(img, rot, px, cfg) {
    var c = prepararCanvas(img, rot, px);
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    return { canvas: c, res: OMR.analyze(d.data, c.width, c.height, cfg) };
  }

  // Algum bloco ficou faltando entre os encontrados (posições com buraco)?
  function temLacuna(res) {
    if (!res.ok) return true;
    var ncols = 0;
    res.blocks.forEach(function (b) { ncols = Math.max(ncols, b.col + 1); });
    var span = 0;
    res.blocks.forEach(function (b) { span = Math.max(span, b.tier * ncols + b.col + 1); });
    return span > res.blocks.length;
  }

  // Lê a foto. Testa as rotações até achar o cartão em pé (foto deitada ou de cabeça para
  // baixo: a grade de cabeça para baixo também "encaixa", mas lida ao contrário). Se faltar
  // bloco e a foto tiver resolução sobrando, relê em resolução maior (bolinhas pequenas
  // numa foto da folha inteira).
  function lerFoto(file, p) {
    busy(true, 'Lendo a folha…');
    var cfg = { alternativas: p.alternativas, questoesPorBloco: p.questoesPorBloco };
    var carregada;
    return esperarTela().then(function () { return carregarImagem(file); }).then(function (r) {
      carregada = r;
      var passos = Promise.resolve(null);
      [0, 270, 90, 180].forEach(function (rot, k) {
        passos = passos.then(function (atual) {
          if (atual && atual.res.ok && atual.res.orient > 0) return atual;
          if (k) busy(true, 'Tentando com a foto girada…');
          return esperarTela().then(function () {
            var alt = analisar(r.img, rot, MAX_PX, cfg);
            alt.rot = rot;
            if (!atual) return alt;
            // fica a leitura válida mais "em pé"
            if (!alt.res.ok) return atual;
            return !atual.res.ok || alt.res.orient > atual.res.orient ? alt : atual;
          });
        });
      });
      var maior = Math.min(2600, Math.max(r.img.naturalWidth, r.img.naturalHeight));
      return passos.then(function (atual) {
        if (!temLacuna(atual.res) || maior <= MAX_PX * 1.25) return atual;
        busy(true, 'Relendo com mais detalhe…');
        return esperarTela().then(function () {
          var alt = analisar(r.img, atual.rot, maior, cfg);
          return alt.res.ok && (!atual.res.ok || alt.res.blocks.length > atual.res.blocks.length) ? alt : atual;
        });
      });
    }).then(function (out) {
      URL.revokeObjectURL(carregada.url);
      busy(false);
      return out;
    }, function (err) {
      if (carregada) URL.revokeObjectURL(carregada.url);
      busy(false);
      throw err;
    });
  }

  function valorLido(a) {
    if (a.status === 'ok') return LET[a.marked[0]];
    if (a.status === 'multi') return '*';
    return '';
  }

  /* ---------------- aba Corrigir ---------------- */

  function novaFolha(p, resultado) {
    return {
      provaId: p.id,
      resultadoId: resultado ? resultado.id : null,
      aluno: resultado ? resultado.aluno : '',
      respostas: resultado ? ajustar(resultado.respostas, total(p), null) : ajustar([], total(p), null),
      duvidas: {},
      alterada: false
    };
  }

  function blocoLido(p, f, b) {
    for (var q = 0; q < p.questoesPorBloco; q++) if (f.respostas[b * p.questoesPorBloco + q] !== null) return true;
    return false;
  }

  function primeiroBlocoPendente(p, f) {
    for (var b = 0; b < p.blocos; b++) if (!blocoLido(p, f, b)) return b;
    return 0;
  }

  // Decide para qual bloco da prova vai cada bloco achado na foto, pela posição dele na
  // folha (fileira/coluna). Se a foto mostra a folha inteira, a posição já é o número do
  // bloco; se mostra só uma parte, continua a partir de `pendente` (1º bloco ainda não lido).
  function mapearBlocos(p, dets, pendente) {
    var ncols = 0;
    dets.forEach(function (d) { ncols = Math.max(ncols, d.col + 1); });
    var slots = dets.map(function (d) { return d.tier * ncols + d.col; });
    var span = Math.max.apply(null, slots) + 1;
    var inicio = span >= p.blocos ? 0 : pendente;
    if (inicio + span > p.blocos) inicio = Math.max(0, p.blocos - span);
    return slots.map(function (s) { return inicio + s < p.blocos ? inicio + s : -1; });
  }

  // Coloca as respostas lidas de um bloco da foto no bloco `destino` da prova.
  function aplicarBloco(p, f, det) {
    if (det.destino == null || det.destino < 0) return;
    var nQ = p.questoesPorBloco;
    det.answers.forEach(function (a, q) {
      var i = det.destino * nQ + q;
      f.respostas[i] = valorLido(a);
      if (a.doubtful || a.status === 'multi') f.duvidas[i] = true; else delete f.duvidas[i];
    });
    f.alterada = true;
  }

  function limparBloco(p, f, b) {
    var nQ = p.questoesPorBloco;
    for (var q = 0; q < nQ; q++) { f.respostas[b * nQ + q] = null; delete f.duvidas[b * nQ + q]; }
  }

  function renderCorrigir() {
    var p = provaAtiva();
    if (!p) {
      view.innerHTML = '<div class="card empty"><div class="ico">📋</div><p>Cadastre uma prova primeiro.</p>' +
        '<button class="btn primary" data-act="nova-prova">+ Nova prova</button></div>';
      return;
    }
    if (!ui.folha || ui.folha.provaId !== p.id) { ui.folha = novaFolha(p); ui.foto = null; }
    var f = ui.folha;
    var falta = p.gabarito.filter(function (g) { return !g; }).length;
    var html = '<h2>' + (f.resultadoId ? 'Editar correção' : 'Corrigir') + '</h2>';
    if (falta) {
      html += '<div class="alert warn">O gabarito desta prova está incompleto (' + falta + ' questões sem resposta). ' +
        'Essas questões não entram na nota. <a href="#" data-act="ir-gabarito">Completar gabarito</a></div>';
    }

    html += '<div class="card"><label class="field" style="margin-bottom:10px"><span>Aluno(a)</span>' +
      '<input id="aluno" list="lista-alunos" value="' + esc(f.aluno) + '" placeholder="Nome do aluno" autocomplete="off"></label>' +
      '<datalist id="lista-alunos">' + state.alunos.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
      '<div class="progress">';
    for (var b = 0; b < p.blocos; b++) {
      html += '<span class="pb' + (blocoLido(p, f, b) ? ' done' : '') + '">' + (blocoLido(p, f, b) ? '✓ ' : '') + esc(nomeCurtoBloco(p, b)) + '</span>';
    }
    html += '</div></div>';

    html += '<div class="row" style="margin-bottom:12px">' +
      '<button class="btn primary grow" data-act="foto-camera" style="padding:15px">📷 Fotografar cartão</button>' +
      '<button class="btn" data-act="foto-galeria" style="padding:15px">🖼️ Galeria</button></div>';

    if (!ui.foto && !f.respostas.some(function (x) { return x !== null; })) {
      html += '<div class="card"><b>Dicas para uma boa leitura</b><ul class="tips">' +
        '<li>Fotografe de cima, com o cartão reto e bem iluminado, sem sombra do celular.</li>' +
        '<li>Enquadre os blocos de questões <b>inteiros</b> (do cabeçalho até a última questão).</li>' +
        '<li>Se o cartão não couber em uma foto, tire duas: o app junta os blocos.</li>' +
        '<li>Depois da leitura, confira as questões marcadas em amarelo.</li></ul></div>';
    }

    if (ui.foto) html += renderFoto(p, f);

    html += renderRespostas(p, f);
    view.innerHTML = html;
    if (ui.foto) desenharFoto(p, f);
  }

  function renderFoto(p, f) {
    var foto = ui.foto;
    var html = '<div class="card"><div class="photo-wrap"><canvas id="foto-canvas"></canvas></div>';
    if (!foto.res.ok) {
      html += '<div class="alert bad" style="margin-top:10px"><b>Não consegui ler esta foto.</b> ' + esc(foto.res.error) +
        '<br>Confira se o formato da prova (' + p.blocos + ' × ' + p.questoesPorBloco + ', A–' + LET[p.alternativas - 1] + ') bate com o cartão e tente outra foto.</div>';
    } else {
      var parcial = foto.blocos.length < p.blocos;
      html += '<div class="alert ' + (parcial ? 'warn' : 'ok') + '" style="margin-top:10px"><b>' + foto.blocos.length + ' de ' + p.blocos +
        ' bloco' + (p.blocos > 1 ? 's' : '') + '</b> encontrado' + (foto.blocos.length > 1 ? 's' : '') + ' nesta foto.' +
        (parcial ? ' Confira pelos números das questões se cada bloco foi para o lugar certo e ajuste abaixo se precisar.' : '') +
        '</div><div class="blocks-found">';
      foto.blocos.forEach(function (det, k) {
        html += '<div class="bf"><b>Foto ' + (k + 1) + ' →</b><select data-act="destino" data-k="' + k + '">' +
          '<option value="-1"' + (det.destino < 0 ? ' selected' : '') + '>ignorar</option>';
        for (var b = 0; b < p.blocos; b++) {
          html += '<option value="' + b + '"' + (det.destino === b ? ' selected' : '') + '>' + esc(nomeBloco(p, b)) + '</option>';
        }
        html += '</select><span class="muted small">grade:</span>' +
          '<button class="btn sm" data-act="mover" data-k="' + k + '" data-d="-1" title="Subir a grade uma linha">↑</button>' +
          '<button class="btn sm" data-act="mover" data-k="' + k + '" data-d="1" title="Descer a grade uma linha">↓</button></div>';
      });
      html += '</div><p class="muted small">Os círculos na foto mostram onde o app leu cada resposta. ' +
        'Se a grade estiver uma linha deslocada, use ↑ ↓.</p>';
    }
    html += '</div>';
    return html;
  }

  function desenharFoto(p, f) {
    var c = document.getElementById('foto-canvas');
    var src = ui.foto.canvas;
    c.width = src.width; c.height = src.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    if (!ui.foto.res.ok) return;
    var nQ = p.questoesPorBloco;
    ui.foto.blocos.forEach(function (det, k) {
      var cs = det.answers[0].centers;
      var r = 0.38 * Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]);
      det.answers.forEach(function (a, q) {
        var i = det.destino >= 0 ? det.destino * nQ + q : -1;
        var g = i >= 0 ? p.gabarito[i] : '';
        var resp = i >= 0 ? f.respostas[i] : valorLido(a);
        a.centers.forEach(function (pt, alt) {
          var L = LET[alt];
          var marcada = resp === '*' ? a.marked.indexOf(alt) >= 0 : resp === L;
          ctx.lineWidth = Math.max(2, r * 0.18);
          if (marcada) {
            var cor = det.destino < 0 || !g ? '#2b6ca3' : g === 'X' || g === L ? '#1f8a4c' : '#c0392b';
            if (resp === '*') cor = '#c77700';
            ctx.fillStyle = cor + 'aa';
            ctx.beginPath(); ctx.arc(pt[0], pt[1], r * 1.05, 0, 7); ctx.fill();
          } else if (g === L && resp !== g) {
            ctx.strokeStyle = '#1f8a4c';
            ctx.setLineDash([r * 0.4, r * 0.3]);
            ctx.beginPath(); ctx.arc(pt[0], pt[1], r * 1.1, 0, 7); ctx.stroke();
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = 'rgba(43,108,163,.55)';
            ctx.lineWidth = Math.max(1, r * 0.08);
            ctx.beginPath(); ctx.arc(pt[0], pt[1], r * 0.95, 0, 7); ctx.stroke();
          }
        });
        if (i >= 0 && f.duvidas[i]) {
          var a0 = a.centers[0], a1 = a.centers[a.centers.length - 1];
          ctx.strokeStyle = '#ff9f1a'; ctx.lineWidth = Math.max(2, r * 0.15);
          ctx.strokeRect(a0[0] - r * 1.4, a0[1] - r * 1.4, a1[0] - a0[0] + r * 2.8, a1[1] - a0[1] + r * 2.8);
        }
      });
      // rótulo do bloco
      var tl = det.answers[0].centers[0];
      var label = 'Foto ' + (k + 1) + (det.destino >= 0 ? ' → ' + nomeCurtoBloco(p, det.destino) : ' (ignorado)');
      ctx.font = 'bold ' + Math.round(r * 1.3) + 'px system-ui, sans-serif';
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(29,79,122,.92)';
      ctx.fillRect(tl[0] - r, tl[1] - r * 4.2, tw + r * 1.2, r * 2.2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, tl[0] - r * 0.4, tl[1] - r * 2.5);
    });
  }

  function renderRespostas(p, f) {
    var lidas = f.respostas.some(function (x) { return x !== null; });
    if (!lidas) return '';
    var c = corrigir(p, f.respostas.map(function (x) { return x == null ? '' : x; }));
    var nDuv = Object.keys(f.duvidas).length;
    var naoLidos = [];
    for (var b = 0; b < p.blocos; b++) if (!blocoLido(p, f, b)) naoLidos.push(nomeCurtoBloco(p, b));

    var html = '<div class="card"><div class="score"><span class="big">' + fmtNota(c.nota) + '</span>' +
      '<span class="muted">de ' + fmtNota(p.valor || 10) + ' · ' + c.acertos + '/' + c.total + ' acertos</span></div>';
    var rs = resumo(p, c);
    if (rs.length) {
      html += '<div class="row small" style="margin-top:6px">' + rs.map(function (x) {
        return '<span class="pill gray">' + esc(x.nome) + ': ' + x.acertos + '/' + x.total + '</span>';
      }).join('') + '</div>';
    }
    if (naoLidos.length) html += '<div class="alert warn" style="margin-top:10px">Ainda não lido: <b>' + esc(naoLidos.join(', ')) + '</b>. Tire outra foto ou preencha à mão abaixo.</div>';
    if (nDuv) html += '<div class="alert warn" style="margin-top:10px"><b>' + nDuv + ' questão(ões) para conferir</b> (em amarelo): marcação fraca, rasurada ou mais de uma bolinha.</div>';
    html += '</div>';

    html += '<div class="card"><h3 style="margin-top:0">Respostas do aluno</h3>' +
      '<p class="muted small">Toque para corrigir uma leitura. O contorno verde indica a resposta certa.</p><div class="qgrid">';
    for (b = 0; b < p.blocos; b++) {
      html += '<div class="qblock"><div class="qblock-title">' + esc(nomeBloco(p, b)) + '</div>';
      for (var q = 0; q < p.questoesPorBloco; q++) {
        var i = b * p.questoesPorBloco + q, r = f.respostas[i], g = p.gabarito[i], st = c.status[i];
        var cls = 'qrow' + (f.duvidas[i] ? ' duvida' : '') + (st === 'certa' ? ' certa' : st === 'errada' ? ' errada' : '');
        var mi = materiaInicio(p, i);
        if (mi) html += '<div class="qmat">' + esc(mi.nome) + '</div>';
        html += '<div class="' + cls + '"><span class="qn">' + numQ(p, i) + '</span><span class="alts">';
        for (var a = 0; a < p.alternativas; a++) {
          var L = LET[a];
          html += '<button class="alt' + (r === L ? ' on' : '') + (g === L && r !== L ? ' gab' : '') + '" data-act="resp" data-i="' + i + '" data-v="' + L + '">' + L + '</button>';
        }
        html += '</span>' + tagStatus(st, r) + '</div>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    html += '<div class="stack"><button class="btn primary big" data-act="salvar-correcao">💾 Salvar e corrigir o próximo</button>' +
      '<button class="btn big" data-act="descartar">Descartar</button></div>';
    return html;
  }

  function tagStatus(st, r) {
    if (r === null) return '<span class="tag muted">não lida</span>';
    if (st === 'multipla') return '<span class="tag pill warn">2+ marcadas</span>';
    if (st === 'branco') return '<span class="tag muted">em branco</span>';
    if (st === 'anulada') return '<span class="tag pill gray">anulada</span>';
    if (st === 'semgab') return '<span class="tag muted">sem gabarito</span>';
    return '';
  }

  function processarArquivos(files) {
    var p = provaAtiva();
    if (!p || !files.length) return;
    var lista = Array.prototype.slice.call(files);
    var chain = Promise.resolve();
    lista.forEach(function (file) {
      chain = chain.then(function () { return processarUm(p, file); });
    });
    chain.catch(function (e) { busy(false); toast(e.message || 'Erro ao ler a foto.'); });
  }

  function processarUm(p, file) {
    return lerFoto(file, p).then(function (out) {
      var f = ui.folha;
      var foto = { canvas: out.canvas, res: out.res, blocos: [] };
      if (out.res.ok) {
        var dets = out.res.blocks;
        var destinos = mapearBlocos(p, dets, primeiroBlocoPendente(p, f));
        dets.forEach(function (d, k) {
          var det = { bloco: d, shift: 0, answers: d.answers, destino: destinos[k] };
          foto.blocos.push(det);
          aplicarBloco(p, f, det);
        });
        var nd = Object.keys(f.duvidas).length;
        toast(dets.length + ' bloco(s) lido(s)' + (nd ? ' · confira ' + nd + ' questão(ões)' : '') + '.');
      }
      ui.foto = foto;
      renderCorrigir();
      var el = document.getElementById('foto-canvas');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function salvarCorrecao() {
    var p = provaAtiva(), f = ui.folha;
    var alunoEl = document.getElementById('aluno');
    f.aluno = alunoEl ? alunoEl.value.trim() : f.aluno;
    if (!f.aluno) { toast('Informe o nome do aluno.'); if (alunoEl) alunoEl.focus(); return; }
    var naoLidos = [];
    for (var b = 0; b < p.blocos; b++) if (!blocoLido(p, f, b)) naoLidos.push(nomeCurtoBloco(p, b));
    if (naoLidos.length && !confirm('Os blocos ' + naoLidos.join(', ') + ' não foram lidos e contarão como em branco. Salvar mesmo assim?')) return;
    var lista = state.resultados[p.id] = state.resultados[p.id] || [];
    var outro = lista.find(function (r) { return r.id !== f.resultadoId && r.aluno.toLowerCase() === f.aluno.toLowerCase(); });
    if (outro && !confirm(f.aluno + ' já tem uma correção nesta prova. Substituir?')) return;
    if (outro) lista.splice(lista.indexOf(outro), 1);
    var reg = {
      id: f.resultadoId || uid(), aluno: f.aluno,
      respostas: f.respostas.map(function (x) { return x == null ? '' : x; }), data: Date.now()
    };
    var i = lista.findIndex(function (r) { return r.id === reg.id; });
    if (i >= 0) lista[i] = reg; else lista.push(reg);
    if (state.alunos.indexOf(f.aluno) < 0 && !state.alunos.some(function (a) { return a.toLowerCase() === f.aluno.toLowerCase(); })) {
      state.alunos.push(f.aluno);
      state.alunos.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    }
    save();
    var c = corrigir(p, reg.respostas);
    toast('Salvo: ' + reg.aluno + ' — nota ' + fmtNota(c.nota));
    ui.folha = novaFolha(p); ui.foto = null;
    renderCorrigir();
    window.scrollTo(0, 0);
  }

  /* ---------------- aba Resultados ---------------- */

  function renderResultados() {
    var p = provaAtiva();
    if (!p) { view.innerHTML = '<div class="card empty"><p>Nenhuma prova cadastrada.</p></div>'; return; }
    var lista = (state.resultados[p.id] || []).slice().sort(function (a, b) { return a.aluno.localeCompare(b.aluno, 'pt-BR'); });
    var html = '<div class="row" style="justify-content:space-between"><h2>Resultados</h2>' +
      (lista.length ? '<button class="btn sm" data-act="csv">⬇️ Exportar planilha</button>' : '') + '</div>';
    if (!lista.length) {
      view.innerHTML = html + '<div class="card empty"><div class="ico">📊</div><p>Nenhum cartão corrigido nesta prova ainda.</p>' +
        '<button class="btn primary" data-act="tab" data-tab="corrigir">📷 Corrigir</button></div>';
      return;
    }
    var cs = lista.map(function (r) { return corrigir(p, r.respostas); });
    var notas = cs.map(function (c) { return c.nota; });
    var media = notas.reduce(function (a, b) { return a + b; }, 0) / notas.length;
    html += '<div class="stats" style="margin-bottom:12px">' +
      '<div class="st"><b>' + lista.length + '</b><span>corrigidos</span></div>' +
      '<div class="st"><b>' + fmtNota(media) + '</b><span>média</span></div>' +
      '<div class="st"><b>' + fmtNota(Math.max.apply(null, notas)) + '</b><span>maior</span></div>' +
      '<div class="st"><b>' + fmtNota(Math.min.apply(null, notas)) + '</b><span>menor</span></div></div>';

    html += '<div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Aluno</th><th class="num">Acertos</th><th class="num">Nota</th>';
    resumo(p, cs[0]).forEach(function (x) { html += '<th class="num">' + esc(x.nome) + '</th>'; });
    html += '<th></th></tr></thead><tbody>';
    lista.forEach(function (r, k) {
      var c = cs[k];
      html += '<tr class="click" data-act="abrir-resultado" data-id="' + r.id + '"><td>' + esc(r.aluno) + '</td>' +
        '<td class="num">' + c.acertos + '/' + c.total + '</td><td class="num"><b>' + fmtNota(c.nota) + '</b></td>';
      resumo(p, c).forEach(function (x) { html += '<td class="num">' + x.acertos + '/' + x.total + '</td>'; });
      html += '<td><button class="btn sm danger" data-act="excluir-resultado" data-id="' + r.id + '">✕</button></td></tr>';
    });
    html += '</tbody></table></div></div><p class="muted small">Toque em um aluno para revisar ou corrigir as respostas.</p>';

    // Análise por questão
    html += '<h3>Análise por questão</h3><div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr>' +
      '<th>Questão</th><th>Gab.</th><th>% acerto</th>';
    for (var a = 0; a < p.alternativas; a++) html += '<th class="num">' + LET[a] + '</th>';
    html += '<th class="num">Branco</th></tr></thead><tbody>';
    for (var i = 0; i < total(p); i++) {
      var g = p.gabarito[i], cont = {}, certos = 0;
      lista.forEach(function (r, k) {
        var v = r.respostas[i] || '';
        cont[v] = (cont[v] || 0) + 1;
        if (cs[k].status[i] === 'certa' || cs[k].status[i] === 'anulada') certos++;
      });
      var pct = g ? Math.round(certos / lista.length * 100) : null;
      html += '<tr><td>' + (p.numeracao === 'bloco' ? esc(nomeCurtoBloco(p, Math.floor(i / p.questoesPorBloco))) + ' ' : '') + numQ(p, i) + '</td>' +
        '<td><b>' + (g || '—') + '</b></td><td>' + (pct == null ? '—' :
          '<div class="row" style="flex-wrap:nowrap"><div class="bar' + (pct < 40 ? ' low' : '') + '" style="width:70px"><i style="width:' + pct + '%"></i></div>' + pct + '%</div>') + '</td>';
      for (a = 0; a < p.alternativas; a++) {
        var n = cont[LET[a]] || 0;
        html += '<td class="num"' + (LET[a] === g ? ' style="color:var(--ok);font-weight:700"' : '') + '>' + n + '</td>';
      }
      html += '<td class="num">' + ((cont[''] || 0) + (cont['*'] || 0)) + '</td></tr>';
    }
    html += '</tbody></table></div></div>';
    view.innerHTML = html;
  }

  function exportarCSV() {
    var p = provaAtiva();
    var lista = (state.resultados[p.id] || []).slice().sort(function (a, b) { return a.aluno.localeCompare(b.aluno, 'pt-BR'); });
    var head = ['Aluno', 'Acertos', 'Total', 'Nota'];
    var cols = resumo(p, corrigir(p, []));
    cols.forEach(function (x) { head.push(x.nome + ' (' + x.total + ')'); });
    for (var i = 0; i < total(p); i++) head.push((p.numeracao === 'bloco' ? nomeCurtoBloco(p, Math.floor(i / p.questoesPorBloco)) + ' ' : 'Q') + numQ(p, i));
    var linhaGab = ['GABARITO', '', '', ''];
    cols.forEach(function () { linhaGab.push(''); });
    var rows = [head, linhaGab.concat(p.gabarito.map(function (g) { return g === 'X' ? 'ANULADA' : g || '-'; }))];
    lista.forEach(function (r) {
      var c = corrigir(p, r.respostas);
      var row = [r.aluno, c.acertos, c.total, fmtNota(c.nota)];
      resumo(p, c).forEach(function (x) { row.push(x.acertos); });
      r.respostas.forEach(function (v) { row.push(v === '*' ? 'MÚLTIPLA' : v || '-'); });
      rows.push(row);
    });
    var csv = '﻿' + rows.map(function (row) {
      return row.map(function (v) {
        v = String(v);
        return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(';');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (p.nome + (p.turma ? ' - ' + p.turma : '')).replace(/[\\/:*?"<>|]/g, '_') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- aba Alunos ---------------- */

  function renderAlunos() {
    view.innerHTML = '<h2>Alunos</h2><div class="card">' +
      '<p class="muted small">Um nome por linha. A lista aparece como sugestão ao digitar o nome na correção. ' +
      'Alunos corrigidos também entram aqui automaticamente.</p>' +
      '<textarea id="alunos-txt" placeholder="Ana Beatriz Souza&#10;Bruno Henrique Lima&#10;…">' + esc(state.alunos.join('\n')) + '</textarea>' +
      '<div class="row" style="margin-top:10px"><button class="btn primary" data-act="salvar-alunos">Salvar lista</button>' +
      '<button class="btn" data-act="importar-alunos">📄 Importar arquivo (.txt/.csv)</button>' +
      '<span class="muted small">' + state.alunos.length + ' aluno(s)</span></div></div>';
  }

  function salvarAlunos(txt) {
    var vistos = {};
    state.alunos = txt.split(/\r?\n/).map(function (s) {
      return s.split(/[;,\t]/)[0].trim();
    }).filter(function (s) {
      var k = s.toLowerCase();
      if (!s || vistos[k]) return false;
      vistos[k] = 1;
      return true;
    }).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    save();
  }

  /* ---------------- eventos ---------------- */

  var gabFoto = false; // a próxima foto preenche o gabarito em vez de corrigir

  view.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    var act = el.dataset.act;
    var p = provaAtiva();
    if (el.tagName === 'A') e.preventDefault();

    if (act === 'nova-prova') { ui.tab = 'provas'; ui.editando = novaProva(); render(); }
    else if (act === 'editar-prova') {
      var orig = state.provas.find(function (x) { return x.id === el.dataset.id; });
      ui.editando = JSON.parse(JSON.stringify(orig));
      state.ativa = orig.id; save();
      render();
    }
    else if (act === 'ir-gabarito') { ui.tab = 'provas'; ui.editando = JSON.parse(JSON.stringify(p)); render(); }
    else if (act === 'voltar') { ui.editando = null; render(); }
    else if (act === 'preset') {
      lerCamposProva();
      ui.editando.blocos = +el.dataset.b; ui.editando.questoesPorBloco = +el.dataset.q;
      ui.editando.gabarito = ajustar(ui.editando.gabarito, total(ui.editando), '');
      renderEditor();
    }
    else if (act === 'gab') {
      lerCamposProva();
      var i = +el.dataset.i, v = el.dataset.v;
      ui.editando.gabarito[i] = ui.editando.gabarito[i] === v ? '' : v;
      var y = window.scrollY;
      renderEditor();
      window.scrollTo(0, y);
    }
    else if (act === 'gab-limpar') {
      if (confirm('Apagar todo o gabarito?')) { lerCamposProva(); ui.editando.gabarito = ajustar([], total(ui.editando), ''); renderEditor(); }
    }
    else if (act === 'gab-texto') gabaritoTexto();
    else if (act === 'gab-foto') { lerCamposProva(); gabFoto = true; document.getElementById('file-camera').click(); }
    else if (act === 'salvar-prova') salvarProva();
    else if (act === 'imprimir') { lerCamposProva(); imprimir(ui.editando); }
    else if (act === 'excluir-prova') {
      if (!confirm('Excluir a prova "' + ui.editando.nome + '" e todas as correções dela?')) return;
      state.provas = state.provas.filter(function (x) { return x.id !== ui.editando.id; });
      delete state.resultados[ui.editando.id];
      if (state.ativa === ui.editando.id) state.ativa = state.provas[0] ? state.provas[0].id : null;
      ui.editando = null; ui.folha = null; ui.foto = null;
      save(); render();
    }
    else if (act === 'foto-camera') { gabFoto = false; guardarAluno(); document.getElementById('file-camera').click(); }
    else if (act === 'foto-galeria') { gabFoto = false; guardarAluno(); document.getElementById('file-gallery').click(); }
    else if (act === 'mover') {
      var det = ui.foto.blocos[+el.dataset.k];
      det.shift += +el.dataset.d;
      det.answers = det.bloco.read(det.shift);
      guardarAluno();
      aplicarBloco(p, ui.folha, det);
      renderCorrigir();
    }
    else if (act === 'resp') {
      var f = ui.folha, k = +el.dataset.i, L = el.dataset.v;
      guardarAluno();
      f.respostas[k] = f.respostas[k] === L ? '' : L;
      delete f.duvidas[k];
      f.alterada = true;
      var sy = window.scrollY;
      renderCorrigir();
      window.scrollTo(0, sy);
    }
    else if (act === 'salvar-correcao') salvarCorrecao();
    else if (act === 'descartar') {
      if (ui.folha.alterada && !confirm('Descartar esta correção?')) return;
      ui.folha = novaFolha(p); ui.foto = null; renderCorrigir();
    }
    else if (act === 'tab') go(el.dataset.tab);
    else if (act === 'csv') exportarCSV();
    else if (act === 'abrir-resultado') {
      if (e.target.closest('[data-act="excluir-resultado"]')) return;
      var r = (state.resultados[p.id] || []).find(function (x) { return x.id === el.dataset.id; });
      ui.folha = novaFolha(p, r); ui.foto = null;
      go('corrigir');
    }
    else if (act === 'excluir-resultado') {
      e.stopPropagation();
      var lista = state.resultados[p.id] || [];
      var alvo = lista.find(function (x) { return x.id === el.dataset.id; });
      if (alvo && confirm('Excluir a correção de ' + alvo.aluno + '?')) {
        state.resultados[p.id] = lista.filter(function (x) { return x !== alvo; });
        save(); renderResultados();
      }
    }
    else if (act === 'salvar-alunos') { salvarAlunos(document.getElementById('alunos-txt').value); toast('Lista salva: ' + state.alunos.length + ' aluno(s).'); renderAlunos(); }
    else if (act === 'importar-alunos') document.getElementById('file-alunos').click();
  });

  view.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset.act === 'destino') {
      var p = provaAtiva(), f = ui.folha, det = ui.foto.blocos[+el.dataset.k];
      guardarAluno();
      if (det.destino >= 0) limparBloco(p, f, det.destino);
      det.destino = +el.value;
      // um bloco da prova recebe só um bloco da foto
      ui.foto.blocos.forEach(function (o) { if (o !== det && o.destino === det.destino) o.destino = -1; });
      aplicarBloco(p, f, det);
      renderCorrigir();
    } else if (el.hasAttribute('data-materias') || el.dataset.f === 'blocos' || el.dataset.f === 'questoesPorBloco' || el.dataset.f === 'numeracao' || el.dataset.f === 'alternativas') {
      lerCamposProva();
      renderEditor();
    }
  });

  view.addEventListener('input', function (e) {
    if (e.target.id === 'aluno' && ui.folha) { ui.folha.aluno = e.target.value; ui.folha.alterada = true; }
  });

  function guardarAluno() {
    var el = document.getElementById('aluno');
    if (el && ui.folha) ui.folha.aluno = el.value;
  }

  function aoEscolherFotos(e) {
    var files = e.target.files;
    if (!files || !files.length) return;
    var lista = Array.prototype.slice.call(files);
    e.target.value = '';
    if (gabFoto) { gabFoto = false; lerGabaritoFoto(lista[0]); }
    else processarArquivos(lista);
  }
  document.getElementById('file-camera').addEventListener('change', aoEscolherFotos);
  document.getElementById('file-gallery').addEventListener('change', aoEscolherFotos);

  function lerGabaritoFoto(file) {
    var p = ui.editando;
    lerFoto(file, p).then(function (out) {
      if (!out.res.ok) { toast(out.res.error); return; }
      var dets = out.res.blocks;
      // continua do primeiro bloco ainda sem gabarito
      var pendente = 0;
      for (var b = p.blocos - 1; b >= 0; b--) {
        for (var q = 0; q < p.questoesPorBloco; q++) if (!p.gabarito[b * p.questoesPorBloco + q]) { pendente = b; break; }
      }
      var destinos = mapearBlocos(p, dets, pendente);
      var duv = 0, nomes = [];
      dets.forEach(function (d, k) {
        if (destinos[k] < 0) return;
        nomes.push(nomeCurtoBloco(p, destinos[k]));
        d.answers.forEach(function (a, q) {
          var i = destinos[k] * p.questoesPorBloco + q;
          p.gabarito[i] = a.status === 'ok' ? LET[a.marked[0]] : '';
          if (a.status !== 'ok' || a.doubtful) duv++;
        });
      });
      renderEditor();
      toast('Gabarito lido: ' + nomes.join(', ') + '. ' + (duv ? duv + ' questão(ões) sem leitura clara: confira!' : 'Confira antes de salvar.'));
    }).catch(function (err) { toast(err.message); });
  }

  document.getElementById('file-alunos').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var atual = document.getElementById('alunos-txt');
      salvarAlunos((atual ? atual.value + '\n' : '') + rd.result);
      toast('Lista importada: ' + state.alunos.length + ' aluno(s).');
      renderAlunos();
    };
    rd.readAsText(file, 'utf-8');
  });

  window.addEventListener('beforeunload', function (e) {
    if (ui.folha && ui.folha.alterada) { e.preventDefault(); e.returnValue = ''; }
  });

  if (!state.provas.length) ui.tab = 'provas';
  else ui.tab = 'corrigir';
  render();
})();
