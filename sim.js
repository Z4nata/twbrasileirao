// Monte Carlo do fim do Brasileirão (Web Worker). Mesmo modelo de ferramentas/simulacao.py:
// gols por Poisson, força de ataque e defesa pelos gols pró e contra (encolhimento 0,75), mandante x1,18, visitante x0,85.
// Desempate: pontos, vitórias, saldo, gols pró, sorteio. Jogos em andamento: placar atual + gols do tempo que falta.
const ENC = 0.75, CASA = 1.18, FORA = 0.85, RODADAS = 38;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function poisson(l, r) { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }

function simular({ times, jogos, vivos, foco, n = 20000, seed = 2026 }) {
  const T = times.length, idx = new Map(times.map((t, i) => [t.id, i]));
  const mu = times.reduce((s, t) => s + t.gp, 0) / times.reduce((s, t) => s + t.j, 0);
  const atq = times.map(t => 1 + ENC * ((t.gp / t.j) / mu - 1)), dfs = times.map(t => 1 + ENC * ((t.gc / t.j) / mu - 1));
  const r = rng(seed);
  const pos = Array.from({ length: T }, () => new Float64Array(T)), soma = new Float64Array(T);
  const MAXG = 25, ganhoN = Array.from({ length: T }, () => new Float64Array(MAXG)), ganhoCai = Array.from({ length: T }, () => new Float64Array(MAXG));
  // focus games (today's): per outcome (0 home win, 1 draw, 2 away win) the count and, for both teams, sums of cair / g6 / titulo
  const F = foco.map(g => ({ g, n: [0, 0, 0], m: [0, 1].map(() => ({ cai: [0, 0, 0], g6: [0, 0, 0], tit: [0, 0, 0] })) }));
  const pts = new Int32Array(T), vit = new Int32Array(T), sg = new Int32Array(T), gp = new Int32Array(T), ganho = new Int32Array(T);
  const ordem = Array.from({ length: T }, (_, i) => i), chave = new Float64Array(T), out = new Int8Array(F.length);
  const linha17 = new Float64Array(120), ptsFinal = Array.from({ length: T }, () => new Float64Array(120));   // final points of the 17th place; final points per team
  const par = new Float64Array(T * T);   // joint relegation counts
  const jogar = (h, a, gh, ga) => {
    if (gh > ga) { pts[h] += 3; vit[h]++; ganho[h] += 3; } else if (gh < ga) { pts[a] += 3; vit[a]++; ganho[a] += 3; } else { pts[h]++; pts[a]++; ganho[h]++; ganho[a]++; }
    sg[h] += gh - ga; sg[a] += ga - gh; gp[h] += gh; gp[a] += ga;
  };
  const fIdx = new Map(F.map((f, k) => [f.g.casa + '|' + f.g.fora, k]));
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < T; i++) { const t = times[i]; pts[i] = t.pts; vit[i] = t.v; sg[i] = t.gp - t.gc; gp[i] = t.gp; ganho[i] = 0; }
    for (const g of jogos) {
      const h = idx.get(g.casa), a = idx.get(g.fora);
      const gh = poisson(mu * CASA * atq[h] * dfs[a], r), ga = poisson(mu * FORA * atq[a] * dfs[h], r); jogar(h, a, gh, ga);
      const k = fIdx.get(g.casa + '|' + g.fora); if (k !== undefined) out[k] = gh > ga ? 0 : gh === ga ? 1 : 2;
    }
    for (const g of vivos) {
      const h = idx.get(g.casa), a = idx.get(g.fora), f = Math.max(0, Math.min(1, (90 - g.min) / 90));
      const gh = g.gc + poisson(mu * CASA * atq[h] * dfs[a] * f, r), ga = g.gf + poisson(mu * FORA * atq[a] * dfs[h] * f, r); jogar(h, a, gh, ga);
      const k = fIdx.get(g.casa + '|' + g.fora); if (k !== undefined) out[k] = gh > ga ? 0 : gh === ga ? 1 : 2;
    }
    for (let i = 0; i < T; i++) chave[i] = pts[i] * 1e9 + vit[i] * 1e6 + (sg[i] + 500) * 1e3 + gp[i] + r();
    ordem.sort((x, y) => chave[y] - chave[x]);
    const p = new Int8Array(T); for (let k = 0; k < T; k++) p[ordem[k]] = k;
    linha17[Math.min(119, pts[ordem[16]])]++;
    const caidos = []; for (let k = 16; k < T; k++) caidos.push(ordem[k]);
    for (let x = 0; x < caidos.length; x++) for (let y = x + 1; y < caidos.length; y++) { par[caidos[x] * T + caidos[y]]++; par[caidos[y] * T + caidos[x]]++; }
    for (let i = 0; i < T; i++) {
      pos[i][p[i]]++; soma[i] += pts[i]; ptsFinal[i][Math.min(119, pts[i])]++;
      const gg = Math.min(MAXG - 1, ganho[i]); ganhoN[i][gg]++; if (p[i] >= 16) ganhoCai[i][gg]++;
    }
    F.forEach((f, k) => {
      const o = out[k]; f.n[o]++;
      [f.g.casa, f.g.fora].forEach((id, lado) => { const i = idx.get(id); f.m[lado].cai[o] += p[i] >= 16; f.m[lado].g6[o] += p[i] <= 5; f.m[lado].tit[o] += p[i] === 0; });
    });
  }
  const res = times.map((t, i) => {
    const pr = Array.from(pos[i], v => v / n), sum = (a, b) => pr.slice(a, b).reduce((x, y) => x + y, 0);
    // fewest extra points after which relegation stays under 5% (from the points-gained histogram)
    let precisa = null;
    for (let g = MAXG - 1; g >= 0; g--) { if (ganhoN[i][g] < n * .002) continue; if (ganhoCai[i][g] / ganhoN[i][g] < .05) precisa = g; else break; }
    return { id: t.id, pos: pr, titulo: pr[0], g4: sum(0, 4), g6: sum(0, 6), sula: sum(6, 12), cai: sum(16, 20), ptsFim: soma[i] / n, precisa };
  });
  const focoRes = F.map(f => ({ casa: f.g.casa, fora: f.g.fora, n: f.n.map(x => x / n),
    lados: f.m.map(m => ({ cai: m.cai.map((v, o) => f.n[o] ? v / f.n[o] : null), g6: m.g6.map((v, o) => f.n[o] ? v / f.n[o] : null), tit: m.tit.map((v, o) => f.n[o] ? v / f.n[o] : null) })) }));
  // pairs: the most likely double relegation among teams still fighting
  const pares = [];
  for (let a = 0; a < T; a++) for (let b = a + 1; b < T; b++) { const v = par[a * T + b] / n; if (v > .001) pares.push({ a: times[a].id, b: times[b].id, p: v }); }
  pares.sort((x, y) => y.p - x.p);
  return { res, foco: focoRes, n, linha17: Array.from(linha17, v => v / n), pares: pares.slice(0, 60) };
}

self.onmessage = e => {
  const { pedido, ...args } = e.data;
  const t0 = performance.now(), out = simular(args);
  self.postMessage({ pedido, ...out, ms: Math.round(performance.now() - t0) });
};
