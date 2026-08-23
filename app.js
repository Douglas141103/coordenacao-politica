/* global Chart */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const configured = cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes("__SUPABASE");
  const db = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    session: null, profile: null, candidates: [], dashboard: [], leaders: [], checks: [],
    links: [], supporters: [], movements: [], charts: {}
  };

  const candidateByNumber = number => state.candidates.find(c => c.numero === String(number));
  const labelOffice = office => office === "deputado_estadual" ? "Deputado estadual" : "Deputado federal";
  const capitalize = text => String(text || "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  const fmtDate = value => value ? new Intl.DateTimeFormat("pt-BR", {timeZone: "UTC"}).format(new Date(`${value}T12:00:00Z`)) : "—";

  function toast(message, error = false) {
    const el = $("#toast");
    el.textContent = message;
    el.className = `toast show${error ? " error" : ""}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.className = "toast", 3300);
  }

  function setBusy(busy) {
    $("#sync-status").textContent = busy ? "○ Atualizando..." : "● Sincronizado";
    $("#refresh-btn").disabled = busy;
  }

  function showAuth() {
    $("#auth-view").hidden = false;
    $("#app-view").hidden = true;
  }

  function showApp() {
    $("#auth-view").hidden = true;
    $("#app-view").hidden = false;
  }

  function showSection(name) {
    $$(".page-section").forEach(el => el.classList.toggle("active", el.id === `section-${name}`));
    $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.section === name));
    const titles = {painel:"Painel geral", sublideres:"Sublíderes", apoiadores:"Apoiadores", movimentacoes:"Movimentações", relatorios:"Relatórios e checagens"};
    $("#page-title").textContent = titles[name];
    $(".sidebar").classList.remove("open");
  }

  async function loadProfile() {
    const { data } = await db.from("perfis").select("*").eq("id", state.session.user.id).maybeSingle();
    state.profile = data;
    $("#user-name").textContent = data?.nome || state.session.user.email;
    $("#user-role").textContent = data ? capitalize(data.funcao) : "Acesso pendente";
  }

  async function loadAll() {
    setBusy(true);
    try {
      const [dashboard, candidates, leaders, checks, links, supporters, movements] = await Promise.all([
        db.from("v_painel_candidatos").select("*").order("cargo").order("nome"),
        db.from("candidatos").select("*").eq("ativo", true).order("nome"),
        db.from("sublideres").select("*").eq("ativo", true).order("nome"),
        db.from("v_checagem_sublideres").select("*").order("nome"),
        db.from("vinculos_sublider").select("*, candidatos(nome,numero,cargo)").eq("status", "ativo"),
        db.from("apoiadores").select("*, sublideres(nome), preferencias_apoio(*, candidatos(nome,numero,cargo))").neq("status_contato", "inativo").order("nome"),
        db.from("movimentacoes").select("*, sublideres(nome), candidatos(nome,numero)").order("data_movimentacao", {ascending:false}).limit(300)
      ]);
      const failed = [dashboard,candidates,leaders,checks,links,supporters,movements].find(r => r.error);
      if (failed) throw failed.error;
      Object.assign(state, {dashboard:dashboard.data, candidates:candidates.data, leaders:leaders.data, checks:checks.data, links:links.data, supporters:supporters.data, movements:movements.data});
      renderAll();
    } catch (error) {
      console.error(error);
      toast(error.message || "Não foi possível carregar os dados.", true);
    } finally { setBusy(false); }
  }

  function renderAll() {
    renderCandidates(); renderCharts(); renderChecks(); renderRecent(); renderLeaders();
    renderSupporters(); renderMovements(); renderReports(); fillSelects();
  }

  function renderCandidates() {
    $("#candidate-cards").innerHTML = state.dashboard.map(c => {
      const pct = c.meta_sublideres ? Math.min(100, Math.round(c.sublideres_ativos / c.meta_sublideres * 100)) : 0;
      return `<article class="candidate-card ${c.cargo === "deputado_federal" ? "federal" : "estadual"}">
        <div class="candidate-office">${labelOffice(c.cargo)}</div><h3>${esc(c.nome)}</h3><div class="candidate-number">${esc(c.numero)}</div>
        <div class="metrics-row"><div class="metric"><strong>${c.sublideres_ativos}/${c.meta_sublideres}</strong><span>Sublíderes</span></div><div class="metric"><strong>${c.apoios_confirmados}</strong><span>Apoios confirmados</span></div></div>
        <div class="progress"><span style="width:${pct}%"></span></div><div class="progress-label"><span>Progresso dos sublíderes</span><b>${pct}%</b></div>
        <div class="progress-label"><span>Meta por sublíder</span><b>${c.meta_apoios_min} a ${c.meta_apoios_max} apoios</b></div>
      </article>`;
    }).join("");
  }

  function renderCharts() {
    Object.values(state.charts).forEach(chart => chart.destroy());
    const names = state.dashboard.map(c => c.nome.split(" ")[0]);
    state.charts.leaders = new Chart($("#leaders-chart"), {type:"bar", data:{labels:names,datasets:[{label:"Cadastrados",data:state.dashboard.map(c=>c.sublideres_ativos),backgroundColor:"#2d7a66",borderRadius:8},{label:"Meta",data:state.dashboard.map(c=>c.meta_sublideres),backgroundColor:"#dfa52d",borderRadius:8}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});
    const totals = state.dashboard.reduce((a,c)=>({confirmado:a.confirmado+c.apoios_confirmados,provavel:a.provavel+c.apoios_provaveis,indeciso:a.indeciso+c.apoios_indecisos}),{confirmado:0,provavel:0,indeciso:0});
    state.charts.support = new Chart($("#support-chart"), {type:"doughnut",data:{labels:["Confirmados","Prováveis","Indecisos"],datasets:[{data:[totals.confirmado,totals.provavel,totals.indeciso],backgroundColor:["#2d7a66","#dfa52d","#b9c8c3"],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{position:"bottom"}}}});
  }

  function renderChecks() {
    const pending = state.checks.filter(c => c.checagem !== "OK");
    $("#checks-summary").innerHTML = pending.length ? pending.slice(0,5).map(c => `<div class="check-item"><span class="status-dot warning"></span><div><strong>${esc(c.nome)}</strong><div class="muted">${esc(c.checagem)}</div></div></div>`).join("") : `<div class="check-item"><span class="status-dot"></span><div><strong>Todos os vínculos estão corretos</strong><div class="muted">Nenhuma incompatibilidade encontrada.</div></div></div>`;
  }

  function renderRecent() {
    $("#recent-movements").innerHTML = state.movements.length ? state.movements.slice(0,5).map(m => `<div class="activity-item"><span class="status-dot ${m.status === "planejada" ? "warning" : ""}"></span><div><strong>${esc(capitalize(m.tipo))} · ${fmtDate(m.data_movimentacao)}</strong><div class="muted">${esc(m.descricao)}${m.sublideres?.nome ? ` — ${esc(m.sublideres.nome)}` : ""}</div></div></div>`).join("") : `<div class="empty">Nenhuma movimentação cadastrada.</div>`;
  }

  function leaderLinks(id) { return state.links.filter(v => v.sublider_id === id).map(v => v.candidatos).filter(Boolean); }

  function renderLeaders() {
    const term = $("#leader-search").value.toLowerCase(); const filter = $("#leader-filter").value;
    const rows = state.leaders.filter(s => {
      const check = state.checks.find(c=>c.id===s.id); const links = leaderLinks(s.id);
      const text = `${s.nome} ${s.bairro||""} ${s.telefone||""}`.toLowerCase();
      return text.includes(term) && (!filter || (filter === "pendente" ? check?.checagem !== "OK" : links.some(c=>c.nome===filter)));
    });
    $("#leaders-table").innerHTML = rows.length ? rows.map(s => {
      const check=state.checks.find(c=>c.id===s.id); const links=leaderLinks(s.id); const jender=links.some(c=>c.numero==="36123"); const federal=links.find(c=>c.cargo==="deputado_federal");
      return `<tr><td><strong>${esc(s.nome)}</strong><br><span class="muted">${esc(s.telefone||"Sem telefone")}</span></td><td>${esc(s.bairro||"—")}</td><td>${jender?'<span class="badge">Sim</span>':'—'}</td><td>${federal?`<span class="badge gold">${esc(federal.nome)} · ${esc(federal.numero)}</span>`:'—'}</td><td>${check?.apoiadores_cadastrados||0}</td><td><span class="badge ${check?.checagem === "OK" ? "" : "warning"}">${esc(check?.checagem||"Pendente")}</span></td><td><button class="table-action" data-delete-leader="${s.id}">Excluir</button></td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty">Nenhum sublíder encontrado.</td></tr>`;
  }

  function renderSupporters() {
    const term=$("#supporter-search").value.toLowerCase(); const leader=$("#supporter-leader-filter").value;
    const rows=state.supporters.filter(a=>`${a.nome} ${a.bairro||""}`.toLowerCase().includes(term)&&(!leader||a.sublider_id===leader));
    $("#supporters-table").innerHTML=rows.length?rows.map(a=>{const prefs=a.preferencias_apoio||[];return `<tr><td><strong>${esc(a.nome)}</strong><br><span class="muted">${esc(a.telefone||"Sem telefone")}</span></td><td>${esc(a.sublideres?.nome||"—")}</td><td>${esc(a.bairro||"—")}</td><td>${prefs.length?prefs.map(p=>`<span class="badge ${p.candidatos?.cargo==="deputado_federal"?"gold":""}">${esc(p.candidatos?.nome||"")}</span>`).join(""):"—"}</td><td><span class="badge ${prefs.some(p=>p.situacao==="indeciso")?"warning":""}">${esc(capitalize(prefs[0]?.situacao||a.status_contato))}</span></td><td><button class="table-action" data-delete-supporter="${a.id}">Excluir</button></td></tr>`;}).join(""):`<tr><td colspan="6" class="empty">Nenhum apoiador encontrado.</td></tr>`;
  }

  function renderMovements() {
    const term=$("#movement-search").value.toLowerCase(); const status=$("#movement-status-filter").value;
    const rows=state.movements.filter(m=>`${m.descricao} ${m.local||""}`.toLowerCase().includes(term)&&(!status||m.status===status));
    $("#movements-table").innerHTML=rows.length?rows.map(m=>`<tr><td>${fmtDate(m.data_movimentacao)}</td><td>${esc(capitalize(m.tipo))}</td><td>${esc(m.sublideres?.nome||"—")}</td><td>${esc(m.candidatos?.nome||"Coordenação")}</td><td><strong>${esc(m.descricao)}</strong><br><span class="muted">${esc(m.local||"")}</span></td><td><span class="badge ${m.status==="planejada"?"warning":m.status==="cancelada"?"danger":""}">${esc(capitalize(m.status))}</span></td><td><button class="table-action" data-delete-movement="${m.id}">Excluir</button></td></tr>`).join(""):`<tr><td colspan="7" class="empty">Nenhuma movimentação encontrada.</td></tr>`;
  }

  function renderReports() {
    const pending=state.checks.filter(c=>c.checagem!=="OK").length; const confirmed=state.dashboard.reduce((n,c)=>n+c.apoios_confirmados,0); const planned=state.movements.filter(m=>m.status==="planejada").length;
    $("#report-kpis").innerHTML=`<div class="kpi"><strong>${state.leaders.length}</strong><span>Sublíderes ativos</span></div><div class="kpi"><strong>${state.supporters.length}</strong><span>Apoiadores cadastrados</span></div><div class="kpi"><strong>${confirmed}</strong><span>Apoios confirmados</span></div><div class="kpi"><strong>${pending+planned}</strong><span>Pendências e ações planejadas</span></div>`;
    $("#checks-table").innerHTML=state.checks.length?state.checks.map(c=>`<tr><td><strong>${esc(c.nome)}</strong><br><span class="muted">${esc(c.bairro||"")}</span></td><td>${c.trabalha_jender?'<span class="badge">Sim</span>':'Não'}</td><td>${c.candidato_federal?`<span class="badge gold">${esc(c.candidato_federal)}</span>`:'—'}</td><td>${c.apoiadores_cadastrados}</td><td><span class="badge ${c.checagem==="OK"?"":"warning"}">${esc(c.checagem)}</span></td></tr>`).join(""):`<tr><td colspan="5" class="empty">Cadastre os sublíderes para iniciar as checagens.</td></tr>`;
  }

  function fillSelects() {
    const leaders=`<option value="">Selecione</option>${state.leaders.map(s=>`<option value="${s.id}">${esc(s.nome)}</option>`).join("")}`;
    $("#supporter-leader").innerHTML=leaders; $("#movement-leader").innerHTML=`<option value="">Sem sublíder</option>${leaders.replace('<option value="">Selecione</option>',"")}`;
    $("#supporter-leader-filter").innerHTML=`<option value="">Todos os sublíderes</option>${state.leaders.map(s=>`<option value="${s.id}">${esc(s.nome)}</option>`).join("")}`;
    $("#movement-candidate").innerHTML=`<option value="">Todos / coordenação</option>${state.candidates.map(c=>`<option value="${c.id}">${esc(c.nome)} · ${esc(c.numero)}</option>`).join("")}`;
  }

  async function createLeader(form) {
    const data=Object.fromEntries(new FormData(form)); const jender=form.elements.jender.checked; const federal=data.federal;
    if(jender&&!federal) throw new Error("Quem trabalha para Jender também deve escolher um deputado federal.");
    if(!jender&&!federal) throw new Error("Escolha pelo menos um candidato.");
    const {data:leader,error}=await db.from("sublideres").insert({nome:data.nome,telefone:data.telefone||null,bairro:data.bairro||null,zona_eleitoral:data.zona_eleitoral||null,secao_eleitoral:data.secao_eleitoral||null,observacoes:data.observacoes||null}).select().single();
    if(error) throw error;
    const candidateIds=[]; if(jender) candidateIds.push(candidateByNumber("36123")?.id); if(federal) candidateIds.push(candidateByNumber(federal)?.id);
    const {error:linkError}=await db.from("vinculos_sublider").insert(candidateIds.filter(Boolean).map(candidato_id=>({sublider_id:leader.id,candidato_id})));
    if(linkError){await db.from("sublideres").delete().eq("id",leader.id);throw linkError;}
  }

  async function createSupporter(form) {
    const data=Object.fromEntries(new FormData(form)); const jender=form.elements.jender.checked; const federal=data.federal;
    if(!jender&&!federal) throw new Error("Escolha pelo menos um candidato para o apoiador.");
    const {data:supporter,error}=await db.from("apoiadores").insert({nome:data.nome,sublider_id:data.sublider_id,telefone:data.telefone||null,bairro:data.bairro||null,observacoes:data.observacoes||null,status_contato:"contatado"}).select().single(); if(error) throw error;
    const ids=[];if(jender)ids.push(candidateByNumber("36123")?.id);if(federal)ids.push(candidateByNumber(federal)?.id);
    const {error:prefError}=await db.from("preferencias_apoio").insert(ids.filter(Boolean).map(candidato_id=>({apoiador_id:supporter.id,candidato_id,situacao:data.situacao})));
    if(prefError){await db.from("apoiadores").delete().eq("id",supporter.id);throw prefError;}
  }

  async function createMovement(form) {
    const d=Object.fromEntries(new FormData(form)); const payload={...d,quantidade:Number(d.quantidade||0),sublider_id:d.sublider_id||null,candidato_id:d.candidato_id||null,local:d.local||null}; const {error}=await db.from("movimentacoes").insert(payload); if(error)throw error;
  }

  async function handleForm(form, creator, dialog) {
    const button=$("button[type=submit]",form);button.disabled=true;
    try{await creator(form);form.reset();dialog.close();toast("Cadastro salvo com sucesso.");await loadAll();}catch(error){console.error(error);toast(error.message||"Não foi possível salvar.",true);}finally{button.disabled=false;}
  }

  async function remove(table,id,label) {
    if(!window.confirm(`Excluir ${label}? Esta ação não poderá ser desfeita.`))return;
    const {error}=await db.from(table).delete().eq("id",id); if(error)return toast(error.message,true); toast("Registro excluído."); await loadAll();
  }

  function exportCsv() {
    const header=["Sublíder","Telefone","Bairro","Trabalha com Jender","Deputado federal","Apoiadores","Checagem"];
    const rows=state.checks.map(c=>[c.nome,c.telefone||"",c.bairro||"",c.trabalha_jender?"Sim":"Não",c.candidato_federal||"",c.apoiadores_cadastrados,c.checagem]);
    const csv=[header,...rows].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`relatorio-coordenacao-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
  }

  function bindEvents() {
    $$(".nav-item").forEach(b=>b.addEventListener("click",()=>showSection(b.dataset.section)));
    $$('[data-go]').forEach(b=>b.addEventListener("click",()=>showSection(b.dataset.go)));
    $("#menu-btn").addEventListener("click",()=>$(".sidebar").classList.toggle("open"));
    $("#refresh-btn").addEventListener("click",loadAll); $("#logout-btn").addEventListener("click",()=>db.auth.signOut());
    $$('[data-open]').forEach(b=>b.addEventListener("click",()=>{const d=$(`#${b.dataset.open}`);if(b.dataset.open==="movement-dialog")d.querySelector('[name=data_movimentacao]').value=new Date().toISOString().slice(0,10);d.showModal();}));
    $$(".close-dialog").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));
    $("#leader-form").addEventListener("submit",e=>{e.preventDefault();handleForm(e.currentTarget,createLeader,$("#leader-dialog"));});
    $("#supporter-form").addEventListener("submit",e=>{e.preventDefault();handleForm(e.currentTarget,createSupporter,$("#supporter-dialog"));});
    $("#movement-form").addEventListener("submit",e=>{e.preventDefault();handleForm(e.currentTarget,createMovement,$("#movement-dialog"));});
    [["#leader-search",renderLeaders],["#leader-filter",renderLeaders],["#supporter-search",renderSupporters],["#supporter-leader-filter",renderSupporters],["#movement-search",renderMovements],["#movement-status-filter",renderMovements]].forEach(([s,fn])=>$(s).addEventListener("input",fn));
    document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.deleteLeader)remove("sublideres",b.dataset.deleteLeader,"este sublíder e seus vínculos");if(b.dataset.deleteSupporter)remove("apoiadores",b.dataset.deleteSupporter,"este apoiador");if(b.dataset.deleteMovement)remove("movimentacoes",b.dataset.deleteMovement,"esta movimentação");});
    $("#export-btn").addEventListener("click",exportCsv); $("#print-btn").addEventListener("click",()=>window.print());
  }

  function bindAuth() {
    let signup=false;
    $("#toggle-auth").addEventListener("click",()=>{signup=!signup;$("#auth-name").hidden=!signup;$("#auth-name").required=signup;$("#auth-title").textContent=signup?"Criar primeiro acesso":"Entrar no painel";$("#auth-submit").textContent=signup?"Criar conta":"Entrar";$("#toggle-auth").textContent=signup?"Já tenho conta":"Primeiro acesso? Criar conta";});
    $("#auth-form").addEventListener("submit",async e=>{e.preventDefault();if(!db)return toast("A conexão com o Supabase ainda não foi configurada.",true);const email=$("#auth-email").value.trim();const password=$("#auth-password").value;const name=$("#auth-name").value.trim();const button=$("#auth-submit");button.disabled=true;try{const result=signup?await db.auth.signUp({email,password,options:{data:{full_name:name}}}):await db.auth.signInWithPassword({email,password});if(result.error)throw result.error;if(signup&&!result.data.session)toast("Conta criada. Confirme o e-mail e depois faça o login.");}catch(error){toast(error.message||"Falha no acesso.",true);}finally{button.disabled=false;}});
  }

  async function boot() {
    bindAuth(); bindEvents();
    if(!configured){showAuth();toast("Falta adicionar a chave pública do Supabase em config.js.",true);return;}
    const {data:{session}}=await db.auth.getSession();state.session=session;
    if(session){showApp();await loadProfile();await loadAll();}else showAuth();
    db.auth.onAuthStateChange(async(_event,session)=>{state.session=session;if(session){showApp();await loadProfile();await loadAll();}else showAuth();});
  }

  document.addEventListener("DOMContentLoaded",boot);
})();
