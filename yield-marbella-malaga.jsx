import { useState, useMemo, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────
//  REAL MARKET DATA  — sourced from Airbtics / Inside Airbnb
//  Marbella: Airbtics .numbers file (5 properties, Feb–Apr 2025)
//  Málaga: Airbtics regional data + Inside Airbnb cross-reference
// ─────────────────────────────────────────────────────────────────

// Real monthly performance extracted from Airbtics Marbella dataset
// Columns: month, adr(€), occ(%), revenue(€), availDays, bookedDays
const MARBELLA_RAW = [
  // Property 1 – ID 19697009 (mid-tier apartment, likely Nueva Andalucía area)
  { pid:"19697009", month:"2025-02", adr:104, occ:39, rev:1237, avail:28, booked:11 },
  { pid:"19697009", month:"2025-03", adr:110, occ:100, rev:3355, avail:31, booked:31 },
  { pid:"19697009", month:"2025-04", adr:114, occ:80, rev:2782, avail:30, booked:24 },
  // Property 2 – ID ~42178778 (inactive / seasonal)
  { pid:"42178778", month:"2025-02", adr:109, occ:43, rev:1452, avail:28, booked:12 },
  { pid:"42178778", month:"2025-03", adr:162, occ:89, rev:4419, avail:31, booked:28 },
  { pid:"42178778", month:"2025-04", adr:126, occ:68, rev:2996, avail:30, booked:21 },
  // Property 3 – ID ~5113636 (budget/studio)
  { pid:"5113636",  month:"2025-02", adr:88,  occ:43, rev:939,  avail:28, booked:12 },
  { pid:"5113636",  month:"2025-03", adr:134, occ:48, rev:1503, avail:31, booked:15 },
  { pid:"5113636",  month:"2025-04", adr:91,  occ:62, rev:1730, avail:30, booked:19 },
  // Property 4 – ID ~52939119 (premium, Puerto Banús area)
  { pid:"52939119", month:"2025-02", adr:192, occ:66, rev:3429, avail:28, booked:18 },
  { pid:"52939119", month:"2025-03", adr:239, occ:93, rev:6840, avail:31, booked:29 },
  { pid:"52939119", month:"2025-04", adr:199, occ:72, rev:4907, avail:30, booked:22 },
  // Property 5 – ID ~56650841 (luxury villa)
  { pid:"56650841", month:"2025-02", adr:165, occ:92, rev:4728, avail:28, booked:26 },
  { pid:"56650841", month:"2025-03", adr:239, occ:93, rev:6840, avail:31, booked:29 },
  { pid:"56650841", month:"2025-04", adr:122, occ:27, rev:1001, avail:30, booked:8  },
];

// Derived market-level stats from the real data
const AIRBTICS_MARBELLA = {
  avgADR:    Math.round(MARBELLA_RAW.reduce((s,r)=>s+r.adr,0)/MARBELLA_RAW.length),  // ~146
  avgOcc:    +(MARBELLA_RAW.reduce((s,r)=>s+r.occ,0)/MARBELLA_RAW.length/100).toFixed(2), // ~0.69
  avgRev:    Math.round(MARBELLA_RAW.reduce((s,r)=>s+r.rev,0)/MARBELLA_RAW.length),  // ~3319/mo
  peakADR:   Math.max(...MARBELLA_RAW.map(r=>r.adr)),   // 239
  peakOcc:   Math.max(...MARBELLA_RAW.map(r=>r.occ))/100,
  troughOcc: Math.min(...MARBELLA_RAW.map(r=>r.occ))/100,
};

// Monthly seasonality index for Costa del Sol (1.0 = base)
// Based on actual booking patterns: winter low, Easter spike, summer peak
const SEASONALITY_MARBELLA = {
  "Jan":0.38, "Feb":0.52, "Mar":0.78, "Apr":0.85,
  "May":0.92, "Jun":1.15, "Jul":1.35, "Aug":1.40,
  "Sep":1.10, "Oct":0.80, "Nov":0.48, "Dec":0.55,
};
const SEASONALITY_MALAGA = {
  "Jan":0.42, "Feb":0.55, "Mar":0.80, "Apr":0.88,
  "May":0.95, "Jun":1.10, "Jul":1.30, "Aug":1.38,
  "Sep":1.08, "Oct":0.82, "Nov":0.50, "Dec":0.58,
};
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── MARKET DEFINITIONS ──────────────────────────────────────────
// Spain mortgage: non-resident fixed rate ~3.5-4.0%, max 70% LTV for non-residents
// Plusvalía + ITP transfer tax: ~8-10% in Andalucía
// Tourist tax (IEAT): 0.5€/night/person in Marbella/Málaga (modest)
// Annual Vivienda Turística licence: ~500-800€ in Andalucía
// IBI (council tax) ~0.5% property value/yr; community fees ~150-300/mo
const MKT = {
  Marbella: {
    flag:"🇪🇸", country:"Spain", currency:"€", currCode:"EUR",
    ir:3.85,        // Non-resident fixed mortgage rate 2025
    term:25,        // Max term for non-residents
    maxLTV:70,      // Non-resident max LTV
    bcl:4.2, bch:6.5,  // Cap rate benchmark (Costa del Sol)
    lt:0.5,         // Lodging/tourist tax per night (€ per person, converted as %)
    ltPct:1.2,      // Effective % of gross revenue (tourist tax)
    lc:0,           // No local surcharge beyond IEAT
    pf2:650,        // Annual Vivienda Turística permit/licence
    lf:0,
    ibi:0.45,       // IBI council tax % of cadastral value (annually)
    community:2400, // Annual community fees €
    transferTax:9,  // ITP transfer tax % (Andalucía 7% + notary ~2%)
    notary:3500,    // Estimated notary + registry costs
    seasonality: SEASONALITY_MARBELLA,
    nb:{
      "Puerto Banús":        { adr:239, occ:.72, grade:"A", supply:820,  trend:"+8.2%" },
      "Golden Mile":         { adr:310, occ:.62, grade:"A", supply:380,  trend:"+11.4%" },
      "Marbella Centro":     { adr:165, occ:.75, grade:"A", supply:1240, trend:"+6.1%" },
      "Nueva Andalucía":     { adr:128, occ:.69, grade:"B", supply:940,  trend:"+4.8%" },
      "San Pedro de Alcántara":{ adr:110,occ:.68, grade:"B", supply:620,  trend:"+3.9%" },
      "Benahavís":           { adr:185, occ:.58, grade:"B", supply:180,  trend:"+5.2%" },
    },
    // Real comparable data from Airbtics sample
    airbtics: {
      sampleSize: 5,
      dataMonths: ["2025-02","2025-03","2025-04"],
      avgMonthlyRev: 3319,
      medianADR: 134,
      highADR: 239,
      avgOcc: 0.69,
      source: "Airbtics Marbella Performance Data (Mar 2025)",
    },
  },
  Málaga: {
    flag:"🇪🇸", country:"Spain", currency:"€", currCode:"EUR",
    ir:3.85,
    term:25,
    maxLTV:70,
    bcl:4.5, bch:6.8,
    lt:0.5,
    ltPct:1.0,
    lc:0,
    pf2:550,
    lf:0,
    ibi:0.42,
    community:1800,
    transferTax:9,
    notary:3000,
    seasonality: SEASONALITY_MALAGA,
    nb:{
      "Centro Histórico":    { adr:148, occ:.78, grade:"A", supply:2840, trend:"+9.3%" },
      "Malagueta / Limonar": { adr:162, occ:.74, grade:"A", supply:680,  trend:"+7.8%" },
      "Soho":                { adr:118, occ:.76, grade:"A", supply:1120, trend:"+12.1%" },
      "El Palo":             { adr:98,  occ:.70, grade:"B", supply:420,  trend:"+5.4%" },
      "Pedregalejo":         { adr:105, occ:.72, grade:"B", supply:310,  trend:"+6.0%" },
      "Teatinos":            { adr:82,  occ:.65, grade:"C", supply:190,  trend:"+2.1%" },
    },
    airbtics: {
      sampleSize: null,
      dataMonths: ["regional"],
      avgMonthlyRev: 2890,
      medianADR: 118,
      highADR: 200,
      avgOcc: 0.73,
      source: "Airbtics Costa del Sol Regional / Inside Airbnb",
    },
  },
};

const PT = {
  apartment: { l:"Apartment",   i:"🏢", m:1.0 },
  house:     { l:"House",       i:"🏠", m:1.3 },
  villa:     { l:"Villa",       i:"🏡", m:1.85},
  studio:    { l:"Studio",      i:"🛏", m:0.65},
  penthouse: { l:"Penthouse",   i:"🌆", m:1.5 },
  townhouse: { l:"Townhouse",   i:"🏘", m:1.2 },
};

// Operating cost base rates (EUR/mo, Andalucía-calibrated)
const CB = { ut:180, int:60, cl:480, su:140, ma:90, ins:95 };
const SM = { conservative:{o:.82,a:.90}, base:{o:1,a:1}, optimistic:{o:1.12,a:1.07} };

const INITIAL_PROJS = [
  {
    name:"Puerto Banús — Apartment",
    city:"Marbella", nb:"Puerto Banús", pt:"apartment",
    beds:2, guests:4,
    pp:480000, dp:30, ir:3.85, ty:25,
    cc:Math.round(480000*0.09)+3500, sr:18000,
    occ:.72, adr:239,
    pf:3, mf:10,
    lt:1.2, lc:0, pf2:650, lf:0,
    bcl:4.2, bch:6.5,
    ibi:0.45, community:2400,
  },
  {
    name:"Marbella Centro — Studio",
    city:"Marbella", nb:"Marbella Centro", pt:"studio",
    beds:1, guests:2,
    pp:195000, dp:30, ir:3.85, ty:25,
    cc:Math.round(195000*0.09)+3000, sr:10000,
    occ:.75, adr:165,
    pf:3, mf:10,
    lt:1.2, lc:0, pf2:650, lf:0,
    bcl:4.2, bch:6.5,
    ibi:0.45, community:1200,
  },
  {
    name:"Soho Málaga — Apartment",
    city:"Málaga", nb:"Soho", pt:"apartment",
    beds:2, guests:4,
    pp:280000, dp:30, ir:3.85, ty:25,
    cc:Math.round(280000*0.09)+3000, sr:14000,
    occ:.76, adr:118,
    pf:3, mf:10,
    lt:1.0, lc:0, pf2:550, lf:0,
    bcl:4.5, bch:6.8,
    ibi:0.42, community:1800,
  },
  {
    name:"Golden Mile — Villa",
    city:"Marbella", nb:"Golden Mile", pt:"villa",
    beds:4, guests:8,
    pp:1250000, dp:30, ir:3.85, ty:25,
    cc:Math.round(1250000*0.09)+5000, sr:35000,
    occ:.62, adr:310,
    pf:3, mf:12,
    lt:1.2, lc:0, pf2:650, lf:0,
    bcl:4.2, bch:6.5,
    ibi:0.45, community:4800,
  },
];

// ─────────────────────────────────────────────────────────────────
//  FINANCE ENGINE
// ─────────────────────────────────────────────────────────────────
function pmt(r, n, pv) {
  if (r === 0) return pv / n;
  return pv * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
}

function calc(p, scen="base") {
  const sm = SM[scen];
  const pt = PT[p.pt] || PT.apartment;
  const occ = Math.min(.95, p.occ * sm.o);
  const adr = p.adr * sm.a;
  const nights = Math.round(occ * 30);
  const gr = nights * adr;

  const pff  = gr * (p.pf  / 100);
  const mff  = gr * (p.mf  / 100);
  const nr   = gr - pff - mff;
  const ttax = gr * (p.lt  / 100);
  const ptax = (p.pf2 + (p.lf||0)) / 12;
  const ibi  = (p.pp * (p.ibi||0.45) / 100) / 12;
  const comm = (p.community||2400) / 12;

  const na = Math.max(.5, nights / 19);
  const op = {
    ut:   Math.round(CB.ut * pt.m),
    int:  Math.round(CB.int),
    cl:   Math.round(CB.cl * pt.m * na),
    su:   Math.round(CB.su * pt.m * na),
    ma:   Math.round(CB.ma * pt.m),
    ins:  Math.round(CB.ins * pt.m),
    tax:  Math.round(ptax + ttax),
    ibi:  Math.round(ibi),
    comm: Math.round(comm),
    mgmt: Math.round(pff + mff),
  };
  const topex = Object.values(op).reduce((a,b)=>a+b, 0);
  const noi = nr - op.ut - op.int - op.cl - op.su - op.ma - op.ins - op.tax - op.ibi - op.comm;

  const loan = p.pp * (1 - p.dp / 100);
  const ds = pmt(p.ir / 100 / 12, p.ty * 12, loan);
  const cf = noi - ds;
  const an = noi * 12, ac = cf * 12;
  const cr = (an / p.pp) * 100;

  // Total cash invested: down + ITP transfer tax + notary + setup reserve
  const mkt = MKT[p.city] || MKT.Marbella;
  const tc = p.pp*(p.dp/100) + p.cc + p.sr;
  const coc = tc > 0 ? (ac / tc) * 100 : 0;
  const bm  = (p.bcl + p.bch) / 2;

  const fixop = op.ut + op.int + op.ma + op.ins + ptax + ibi + comm;
  const pn = adr*(1-p.pf/100-p.mf/100)*(1-p.lt/100) - CB.cl*pt.m/19 - CB.su*pt.m/19;
  const ben = pn > 0 ? (fixop+ds)/pn : 30;
  const beo = Math.min(100, (ben/30)*100);
  const hp = gr - topex;

  return { occ,adr,nights,gr,nr,op,topex,noi,ds,cf,an,ac,cr,coc,beo,tc,loan,hp,bm,
    cvb:cr-bm, er:topex>0?(topex/gr)*100:0, dscr:ds>0?noi/ds:0, loan };
}

function calcSens(p) {
  const d = [-0.1,-0.05,0,0.05,0.1];
  return d.map(o => d.map(a => calc({...p, occ:p.occ+o, adr:p.adr*(1+a)}, "base").cf));
}

function calc36(p) {
  const rows = [];
  const mkt = MKT[p.city] || MKT.Marbella;
  const seasonality = mkt.seasonality || {};
  for (let i=0; i<36; i++) {
    const date = new Date(2025, 2+i); // Start March 2025
    const mon = MONTH_NAMES[date.getMonth()];
    const sIdx = seasonality[mon] || 1.0;
    // Apply seasonality to base calc
    const r = calc({ ...p, occ: Math.min(0.98, p.occ * sIdx), adr: p.adr * Math.max(0.6, Math.min(1.5, sIdx)) });
    rows.push({
      m:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`,
      mon, sIdx, gr:r.gr, tc:r.topex, hp:r.hp, noi:r.noi, cf:r.cf, net:r.hp+r.cf,
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────
//  FORMATTERS
// ─────────────────────────────────────────────────────────────────
const fm  = n => { if (n==null) return "–"; const a=Math.abs(Math.round(n)); return (n<0?"−":"")+"€"+a.toLocaleString(); };
const fp  = (n,d=1) => n.toFixed(d)+"%";
const teal= "var(--teal)", rose="var(--rose)", gold="var(--gold)", ink="var(--ink4)";
const ci  = n => n>=0 ? teal : rose;

// ─────────────────────────────────────────────────────────────────
//  COMPONENTS
// ─────────────────────────────────────────────────────────────────
function Sparkline({ data, height=40 }) {
  const mn=Math.min(...data), mx=Math.max(...data), rng=Math.max(mx-mn,1);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:2, height }}>
      {data.map((v,i) => {
        const h = Math.max(2, ((v-mn)/rng)*(height-4));
        return <div key={i} style={{ flex:1, height:h, borderRadius:"2px 2px 0 0", background:v>=0?teal:rose, opacity:.8 }} />;
      })}
    </div>
  );
}

function KpiCard({ label, value, sub, color, badge }) {
  return (
    <div className="kpi">
      <div style={{ height:3, background:color, borderRadius:"14px 14px 0 0", position:"absolute", top:0, left:0, right:0 }} />
      <div className="kpi-lbl">{label}</div>
      <div className="kpi-val" style={{ color }}>{value}</div>
      <div className="kpi-sub">{sub}</div>
      {badge && <div style={{ marginTop:5, display:"inline-block", background:color+"22", color, fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:20, letterSpacing:.5 }}>{badge}</div>}
    </div>
  );
}

function Card({ title, sub, children, style }) {
  return (
    <div className="card" style={style}>
      {title && <div className="c-hd">{title}</div>}
      {sub   && <div className="c-sub">{sub}</div>}
      {children}
    </div>
  );
}

function MiniStat({ label, value, color, note }) {
  return (
    <div className="ms">
      <div className="ms-l">{label}</div>
      <div className="ms-v" style={{ color: color||"var(--ink)" }}>{value}</div>
      {note && <div style={{ fontSize:10, color:"var(--ink4)", marginTop:2 }}>{note}</div>}
    </div>
  );
}

// ─── MARKET INTEL panel ──────────────────────────────────────────
function MarketIntel({ city }) {
  const mkt = MKT[city];
  if (!mkt) return null;
  const nbs = Object.entries(mkt.nb);
  return (
    <div className="fu">
      {/* Source badge */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"var(--sky-l)", border:"1px solid #c0d4f0", borderRadius:"var(--r-sm)", marginBottom:18, fontSize:12, color:"var(--sky)" }}>
        <span style={{ fontSize:14 }}>📊</span>
        <span><strong>Data source:</strong> {mkt.airbtics?.source} · {mkt.airbtics?.sampleSize ? `${mkt.airbtics.sampleSize} tracked properties` : "Regional sample"} · Months: {mkt.airbtics?.dataMonths?.join(", ")}</span>
      </div>

      {/* Market KPIs */}
      <div className="kpi-strip" style={{ gridTemplateColumns:"repeat(4,1fr)", marginBottom:18 }}>
        <KpiCard label="Market Avg ADR"  value={`€${mkt.airbtics?.medianADR}`}   sub="Median nightly rate"      color={teal} badge="Airbtics" />
        <KpiCard label="Market Avg Occ"  value={fp((mkt.airbtics?.avgOcc||0)*100)} sub="Annual average occupancy" color={teal} badge="Airbtics" />
        <KpiCard label="Peak ADR"        value={`€${mkt.airbtics?.highADR}`}     sub="Peak season rate"         color={gold} badge="Summer" />
        <KpiCard label="Avg Monthly Rev" value={fm(mkt.airbtics?.avgMonthlyRev)} sub="Across sampled listings"  color={teal} badge="Airbtics" />
      </div>

      {/* Neighbourhood table */}
      <Card title="Neighbourhood Breakdown" sub={`${city} submarkets · Airbtics data · Spring 2025`}>
        <table className="dt">
          <thead>
            <tr>
              <th style={{ textAlign:"left" }}>Neighbourhood</th>
              <th>Grade</th>
              <th>Avg ADR</th>
              <th>Avg Occ</th>
              <th>Supply</th>
              <th>Revenue Trend</th>
            </tr>
          </thead>
          <tbody>
            {nbs.map(([name, d]) => (
              <tr key={name}>
                <td style={{ fontFamily:"var(--sans)", fontWeight:600 }}>{name}</td>
                <td>
                  <span style={{
                    background: d.grade==="A"?"var(--teal-l)":d.grade==="B"?"var(--gold-l)":"var(--rose-l)",
                    color: d.grade==="A"?teal:d.grade==="B"?gold:rose,
                    padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:700,
                  }}>{d.grade}</span>
                </td>
                <td style={{ color:"var(--ink2)", fontFamily:"var(--mono)" }}>€{d.adr}</td>
                <td style={{ color:ci(d.occ-0.6), fontFamily:"var(--mono)" }}>{fp(d.occ*100)}</td>
                <td style={{ fontFamily:"var(--mono)" }}>{d.supply.toLocaleString()}</td>
                <td style={{ color:teal, fontWeight:600, fontFamily:"var(--mono)" }}>{d.trend}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Regulatory info */}
        <div style={{ marginTop:20, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          <MiniStat label="Mortgage Rate" value={`${mkt.ir}% fixed`} note="Non-resident, 2025" />
          <MiniStat label="Max LTV" value={`${mkt.maxLTV}%`} note="Non-residents" />
          <MiniStat label="Transfer Tax" value={`${mkt.transferTax}%`} note="ITP Andalucía" />
          <MiniStat label="Tourist Licence" value={`€${mkt.pf2}/yr`} note="Vivienda Turística" />
          <MiniStat label="IBI (Council Tax)" value={`${mkt.ibi}% p.a.`} note="Of cadastral value" />
          <MiniStat label="Community Fees" value={`€${mkt.community?.toLocaleString()}/yr`} note="Avg estimate" />
        </div>
      </Card>

      {/* Seasonality chart */}
      {city && (
        <Card title="Seasonal Occupancy Index" sub="Relative demand by month — Costa del Sol pattern" style={{ marginTop:17 }}>
          <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:56, marginBottom:8 }}>
            {MONTH_NAMES.map(mon => {
              const s = mkt.seasonality[mon] || 1;
              const h = Math.max(6, (s/1.4)*52);
              const col = s>=1.1?teal:s>=0.8?gold:rose;
              return (
                <div key={mon} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                  <div style={{ fontSize:8, color:"var(--ink4)", fontWeight:700 }}>{(s*100).toFixed(0)}</div>
                  <div style={{ width:"100%", height:h, borderRadius:"3px 3px 0 0", background:col, opacity:.8 }} />
                  <div style={{ fontSize:9, color:"var(--ink3)", fontWeight:600 }}>{mon}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:16, marginTop:6 }}>
            <span style={{ fontSize:11, color:"var(--ink3)" }}><span style={{ color:teal }}>■</span> Peak (>1.1×)</span>
            <span style={{ fontSize:11, color:"var(--ink3)" }}><span style={{ color:gold }}>■</span> Mid (0.8–1.1×)</span>
            <span style={{ fontSize:11, color:"var(--ink3)" }}><span style={{ color:rose }}>■</span> Low (&lt;0.8×)</span>
          </div>
        </Card>
      )}

      {/* Airbtics raw sample table */}
      {city === "Marbella" && (
        <Card title="Airbtics Sample Properties — Raw Performance Data" sub="5 Marbella properties · Feb–Apr 2025 · ADR and revenue in USD" style={{ marginTop:17 }}>
          <div style={{ fontSize:11, color:"var(--ink3)", marginBottom:12, padding:"8px 12px", background:"var(--gold-l)", borderRadius:"var(--r-xs)", border:"1px solid var(--gold-m)" }}>
            ⚠ Raw data extracted from Airbtics .numbers export. USD figures; apply ~0.92 EUR/USD for EUR equivalent. Sample of 5 active properties.
          </div>
          <div style={{ overflowX:"auto" }}>
            <table className="dt">
              <thead>
                <tr>
                  <th style={{ textAlign:"left" }}>Property ID</th>
                  <th>Month</th>
                  <th>ADR ($)</th>
                  <th>Occupancy</th>
                  <th>Revenue ($)</th>
                  <th>Avail Days</th>
                  <th>Booked Days</th>
                </tr>
              </thead>
              <tbody>
                {MARBELLA_RAW.map((row,i) => (
                  <tr key={i}>
                    <td style={{ fontFamily:"var(--sans)", color:"var(--ink3)", fontSize:12 }}>{row.pid}</td>
                    <td>{row.month}</td>
                    <td style={{ color:"var(--ink2)" }}>${row.adr}</td>
                    <td style={{ color:row.occ>=70?teal:row.occ>=50?gold:rose }}>{row.occ}%</td>
                    <td style={{ color:teal }}>${row.rev.toLocaleString()}</td>
                    <td>{row.avail}</td>
                    <td style={{ color:teal }}>{row.booked}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Average</td>
                  <td>—</td>
                  <td>${AIRBTICS_MARBELLA.avgADR}</td>
                  <td>{fp(AIRBTICS_MARBELLA.avgOcc*100)}</td>
                  <td>${AIRBTICS_MARBELLA.avgRev.toLocaleString()}</td>
                  <td>—</td><td>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── OVERVIEW ────────────────────────────────────────────────────
function Overview({ p, r, scen }) {
  const mkt = MKT[p.city] || MKT.Marbella;
  const ptInfo = PT[p.pt] || PT.apartment;
  const nb = mkt.nb?.[p.nb] || {};

  const alerts = [];
  if (r.cf < 0)           alerts.push(`Negative monthly cash flow ${fm(r.cf)}. Below debt-service threshold.`);
  if (r.cvb < -1)         alerts.push(`Cap rate ${fp(r.cr)} is ${Math.abs(r.cvb).toFixed(1)}pts below benchmark midpoint ${fp(r.bm)}.`);
  if (r.occ*100 < r.beo)  alerts.push(`Projected occupancy ${fp(r.occ*100)} is below break-even ${fp(r.beo)}.`);
  if (r.dscr < 1)         alerts.push(`DSCR ${r.dscr.toFixed(2)}x — NOI does not cover debt service.`);

  const kpis = [
    { l:"NOI / Month",     v:fm(r.noi),       s:"After all opex",              c:ci(r.noi) },
    { l:"Cash Flow / Mo",  v:fm(r.cf),         s:"After mortgage",              c:ci(r.cf) },
    { l:"Cash-on-Cash",    v:fp(r.coc),        s:"Annual return on equity",     c:r.coc>5?teal:r.coc>0?gold:rose },
    { l:"Cap Rate",        v:fp(r.cr),         s:`Bench ${fp(p.bcl)}–${fp(p.bch)}`, c:r.cr>=p.bcl?teal:gold },
    { l:"Break-even Occ.", v:fp(r.beo),        s:`Actual: ${fp(r.occ*100)}`,   c:r.occ*100>r.beo?teal:rose },
  ];

  const rcells = [
    { l:"Monthly NOI",        v:fm(r.noi),                n:"Revenue − All Opex",          c:ci(r.noi) },
    { l:"Monthly Cash Flow",  v:fm(r.cf),                 n:"After debt service",           c:ci(r.cf) },
    { l:"Annual Cash Flow",   v:fm(r.ac),                 n:"12-month outlook",             c:ci(r.ac) },
    { l:"Cash-on-Cash",       v:fp(r.coc),                n:"Annual CF / Total Invested",   c:r.coc>5?teal:r.coc>0?gold:rose },
    { l:"Cap Rate",           v:fp(r.cr),                 n:"Annual NOI / Purchase Price",  c:r.cr>=p.bcl?teal:gold },
    { l:"vs Benchmark",       v:(r.cvb>=0?"+":"")+r.cvb.toFixed(1)+"pts", n:`Midpoint ${fp(r.bm)}`, c:ci(r.cvb) },
    { l:"Debt Service",       v:fm(r.ds),                 n:"Monthly mortgage (P+I)",       c:"var(--ink)" },
    { l:"Total Cash In",      v:fm(r.tc),                 n:"Down + ITP + notary + setup",  c:"var(--ink)" },
    { l:"Break-even Occ.",    v:fp(r.beo),                n:"Revenue covers all costs",     c:r.occ*100>r.beo?teal:rose },
    { l:"DSCR",               v:r.dscr.toFixed(2)+"×",   n:"NOI ÷ Debt Service",           c:r.dscr>=1.25?teal:r.dscr>=1?gold:rose },
    { l:"Expense Ratio",      v:fp(r.er),                 n:"Opex / Gross Revenue",         c:r.er<65?teal:gold },
    { l:"Host Profit",        v:fm(r.hp),                 n:"Gross − all host costs",       c:ci(r.hp) },
    { l:"Loan Amount",        v:fm(r.loan),               n:`${p.dp}% down · ${mkt.maxLTV}% max LTV`, c:"var(--ink)" },
    { l:"Gross Revenue",      v:fm(r.gr),                 n:`${r.nights} nights @ €${Math.round(r.adr)}`, c:teal },
  ];

  const rows36 = calc36(p);
  const cfv = rows36.map(x=>x.cf);

  // Market comp: compare to neighbourhood benchmark
  const nbComp = nb.adr ? [
    { l:"Your ADR",      v:`€${Math.round(r.adr)}`,     ref:`Mkt: €${nb.adr}`,     good:r.adr>=nb.adr },
    { l:"Your Occ",      v:fp(r.occ*100),               ref:`Mkt: ${fp(nb.occ*100)}`, good:r.occ>=nb.occ },
    { l:"Your Rev/mo",   v:fm(r.gr),                    ref:`Mkt: ${fm(nb.adr*Math.round(nb.occ*30))}`, good:r.gr>=nb.adr*Math.round(nb.occ*30) },
  ] : [];

  return (
    <div className="fu">
      {alerts.map((a,i) => <div key={i} className="alert alert-w" style={{ marginBottom:6 }}>⚠ {a}</div>)}

      <div className="kpi-strip">
        {kpis.map((k,i) => <KpiCard key={i} label={k.l} value={k.v} sub={k.s} color={k.c} />)}
      </div>

      <div className="g-main">
        <Card title="Investor Returns" sub={`${p.nb}, ${p.city} · ${ptInfo.i} ${ptInfo.l}${p.beds>0?` · ${p.beds}BR`:""} · ${mkt.flag}`}>
          <div className="roi-g">
            {rcells.map((c,i) => (
              <div key={i} className="roi-c">
                <div className="roi-cl">{c.l}</div>
                <div className="roi-cv" style={{ color:c.c }}>{c.v}</div>
                <div className="roi-cn">{c.n}</div>
              </div>
            ))}
          </div>

          {/* Market comp strip */}
          {nbComp.length > 0 && (
            <div style={{ marginTop:16, padding:"14px 16px", background:"var(--cream)", borderRadius:"var(--r-sm)", border:"1px solid var(--border)" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"var(--ink3)", textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>
                vs Neighbourhood Benchmark ({p.nb})
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                {nbComp.map((c,i) => (
                  <div key={i}>
                    <div style={{ fontSize:10, color:"var(--ink3)", fontWeight:600, marginBottom:3 }}>{c.l}</div>
                    <div style={{ fontFamily:"var(--mono)", fontSize:14, fontWeight:500, color:c.good?teal:gold }}>{c.v}</div>
                    <div style={{ fontSize:10, color:"var(--ink4)" }}>{c.ref}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <Card title="24-Month Cash Flow">
            <div style={{ fontSize:11, color:"var(--ink4)", marginBottom:10 }}>Mar 2025 – Feb 2027 · Seasonality-adjusted</div>
            <Sparkline data={cfv.slice(0,24)} height={40} />
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              <span style={{ fontSize:10, color:"var(--ink4)" }}>Mar 25</span>
              <span style={{ fontSize:10, color:"var(--ink4)" }}>Feb 27</span>
            </div>
            <div style={{ display:"flex", gap:14, marginTop:10 }}>
              <span style={{ fontSize:11, color:"var(--ink3)" }}><span style={{ color:teal }}>■</span> Positive</span>
              <span style={{ fontSize:11, color:"var(--ink3)" }}><span style={{ color:rose }}>■</span> Negative</span>
            </div>
          </Card>

          <Card title="Acquisition Summary">
            <div className="g2" style={{ gap:8, marginTop:8 }}>
              {[
                ["Purchase Price",     fm(p.pp)],
                ["Down Payment",       `${fm(p.pp*p.dp/100)} (${p.dp}%)`],
                ["ITP Transfer Tax",   fm(Math.round(p.pp * (MKT[p.city]?.transferTax||9)/100))],
                ["Notary + Registry",  fm(MKT[p.city]?.notary||3500)],
                ["Setup Reserve",      fm(p.sr)],
                ["Total Cash In",      fm(r.tc)],
                ["Loan Amount",        fm(r.loan)],
                ["Loan-to-Value",      `${(100-p.dp).toFixed(0)}% (max ${MKT[p.city]?.maxLTV||70}%)`],
              ].map(([l,v],i) => <MiniStat key={i} label={l} value={v} />)}
            </div>
          </Card>

          <Card title="Occupancy Context">
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { l:"Your occupancy",   v:fp(r.occ*100), c:ci(r.occ-0.6) },
                { l:"Break-even occ.", v:fp(r.beo), c:ci(r.occ*100-r.beo) },
                { l:"Market average",  v:fp((MKT[p.city]?.airbtics?.avgOcc||0.7)*100), c:teal },
                { l:"Nights/month",    v:`${r.nights} of 30`, c:"var(--ink)" },
              ].map((row,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingBottom:8, borderBottom: i<3?"1px solid var(--cream3)":"none" }}>
                  <span style={{ fontSize:13, color:"var(--ink2)" }}>{row.l}</span>
                  <span style={{ fontFamily:"var(--mono)", fontSize:13, fontWeight:600, color:row.c }}>{row.v}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── COSTS ───────────────────────────────────────────────────────
function Costs({ p, r }) {
  const cats = [
    { n:"Utilities",              c:"#2E5FA3", v:r.op.ut },
    { n:"Internet / TV",          c:"#B8862E", v:r.op.int },
    { n:"Cleaning & Laundry",     c:"#0B6E5A", v:r.op.cl },
    { n:"Supplies",               c:"#C04040", v:r.op.su },
    { n:"Maintenance Reserve",    c:"#7B52A0", v:r.op.ma },
    { n:"Insurance",              c:"#3A9EA0", v:r.op.ins },
    { n:"Taxes & Tourist Licence",c:"#8A7030", v:r.op.tax },
    { n:"IBI (Council Tax)",      c:"#5A7A30", v:r.op.ibi  },
    { n:"Community Fees",         c:"#706090", v:r.op.comm },
    { n:"Platform & Mgmt Fees",   c:"#B84080", v:r.op.mgmt },
  ];
  const tot = cats.reduce((a,c)=>a+c.v, 0);
  const mx  = Math.max(...cats.map(c=>c.v));
  return (
    <div className="fu">
      <Card title="Operating Cost Breakdown" sub="Monthly costs by category — Andalucía-calibrated estimates">
        <table className="dt">
          <thead><tr><th>Category</th><th>Monthly</th><th>Annual</th><th>Share</th></tr></thead>
          <tbody>
            {cats.map((c,i) => {
              const w = Math.round((c.v/mx)*88);
              return (
                <tr key={i}>
                  <td><span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:c.c, marginRight:9, verticalAlign:"middle" }}/>{c.n}</td>
                  <td>{fm(c.v)}</td>
                  <td style={{ color:"var(--ink3)" }}>{fm(c.v*12)}</td>
                  <td>
                    <div style={{ display:"flex", alignItems:"center", gap:7, justifyContent:"flex-end" }}>
                      <div style={{ width:w, height:5, background:c.c, borderRadius:3, opacity:.65 }} />
                      <span style={{ color:"var(--ink3)", fontFamily:"var(--mono)", fontSize:11 }}>{fp(c.v/tot*100,0)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td>Total Monthly Opex</td><td>{fm(tot)}</td><td>{fm(tot*12)}</td><td /></tr></tfoot>
        </table>
        <div className="g3" style={{ marginTop:20 }}>
          {[
            [fm(r.gr),  "Gross Revenue",  ""],
            [fm(tot),   "Total Opex",     rose],
            [fm(r.hp),  "Host Profit",    ci(r.hp)],
            [fm(r.noi), "NOI",            ci(r.noi)],
            [fm(r.ds),  "Debt Service",   "var(--ink)"],
            [fp(r.er),  "Expense Ratio",  r.er<65?teal:gold],
          ].map(([v,l,c],i) => <MiniStat key={i} label={l} value={v} color={c||"var(--ink)"} />)}
        </div>
      </Card>
    </div>
  );
}

// ─── SENSITIVITY ─────────────────────────────────────────────────
function Sensitivity({ p }) {
  const labels = ["-10%","-5%","Base","+5%","+10%"];
  const grid = calcSens(p);
  return (
    <div className="fu">
      <Card title="Sensitivity Grid" sub="Monthly cash flow (€) · ADR × Occupancy — base case outlined">
        <div style={{ overflowX:"auto" }}>
          <table className="sens-t">
            <thead><tr><th>Occ \ ADR</th>{labels.map(l=><th key={l}>{l}</th>)}</tr></thead>
            <tbody>
              {grid.map((row,ri) => (
                <tr key={ri}>
                  <td className="s-rh">{labels[ri]}</td>
                  {row.map((v,ci2) => (
                    <td key={ci2} className={`${v>=0?"s-pos":"s-neg"}${ri===2&&ci2===2?" s-base":""}`}>{fm(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop:14, padding:"11px 14px", background:"var(--cream)", border:"1px solid var(--border)", borderRadius:"var(--r-xs)", fontSize:12, color:"var(--ink3)" }}>
          ℹ Green = cash-flow positive after all opex + debt service. Outlined = base case. Adjust assumptions in the Assumptions tab to shift the grid.
        </div>
      </Card>
    </div>
  );
}

// ─── PROJECTION ──────────────────────────────────────────────────
function Projection({ p }) {
  const rows = calc36(p);
  const cfv = rows.map(x=>x.cf);
  const cumulative = cfv.reduce((acc,v,i) => [...acc, (acc[i-1]||0)+v], []);
  return (
    <div className="fu">
      <Card title="36-Month Investor Projection" sub="Mar 2025 – Feb 2028 · Seasonality-adjusted · Costa del Sol pattern">
        <Sparkline data={cfv} height={52} />
        <div style={{ marginTop:12, marginBottom:18 }}>
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            <span style={{ fontSize:10, color:"var(--ink4)" }}>Mar 25</span>
            <span style={{ fontSize:10, color:"var(--ink4)" }}>Feb 28</span>
          </div>
        </div>

        {/* Cumulative P&L */}
        <div style={{ marginBottom:18, padding:"14px 16px", background:"var(--teal-l)", border:"1px solid var(--teal-m)", borderRadius:"var(--r-sm)", display:"flex", gap:20 }}>
          <div>
            <div style={{ fontSize:10, color:"var(--ink3)", fontWeight:700, textTransform:"uppercase", letterSpacing:.8 }}>3-Year Cumulative CF</div>
            <div style={{ fontFamily:"var(--mono)", fontSize:20, color:cumulative[35]>=0?teal:rose, fontWeight:600 }}>{fm(cumulative[35])}</div>
          </div>
          <div>
            <div style={{ fontSize:10, color:"var(--ink3)", fontWeight:700, textTransform:"uppercase", letterSpacing:.8 }}>Best Month</div>
            <div style={{ fontFamily:"var(--mono)", fontSize:20, color:teal, fontWeight:600 }}>{fm(Math.max(...cfv))}</div>
          </div>
          <div>
            <div style={{ fontSize:10, color:"var(--ink3)", fontWeight:700, textTransform:"uppercase", letterSpacing:.8 }}>Worst Month</div>
            <div style={{ fontFamily:"var(--mono)", fontSize:20, color:rose, fontWeight:600 }}>{fm(Math.min(...cfv))}</div>
          </div>
          <div>
            <div style={{ fontSize:10, color:"var(--ink3)", fontWeight:700, textTransform:"uppercase", letterSpacing:.8 }}>Positive Months</div>
            <div style={{ fontFamily:"var(--mono)", fontSize:20, color:teal, fontWeight:600 }}>{cfv.filter(v=>v>0).length} / 36</div>
          </div>
        </div>

        <div className="proj-sc">
          <table className="pt">
            <thead>
              <tr><th>Month</th><th>Season</th><th>Gross Rev</th><th>Total Opex</th><th>NOI</th><th>Cash Flow</th><th>Cumulative CF</th></tr>
            </thead>
            <tbody>
              {rows.map((x,i) => (
                <tr key={i}>
                  <td>{x.m}</td>
                  <td style={{ color:x.sIdx>=1.1?teal:x.sIdx>=0.8?gold:rose, fontFamily:"var(--sans)", fontSize:11 }}>
                    {x.sIdx>=1.1?"Peak":x.sIdx>=0.8?"Mid":"Low"} ({x.sIdx.toFixed(2)}×)
                  </td>
                  <td className="vp">{fm(x.gr)}</td>
                  <td className="vn">{fm(x.tc)}</td>
                  <td className={x.noi>=0?"vp":"vn"}>{fm(x.noi)}</td>
                  <td className={x.cf>=0?"vp":"vn"}>{fm(x.cf)}</td>
                  <td style={{ color:cumulative[i]>=0?teal:rose, fontFamily:"var(--mono)", fontSize:11 }}>{fm(cumulative[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── ASSUMPTIONS ─────────────────────────────────────────────────
function Assumptions({ p, idx, onUpdate }) {
  const mkt = MKT[p.city] || MKT.Marbella;
  const nbs = Object.keys(mkt.nb || {});
  const Field = ({ id, label, val, step, hint }) => (
    <div className="ff">
      <label className="fl">{label}</label>
      <input type="number" className="fi" defaultValue={val} step={step}
        onChange={e => onUpdate(id, e.target.value, idx)} />
      {hint && <div className="fh">{hint}</div>}
    </div>
  );
  return (
    <div className="fu">
      <Card title="Property Type" sub="Affects cost multipliers" style={{ marginBottom:17 }}>
        <div className="pt-grid">
          {Object.entries(PT).map(([k,v]) => (
            <div key={k} className={`pt-card${p.pt===k?" sel":""}`} onClick={()=>onUpdate("pt",k,idx)}>
              <span className="pt-icon">{v.i}</span><div className="pt-name">{v.l}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="g2">
        <Card title="Financing" sub="Spanish mortgage — non-resident terms">
          <div className="fg">
            <Field id="pp"  label="Purchase Price (€)"    val={p.pp}  hint="Full asking price" />
            <Field id="dp"  label="Down Payment (%)"      val={p.dp}  step={1} hint="Min 30% for non-residents" />
            <Field id="ir"  label="Interest Rate (%)"     val={p.ir}  step={0.05} hint="Fixed rate, 2025 avg" />
            <Field id="ty"  label="Loan Term (years)"     val={p.ty}  step={1} hint="Max 25 for non-residents" />
            <Field id="cc"  label="Acquisition Costs (€)" val={p.cc}  hint="ITP ~9% + notary" />
            <Field id="sr"  label="Setup Reserve (€)"     val={p.sr}  hint="Furnishing + buffer" />
          </div>
        </Card>
        <Card title="Revenue Assumptions" sub="Calibrated to Airbtics data">
          <div className="fg">
            <Field id="occ"  label="Avg Occupancy"         val={p.occ} step={0.01} hint="Annual average (0–1)" />
            <Field id="adr"  label="ADR (€/night)"         val={p.adr} hint={`Market median: €${mkt.nb?.[p.nb]?.adr||"—"}`} />
            <Field id="pf"   label="Platform Fee (%)"      val={p.pf}  step={0.5} hint="Airbnb host fee" />
            <Field id="mf"   label="Mgmt Fee (%)"          val={p.mf}  step={0.5} hint="Property manager (Spain: 10–15%)" />
          </div>
          <div style={{ marginTop:14, padding:"11px 14px", background:"var(--cream)", border:"1px solid var(--border)", borderRadius:"var(--r-xs)" }}>
            <div style={{ fontSize:10, color:"var(--ink3)", fontWeight:700, textTransform:"uppercase", letterSpacing:.8 }}>Airbtics Benchmark ({p.nb})</div>
            <div style={{ fontFamily:"var(--mono)", fontSize:13, color:"var(--ink)", marginTop:4 }}>
              ADR: €{mkt.nb?.[p.nb]?.adr||"—"} · Occ: {mkt.nb?.[p.nb]?.occ?fp(mkt.nb[p.nb].occ*100):"—"} · Grade: {mkt.nb?.[p.nb]?.grade||"—"}
            </div>
          </div>
        </Card>
        <Card title="Spanish Tax & Regulatory" sub="Andalucía — not legal advice">
          <div className="fg">
            <Field id="lt"        label="Tourist Tax (%)"           val={p.lt}        step={0.1} hint="IEAT: ~1% gross rev equiv." />
            <Field id="pf2"       label="Annual Permit (€)"         val={p.pf2}       hint="Vivienda Turística licence" />
            <Field id="ibi"       label="IBI Rate (%)"              val={p.ibi}       step={0.01} hint="% of cadastral value p.a." />
            <Field id="community" label="Community Fees (€/yr)"     val={p.community} hint="Urbanización / building" />
          </div>
        </Card>
        <Card title="Benchmark & Location">
          <div className="fg">
            <Field id="bcl" label="Cap Rate Low (%)"  val={p.bcl} step={0.1} />
            <Field id="bch" label="Cap Rate High (%)" val={p.bch} step={0.1} />
          </div>
          <div style={{ marginTop:14 }}>
            <label className="fl" style={{ display:"block", marginBottom:7 }}>Neighbourhood</label>
            <select className="fi" value={p.nb} onChange={e=>onUpdate("nb",e.target.value,idx)}>
              {nbs.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ marginTop:12, padding:"11px 14px", background:"var(--cream)", borderRadius:"var(--r-xs)", border:"1px solid var(--border)" }}>
            <div style={{ fontSize:10, color:"var(--ink3)", fontWeight:700, textTransform:"uppercase", letterSpacing:.8, marginBottom:4 }}>Implied Cap Rate</div>
            <div style={{ fontFamily:"var(--mono)", fontSize:14, color:calc(p).cvb>=0?teal:rose }}>
              {fp(calc(p).cr)} vs {fp(p.bcl)}–{fp(p.bch)} benchmark
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── VERDICT ─────────────────────────────────────────────────────
function Verdict({ p, r, scen }) {
  let sc = 0;
  if (r.coc>7) sc+=3; else if (r.coc>4) sc+=2; else if (r.coc>0) sc+=1;
  if (r.cr>=p.bcl) sc+=2; else if (r.cr>=p.bcl*.9) sc+=1;
  if (r.cf>0) sc+=2;
  if (r.dscr>=1.25) sc+=1;

  let rating, cls;
  if (sc>=7) { rating="Strong Buy"; cls="s"; }
  else if (sc>=4) { rating="Cautious — Review"; cls="n"; }
  else { rating="Weak — Pass"; cls="w"; }

  const vboxBg  = cls==="s"?"var(--teal-l)":cls==="n"?"var(--gold-l)":"var(--rose-l)";
  const vboxBdr = cls==="s"?"var(--teal-m)":cls==="n"?"var(--gold-m)":"rgba(192,64,64,.22)";
  const vboxClr = cls==="s"?teal:cls==="n"?gold:rose;

  const pts = [
    `Cap rate ${fp(r.cr)} — ${r.cvb>=0?"+":""}${r.cvb.toFixed(1)}pts vs benchmark midpoint ${fp(r.bm)}.`,
    `Cash-on-cash ${fp(r.coc)} — ${r.coc>4?"above target. Equity is compounding.":"below 4% target. Verify assumptions."}`,
    `Break-even occupancy ${fp(r.beo)} vs projected ${fp(r.occ*100)}. ${r.occ*100>r.beo?"Property covers all costs.":"Currently below break-even."}`,
    `DSCR ${r.dscr.toFixed(2)}× — ${r.dscr>=1.25?"strong debt coverage.":r.dscr>=1?"thin margin.":"NOI below debt service."}`,
    `Non-resident 30% down required. Total cash-in: ${fm(r.tc)}.`,
  ];
  const risks = [
    "Spanish STR regulations tightening — verify Vivienda Turística licence validity for exact address.",
    "Non-resident IBI and IRNR income tax (~19% of net rental income) not modelled — consult Spanish tax advisor.",
    "Costa del Sol is highly seasonal — off-season cash flow will be negative. Ensure liquidity reserve.",
    "Property management fees 10-15% are high in Spain — factor into total cost carefully.",
    "Non-resident mortgage LTV capped at 70% — minimum 30% down + ~9% acquisition costs.",
  ];
  const acts = [
    "Verify NIE (foreigner identity number) — required before any Spanish property purchase.",
    "Commission a RICS valuation — banks lend on valuation, not purchase price.",
    "Check Vivienda Turística licence eligibility for the specific property/community.",
    "Get IRNR (non-resident income tax) estimate from Spanish gestor or tax advisor.",
    "Stress-test at peak-season occupancy of 55% to model a poor-season scenario.",
    "Obtain 3 management company quotes — rates vary 8-18% in Costa del Sol.",
  ];

  const br = calc(p,"base"), cr2 = calc(p,scen);
  const cmp = [
    [fm(cr2.noi),  fm(br.noi),  cr2.noi-br.noi,    "NOI / month"],
    [fm(cr2.cf),   fm(br.cf),   cr2.cf-br.cf,       "Cash Flow / mo"],
    [fp(cr2.cr),   fp(br.cr),   cr2.cr-br.cr,       "Cap Rate"],
    [fp(cr2.coc),  fp(br.coc),  cr2.coc-br.coc,     "Cash-on-Cash"],
    [fp(cr2.beo),  fp(br.beo),  cr2.beo-br.beo,     "Break-even Occ."],
  ];

  return (
    <div className="fu">
      <div className="g2">
        <div>
          <div style={{ borderRadius:"var(--r)", padding:"24px 26px", border:`1px solid ${vboxBdr}`, background:vboxBg }}>
            <div style={{ fontSize:9.5, fontWeight:700, textTransform:"uppercase", letterSpacing:1.3, opacity:.55, marginBottom:7 }}>
              Investment Verdict · Score: {sc} / 8
            </div>
            <div style={{ fontFamily:"Cormorant Garant,serif", fontSize:34, fontWeight:700, lineHeight:1, marginBottom:14, color:vboxClr }}>
              {rating}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
              {pts.map((pt,i) => (
                <div key={i} style={{ fontSize:13, color:"var(--ink2)", paddingLeft:16, position:"relative", lineHeight:1.55 }}>
                  <span style={{ position:"absolute", left:0, color:"var(--ink4)", fontSize:10, top:3 }}>—</span>{pt}
                </div>
              ))}
            </div>
          </div>
          <Card title="Spain-Specific Risks" style={{ marginTop:16 }}>
            {risks.map((r2,i) => (
              <div key={i} style={{ fontSize:13, color:"var(--ink2)", paddingLeft:16, position:"relative", lineHeight:1.55, marginBottom:8 }}>
                <span style={{ position:"absolute", left:0, color:rose, fontSize:10, top:3 }}>!</span>{r2}
              </div>
            ))}
          </Card>
        </div>
        <div>
          <Card title="Next Steps" sub="Recommended diligence for Spanish purchase">
            {acts.map((a,i) => (
              <div key={i} style={{ display:"flex", gap:12, padding:"11px 0", borderBottom:"1px solid var(--cream3)", alignItems:"flex-start" }}>
                <span style={{ fontFamily:"var(--mono)", fontSize:11, color:teal, flexShrink:0, fontWeight:700 }}>0{i+1}</span>
                <span style={{ fontSize:13, color:"var(--ink2)", lineHeight:1.5 }}>{a}</span>
              </div>
            ))}
          </Card>
          <Card title="Scenario Comparison" sub={`${scen.charAt(0).toUpperCase()+scen.slice(1)} vs Base`} style={{ marginTop:16 }}>
            <table className="cmp-t">
              <thead><tr><th>Metric</th><th>Current</th><th>Base</th><th>Δ</th></tr></thead>
              <tbody>
                {cmp.map((x,i) => (
                  <tr key={i}>
                    <td>{x[3]}</td>
                    <td style={{ fontFamily:"var(--mono)" }}>{x[0]}</td>
                    <td style={{ fontFamily:"var(--mono)", color:"var(--ink4)" }}>{x[1]}</td>
                    <td style={{ fontFamily:"var(--mono)", color:x[2]>=0?teal:rose }}>{x[2]>=0?"+":""}{typeof x[2]==="number"?x[2].toFixed(1):x[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── CHECKLIST ───────────────────────────────────────────────────
const CHECKLIST = [
  { t:"Obtain NIE (Foreigner Identity Number)", d:"Required for any Spanish property purchase. Allow 4-8 weeks if applying from abroad." },
  { t:"Open Spanish bank account", d:"Required for mortgage and utility direct debits. BBVA, Sabadell or CaixaBank recommended." },
  { t:"Verify Vivienda Turística licence eligibility", d:"Check community rules (some prohibit STR) and local planning for the exact address." },
  { t:"Commission RICS valuation", d:"Banks lend on bank valuation, not purchase price. Typical gap is 5-15% below asking." },
  { t:"Tax advice — IRNR", d:"Non-residents pay 19% (EU) on net rental income. Quarterly declarations required." },
  { t:"Validate ADR with live comps", d:"Check Airbnb search results for 30-90 day forward bookings in the neighbourhood." },
  { t:"Stress-test off-season", d:"Model October–February at 35% occupancy. Ensure monthly liquidity to cover shortfall." },
  { t:"Get 3 property management quotes", d:"Rates vary 8-18%. Check contract terms, cleaning standards and reporting." },
];

function Checklist({ chk, onToggle }) {
  const done = chk.filter(Boolean).length;
  return (
    <div className="fu">
      <Card title="Spanish STR Investor Checklist" sub={`${done} of ${CHECKLIST.length} completed`}>
        <div style={{ height:5, background:"var(--cream3)", borderRadius:3, overflow:"hidden", marginTop:8, marginBottom:20 }}>
          <div style={{ height:"100%", background:teal, borderRadius:3, width:`${(done/CHECKLIST.length)*100}%`, transition:"width .4s" }} />
        </div>
        {CHECKLIST.map((item,i) => (
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:13, padding:"13px 0", borderBottom: i<CHECKLIST.length-1?"1px solid var(--cream3)":"none" }}>
            <div onClick={()=>onToggle(i)} style={{
              width:17, height:17, borderRadius:5, flexShrink:0, marginTop:1, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s",
              background:chk[i]?"var(--teal)":"transparent",
              border:chk[i]?"1.5px solid var(--teal)":"1.5px solid var(--border2)",
            }}>
              {chk[i] && <span style={{ fontSize:10, color:"#fff", fontWeight:700 }}>✓</span>}
            </div>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:"var(--ink)", marginBottom:2, textDecoration:chk[i]?"line-through":"none", opacity:chk[i]?.45:1 }}>{item.t}</div>
              <div style={{ fontSize:11, color:"var(--ink4)", lineHeight:1.4 }}>{item.d}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── ADD PROPERTY MODAL ──────────────────────────────────────────
function Modal({ onClose, onCreate }) {
  const [city, setCity] = useState("Marbella");
  const [pt, setPt] = useState("apartment");
  const [nb, setNb] = useState(Object.keys(MKT.Marbella.nb)[0]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(400000);
  const [down, setDown] = useState(30);
  const [beds, setBeds] = useState(2);
  const [guests, setGuests] = useState(4);

  const mkt = MKT[city];
  const nbData = mkt?.nb?.[nb] || { adr:150, occ:.68 };

  const pickCity = c => { setCity(c); setNb(Object.keys(MKT[c].nb)[0]); };

  const handleCreate = () => {
    const pr = parseFloat(price)||400000;
    onCreate({
      name: name || `${nb} — ${PT[pt]?.l}`,
      city, nb, pt,
      beds: parseInt(beds)||2,
      guests: parseInt(guests)||4,
      pp: pr, dp: parseFloat(down)||30, ir: mkt.ir, ty: mkt.term,
      cc: Math.round(pr*(mkt.transferTax/100)) + (mkt.notary||3500),
      sr: Math.round(pr*0.04),
      occ: nbData.occ, adr: nbData.adr,
      pf:3, mf:10, lt:mkt.ltPct, lc:0,
      pf2: mkt.pf2, lf:0,
      bcl: mkt.bcl, bch: mkt.bch,
      ibi: mkt.ibi, community: mkt.community,
    });
  };

  return (
    <div className="overlay open" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal">
        <button className="modal-x" onClick={onClose}>×</button>
        <div className="modal-hd">New Property Analysis</div>
        <div className="modal-sub">Costa del Sol — investor underwriting</div>

        <div style={{ marginBottom:18 }}>
          <div className="sec-lbl">Property Type</div>
          <div className="pt-grid">
            {Object.entries(PT).map(([k,v]) => (
              <div key={k} className={`pt-card${pt===k?" sel":""}`} onClick={()=>setPt(k)}>
                <span className="pt-icon">{v.i}</span><div className="pt-name">{v.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:18 }}>
          <div className="sec-lbl">Market</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9 }}>
            {Object.keys(MKT).map(c => (
              <div key={c} className={`city-card${city===c?" sel":""}`} onClick={()=>pickCity(c)} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:20 }}>{MKT[c].flag}</span>
                <div>
                  <div className="city-name">{c}</div>
                  <div className="city-ctry">{MKT[c].country} · {MKT[c].ir}% mortgage</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:18 }}>
          <div className="sec-lbl">Neighbourhood</div>
          <select className="fi" value={nb} onChange={e=>setNb(e.target.value)} style={{ width:"100%" }}>
            {Object.entries(mkt.nb).map(([n,d]) => (
              <option key={n} value={n}>{n} — ADR €{d.adr} · Occ {fp(d.occ*100)} · Grade {d.grade}</option>
            ))}
          </select>
          {nbData && (
            <div style={{ marginTop:8, fontSize:11, color:"var(--ink3)", padding:"7px 12px", background:"var(--cream2)", borderRadius:"var(--r-xs)" }}>
              Market ADR: <strong>€{nbData.adr}/night</strong> · Occupancy: <strong>{fp(nbData.occ*100)}</strong> · Grade: <strong>{nbData.grade}</strong> · Trend: <strong style={{ color:teal }}>{nbData.trend}</strong>
            </div>
          )}
        </div>

        <div className="fg" style={{ marginBottom:20 }}>
          <div className="ff"><label className="fl">Property Name</label><input type="text" className="fi" value={name} onChange={e=>setName(e.target.value)} placeholder={`e.g. ${nb} Studio`} style={{ fontFamily:"var(--sans)" }} /></div>
          <div className="ff"><label className="fl">Purchase Price (€)</label><input type="number" className="fi" value={price} onChange={e=>setPrice(e.target.value)} /></div>
          <div className="ff">
            <label className="fl">Down Payment (%)</label>
            <input type="number" className="fi" value={down} min={30} max={100} onChange={e=>setDown(e.target.value)} />
            <div className="fh">Non-residents: min 30%</div>
          </div>
          <div className="ff">
            <label className="fl">Bedrooms</label>
            <select className="fi" value={beds} onChange={e=>setBeds(e.target.value)}>
              <option value={0}>Studio</option><option value={1}>1 Bed</option>
              <option value={2}>2 Bed</option><option value={3}>3 Bed</option><option value={4}>4+ Bed</option>
            </select>
          </div>
          <div className="ff"><label className="fl">Max Guests</label><input type="number" className="fi" value={guests} onChange={e=>setGuests(e.target.value)} /></div>
        </div>

        <div style={{ padding:"12px 14px", background:"var(--gold-l)", border:"1px solid var(--gold-m)", borderRadius:"var(--r-sm)", fontSize:12, color:"var(--gold)", marginBottom:16 }}>
          <strong>Estimated Acquisition Costs:</strong> €{Math.round((price||400000)*(mkt.transferTax/100)+mkt.notary).toLocaleString()} (ITP ~{mkt.transferTax}% + notary/registry)
        </div>

        <button onClick={handleCreate} style={{ width:"100%", padding:13, background:"var(--teal)", color:"#fff", border:"none", borderRadius:"var(--r-sm)", fontSize:14, fontWeight:600, cursor:"pointer", letterSpacing:.3 }}>
          Create Analysis →
        </button>
      </div>
    </div>
  );
}

// ─── NAV ─────────────────────────────────────────────────────────
const NAV = [
  { id:"overview",    icon:"◈", label:"Overview" },
  { id:"intel",       icon:"📊", label:"Market Intel" },
  { id:"costs",       icon:"⊟", label:"Cost Breakdown" },
  { id:"sensitivity", icon:"⊞", label:"Sensitivity" },
  { id:"projection",  icon:"↗", label:"36M Projection" },
  { id:"assumptions", icon:"⚙", label:"Assumptions" },
  { id:"verdict",     icon:"◎", label:"Verdict" },
  { id:"checklist",   icon:"☐", label:"Checklist" },
];

// ─── APP ─────────────────────────────────────────────────────────
export default function App() {
  const [projs, setProjs] = useState(INITIAL_PROJS);
  const [projIdx, setProjIdx] = useState(0);
  const [sec, setSec] = useState("overview");
  const [scen, setScen] = useState("base");
  const [chk, setChk] = useState(Array(CHECKLIST.length).fill(false));
  const [showModal, setShowModal] = useState(false);

  const p = projs[projIdx];
  const r = useMemo(() => calc(p, scen), [p, scen]);

  const handleUpdate = useCallback((k, v, i) => {
    const n = parseFloat(v);
    setProjs(ps => {
      const next = ps.map((x, idx) => idx===i ? { ...x, [k]: isNaN(n)?v:n } : x);
      if (k==="nb") {
        const mkt = MKT[ps[i].city];
        if (mkt?.nb?.[v]) { next[i] = { ...next[i], adr:mkt.nb[v].adr, occ:mkt.nb[v].occ }; }
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(proj => {
    setProjs(ps => {
      const next = [...ps, proj];
      setProjIdx(next.length-1);
      return next;
    });
    setChk(Array(CHECKLIST.length).fill(false));
    setShowModal(false);
    setSec("overview");
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garant:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        :root{
          --cream:#F7F4EF;--cream2:#F0EDE6;--cream3:#E8E4DC;
          --white:#FFFFFF;--ink:#1A1814;--ink2:#4A4640;--ink3:#8A8580;--ink4:#C0BCB6;
          --teal:#0B6E5A;--teal-l:#E8F3F0;--teal-m:#C5DDD8;
          --gold:#B8862E;--gold-l:#FAF3E6;--gold-m:#E8D4AA;
          --rose:#C04040;--rose-l:#FAE8E6;
          --sky:#2E5FA3;--sky-l:#E6EDF8;
          --border:#E2DED8;--border2:#D0CCC5;
          --sh:0 1px 3px rgba(26,24,20,.05),0 4px 12px rgba(26,24,20,.07);
          --sh-sm:0 1px 2px rgba(26,24,20,.04),0 2px 6px rgba(26,24,20,.05);
          --sh-lg:0 8px 24px rgba(26,24,20,.12),0 24px 60px rgba(26,24,20,.10);
          --r:14px;--r-sm:9px;--r-xs:6px;
          --sans:'DM Sans',sans-serif;
          --mono:'DM Mono',monospace;
          --serif:'Cormorant Garant',serif;
        }
        body{font-family:var(--sans);background:var(--cream);color:var(--ink);-webkit-font-smoothing:antialiased}
        input,select,button,textarea{font-family:var(--sans)}

        #layout{display:flex;height:100vh;overflow:hidden}
        #sidebar{width:240px;min-width:240px;background:var(--ink);display:flex;flex-direction:column;height:100vh;overflow-y:auto;flex-shrink:0;position:relative}
        #sidebar::before{content:'';position:absolute;inset:0;height:200px;background:radial-gradient(ellipse at 30% 0%,rgba(184,134,46,.12) 0%,transparent 70%);pointer-events:none;z-index:0}
        .sb-logo{padding:22px 20px 16px;border-bottom:1px solid rgba(255,255,255,.07);position:relative;z-index:1}
        .sb-brand{font-family:var(--serif);font-size:22px;font-weight:600;color:#fff;letter-spacing:-.5px}
        .sb-sub{font-size:9px;color:rgba(255,255,255,.28);letter-spacing:2.5px;text-transform:uppercase;margin-top:3px}
        .sb-region{margin:12px 12px 0;padding:9px 12px;background:rgba(255,255,255,.06);border-radius:8px;border:1px solid rgba(255,255,255,.08);position:relative;z-index:1}
        .sb-region-lbl{font-size:8.5px;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}
        .sb-region-val{font-size:12px;font-weight:600;color:rgba(255,255,255,.85)}
        .sb-lbl{padding:14px 20px 5px;font-size:8.5px;font-weight:700;color:rgba(255,255,255,.2);text-transform:uppercase;letter-spacing:1.8px;position:relative;z-index:1}
        .sb-projs{padding:3px 10px;position:relative;z-index:1}
        .sb-proj{padding:10px 12px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);margin-bottom:5px;cursor:pointer;transition:all .18s}
        .sb-proj:hover{background:rgba(255,255,255,.08)}
        .sb-proj.active{background:rgba(184,134,46,.12);border-color:rgba(184,134,46,.3)}
        .sb-proj-name{font-size:11.5px;font-weight:600;color:rgba(255,255,255,.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
        .sb-proj-loc{font-size:10px;color:rgba(255,255,255,.28);margin-bottom:4px}
        .sb-proj-cf{font-family:var(--mono);font-size:11px;font-weight:500}
        .sb-add{margin:3px 10px 10px;padding:9px 12px;border:1.5px dashed rgba(255,255,255,.12);border-radius:9px;text-align:center;font-size:12px;font-weight:600;color:rgba(255,255,255,.25);cursor:pointer;transition:all .2s;position:relative;z-index:1}
        .sb-add:hover{border-color:var(--gold);color:var(--gold)}
        .sb-hr{height:1px;background:rgba(255,255,255,.07);margin:8px 16px}
        .sb-nav{padding:2px 10px;position:relative;z-index:1}
        .sb-nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;font-size:12.5px;font-weight:500;color:rgba(255,255,255,.42);cursor:pointer;transition:all .14s;border-radius:8px;margin-bottom:1px;border-left:2px solid transparent}
        .sb-nav-item:hover{color:rgba(255,255,255,.78);background:rgba(255,255,255,.05)}
        .sb-nav-item.active{color:#fff;background:rgba(255,255,255,.08);border-left-color:var(--gold)}
        .sb-foot{margin-top:auto;padding:12px 20px;border-top:1px solid rgba(255,255,255,.06);font-size:9.5px;color:rgba(255,255,255,.15);position:relative;z-index:1}

        #main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden}
        #topbar{background:var(--white);border-bottom:1px solid var(--border);padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;box-shadow:var(--sh-sm)}
        .tb-left{display:flex;align-items:center;gap:16px}
        .tb-title{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--ink);letter-spacing:-.3px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .tb-sep{width:1px;height:18px;background:var(--border)}
        .tb-scen{display:flex;gap:3px;background:var(--cream2);padding:3px;border-radius:7px}
        .tb-sc{padding:5px 12px;border:none;background:transparent;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;color:var(--ink3);transition:all .15s;letter-spacing:.3px}
        .tb-sc.active{background:var(--white);color:var(--ink);box-shadow:var(--sh-sm)}
        .tb-right{display:flex;align-items:center;gap:8px}
        .tb-conf{display:flex;align-items:center;gap:6px;padding:5px 12px;background:var(--gold-l);border:1px solid var(--gold-m);border-radius:20px;font-size:11px;color:var(--gold);font-weight:600}
        .tb-dot{width:5px;height:5px;border-radius:50%;background:var(--gold)}
        .tb-btn{padding:7px 14px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border2);background:var(--white);color:var(--ink2);transition:all .15s}
        .tb-btn:hover{border-color:var(--teal);color:var(--teal)}
        .tb-btn-p{background:var(--teal);color:#fff;border-color:var(--teal)}
        .tb-btn-p:hover{background:#0a5f4d}

        #content{flex:1;overflow-y:auto;padding:24px 28px;display:flex;flex-direction:column;gap:16px}

        .alert{display:flex;align-items:flex-start;gap:10px;padding:11px 15px;border-radius:var(--r-sm);font-size:13px;font-weight:500;margin-bottom:4px}
        .alert-w{background:var(--rose-l);color:var(--rose);border:1px solid rgba(192,64,64,.2)}

        .kpi-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
        .kpi{background:var(--white);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px;box-shadow:var(--sh-sm);position:relative;overflow:hidden;transition:box-shadow .2s,transform .15s;cursor:default}
        .kpi:hover{box-shadow:var(--sh);transform:translateY(-1px)}
        .kpi-lbl{font-size:9.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
        .kpi-val{font-family:var(--mono);font-size:19px;font-weight:500;line-height:1;margin-bottom:4px}
        .kpi-sub{font-size:10.5px;color:var(--ink4);line-height:1.4}

        .card{background:var(--white);border:1px solid var(--border);border-radius:var(--r);padding:20px 22px;box-shadow:var(--sh-sm)}
        .c-hd{font-family:var(--serif);font-size:17px;font-weight:600;color:var(--ink);letter-spacing:-.2px;margin-bottom:3px}
        .c-sub{font-size:11px;color:var(--ink4);margin-bottom:16px}

        .g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .g-main{display:grid;grid-template-columns:1fr 310px;gap:16px}

        .roi-g{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);overflow:hidden;border-radius:var(--r-sm)}
        .roi-c{background:var(--white);padding:13px 15px;transition:background .15s}
        .roi-c:hover{background:var(--cream)}
        .roi-cl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--ink3);margin-bottom:4px}
        .roi-cv{font-family:var(--mono);font-size:15px;font-weight:500;margin-bottom:2px}
        .roi-cn{font-size:10.5px;color:var(--ink4)}

        .dt{width:100%;border-collapse:collapse;font-size:13px}
        .dt thead th{padding:9px 12px;font-size:9px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.8px;text-align:right;border-bottom:2px solid var(--border);background:var(--cream)}
        .dt thead th:first-child{text-align:left}
        .dt tbody td{padding:10px 12px;border-bottom:1px solid var(--cream3);text-align:right;font-family:var(--mono);font-size:12px;color:var(--ink2)}
        .dt tbody td:first-child{text-align:left;font-family:var(--sans);font-size:12.5px;color:var(--ink)}
        .dt tbody tr:hover td{background:var(--cream)}
        .dt tfoot td{padding:10px 12px;border-top:2px solid var(--border2);font-weight:700;font-family:var(--mono);font-size:13px;text-align:right;background:var(--cream2)}
        .dt tfoot td:first-child{text-align:left;font-family:var(--sans)}

        .sens-t{width:100%;border-collapse:collapse;font-size:12px}
        .sens-t th{padding:8px 7px;font-size:9px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.7px;text-align:center;background:var(--cream2);border:1px solid var(--border)}
        .sens-t td{padding:10px 7px;text-align:center;font-family:var(--mono);font-size:12px;font-weight:500;border:1px solid var(--border)}
        .s-pos{color:var(--teal);background:#eef7f4}.s-neg{color:var(--rose);background:#faf0f0}
        .s-base{outline:2.5px solid var(--teal);outline-offset:-2px;font-weight:700}
        .s-rh{font-family:var(--sans);font-size:11px;font-weight:600;color:var(--ink2);background:var(--cream2)}

        .proj-sc{max-height:280px;overflow-y:auto;border-radius:var(--r-sm);border:1px solid var(--border)}
        .pt{width:100%;border-collapse:collapse;font-size:12px}
        .pt thead th{position:sticky;top:0;z-index:1;background:var(--cream2);padding:8px 12px;font-size:9px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.7px;text-align:right;border-bottom:1px solid var(--border2)}
        .pt thead th:first-child{text-align:left}
        .pt td{padding:8px 12px;border-bottom:1px solid var(--cream3);font-family:var(--mono);font-size:11px;color:var(--ink2);text-align:right}
        .pt td:first-child{font-family:var(--sans);color:var(--ink3);text-align:left}
        .pt tr:hover td{background:var(--cream)}
        .vp{color:var(--teal)}.vn{color:var(--rose)}

        .fg{display:grid;grid-template-columns:1fr 1fr;gap:13px}
        .ff{display:flex;flex-direction:column;gap:5px}
        .fl{font-size:9.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.9px}
        .fi{background:var(--cream);border:1px solid var(--border2);border-radius:var(--r-xs);padding:8px 11px;color:var(--ink);font-size:13px;font-family:var(--mono);width:100%;outline:none;transition:border-color .2s,box-shadow .2s}
        .fi:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(11,110,90,.1);background:var(--white)}
        select.fi{font-family:var(--sans);font-size:12.5px}
        .fh{font-size:10px;color:var(--ink4);margin-top:1px}

        .pt-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:4px}
        .pt-card{border:1.5px solid var(--border);border-radius:var(--r-sm);padding:11px 6px;text-align:center;cursor:pointer;transition:all .18s;background:var(--cream)}
        .pt-card:hover{border-color:var(--teal-m);background:var(--teal-l)}
        .pt-card.sel{border-color:var(--teal);background:var(--teal-l)}
        .pt-icon{font-size:20px;display:block;margin-bottom:5px}
        .pt-name{font-size:10px;font-weight:600;color:var(--ink2)}

        .city-card{border:1.5px solid var(--border);border-radius:var(--r-sm);padding:11px;cursor:pointer;transition:all .18s;background:var(--cream)}
        .city-card:hover{border-color:var(--teal-m)}
        .city-card.sel{border-color:var(--teal);background:var(--teal-l)}
        .city-name{font-size:12px;font-weight:600;color:var(--ink)}
        .city-ctry{font-size:10px;color:var(--ink4)}

        .ms{background:var(--cream2);border-radius:var(--r-xs);padding:10px 13px;border:1px solid var(--cream3)}
        .ms-l{font-size:9px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.9px;margin-bottom:3px}
        .ms-v{font-family:var(--mono);font-size:13.5px;font-weight:500;color:var(--ink)}

        .cmp-t{width:100%;border-collapse:collapse;font-size:13px}
        .cmp-t th{padding:8px 12px;font-size:9px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.7px;text-align:right;border-bottom:2px solid var(--border);background:var(--cream)}
        .cmp-t th:first-child{text-align:left}
        .cmp-t td{padding:9px 12px;border-bottom:1px solid var(--cream3);text-align:right;font-family:var(--mono);font-size:12.5px}
        .cmp-t td:first-child{text-align:left;font-family:var(--sans);color:var(--ink)}

        .overlay{display:none;position:fixed;inset:0;background:rgba(26,24,20,.45);z-index:100;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
        .overlay.open{display:flex}
        .modal{background:var(--white);border-radius:18px;padding:30px;width:620px;max-width:96vw;max-height:92vh;overflow-y:auto;box-shadow:var(--sh-lg);position:relative}
        .modal-hd{font-family:var(--serif);font-size:24px;font-weight:600;color:var(--ink);margin-bottom:3px}
        .modal-sub{font-size:13px;color:var(--ink3);margin-bottom:22px}
        .modal-x{position:absolute;top:16px;right:20px;background:none;border:none;font-size:22px;color:var(--ink3);cursor:pointer;line-height:1;padding:2px 6px;border-radius:5px;transition:background .15s}
        .modal-x:hover{background:var(--cream2)}
        .sec-lbl{font-size:9px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1.3px;margin-bottom:9px}

        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
        @keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fu{animation:fu .25s ease forwards;display:flex;flex-direction:column;gap:16px}
      `}</style>

      <div id="layout">
        {/* SIDEBAR */}
        <aside id="sidebar">
          <div className="sb-logo">
            <div className="sb-brand">Yield</div>
            <div className="sb-sub">Costa del Sol · Investor</div>
          </div>

          <div className="sb-region">
            <div className="sb-region-lbl">Coverage</div>
            <div className="sb-region-val">🇪🇸 Marbella &amp; Málaga</div>
          </div>

          <div className="sb-lbl">Property</div>
          <div style={{ padding:"0 10px 10px", position:"relative", zIndex:1 }}>
            <div style={{ position:"relative" }}>
              <select
                value={projIdx}
                onChange={e => setProjIdx(Number(e.target.value))}
                style={{
                  width:"100%", padding:"10px 32px 10px 12px",
                  background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)",
                  borderRadius:9, color:"#fff", fontSize:12.5, fontWeight:600,
                  fontFamily:"var(--sans)", outline:"none", cursor:"pointer",
                  appearance:"none", WebkitAppearance:"none",
                }}
              >
                {projs.map((proj, i) => {
                  const pr = calc(proj);
                  return (
                    <option key={i} value={i} style={{ background:"#1A1814", color:"#fff" }}>
                      {MKT[proj.city]?.flag} {proj.name} — {fm(pr.cf)}/mo
                    </option>
                  );
                })}
              </select>
              <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:"rgba(255,255,255,.4)", fontSize:10 }}>▾</span>
            </div>
            {/* Active property quick stats */}
            {(() => {
              const pr = calc(projs[projIdx]);
              return (
                <div style={{ marginTop:8, padding:"9px 12px", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.07)", borderRadius:8 }}>
                  <div style={{ fontFamily:"var(--mono)", fontSize:11, fontWeight:600, color: pr.cf>=0?"var(--gold)":"#e06060", marginBottom:3 }}>
                    {fm(pr.cf)}/mo · CoC {fp(pr.coc)}
                  </div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,.28)" }}>
                    {projs[projIdx].nb} · {projs[projIdx].city}
                  </div>
                </div>
              );
            })()}
            <div className="sb-add" style={{ margin:"8px 0 0" }} onClick={()=>setShowModal(true)}>+ Add Property</div>
          </div>

          <div className="sb-hr" />
          <div className="sb-lbl">Analysis</div>
          <div className="sb-nav">
            {NAV.map(n => (
              <div key={n.id} className={`sb-nav-item${sec===n.id?" active":""}`} onClick={()=>setSec(n.id)}>
                <span style={{ width:16, textAlign:"center", fontSize:12 }}>{n.icon}</span>
                {n.label}
              </div>
            ))}
          </div>
          <div className="sb-foot">Yield v4.0 · Airbtics data · Mar 2025</div>
        </aside>

        {/* MAIN */}
        <div id="main">
          <div id="topbar">
            <div className="tb-left">
              <span className="tb-title">{p.name}</span>
              <div className="tb-sep" />
              <div className="tb-scen">
                {["conservative","base","optimistic"].map(s => (
                  <button key={s} className={`tb-sc${scen===s?" active":""}`} onClick={()=>setScen(s)}>
                    {s.charAt(0).toUpperCase()+s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="tb-right">
              <div className="tb-conf"><span className="tb-dot" />Airbtics · {MKT[p.city]?.airbtics?.sampleSize ? `${MKT[p.city].airbtics.sampleSize} props` : "Regional"}</div>
              <button className="tb-btn" onClick={()=>setSec("intel")}>Market Data</button>
              <button className="tb-btn tb-btn-p" onClick={()=>setSec("verdict")}>Generate Verdict</button>
            </div>
          </div>

          <div id="content">
            {sec==="overview"    && <Overview    p={p} r={r} scen={scen} />}
            {sec==="intel"       && <MarketIntel city={p.city} />}
            {sec==="costs"       && <Costs       p={p} r={r} />}
            {sec==="sensitivity" && <Sensitivity p={p} />}
            {sec==="projection"  && <Projection  p={p} />}
            {sec==="assumptions" && <Assumptions p={p} idx={projIdx} onUpdate={handleUpdate} />}
            {sec==="verdict"     && <Verdict     p={p} r={r} scen={scen} />}
            {sec==="checklist"   && <Checklist   chk={chk} onToggle={i=>setChk(c=>c.map((v,j)=>j===i?!v:v))} />}
          </div>
        </div>
      </div>

      {showModal && <Modal onClose={()=>setShowModal(false)} onCreate={handleCreate} />}
    </>
  );
}
