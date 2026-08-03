# AdsPilot Analytics V2 — instalação

## O que a V2 entrega

- Login com Supabase Auth e renovação automática da sessão.
- APIs protegidas no Railway; a Service Role nunca vai para o navegador.
- Dashboard com dados reais, períodos, contas, status, pesquisa e moeda.
- Receita atribuída, custo, lucro, ROI, margem, CPA e RPC.
- Detalhes diários, termos, segmentos, alterações e notas manuais.
- Comissão, tipo, início e limite do teste configuráveis por campanha.
- Atualização visual automática a cada cinco minutos.

## 1. Executar a migração

No **Supabase → SQL Editor**, execute todo o arquivo:

```text
supabase/migrations/003_dashboard_v2.sql
```

As migrações `001` e `002` devem continuar instaladas.

## 2. Criar ou conferir o usuário

1. Abra **Supabase → Authentication → Users**.
2. Clique em **Add user → Create new user**.
3. Informe seu e-mail e uma senha forte.
4. Marque o usuário como confirmado, se essa opção aparecer.
5. Copie o UUID do usuário.

No Railway, `APP_USER_ID` deve ser exatamente esse UUID. Se o usuário já existe
e o UUID já está configurado, não crie outro.

## 3. Obter a chave pública

No Supabase, abra **Project Settings → API Keys**. Copie a chave pública
`anon`/`publishable`. Não use a `service_role` neste campo.

Adicione no Railway:

```text
SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
```

A chave pública pode ser entregue ao navegador; o acesso aos dados continua
protegido pelo login, RLS e pela validação do servidor. A
`SUPABASE_SERVICE_ROLE_KEY` deve permanecer somente no Railway.

## 4. Publicar

Substitua os arquivos do projeto pelo pacote V2 e execute:

```bash
npm install
npm run build
git add .
git commit -m "Atualiza AdsPilot para V2"
git push
```

## 5. Conferir o deploy

Abra:

```text
https://adsanalytics.up.railway.app/api/health
```

Esperado:

```json
{"status":"ok","app":"AdsPilot Analytics","version":"2.0.0","mode":"configured"}
```

Depois abra:

```text
https://adsanalytics.up.railway.app/api/config/status
```

Em `supabase`, `url`, `anonKey`, `serviceRoleKey` e `appUserId` devem estar
como `true`.

## 6. Entrar

Abra o domínio principal e use o e-mail e a senha do usuário do Supabase Auth.
O dashboard deve mostrar as campanhas já carregadas pelos scripts.

## Segurança

- Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` no código React.
- Nunca envie prints contendo chaves ou senhas.
- `SUPABASE_ANON_KEY` é pública; `SUPABASE_SERVICE_ROLE_KEY` é secreta.
- Somente o UUID definido em `APP_USER_ID` é aceito pela API V2.

## Escopo posterior

Tracker de plataformas, receita confirmada, reembolsos e análise por IA não
fazem parte da V2.0. O dashboard usa a receita atribuída enviada ao Google Ads.

