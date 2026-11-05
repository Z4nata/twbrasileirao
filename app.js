// The Worst of Brasileirão: painel ao vivo. Busca tabela e jogos na API pública da ESPN, simula o fim do campeonato
// num Web Worker (sim.js) e redesenha a página. Com jogo rolando, atualiza a cada 45 s; sem jogo, a cada 5 min.
const ESPN = 'https://site.api.espn.com/apis', LIGA = 'bra.1', RODADAS = 38, FIM_TEMPORADA = '2026-12';
const ENC = 0.75, CASA = 1.18, FORA = 0.85;                       // same model as sim.js, for the per-game odds in the team panel
const NOMES = { 'Athletico Paranaense': 'Athletico-PR', 'Red Bull Bragantino': 'Bragantino', 'Vasco da Gama': 'Vasco' };
const CORES = {   // club colors as two-tone stripes (no crests)
  Flamengo: ['#C8102E', '#141414'], Palmeiras: ['#0B6B3A', '#F3F0E8'], Cruzeiro: ['#1F4DB8', '#F3F0E8'], Fluminense: ['#8A1E35', '#0B6B3A'],
  'Athletico-PR': ['#C8102E', '#141414'], Bahia: ['#1F5FB8', '#D7182A'], 'Atlético-MG': ['#F3F0E8', '#141414'], Bragantino: ['#F3F0E8', '#D7182A'],
  Santos: ['#F3F0E8', '#141414'], 'São Paulo': ['#D7182A', '#F3F0E8'], Botafogo: ['#141414', '#F3F0E8'], Coritiba: ['#0B6B3A', '#F3F0E8'],
  Vasco: ['#141414', '#F3F0E8'], Mirassol: ['#F7D117', '#0B8A43'], 'Vitória': ['#D7182A', '#141414'], Internacional: ['#D7182A', '#F3F0E8'],
  Corinthians: ['#F3F0E8', '#141414'], 'Grêmio': ['#1A7BC4', '#141414'], Remo: ['#14275C', '#F3F0E8'], Chapecoense: ['#0B8A43', '#F3F0E8'],
};
const S = { times: [], ev: new Map(), res: null, base: null, foco: [], ultima: null, erro: false, pedido: 0, faltaBuscada: false,
  filtro: 'todos', ord: { col: 'pos', dir: 1 }, aberto: null };
const $ = id => document.getElementById(id);
const worker = new Worker('sim.js');

// ---------- format ----------
const pct = v => v == null ? '0%' : v >= .9995 ? '100%' : v < .0005 ? (v > 0 ? '<0,1%' : '0%') : (v * 100).toFixed(1).replace('.', ',') + '%';
const pct0 = v => v == null ? '0%' : v >= .995 ? '100%' : v < .005 ? (v > 0 ? '<1%' : '0%') : Math.round(v * 100) + '%';
const dec = v => v.toFixed(1).replace('.', ',');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nome = t => NOMES[t.nome] || t.nome;
const doTime = t => (nome(t) === 'Chapecoense' ? 'da ' : 'do ') + nome(t);   // "do Bahia", "da Chapecoense"
const cor = t => { const [a, b] = CORES[nome(t)] || ['#6E6B78', '#2A2933']; return `<i class="cor" style="--c1:${a};--c2:${b}" aria-hidden="true"></i>`; };
const BRT = d => new Date(d.getTime() - 3 * 3600e3);
const ymd = d => BRT(d).toISOString().slice(0, 10);
const hora = d => { const b = BRT(d); return `${b.getUTCHours()}h${String(b.getUTCMinutes()).padStart(2, '0')}`.replace('h00', 'h'); };
const relogio = d => { const b = BRT(d); return `${b.getUTCHours()}:${String(b.getUTCMinutes()).padStart(2, '0')}`; };
const diaMes = d => { const b = BRT(d); return `${String(b.getUTCDate()).padStart(2, '0')}/${String(b.getUTCMonth() + 1).padStart(2, '0')}`; };
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const quando = d => ymd(d) === ymd(new Date()) ? `hoje, ${hora(d)}` : `${SEMANA[BRT(d).getUTCDay()]} ${diaMes(d)}, ${hora(d)}`;
function delta(novo, velho) {
  if (velho == null || novo == null) return '';
  const d = (novo - velho) * 100; if (Math.abs(d) < .5) return '';
  return `<span class="delta ${d > 0 ? 'sobe' : 'desce'}">${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(1).replace('.', ',')}</span>`;
}

// ---------- data ----------
async function get(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
function normal(ev) {
  const c = ev.competitions[0], h = c.competitors.find(x => x.homeAway === 'home'), a = c.competitors.find(x => x.homeAway === 'away'), st = ev.status.type;
  let min = 0;
  if (st.state === 'in') { min = parseInt(ev.status.displayClock, 10) || 0; if (/HALFTIME/i.test(st.name)) min = 45; }
  return { id: ev.id, data: new Date(ev.date), casa: h.team.id, fora: a.team.id, estado: st.state, gc: +h.score || 0, gf: +a.score || 0, min, detalhe: st.shortDetail || '' };
}
async function carregarTabela() {
  const raw = await get(`${ESPN}/v2/sports/soccer/${LIGA}/standings`);
  S.times = raw.children[0].standings.entries.map(e => {
    const st = Object.fromEntries(e.stats.map(s => [s.name, s.value]));
    return { id: e.team.id, nome: e.team.displayName, sigla: e.team.abbreviation, pos: +st.rank, pts: +st.points, j: +st.gamesPlayed, v: +st.wins, e: +st.ties, d: +st.losses, gp: +st.pointsFor, gc: +st.pointsAgainst };
  }).sort((a, b) => a.pos - b.pos);
}
function meses() {
  const out = [], b = BRT(new Date()); let y = b.getUTCFullYear(), m = b.getUTCMonth() + 1;
  while (`${y}-${String(m).padStart(2, '0')}` <= FIM_TEMPORADA) { out.push(`${y}${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out.length ? out : [`${y}${String(m).padStart(2, '0')}`];
}
async function carregarJogos() {
  const lotes = await Promise.all(meses().map(m => get(`${ESPN}/site/v2/sports/soccer/${LIGA}/scoreboard?dates=${m}`)));
  for (const l of lotes) for (const ev of l.events || []) S.ev.set(ev.id, normal(ev));
}
async function carregarHoje() {
  const sb = await get(`${ESPN}/site/v2/sports/soccer/${LIGA}/scoreboard?dates=${ymd(new Date()).replace(/-/g, '')}`);
  let terminou = false;
  for (const ev of sb.events || []) { const n = normal(ev), v = S.ev.get(n.id); if (v && v.estado !== 'post' && n.estado === 'post') terminou = true; S.ev.set(n.id, n); }
  return terminou;
}
async function completarFaltando(ids) {   // postponed games outside the fetched months: read those teams' schedules
  for (const id of ids) {
    try {
      const sc = await get(`${ESPN}/site/v2/sports/soccer/${LIGA}/teams/${id}/schedule?fixture=true`);
      for (const ev of sc.events || []) { const n = normal(ev); if (n.estado === 'pre' && !S.ev.has(n.id)) S.ev.set(n.id, n); }
    } catch (e) { /* the simulation still runs with what it has */ }
  }
}
// The ESPN table can lag a few minutes after the final whistle: a finished game from the last 36 h that the table hasn't
// counted yet (the team's unplayed count doesn't match its listed games) is added to the table here.
function estadoSim() {
  const times = S.times.map(t => ({ ...t })), by = new Map(times.map(t => [t.id, t]));
  const evs = [...S.ev.values()].filter(e => by.has(e.casa) && by.has(e.fora));
  const pre = evs.filter(e => e.estado === 'pre'), vivos = evs.filter(e => e.estado === 'in');
  const recentes = evs.filter(e => e.estado === 'post' && Date.now() - e.data < 36 * 3600e3).sort((a, b) => b.data - a.data);
  const listados = new Map(); for (const e of [...pre, ...vivos]) for (const id of [e.casa, e.fora]) listados.set(id, (listados.get(id) || 0) + 1);
  const def = new Map(times.map(t => [t.id, (RODADAS - t.j) - (listados.get(t.id) || 0)]));
  for (const g of recentes) {
    if (def.get(g.casa) > 0 && def.get(g.fora) > 0) {
      for (const [t, a, b] of [[by.get(g.casa), g.gc, g.gf], [by.get(g.fora), g.gf, g.gc]]) {
        t.j++; t.gp += a; t.gc += b; if (a > b) { t.v++; t.pts += 3; } else if (a === b) { t.e++; t.pts++; } else t.d++;
      }
      def.set(g.casa, def.get(g.casa) - 1); def.set(g.fora, def.get(g.fora) - 1);
    }
  }
  return { times, pre, vivos, faltando: [...def].filter(([, v]) => v > 0).map(([id]) => id) };
}
// games for the top strip: live first, then the next upcoming ones (today and the next days), at most 8
function jogosFaixa() {
  const ids = new Set(S.times.map(t => t.id)), agora = Date.now();
  const evs = [...S.ev.values()].filter(e => ids.has(e.casa) && ids.has(e.fora)).sort((a, b) => a.data - b.data);
  const vivos = evs.filter(e => e.estado === 'in');
  const encerradosHoje = evs.filter(e => e.estado === 'post' && ymd(e.data) === ymd(new Date()) && agora - e.data < 6 * 3600e3);
  const prox = evs.filter(e => e.estado === 'pre');
  const lim = prox.length ? prox[0].data.getTime() + 3 * 86400e3 : 0;
  return [...vivos, ...prox.filter(e => e.data.getTime() <= lim).slice(0, 8 - vivos.length), ...encerradosHoje].slice(0, 10);
}

// ---------- simulation ----------
function rodar(estado, foco) {
  const id = ++S.pedido;
  return new Promise(ok => {
    const h = e => { if (e.data.pedido === id) { worker.removeEventListener('message', h); ok(e.data); } };
    worker.addEventListener('message', h);
    worker.postMessage({ pedido: id, times: estado.times, jogos: estado.jogos, vivos: estado.vivos, foco, n: 20000, seed: 2026 });
  });
}
async function simular() {
  const e = estadoSim();
  if (e.faltando.length && !S.faltaBuscada) { S.faltaBuscada = true; await completarFaltando(e.faltando); return simular(); }
  const faixa = jogosFaixa(), lim = x => ({ casa: x.casa, fora: x.fora });
  const foco = faixa.filter(g => g.estado !== 'post').map(lim);
  const atual = await rodar({ times: e.times, jogos: e.pre.map(lim), vivos: e.vivos.map(g => ({ ...lim(g), gc: g.gc, gf: g.gf, min: g.min })) }, foco);
  let base = null;
  if (e.vivos.length) base = await rodar({ times: e.times, jogos: [...e.pre, ...e.vivos].map(lim), vivos: [] }, foco);
  S.res = new Map(atual.res.map(r => [r.id, r])); S.base = base ? new Map(base.res.map(r => [r.id, r])) : null;
  S.foco = atual.foco; S.linha17 = atual.linha17; S.pares = atual.pares;
  S.tabSim = e.times; S.faixa = faixa; S.vivos = e.vivos; S.ultima = new Date();
  forcas();
  desenhar();
}
// model strengths for the per-game odds shown in the team panel (same formula as the worker)
function forcas() {
  const T = S.tabSim, mu = T.reduce((s, t) => s + t.gp, 0) / T.reduce((s, t) => s + t.j, 0);
  S.mod = { mu, atq: new Map(T.map(t => [t.id, 1 + ENC * ((t.gp / t.j) / mu - 1)])), dfs: new Map(T.map(t => [t.id, 1 + ENC * ((t.gc / t.j) / mu - 1)])) };
}
function oddsJogo(casa, fora) {
  const { mu, atq, dfs } = S.mod, lc = mu * CASA * atq.get(casa) * dfs.get(fora), lf = mu * FORA * atq.get(fora) * dfs.get(casa);
  const pm = (l, k) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
  let v = 0, e = 0; for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) { const p = pm(lc, a) * pm(lf, b); if (a > b) v += p; else if (a === b) e += p; }
  return [v, e, 1 - v - e];
}

// ---------- render helpers ----------
const T = id => S.tabSim.find(t => t.id === id);
const R = id => S.res.get(id), B = id => S.base && S.base.get(id);
function metricaDe(id) { const r = R(id); if (!r) return null; if (r.cai >= .01 && r.cai <= .995) return 'cai'; if (r.titulo >= .01) return 'titulo'; if (r.g6 >= .01 && r.g6 <= .995) return 'g6'; return null; }
const ROT = { cai: 'cai', titulo: 'campeão', g6: 'Libertadores' };
function setHTML(id, html) { const el = $(id); if (el && el.innerHTML !== html) el.innerHTML = html; }

function desenharStatus() {
  const s = $('status'), vivo = (S.vivos || []).length > 0;
  s.dataset.estado = S.erro ? 'erro' : vivo ? 'vivo' : 'ok';
  s.querySelector('span').textContent = S.erro ? 'Sem conexão, tentando de novo' : `${vivo ? 'Ao vivo, atualizado' : 'Atualizado'} às ${relogio(S.ultima)}`;
}

// ---------- top strip: live and upcoming games ----------
function desenharJogos() {
  const faixa = S.faixa || [];
  const temVivo = faixa.some(g => g.estado === 'in');
  $('jogos-tit').textContent = temVivo ? 'Ao vivo' : 'Próximos jogos';
  $('jogos-sub').textContent = temVivo ? 'placar e chances atualizando a cada 45 segundos' : 'o que cada resultado faz com as chances';
  if (!faixa.length) { setHTML('jogos', '<p class="vazio">Nenhum jogo marcado. As chances abaixo já são as finais.</p>'); return; }
  setHTML('jogos', faixa.map(g => {
    const c = T(g.casa), f = T(g.fora), vivo = g.estado === 'in', fim = g.estado === 'post';
    const k = S.foco.findIndex(x => x.casa === g.casa && x.fora === g.fora), fo = S.foco[k];
    const st = vivo ? `<span class="ao-vivo">AO VIVO</span> ${esc(g.detalhe || g.min + "'")}` : fim ? 'Encerrado' : quando(g.data);
    const placar = (vivo || fim) ? `<b>${g.gc}</b><i>×</i><b>${g.gf}</b>` : '<i>×</i>';
    // 1. the match itself: chance of each result (for a live game, from the current score and the time left)
    const odds = fo ? `<div class="jg-odds" role="img" aria-label="${esc(`Chance de cada resultado: ${nome(c)} ${pct0(fo.n[0])}, empate ${pct0(fo.n[1])}, ${nome(f)} ${pct0(fo.n[2])}`)}">
        <span class="o-c" style="flex:${fo.n[0]}"></span><span class="o-e" style="flex:${fo.n[1]}"></span><span class="o-f" style="flex:${fo.n[2]}"></span></div>
      <div class="jg-odds-l"><span><b>${pct0(fo.n[0])}</b> ${esc(nome(c))}</span><span><b>${pct0(fo.n[1])}</b> empate</span><span><b>${pct0(fo.n[2])}</b> ${esc(nome(f))}</span></div>` : '';
    // 2. what each result does to the table, from each team's side
    let linhas = '';
    for (const [lado, t] of [[0, c], [1, f]]) {
      const m = metricaDe(t.id); if (!m) continue;
      const chave = m === 'titulo' ? 'titulo' : m, rot = `Chance ${esc(doTime(t))} ${m === 'cai' ? 'cair' : m === 'titulo' ? 'ser campeão' : 'ir à Libertadores'}`;
      if (vivo) linhas += `<li><span class="jg-q">${rot}</span><span class="jg-agora">agora <b>${pct0(R(t.id)[chave])}</b>${delta(R(t.id)[chave], B(t.id)?.[chave])}${B(t.id) ? ` <small>antes do jogo ${pct0(B(t.id)[chave])}</small>` : ''}</span></li>`;
      else if (fo) { const v = fo.lados[lado][m === 'titulo' ? 'tit' : m], o = lado === 0 ? [0, 1, 2] : [2, 1, 0];
        linhas += `<li><span class="jg-q">${rot}</span><span class="jg-se"><em>se vencer<b>${pct0(v[o[0]])}</b></em><em>se empatar<b>${pct0(v[o[1]])}</b></em><em>se perder<b>${pct0(v[o[2]])}</b></em></span></li>`; }
    }
    return `<article class="jg${vivo ? ' vivo' : ''}${fim ? ' fim' : ''}"><span class="jg-st">${st}</span>
      <div class="jg-pl"><span class="jg-t">${cor(c)}${esc(nome(c))}</span><span class="jg-g">${placar}</span><span class="jg-t f">${esc(nome(f))}${cor(f)}</span></div>
      ${odds}${linhas ? `<ul class="jg-ch">${linhas}</ul>` : `<p class="jg-nada">${fim ? 'Já está na tabela.' : 'Nenhum dos dois tem título, Libertadores ou Z4 em jogo.'}</p>`}</article>`;
  }).join(''));
}

// ---------- the interactive table ----------
const COLS = [
  { k: 'pos', rot: '#', num: true }, { k: 'time', rot: 'Time', l: true }, { k: 'pts', rot: 'Pts', num: true }, { k: 'j', rot: 'J', num: true },
  { k: 'sg', rot: 'SG', num: true }, { k: 'titulo', rot: 'Título', p: true }, { k: 'g4', rot: 'G4', p: true }, { k: 'g6', rot: 'Liberta', p: true },
  { k: 'sula', rot: 'Sula', p: true }, { k: 'cai', rot: 'Cai', p: true }, { k: 'mapa', rot: '1º ao 20º', so: true },
];
const FILTRO = {
  todos: () => true, titulo: r => r.titulo >= .001, liberta: r => r.g6 >= .005, sula: r => r.sula >= .005, z4: r => r.cai >= .005,
};
function linhasOrdenadas() {
  const base = [...S.tabSim].sort((a, b) => b.pts - a.pts || b.v - a.v || (b.gp - b.gc) - (a.gp - a.gc) || b.gp - a.gp);
  const pos = new Map(base.map((t, i) => [t.id, i + 1]));
  const val = (t, k) => k === 'pos' ? pos.get(t.id) : k === 'time' ? nome(t) : k === 'pts' ? t.pts : k === 'j' ? t.j : k === 'sg' ? t.gp - t.gc : R(t.id)[k];
  const { col, dir } = S.ord;
  const lista = base.filter(t => FILTRO[S.filtro](R(t.id)));
  lista.sort((a, b) => { const x = val(a, col), y = val(b, col); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || pos.get(a.id) - pos.get(b.id); });
  return { lista, pos };
}
function vivoDe(id) { return (S.vivos || []).find(g => g.casa === id || g.fora === id); }
function painel(t) {
  const r = R(t.id), falta = RODADAS - t.j;
  const jogos = [...S.ev.values()].filter(e => (e.estado === 'pre' || e.estado === 'in') && (e.casa === t.id || e.fora === t.id)).sort((a, b) => a.data - b.data);
  const lista = jogos.map(g => {
    const casa = g.casa === t.id, adv = T(casa ? g.fora : g.casa), [v, e, d] = oddsJogo(g.casa, g.fora), pv = casa ? v : d, pd = casa ? d : v;
    const ao = g.estado === 'in' ? `<span class="ao-vivo">AO VIVO ${casa ? g.gc : g.gf}×${casa ? g.gf : g.gc}</span>` : '';
    return `<li><span class="pj-q">${diaMes(g.data)}</span><span class="pj-a">${cor(adv)}${esc(nome(adv))} <small>${casa ? 'casa' : 'fora'}</small> ${ao}</span><span class="pj-o"><em class="v">V ${pct0(pv)}</em><em>E ${pct0(e)}</em><em class="d">D ${pct0(pd)}</em></span></li>`;
  }).join('');
  const maxp = Math.max(...r.pos);
  const barras = r.pos.map((p, i) => `<span class="pb${i < 6 ? ' g' : i >= 16 ? ' z' : ''}" style="--h:${Math.max(p > 0 ? 3 : 0, p / maxp * 100)}%" title="${i + 1}º: ${pct(p)}"><i>${i + 1}</i></span>`).join('');
  const nums = [['Pontos no fim, em média', dec(r.ptsFim)], ['Título', pct(r.titulo)], ['Libertadores', pct(r.g6)], ['Cai', pct(r.cai)]];
  const prec = r.cai >= .01 ? (r.precisa == null ? 'Nem ganhando tudo o risco de cair fica abaixo de 5%.' : `Precisa de ${r.precisa} ponto${r.precisa === 1 ? '' : 's'} nos ${falta} jogos que faltam para o risco de cair ficar abaixo de 5%.`) : '';
  return `<div class="painel"><div class="pn-jogos"><h3>Os ${jogos.length} jogos que faltam</h3><ul>${lista || '<li>Nenhum.</li>'}</ul>${prec ? `<p class="pn-prec">${prec}</p>` : ''}</div>
    <div class="pn-pos"><h3>Onde termina</h3><div class="pbs" role="img" aria-label="Chance de cada posição final de ${esc(nome(t))}">${barras}</div></div>
    <dl class="pn-nums">${nums.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl></div>`;
}
function desenharTabela() {
  const { lista, pos } = linhasOrdenadas();
  const th = COLS.map(c => {
    const ativo = S.ord.col === c.k, sortavel = c.k !== 'mapa';
    const aria = ativo ? (S.ord.dir === 1 ? 'ascending' : 'descending') : 'none';
    const seta = ativo ? (S.ord.dir === 1 ? ' ▲' : ' ▼') : '';
    return `<th class="${c.l ? 'l' : ''}${c.so ? ' so-larga' : ''}" ${sortavel ? `aria-sort="${aria}"` : ''}>${sortavel ? `<button type="button" data-col="${c.k}">${c.rot}${seta}</button>` : c.rot}</th>`;
  }).join('');
  const cel = (v, b, forte) => `<td class="pct ${v < .0005 ? 'nulo' : v >= .5 ? forte : ''}">${pct(v)}${delta(v, b)}</td>`;
  const mapa = r => `<div class="mapa" aria-hidden="true">${r.pos.map((p, i) => { const c = i < 6 ? '57,226,125' : i >= 16 ? '143,68,255' : '243,240,232'; return `<i style="--c:rgba(${c},${p < .001 ? .05 : Math.min(1, .12 + Math.sqrt(p) * .95)})"></i>`; }).join('')}</div>`;
  const corpo = lista.map(t => {
    const r = R(t.id), b = B(t.id), p = pos.get(t.id), v = vivoDe(t.id), aberto = S.aberto === t.id;
    const ao = v ? `<span class="ao-vivo mini">${v.casa === t.id ? v.gc : v.gf}×${v.casa === t.id ? v.gf : v.gc}</span>` : '';
    const zona = p <= 6 ? 'g' : p >= 17 ? 'z' : '';
    const corte = p === 7 && S.ord.col === 'pos' && S.filtro === 'todos' ? ' corte-g6' : p === 17 && S.ord.col === 'pos' && S.filtro === 'todos' ? ' corte-z4' : '';
    const linha = `<tr class="lin ${zona}${corte}${aberto ? ' aberto' : ''}" data-id="${t.id}" tabindex="0" aria-expanded="${aberto}">
      <td class="pos">${p}</td><td class="time l">${cor(t)}<span>${esc(nome(t))}</span>${ao}</td><td>${t.pts}</td><td>${t.j}</td><td>${t.gp - t.gc > 0 ? '+' : ''}${t.gp - t.gc}</td>
      ${cel(r.titulo, b?.titulo, 'forte-v')}${cel(r.g4, b?.g4, 'forte-v')}${cel(r.g6, b?.g6, 'forte-v')}${cel(r.sula, b?.sula, '')}${cel(r.cai, b?.cai, 'forte-r')}<td class="so-larga">${mapa(r)}</td></tr>`;
    return linha + (aberto ? `<tr class="det"><td colspan="${COLS.length}">${painel(t)}</td></tr>` : '');
  }).join('');
  const html = `<caption class="vh">Chances de cada time no fim do Brasileirão 2026</caption><thead><tr>${th}</tr></thead><tbody>${corpo || `<tr><td colspan="${COLS.length}" class="vazio">Nenhum time nesse filtro.</td></tr>`}</tbody>`;
  const tab = $('tab'); if (tab.innerHTML !== html) tab.innerHTML = html;
  $('rodape-tab').textContent = `${(20000).toLocaleString('pt-BR')} campeonatos simulados às ${relogio(S.ultima)}${S.vivos.length ? ', com os jogos em andamento no placar atual. As setas mostram quanto o placar ao vivo mudou cada chance' : ''}.`;
}
$('tab').addEventListener('click', e => {
  const b = e.target.closest('button[data-col]');
  if (b) { const k = b.dataset.col; S.ord = { col: k, dir: S.ord.col === k ? -S.ord.dir : (['pos', 'time'].includes(k) ? 1 : -1) }; desenharTabela(); return; }
  const tr = e.target.closest('tr.lin'); if (tr) { S.aberto = S.aberto === tr.dataset.id ? null : tr.dataset.id; desenharTabela(); }
});
$('tab').addEventListener('keydown', e => {
  const tr = e.target.closest('tr.lin'); if (!tr || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault(); const id = tr.dataset.id; S.aberto = S.aberto === id ? null : id; desenharTabela(); document.querySelector(`tr.lin[data-id="${id}"]`)?.focus();
});
$('filtros').addEventListener('click', e => {
  const b = e.target.closest('button[data-f]'); if (!b) return;
  S.filtro = b.dataset.f; S.ord = S.filtro === 'titulo' ? { col: 'titulo', dir: -1 } : S.filtro === 'liberta' ? { col: 'g6', dir: -1 } : S.filtro === 'sula' ? { col: 'sula', dir: -1 } : S.filtro === 'z4' ? { col: 'cai', dir: -1 } : { col: 'pos', dir: 1 };
  for (const x of $('filtros').querySelectorAll('button')) x.setAttribute('aria-pressed', x === b);
  desenharTabela();
});

// ---------- curiosities ----------
function desenharCuriosidades() {
  const todos = [...S.res.values()], card = (cls, tit, corpo) => `<article class="cc ${cls}"><h3>${tit}</h3>${corpo}</article>`;
  const out = [];
  const cand = todos.filter(r => r.titulo >= .005).sort((a, b) => b.titulo - a.titulo);
  out.push(card('cc-titulo', 'A taça', `<div class="cc-duelo">${cand.map((r, i) => `<div><span class="cc-n">${cor(T(r.id))}${esc(nome(T(r.id)))}</span><b class="${i ? '' : 'v'}">${pct(r.titulo)}</b></div>`).join('')}</div>
    <p>${cand.length > 1 ? `${esc(nome(T(cand[0].id)))} termina com ${dec(cand[0].ptsFim)} pontos em média, ${esc(nome(T(cand[1].id)))} com ${dec(cand[1].ptsFim)}.` : 'Só um time ainda pode ser campeão.'}</p>`));
  const l17 = S.linha17 || [], media17 = l17.reduce((s, v, p) => s + v * p, 0);
  let ac = 0, salva = null; for (let p = l17.length - 1; p >= 0; p--) { ac += l17[p]; if (ac >= .05) { salva = p + 1; break; } }
  out.push(card('cc-linha', 'A linha do Z4', `<b class="cc-grande">${dec(media17)} <small>pontos</small></b><p>é quanto o 17º colocado faz, em média, no fim. ${salva ? `Com ${salva} pontos, um time fica fora do Z4 em pelo menos 95% das simulações.` : ''}</p>`));
  const vivos = new Set(todos.filter(r => r.cai > .01 && r.cai < .99).map(r => r.id));
  const par = (S.pares || []).find(p => vivos.has(p.a) && vivos.has(p.b));
  if (par) out.push(card('cc-par', 'Caem juntos', `<b class="cc-grande r">${pct(par.p)}</b><p>é a chance de ${esc(nome(T(par.a)))} e ${esc(nome(T(par.b)))} caírem os dois no mesmo ano.</p>`));
  const bolha = todos.filter(r => r.g6 > .02 && r.g6 < .98).sort((a, b) => Math.abs(a.g6 - .5) - Math.abs(b.g6 - .5))[0];
  if (bolha) out.push(card('cc-muro', 'Em cima do muro', `<b class="cc-grande">${pct(bolha.g6)}</b><p>de chance de ${esc(nome(T(bolha.id)))} terminar no G6, o time mais perto do meio a meio na briga pela Libertadores.</p>`));
  let melhor = null;   // the game whose result moves a chance the most
  (S.foco || []).forEach(f => [0, 1].forEach(lado => { const id = lado ? f.fora : f.casa, m = metricaDe(id); if (!m) return; const v = f.lados[lado][m === 'titulo' ? 'tit' : m].filter(x => x != null); if (v.length < 2) return; const amp = Math.max(...v) - Math.min(...v); if (!melhor || amp > melhor.amp) melhor = { f, id, m, amp, min: Math.min(...v), max: Math.max(...v) }; }));
  if (melhor) out.push(card('cc-jogo', 'O jogo que mais mexe', `<p class="cc-confronto">${esc(nome(T(melhor.f.casa)))} x ${esc(nome(T(melhor.f.fora)))}</p><p>A chance de ${esc(nome(T(melhor.id)))} ${melhor.m === 'cai' ? 'cair' : melhor.m === 'titulo' ? 'ser campeão' : 'ir à Libertadores'} vai de <b>${pct0(melhor.min)}</b> a <b>${pct0(melhor.max)}</b>, dependendo do resultado.</p>`));
  const caidos = todos.filter(r => r.cai >= .995).map(r => esc(nome(T(r.id))));
  if (caidos.length) out.push(card('cc-caidos', 'Já arrumando a mala', `<p>${caidos.join(' e ')} ${caidos.length > 1 ? 'caem' : 'cai'} em 99,5% ou mais das simulações.</p>`));
  setHTML('cur', out.join(''));
}
function desenhar() {
  try { desenharStatus(); desenharJogos(); desenharTabela(); desenharCuriosidades(); } catch (e) { console.error(e); }
}

// ---------- loop ----------
async function iniciar() {
  try { await Promise.all([carregarTabela(), carregarJogos()]); S.erro = false; await simular(); }
  catch (e) {
    console.error(e); S.erro = true; $('status').dataset.estado = 'erro'; $('status').querySelector('span').textContent = 'Sem conexão, tentando de novo';
    for (const id of ['jogos', 'cur']) setHTML(id, '<div class="erro-box">Não deu pra buscar os dados da ESPN agora. A página tenta de novo sozinha em 1 minuto.</div>');
    setTimeout(iniciar, 60e3); return;
  }
  agendar();
}
let ultimaTabela = Date.now(), timer = null;
async function ciclo() {
  try {
    const terminou = await carregarHoje();
    if (terminou || Date.now() - ultimaTabela > 10 * 60e3) { await carregarTabela(); ultimaTabela = Date.now(); }
    S.erro = false; await simular();
  } catch (e) { console.error(e); S.erro = true; if (S.res) desenharStatus(); }
  agendar();
}
function agendar() {
  const agora = Date.now();
  const ativo = [...S.ev.values()].some(e => e.estado === 'in' || (e.estado === 'pre' && e.data - agora < 20 * 60e3 && agora - e.data < 3 * 3600e3)
    || (e.estado === 'post' && agora - e.data < 3.5 * 3600e3));
  clearTimeout(timer); timer = setTimeout(ciclo, ativo ? 45e3 : 5 * 60e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ultima && Date.now() - S.ultima > 60e3) { clearTimeout(timer); ciclo(); } });
iniciar();
