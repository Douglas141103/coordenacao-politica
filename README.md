# Coordenação Política

Aplicativo web responsivo para acompanhar candidatos, sublíderes, apoiadores e movimentações da coordenação política.

## Regras configuradas

- Jender Lobato — deputado estadual 36123: 6 sublíderes, meta de 30 a 50 apoios por sublíder.
- Dalmir Salazar — deputado federal 7012: 10 sublíderes, meta de 40 a 50 apoios por sublíder.
- Pauderney Avelino — deputado federal 5522: 20 sublíderes, meta de 20 a 30 apoios por sublíder.
- Quem trabalha para Jender precisa ser vinculado a um deputado federal.
- Um sublíder ou apoiador nunca pode ser vinculado aos dois deputados federais.

## Segurança

- Login pelo Supabase Auth.
- O primeiro usuário cadastrado torna-se proprietário.
- Usuários posteriores ficam inativos até autorização do proprietário.
- Row Level Security ativado em todas as tabelas.
- Visitantes anônimos não acessam os dados.
- A senha do banco e a `service_role` nunca devem ser publicadas.

O arquivo `config.js` utiliza somente a chave **Publishable/anon**, que é própria para aplicações web e continua limitada pelas regras de RLS.

## Publicação

O projeto é estático e pode ser publicado diretamente pelo GitHub Pages. O banco e a autenticação são fornecidos pelo Supabase.
