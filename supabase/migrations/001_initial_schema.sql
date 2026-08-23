create extension if not exists pgcrypto;

create table public.campanhas (
  id uuid primary key default gen_random_uuid(), nome text not null, ano integer not null unique,
  status text not null default 'ativa' check (status in ('planejamento','ativa','encerrada')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.candidatos (
  id uuid primary key default gen_random_uuid(), campanha_id uuid not null references public.campanhas(id) on delete cascade,
  nome text not null, cargo text not null check (cargo in ('deputado_estadual','deputado_federal')), numero text not null,
  meta_sublideres integer not null default 0 check (meta_sublideres>=0), meta_apoios_min integer not null default 0 check (meta_apoios_min>=0),
  meta_apoios_max integer not null default 0 check (meta_apoios_max>=meta_apoios_min), ativo boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(campanha_id,numero)
);
create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade, email text, nome text,
  funcao text not null default 'visualizador' check (funcao in ('proprietario','coordenador','visualizador')),
  ativo boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sublideres (
  id uuid primary key default gen_random_uuid(), nome text not null, telefone text, bairro text, zona_eleitoral text, secao_eleitoral text,
  observacoes text, ativo boolean not null default true, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.vinculos_sublider (
  id uuid primary key default gen_random_uuid(), sublider_id uuid not null references public.sublideres(id) on delete cascade,
  candidato_id uuid not null references public.candidatos(id) on delete cascade, meta_minima integer check(meta_minima>=0),
  meta_maxima integer check(meta_maxima>=meta_minima), status text not null default 'ativo' check(status in ('ativo','pausado','encerrado')),
  created_at timestamptz not null default now(), unique(sublider_id,candidato_id)
);
create table public.apoiadores (
  id uuid primary key default gen_random_uuid(), sublider_id uuid not null references public.sublideres(id) on delete cascade,
  nome text not null, telefone text, bairro text, zona_eleitoral text, secao_eleitoral text,
  status_contato text not null default 'em_contato' check(status_contato in ('em_contato','contatado','confirmado','inativo')),
  observacoes text, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.preferencias_apoio (
  id uuid primary key default gen_random_uuid(), apoiador_id uuid not null references public.apoiadores(id) on delete cascade,
  candidato_id uuid not null references public.candidatos(id) on delete cascade,
  situacao text not null default 'provavel' check(situacao in ('confirmado','provavel','indeciso','recusado')),
  updated_at timestamptz not null default now(), unique(apoiador_id,candidato_id)
);
create table public.movimentacoes (
  id uuid primary key default gen_random_uuid(), sublider_id uuid references public.sublideres(id) on delete set null,
  candidato_id uuid references public.candidatos(id) on delete set null,
  tipo text not null check(tipo in ('visita','reuniao','ligacao','evento','cadastro','outra')),
  data_movimentacao date not null default current_date, quantidade integer not null default 0 check(quantidade>=0),
  local text, descricao text not null, status text not null default 'realizada' check(status in ('planejada','realizada','cancelada')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create or replace function public.atualizar_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
do $$ declare t text; begin foreach t in array array['campanhas','candidatos','perfis','sublideres','apoiadores','preferencias_apoio','movimentacoes'] loop execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.atualizar_updated_at()',t,t); end loop; end $$;

create or replace function public.preencher_meta_vinculo() returns trigger language plpgsql set search_path=public as $$
begin if new.meta_minima is null or new.meta_maxima is null then select coalesce(new.meta_minima,c.meta_apoios_min),coalesce(new.meta_maxima,c.meta_apoios_max) into new.meta_minima,new.meta_maxima from public.candidatos c where c.id=new.candidato_id; end if; return new; end; $$;
create trigger preencher_meta_vinculo before insert or update of candidato_id on public.vinculos_sublider for each row execute function public.preencher_meta_vinculo();

create or replace function public.validar_um_federal_por_sublider() returns trigger language plpgsql set search_path=public as $$
declare v_cargo text; begin select cargo into v_cargo from public.candidatos where id=new.candidato_id;
if v_cargo='deputado_federal' and exists(select 1 from public.vinculos_sublider v join public.candidatos c on c.id=v.candidato_id where v.sublider_id=new.sublider_id and c.cargo='deputado_federal' and v.id<>new.id) then raise exception 'Cada sublider pode trabalhar para apenas um candidato a deputado federal.'; end if; return new; end; $$;
create trigger validar_um_federal_por_sublider before insert or update on public.vinculos_sublider for each row execute function public.validar_um_federal_por_sublider();

create or replace function public.validar_um_federal_por_apoiador() returns trigger language plpgsql set search_path=public as $$
declare v_cargo text; begin select cargo into v_cargo from public.candidatos where id=new.candidato_id;
if v_cargo='deputado_federal' and exists(select 1 from public.preferencias_apoio p join public.candidatos c on c.id=p.candidato_id where p.apoiador_id=new.apoiador_id and c.cargo='deputado_federal' and p.id<>new.id) then raise exception 'Cada apoiador pode apoiar apenas um candidato a deputado federal.'; end if; return new; end; $$;
create trigger validar_um_federal_por_apoiador before insert or update on public.preferencias_apoio for each row execute function public.validar_um_federal_por_apoiador();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare primeiro_usuario boolean; begin select not exists(select 1 from public.perfis where ativo) into primeiro_usuario;
insert into public.perfis(id,email,nome,funcao,ativo) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,''),'@',1)),case when primeiro_usuario then 'proprietario' else 'visualizador' end,primeiro_usuario) on conflict(id) do nothing; return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create or replace function public.usuario_ativo() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.perfis p where p.id=auth.uid() and p.ativo); $$;
create or replace function public.usuario_coordenador() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.perfis p where p.id=auth.uid() and p.ativo and p.funcao in ('proprietario','coordenador')); $$;

alter table public.campanhas enable row level security; alter table public.candidatos enable row level security; alter table public.perfis enable row level security;
alter table public.sublideres enable row level security; alter table public.vinculos_sublider enable row level security; alter table public.apoiadores enable row level security;
alter table public.preferencias_apoio enable row level security; alter table public.movimentacoes enable row level security;
do $$ declare t text; begin foreach t in array array['campanhas','candidatos','sublideres','vinculos_sublider','apoiadores','preferencias_apoio','movimentacoes'] loop execute format('create policy acesso_leitura on public.%I for select to authenticated using(public.usuario_ativo())',t); execute format('create policy acesso_gestao on public.%I for all to authenticated using(public.usuario_coordenador()) with check(public.usuario_coordenador())',t); end loop; end $$;
create policy perfis_leitura on public.perfis for select to authenticated using(public.usuario_ativo());
create policy perfis_gestao on public.perfis for all to authenticated using(public.usuario_coordenador()) with check(public.usuario_coordenador());
revoke all on all tables in schema public from anon; revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated; grant usage,select on all sequences in schema public to authenticated;

insert into public.campanhas(nome,ano,status) values('Eleições 2026',2026,'ativa');
insert into public.candidatos(campanha_id,nome,cargo,numero,meta_sublideres,meta_apoios_min,meta_apoios_max)
select c.id,x.nome,x.cargo,x.numero,x.meta_sublideres,x.meta_min,x.meta_max from public.campanhas c cross join (values
('Jender Lobato','deputado_estadual','36123',6,30,50),('Dalmir Salazar','deputado_federal','7012',10,40,50),('Pauderney Avelino','deputado_federal','5522',20,20,30)) as x(nome,cargo,numero,meta_sublideres,meta_min,meta_max) where c.ano=2026;

create view public.v_painel_candidatos with(security_invoker=true) as select c.id,c.nome,c.cargo,c.numero,c.meta_sublideres,c.meta_apoios_min,c.meta_apoios_max,count(distinct v.sublider_id) filter(where v.status='ativo')::int sublideres_ativos,count(distinct p.apoiador_id) filter(where p.situacao='confirmado')::int apoios_confirmados,count(distinct p.apoiador_id) filter(where p.situacao='provavel')::int apoios_provaveis,count(distinct p.apoiador_id) filter(where p.situacao='indeciso')::int apoios_indecisos,count(distinct m.id) filter(where m.status='realizada')::int movimentacoes_realizadas from public.candidatos c left join public.vinculos_sublider v on v.candidato_id=c.id left join public.preferencias_apoio p on p.candidato_id=c.id left join public.movimentacoes m on m.candidato_id=c.id where c.ativo group by c.id;
create view public.v_checagem_sublideres with(security_invoker=true) as select s.id,s.nome,s.telefone,s.bairro,coalesce(bool_or(c.cargo='deputado_estadual'),false) trabalha_jender,max(c.nome) filter(where c.cargo='deputado_federal') candidato_federal,case when count(v.id)=0 then 'PENDENTE: sem candidato' when bool_or(c.cargo='deputado_estadual') and max(c.nome) filter(where c.cargo='deputado_federal') is null then 'PENDENTE: vincular a um deputado federal' else 'OK' end checagem,count(distinct a.id)::int apoiadores_cadastrados from public.sublideres s left join public.vinculos_sublider v on v.sublider_id=s.id and v.status='ativo' left join public.candidatos c on c.id=v.candidato_id left join public.apoiadores a on a.sublider_id=s.id where s.ativo group by s.id;
grant select on public.v_painel_candidatos,public.v_checagem_sublideres to authenticated;
