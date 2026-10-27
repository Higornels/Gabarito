/*
 * Leitura óptica de cartões-resposta a partir de fotos do celular.
 *
 * Não depende de um modelo de folha específico: procura as bolinhas na imagem,
 * agrupa-as em colunas (A, B, C...) e as colunas vizinhas em blocos de questões.
 * Dentro de cada bloco ajusta uma grade (com correção de perspectiva) e mede
 * o preenchimento de cada posição.
 *
 * Entrada: pixels RGBA + configuração { alternativas, questoesPorBloco }.
 * Saída: lista de blocos encontrados (esquerda→direita, cima→baixo), cada um com
 * as respostas lidas de suas questões.
 */
(function (root) {
  'use strict';

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Canal mínimo: caneta azul/vermelha também fica escura.
  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) {
      var r = rgba[j], gg = rgba[j + 1], b = rgba[j + 2];
      var m = r < gg ? r : gg;
      g[i] = m < b ? m : b;
    }
    return g;
  }

  // Média 3x3: apaga a retícula das faixas cinzas sem borrar as bolinhas.
  function blur3(g, w, h) {
    var o = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var ya = y > 0 ? y - 1 : y, yb = y < h - 1 ? y + 1 : y;
      for (var x = 0; x < w; x++) {
        var xa = x > 0 ? x - 1 : x, xb = x < w - 1 ? x + 1 : x;
        o[y * w + x] = (g[ya * w + xa] + g[ya * w + x] + g[ya * w + xb] +
                        g[y * w + xa] + g[y * w + x] + g[y * w + xb] +
                        g[yb * w + xa] + g[yb * w + x] + g[yb * w + xb]) / 9;
      }
    }
    return o;
  }

  // Limiar adaptativo pela média local (imagem integral) — tolera sombras.
  function binarize(g, w, h, win, k) {
    var W = w + 1;
    var integ = new Float64Array(W * (h + 1));
    for (var y = 0; y < h; y++) {
      var rowSum = 0;
      for (var x = 0; x < w; x++) {
        rowSum += g[y * w + x];
        integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + rowSum;
      }
    }
    var out = new Uint8Array(w * h);
    var half = win >> 1;
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        var sum = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
        var mean = sum / ((x1 - x0) * (y1 - y0));
        out[y * w + x] = g[y * w + x] < mean * (1 - k) ? 1 : 0;
      }
    }
    return out;
  }

  // Transformada de distância (chanfro 3-4): distância de cada pixel escuro até o claro mais próximo.
  function distanceTransform(bin, w, h) {
    var d = new Int32Array(w * h), INF = 1 << 20, x, y, i, v;
    for (i = 0; i < d.length; i++) d[i] = bin[i] ? INF : 0;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (!d[i]) continue;
        v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 3); else v = Math.min(v, 3);
        if (y > 0) {
          v = Math.min(v, d[i - w] + 3);
          if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
          if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
        } else v = Math.min(v, 3);
        d[i] = v;
      }
    }
    for (y = h - 1; y >= 0; y--) {
      for (x = w - 1; x >= 0; x--) {
        i = y * w + x;
        if (!d[i]) continue;
        v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 3); else v = Math.min(v, 3);
        if (y < h - 1) {
          v = Math.min(v, d[i + w] + 3);
          if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
          if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
        } else v = Math.min(v, 3);
        d[i] = v;
      }
    }
    return d;
  }

  /* ---------- 1. candidatos a bolinha ---------- */

  // Raio da bolinha: as marcações preenchidas são os "discos" mais frequentes da imagem,
  // então o valor mais comum entre os máximos locais da transformada de distância é o raio.
  function estimateRadius(dt, w, h) {
    var hist = {}, last = {};
    var dirs = [];
    for (var a = 0; a < 16; a++) dirs.push([Math.cos(a * Math.PI / 8), Math.sin(a * Math.PI / 8)]);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x, v = dt[i];
        if (v < 12) continue; // < 4 px: traços de texto e linhas
        if (v < dt[i - 1] || v < dt[i + 1] || v < dt[i - w] || v < dt[i + w] ||
            v < dt[i - w - 1] || v < dt[i - w + 1] || v < dt[i + w - 1] || v < dt[i + w + 1]) continue;
        var r = v / 3;
        // Disco: claro logo além do raio em quase todas as direções (linhas grossas não passam).
        var white = 0, d = r * 1.4 + 1;
        for (a = 0; a < 16; a++) {
          var xx = Math.round(x + dirs[a][0] * d), yy = Math.round(y + dirs[a][1] * d);
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !dt[yy * w + xx]) white++;
        }
        if (white < 11) continue;
        // um voto por disco (o platô do centro tem vários pixels)
        var key = Math.round(x / r) + ',' + Math.round(y / r);
        if (last[key]) continue;
        last[key] = 1;
        var rk = Math.round(r);
        hist[rk] = (hist[rk] || 0) + 1;
      }
    }
    // Picos do histograma (raios plausíveis), do mais votado para o menos.
    var minR = Math.max(5, Math.max(w, h) * 0.005);
    var peaks = [];
    Object.keys(hist).forEach(function (k) {
      k = +k;
      if (k < minR) return;
      var n = (hist[k - 1] || 0) + hist[k] + (hist[k + 1] || 0);
      if ((hist[k - 1] || 0) > hist[k] || (hist[k + 1] || 0) > hist[k]) return;
      var sw = 0, sv = 0;
      for (var j = k - 1; j <= k + 1; j++) { sw += hist[j] || 0; sv += (hist[j] || 0) * j; }
      peaks.push({ r: sv / sw, n: n });
    });
    peaks.sort(function (p, q) { return q.n - p.n; });
    return peaks.slice(0, 3).map(function (p) { return p.r; });
  }

  // Procura centros cercados por um anel escuro de raio r (bolinhas vazias ou cheias).
  function findBubbles(bin, w, h, r) {
    var NA = 32, step = 2;
    var rings = [];
    for (var a = 0; a < NA; a++) {
      var ang = a * 2 * Math.PI / NA, ca = Math.cos(ang), sa = Math.sin(ang), seen = {}, offs = [];
      for (var t = 0.72; t <= 1.18; t += 0.08) {
        var ox = Math.round(ca * r * t), oy = Math.round(sa * r * t), key = ox + ',' + oy;
        if (seen[key]) continue;
        seen[key] = 1;
        offs.push(oy * w + ox);
      }
      rings.push(offs);
    }
    var m = Math.ceil(r * 1.2) + 1;
    var gw = Math.floor((w - 2 * m) / step), gh = Math.floor((h - 2 * m) / step);
    if (gw <= 0 || gh <= 0) return [];
    var score = new Float32Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var c = (m + gy * step) * w + m + gx * step, hit = 0;
        for (a = 0; a < NA; a++) {
          var o = rings[a];
          for (var j = 0; j < o.length; j++) if (bin[c + o[j]]) { hit++; break; }
          if (hit + (NA - a - 1) < NA * 0.74) break; // já não alcança o mínimo
        }
        score[gy * gw + gx] = hit / NA;
      }
    }
    // Máximos locais (supressão de não-máximos num raio ~1,25r: vizinhas reais ficam a ≥ 2r).
    var nr = Math.max(1, Math.round(r * 1.25 / step));
    var out = [];
    for (gy = 0; gy < gh; gy++) {
      for (gx = 0; gx < gw; gx++) {
        var v = score[gy * gw + gx];
        if (v < 0.74) continue;
        var isMax = true;
        for (var dy = -nr; dy <= nr && isMax; dy++) {
          var yy = gy + dy;
          if (yy < 0 || yy >= gh) continue;
          for (var dx = -nr; dx <= nr; dx++) {
            var xx = gx + dx;
            if (xx < 0 || xx >= gw || (!dx && !dy)) continue;
            var u = score[yy * gw + xx];
            // empate: fica o primeiro na ordem de varredura
            if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; }
          }
        }
        if (!isMax) continue;
        // Centro = média das posições com o mesmo escore máximo (platô de discos cheios).
        var sx = 0, sy = 0, n = 0;
        for (dy = -nr; dy <= nr; dy++) {
          for (dx = -nr; dx <= nr; dx++) {
            yy = gy + dy; xx = gx + dx;
            if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue;
            if (score[yy * gw + xx] >= v - 1e-6) { sx += xx; sy += yy; n++; }
          }
        }
        out.push({ x: m + (sx / n) * step, y: m + (sy / n) * step, score: v });
      }
    }
    return out;
  }

  /* ---------- 2. colunas verticais de bolinhas ---------- */

  function buildLines(cands, s, minLen) {
    var n = cands.length;
    var below = new Int32Array(n).fill(-1), above = new Int32Array(n).fill(-1);
    var byY = cands.map(function (c, i) { return i; }).sort(function (a, b) { return cands[a].y - cands[b].y; });
    function bestBelow(i) {
      var c = cands[i], best = -1, bestD = Infinity;
      for (var j = 0; j < n; j++) {
        var o = cands[j];
        var dy = o.y - c.y;
        if (dy < 0.6 * s || dy > 3.2 * s) continue;
        var dx = Math.abs(o.x - c.x);
        if (dx > 0.22 * dy + 0.25 * s) continue;
        var d = dy + 2 * dx;
        if (d < bestD) { bestD = d; best = j; }
      }
      return best;
    }
    function bestAbove(j) {
      var c = cands[j], best = -1, bestD = Infinity;
      for (var i = 0; i < n; i++) {
        var o = cands[i];
        var dy = c.y - o.y;
        if (dy < 0.6 * s || dy > 3.2 * s) continue;
        var dx = Math.abs(o.x - c.x);
        if (dx > 0.22 * dy + 0.25 * s) continue;
        var d = dy + 2 * dx;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    for (var i = 0; i < n; i++) {
      var j = bestBelow(i);
      if (j >= 0 && bestAbove(j) === i) { below[i] = j; above[j] = i; }
    }
    var lines = [];
    byY.forEach(function (i) {
      if (above[i] !== -1) return;
      var chain = [];
      for (var k = i; k !== -1; k = below[k]) chain.push(cands[k]);
      // Corta onde o salto é bem maior que o passo típico: blocos empilhados
      // (um embaixo do outro) não podem virar uma coluna só.
      var gaps = [];
      for (k = 1; k < chain.length; k++) gaps.push(chain[k].y - chain[k - 1].y);
      var mg = median(gaps), seg = [chain[0]];
      for (k = 1; k <= chain.length; k++) {
        if (k === chain.length || gaps[k - 1] > 2.2 * mg) { addLine(seg); seg = []; }
        if (k < chain.length) seg.push(chain[k]);
      }
    });
    return lines;

    function addLine(pts) {
      if (pts.length < minLen) return;
      // x = a*y + b (mínimos quadrados)
      var my = 0, mx = 0;
      pts.forEach(function (p) { my += p.y; mx += p.x; });
      my /= pts.length; mx /= pts.length;
      var sxy = 0, syy = 0;
      pts.forEach(function (p) { sxy += (p.y - my) * (p.x - mx); syy += (p.y - my) * (p.y - my); });
      var a = syy ? sxy / syy : 0;
      lines.push({ pts: pts, a: a, b: mx - a * my, y0: pts[0].y, y1: pts[pts.length - 1].y, xm: mx, ym: my });
    }
  }

  function lineX(L, y) { return L.a * y + L.b; }

  /* ---------- 3. blocos = colunas vizinhas ---------- */

  function groupBlocks(lines, s, nAlt) {
    lines.sort(function (p, q) { return p.xm - q.xm; });
    var used = new Array(lines.length).fill(false);
    var blocks = [];
    function overlap(p, q) {
      var o = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
      return o / Math.min(p.y1 - p.y0 || 1, q.y1 - q.y0 || 1);
    }
    function rightNeighbor(i) {
      var p = lines[i], best = -1, bestD = Infinity;
      for (var j = 0; j < lines.length; j++) {
        if (j === i || used[j]) continue;
        var q = lines[j];
        if (overlap(p, q) < 0.4) continue;
        var ym = (Math.max(p.y0, q.y0) + Math.min(p.y1, q.y1)) / 2;
        var dx = lineX(q, ym) - lineX(p, ym);
        if (dx < 0.9 * s || dx > 2.0 * s) continue;
        if (dx < bestD) { bestD = dx; best = j; }
      }
      return best;
    }
    function hasLeftNeighbor(i) {
      var p = lines[i];
      for (var j = 0; j < lines.length; j++) {
        if (j === i || used[j]) continue;
        var q = lines[j];
        if (overlap(p, q) < 0.4) continue;
        var ym = (Math.max(p.y0, q.y0) + Math.min(p.y1, q.y1)) / 2;
        var dx = lineX(p, ym) - lineX(q, ym);
        if (dx >= 0.9 * s && dx <= 2.0 * s) return true;
      }
      return false;
    }
    for (var i = 0; i < lines.length; i++) {
      if (used[i] || hasLeftNeighbor(i)) continue;
      var run = [i];
      used[i] = true;
      var cur = i;
      for (;;) {
        var nx = rightNeighbor(cur);
        if (nx < 0) break;
        run.push(nx); used[nx] = true; cur = nx;
      }
      splitRun(run.map(function (k) { return lines[k]; }), nAlt, blocks);
    }
    return blocks;
  }

  // Uma sequência de colunas pode ter "intrusas" (coluna dos números, borda da tabela):
  // escolhe a janela de nAlt colunas mais regular e com mais bolinhas; o resto é reprocessado.
  function splitRun(run, nAlt, out) {
    // Com uma coluna a menos (não detectada) ainda vale: o refinamento completa a grade.
    if (run.length === nAlt - 1 && nAlt >= 4) { out.push(run); return; }
    if (run.length < nAlt) return;
    if (run.length === nAlt) { out.push(run); return; }
    var best = -1, bestScore = -Infinity;
    for (var st = 0; st + nAlt <= run.length; st++) {
      var win = run.slice(st, st + nAlt);
      var pts = 0, d = [];
      win.forEach(function (L, i) {
        pts += L.pts.length;
        if (i) d.push(L.xm - win[i - 1].xm);
      });
      var md = median(d), dev = 0;
      d.forEach(function (v) { dev += Math.abs(v - md) / md; });
      var score = pts * (1 - dev);
      if (score > bestScore) { bestScore = score; best = st; }
    }
    out.push(run.slice(best, best + nAlt));
    splitRun(run.slice(0, best), nAlt, out);
    splitRun(run.slice(best + nAlt), nAlt, out);
  }

  /* ---------- 4. grade de cada bloco ---------- */

  // Homografia por mínimos quadrados: (u,v) da grade → (x,y) da imagem.
  function fitHomography(pairs) {
    if (pairs.length < 4) return null;
    var M = [], i, j, k;
    for (i = 0; i < 8; i++) { M.push(new Array(9).fill(0)); }
    pairs.forEach(function (p) {
      var u = p[0], v = p[1], x = p[2], y = p[3];
      var r1 = [u, v, 1, 0, 0, 0, -x * u, -x * v, x];
      var r2 = [0, 0, 0, u, v, 1, -y * u, -y * v, y];
      [r1, r2].forEach(function (r) {
        for (var a = 0; a < 8; a++) for (var b = 0; b < 9; b++) M[a][b] += r[a] * r[b];
      });
    });
    for (var c = 0; c < 8; c++) {
      var p = c;
      for (i = c + 1; i < 8; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      for (i = 0; i < 8; i++) {
        if (i === c) continue;
        var f = M[i][c] / M[c][c];
        if (!f) continue;
        for (k = c; k < 9; k++) M[i][k] -= f * M[c][k];
      }
    }
    var H = [];
    for (j = 0; j < 8; j++) H.push(M[j][8] / M[j][j]);
    H.push(1);
    return H;
  }

  function project(H, u, v) {
    var d = H[6] * u + H[7] * v + H[8];
    return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d];
  }

  function solveBlock(lines, s, nRows, nAlt, fillAt, ringAt) {
    // Inclinação das linhas de questões: casando bolinhas de colunas vizinhas.
    var slopes = [];
    for (var c = 0; c + 1 < lines.length; c++) {
      lines[c].pts.forEach(function (p) {
        var best = null, bd = Infinity;
        lines[c + 1].pts.forEach(function (q) {
          var d = Math.abs(q.y - p.y);
          if (d < bd) { bd = d; best = q; }
        });
        if (best && bd < 0.5 * s && best.x > p.x) slopes.push((best.y - p.y) / (best.x - p.x));
      });
    }
    var m = median(slopes);
    var gaps = [];
    lines.forEach(function (L) {
      for (var i = 1; i < L.pts.length; i++) gaps.push(L.pts[i].y - L.pts[i - 1].y);
    });
    // Espaçamento entre questões. Pode faltar bolinha detectada (ex.: linhas cinzas da
    // zebra), então muitos saltos valem 2 ou 3 linhas: usa os menores saltos como base e
    // o espaçamento entre colunas como referência de escala.
    gaps.sort(function (a, b) { return a - b; });
    var colGaps = [];
    for (var k = 1; k < lines.length; k++) colGaps.push(lines[k].xm - lines[k - 1].xm);
    var colP = median(colGaps);
    var pmin = gaps[Math.floor(gaps.length * 0.1)] || colP;
    if (colP && pmin > 1.6 * colP) pmin /= Math.round(pmin / colP);
    var py = median(gaps.map(function (g) { return g / Math.max(1, Math.round(g / pmin)); }));

    var x0 = median(lines.map(function (L) { return L.xm; }));
    var pts = [];
    lines.forEach(function (L, ci) {
      L.pts.forEach(function (p) { pts.push({ p: p, col: ci, yp: p.y - m * (p.x - x0) }); });
    });
    pts.sort(function (a, b) { return a.yp - b.yp; });
    // Agrupa em linhas (questões).
    var rows = [];
    pts.forEach(function (q) {
      var last = rows[rows.length - 1];
      if (last && q.yp - last.yp < 0.45 * py) { last.items.push(q); last.yp = (last.yp * (last.items.length - 1) + q.yp) / last.items.length; }
      else rows.push({ yp: q.yp, items: [q] });
    });
    var idx = 0;
    rows.forEach(function (r, i) {
      if (i > 0) {
        var gap = r.yp - rows[i - 1].yp;
        idx += Math.max(1, Math.round(gap / py));
      }
      r.idx = idx;
    });
    var span = idx + 1;
    if (span < nRows) return { ok: false, reason: 'incompleto', rowsFound: span };
    // Se sobraram linhas (cabeçalho "QUESTÃO/RESPOSTA", rodapé...), testa cada janela de
    // nRows linhas. Uma questão de verdade tem anéis nítidos em todas as posições e no
    // máximo uma bolinha escura; um cabeçalho de texto não tem anéis e uma faixa escura
    // parece uma linha toda cheia. Fica a janela com mais "cara de questão".
    var best = null;
    for (var st = 0; st + nRows <= span; st++) {
      var sol = fitWindow(rows, st, nRows, s);
      if (!sol) continue;
      sol.quality = blockQuality(sol.H, nAlt, nRows, fillAt, ringAt);
      if (!best || sol.quality > best.quality) best = sol;
    }
    if (!best) return { ok: false, reason: 'grade' };
    var coverage = best.good / (nRows * lines.length);
    if (coverage < 0.35) return { ok: false, reason: 'cobertura' };
    // A grade pode ter "escorregado" uma coluna (coluna dos números, coluna não detectada)
    // ou uma linha: testa os vizinhos e fica com o de maior qualidade.
    var H = best.H, quality = best.quality;
    for (var step = 0; step < 4; step++) {
      var base = H, moved = false;
      for (var dc = -1; dc <= 1; dc++) {
        for (var dq = -1; dq <= 1; dq++) {
          if (!dc && !dq) continue;
          var H2 = shiftH(base, dc, dq);
          var q2 = blockQuality(H2, nAlt, nRows, fillAt, ringAt);
          if (q2 > quality + 0.2) { quality = q2; H = H2; moved = true; }
        }
      }
      if (!moved) break;
    }
    return { ok: true, H: H, coverage: coverage, quality: quality / nRows };
  }

  // Quanto a grade parece um bloco de questões: anéis nítidos em todas as posições e, em
  // cada linha, no máximo uma bolinha escura (um cabeçalho escuro parece uma linha cheia).
  // Uma marcação que se destaca das outras também conta: nas linhas brancas da zebra os
  // anéis saem fracos, e sem isso a grade desce uma linha (perde a 1ª questão e pega o
  // papel em branco abaixo do bloco, que não tem marcação nenhuma).
  function blockQuality(H, nAlt, nRows, fillAt, ringAt) {
    var quality = 0, r = latticeRadius(H, nAlt, nRows);
    for (var q = 0; q < nRows; q++) {
      var f = [], ring = 0;
      for (var c = 0; c < nAlt; c++) {
        var p = project(H, c, q);
        f.push(fillAt(p[0], p[1], r * 0.6));
        ring += ringAt(p[0], p[1], r);
      }
      f.sort(function (a, b) { return a - b; });
      var mark = f[nAlt - 1] - f[(nAlt - 1) >> 1];
      quality += ring / nAlt - 5 * Math.max(0, f[0] - 0.4) + 0.5 * Math.max(0, mark);
    }
    return quality;
  }

  // Raio da bolinha deduzido do espaçamento da grade (≈ 0,38 × distância entre vizinhas).
  // Depender só da grade deixa todas as hipóteses comparáveis entre si.
  function latticeRadius(H, nAlt, nRows) {
    var mc = (nAlt - 1) / 2, mq = (nRows - 1) / 2;
    var colP = Math.hypot.apply(null, sub(project(H, mc + 0.5, mq), project(H, mc - 0.5, mq)));
    var rowP = Math.hypot.apply(null, sub(project(H, mc, mq + 0.5), project(H, mc, mq - 0.5)));
    return 0.38 * Math.min(colP, rowP);
  }

  // Desloca a grade de (dc colunas, dq linhas).
  function shiftH(H, dc, dq) {
    return [H[0], H[1], H[0] * dc + H[1] * dq + H[2],
            H[3], H[4], H[3] * dc + H[4] * dq + H[5],
            H[6], H[7], H[6] * dc + H[7] * dq + H[8]];
  }

  function fitWindow(rows, st, nRows, s) {
    var pairs = [];
    rows.forEach(function (r) {
      if (r.idx < st || r.idx >= st + nRows) return;
      r.items.forEach(function (q) { pairs.push([q.col, r.idx - st, q.p.x, q.p.y]); });
    });
    var H = fitHomography(pairs);
    if (!H) return null;
    // Remove pontos muito fora da grade e reajusta.
    var good = pairs.filter(function (q) {
      var p = project(H, q[0], q[1]);
      return Math.hypot(p[0] - q[2], p[1] - q[3]) < 0.35 * s;
    });
    if (good.length >= 8 && good.length < pairs.length) H = fitHomography(good) || H;
    return { H: H, good: good.length };
  }

  /* ---------- 5. leitura do preenchimento ---------- */

  function sampleDisc(bin, w, h, cx, cy, rad) {
    var r2 = rad * rad, dark = 0, tot = 0;
    var x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
    var y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        tot++; dark += bin[y * w + x];
      }
    }
    return tot ? dark / tot : 0;
  }

  // Fração das direções com a "assinatura" de uma bolinha: traço escuro à distância ~r e,
  // além disso, claro no miolo (anel vazio) ou logo fora (bolinha pintada). Faixas escuras
  // de cabeçalho e texto não têm esse contraste.
  function ringScore(bin, w, h, cx, cy, r) {
    var NA = 32, hit = 0;
    function dark(x, y) {
      x = Math.round(x); y = Math.round(y);
      return x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] === 1;
    }
    for (var a = 0; a < NA; a++) {
      var ca = Math.cos(a * 2 * Math.PI / NA), sa = Math.sin(a * 2 * Math.PI / NA);
      var band = false;
      for (var t = 0.72; t <= 1.18; t += 0.08) {
        if (dark(cx + ca * r * t, cy + sa * r * t)) { band = true; break; }
      }
      if (!band) continue;
      if (!dark(cx + ca * r * 0.45, cy + sa * r * 0.45) || !dark(cx + ca * r * 1.45, cy + sa * r * 1.45)) hit++;
    }
    return hit / NA;
  }

  // Interpreta os preenchimentos de uma questão. As letras impressas dentro das
  // bolinhas vazias também escurecem um pouco, por isso a referência é relativa.
  function decide(fills) {
    var sorted = fills.slice().sort(function (a, b) { return a - b; });
    var base = sorted[Math.floor((sorted.length - 1) / 2)];
    var max = sorted[sorted.length - 1];
    var thr = Math.max(0.45, base + 0.3, max * 0.65);
    var marked = [];
    fills.forEach(function (v, i) { if (v >= thr) marked.push(i); });
    if (!marked.length) return { marked: [], status: 'blank', doubtful: max > 0.4 && max - base > 0.2 };
    if (marked.length > 1) return { marked: marked, status: 'multi', doubtful: true };
    var second = sorted.length > 1 ? sorted[sorted.length - 2] : 0;
    return { marked: marked, status: 'ok', doubtful: max < 0.6 || second > Math.max(0.4, base + 0.2) };
  }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }

  // Tratamentos da imagem, do padrão ao mais fino. O mais fino preserva o contorno das
  // bolinhas vazias quando ele é fino e claro (impressão fraca, foto de baixa resolução).
  var PREPS = [
    { blurs: 2, k: 0.22, scales: [1, 1.2, 1.4] },
    { blurs: 1, k: 0.12, scales: [0.8, 0.9, 1, 1.2] }
  ];

  // Cada tratamento pode achar blocos diferentes (um acha só o bloco 4, outro acha os
  // demais): junta tudo e só para antes quando já tem todos os blocos esperados.
  function analyze(rgba, w, h, cfg) {
    var g0 = toGray(rgba, w, h), nAlt = cfg.alternativas, nRows = cfg.questoesPorBloco;
    var blocks = [], rejected = 0, semRaio = true;
    for (var i = 0; i < PREPS.length; i++) {
      var gray = g0;
      for (var b = 0; b < PREPS[i].blurs; b++) gray = blur3(gray, w, h);
      var res = analyzeGray(gray, w, h, cfg, PREPS[i]);
      if (!res.semRaio) semRaio = false;
      rejected += res.rejected;
      res.blocks.forEach(function (bl) { juntar(blocks, bl); });
      if (blocks.length && (!cfg.blocos || blocks.length >= cfg.blocos)) break;
    }
    if (!blocks.length) {
      return {
        ok: false, blocks: [],
        error: semRaio ? 'Não encontrei bolinhas preenchidas na foto.'
          : rejected
          ? 'Encontrei blocos de questões, mas nenhum completo. Enquadre o bloco inteiro na foto.'
          : 'Não encontrei blocos com ' + nAlt + ' alternativas e ' + nRows + ' questões. Confira a configuração da prova.'
      };
    }
    posicionar(blocks);
    var orient = 0;
    blocks.forEach(function (bl) { orient += bl.orient; });
    return { ok: true, blocks: blocks, orient: orient / blocks.length };
  }

  // Áreas sobrepostas = mesmo bloco (talvez deslocado): fica a leitura de maior qualidade.
  function juntar(blocks, b) {
    for (var i = 0; i < blocks.length; i++) {
      var o = blocks[i];
      if (Math.abs(o.cx - b.cx) < (o.bw + b.bw) / 2 && Math.abs(o.cy - b.cy) < (o.bh + b.bh) / 2) {
        if (o.quality >= b.quality) return;
        blocks.splice(i, 1);
        break;
      }
    }
    blocks.push(b);
  }

  function analyzeGray(gray, w, h, cfg, prep) {
    var nAlt = cfg.alternativas, nRows = cfg.questoesPorBloco;
    var maxDim = Math.max(w, h);
    var win = Math.max(15, Math.round(maxDim / 12)) | 1;
    var bin = binarize(gray, w, h, win, prep.k);
    var radii = estimateRadius(distanceTransform(bin, w, h), w, h);
    if (!radii.length) return { blocks: [], rejected: 0, semRaio: true };
    // Testa os raios mais prováveis (o aluno costuma pintar por dentro do anel impresso,
    // então o anel pode ser um pouco maior — ou borrar para fora, e o anel ser menor) e
    // junta os blocos achados em todas as tentativas; quando o mesmo bloco aparece mais
    // de uma vez, fica a leitura de maior qualidade.
    var tries = [];
    radii.forEach(function (r) { prep.scales.forEach(function (k) { tries.push(r * k); }); });
    var blocks = [], rejected = 0;
    tries.forEach(function (r) {
      var res = detect(bin, w, h, r, nAlt, nRows);
      rejected += res.rejected;
      res.blocks.forEach(function (b) {
        if (b.quality < 0.55) return;
        b.size = res.bubbleSize;
        b.read = function (shift) { return res.read(b.H, shift); };
        var c = project(b.H, (nAlt - 1) / 2, (nRows - 1) / 2);
        b.cx = c[0]; b.cy = c[1];
        b.bw = Math.hypot.apply(null, sub(project(b.H, nAlt - 0.5, (nRows - 1) / 2), project(b.H, -0.5, (nRows - 1) / 2)));
        b.bh = Math.hypot.apply(null, sub(project(b.H, (nAlt - 1) / 2, nRows - 0.5), project(b.H, (nAlt - 1) / 2, -0.5)));
        b.orient = orientation(bin, w, h, b.H, nAlt, nRows);
        juntar(blocks, b);
      });
    });
    return { blocks: blocks, rejected: rejected };
  }

  // Positivo = cartão em pé. Num bloco em pé os números das questões ficam à esquerda da
  // coluna A e o cabeçalho fica acima da 1ª questão; de cabeça para baixo a grade é a
  // mesma, mas esses elementos ficam à direita e embaixo.
  function orientation(bin, w, h, H, nAlt, nRows) {
    var r = latticeRadius(H, nAlt, nRows) * 0.9, lr = 0, tb = 0;
    for (var q = 0; q < nRows; q++) {
      var L = project(H, -1, q), R = project(H, nAlt, q);
      lr += sampleDisc(bin, w, h, L[0], L[1], r) - sampleDisc(bin, w, h, R[0], R[1], r);
    }
    for (var c = 0; c < nAlt; c++) {
      var T = project(H, c, -1), B = project(H, c, nRows);
      tb += sampleDisc(bin, w, h, T[0], T[1], r) - sampleDisc(bin, w, h, B[0], B[1], r);
    }
    return lr / nRows + tb / nAlt;
  }

  // Fileira (tier) e coluna (col) de cada bloco na folha, guardando o lugar de um bloco
  // que não foi encontrado: assim o 3º bloco nunca vira o 2º só porque o 2º faltou.
  function posicionar(blocks) {
    blocks.sort(function (a, b) { return a.cy - b.cy; });
    var tier = 0;
    blocks.forEach(function (b, i) {
      if (i && b.cy - blocks[i - 1].cy > (b.bh + blocks[i - 1].bh) / 4) tier++;
      b.tier = tier;
    });
    var xs = blocks.map(function (b) { return b.cx; }).sort(function (a, b) { return a - b; });
    var bw = median(blocks.map(function (b) { return b.bw; }));
    var cols = [];
    xs.forEach(function (x) {
      var last = cols[cols.length - 1];
      if (last && x - last.x < bw * 0.6) { last.n++; last.x += (x - last.x) / last.n; }
      else cols.push({ x: x, n: 1 });
    });
    var pitch = Infinity;
    for (var i = 1; i < cols.length; i++) pitch = Math.min(pitch, cols[i].x - cols[i - 1].x);
    blocks.forEach(function (b) {
      b.col = cols.length > 1 ? Math.round((b.cx - cols[0].x) / pitch) : 0;
    });
    blocks.sort(function (a, b) { return a.tier - b.tier || a.col - b.col; });
  }

  function detect(bin, w, h, r, nAlt, nRows) {
    var cands = findBubbles(bin, w, h, r);
    var s = 2 * r;
    var lines = buildLines(cands, s, Math.max(3, Math.floor(nRows * 0.4)));
    var groups = groupBlocks(lines, s, nAlt);
    var blocks = [], rejected = 0;
    function fillAt(x, y, rad) { return sampleDisc(bin, w, h, x, y, rad); }
    function ringAt(x, y, rr) { return ringScore(bin, w, h, x, y, rr); }
    // Lê o bloco deslocado de `shift` linhas (correção manual quando a grade "escorrega").
    function read(H, shift) {
      var answers = [], rad = latticeRadius(H, nAlt, nRows) * 0.6;
      for (var q = 0; q < nRows; q++) {
        var fills = [], centers = [];
        for (var c = 0; c < nAlt; c++) {
          var p = project(H, c, q + shift);
          centers.push(p);
          fills.push(fillAt(p[0], p[1], rad));
        }
        var d = decide(fills);
        d.fills = fills; d.centers = centers;
        answers.push(d);
      }
      return answers;
    }
    groups.forEach(function (g) {
      var sol = solveBlock(g, s, nRows, nAlt, fillAt, ringAt);
      if (!sol.ok) { rejected++; return; }
      var tl = project(sol.H, 0, 0);
      // O mesmo bloco pode vir de duas sequências de colunas: fica a melhor leitura.
      for (var i = 0; i < blocks.length; i++) {
        var o = blocks[i];
        if (Math.hypot(o.x - tl[0], o.y - tl[1]) < s * 1.5) {
          if (o.quality >= sol.quality) return;
          blocks.splice(i, 1);
          break;
        }
      }
      blocks.push({ answers: read(sol.H, 0), H: sol.H, x: tl[0], y: tl[1], coverage: sol.coverage, quality: sol.quality });
    });
    return { blocks: blocks, rejected: rejected, bubbleSize: s, read: read };
  }

  var api = {
    analyze: analyze, decide: decide, project: project,
    // expostos para testes/diagnóstico
    _internal: {
      toGray: toGray, binarize: binarize, distanceTransform: distanceTransform, estimateRadius: estimateRadius,
      blur3: blur3, findBubbles: findBubbles, buildLines: buildLines, groupBlocks: groupBlocks, solveBlock: solveBlock,
      latticeRadius: latticeRadius, ringScore: ringScore, sampleDisc: sampleDisc, shiftH: shiftH
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OMR = api;
})(this);
