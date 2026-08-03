# Instalação do AdsPilot V1.2

A V1.2 recebe dados de um Google Ads Script enquanto o developer token ainda
possui acesso de teste. O script é somente leitura.

## 1. Atualizar o Supabase

1. Abra o Supabase.
2. Entre em **SQL Editor** e crie uma nova consulta.
3. Cole todo o conteúdo de `supabase/migrations/002_google_ads_scripts.sql`.
4. Clique em **Run**.

A migração pode ser executada novamente sem duplicar tabelas ou colunas.

## 2. Criar a chave do webhook

No Terminal do Mac, execute:

```bash
openssl rand -hex 32
```

Copie o resultado. Não envie essa chave em mensagens ou capturas de tela.

No Railway, abra o serviço do AdsPilot, entre em **Variables** e adicione:

```text
GOOGLE_ADS_SCRIPT_SECRET=VALOR_GERADO
```

Confirme também que `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `APP_USER_ID`
estão preenchidos.

## 3. Publicar o código

Substitua os arquivos do projeto pelos arquivos do pacote e execute:

```bash
npm install
npm run build
git add .
git commit -m "Atualiza AdsPilot para V1.2 com Google Ads Script"
git push
```

Aguarde o deploy e abra:

```text
https://adsanalytics.up.railway.app/api/health
https://adsanalytics.up.railway.app/api/config/status
```

O health deve mostrar `version: "1.2"`. Em config/status, o campo
`googleAdsScript.secret` deve ser `true`.

## 4. Instalar o script no Google Ads

1. Abra o Google Ads na conta ou MCC desejada.
2. Entre em **Ferramentas → Ações em massa → Scripts**.
3. Clique em **+ Novo script**.
4. Apague o exemplo e cole `google-ads-scripts/adspilot-v1.2.js`.
5. No início do script, substitua apenas:

```javascript
WEBHOOK_SECRET: "COLE_AQUI_O_MESMO_GOOGLE_ADS_SCRIPT_SECRET_DO_RAILWAY"
```

pelo mesmo valor salvo no Railway.

6. Mantenha `LOOKBACK_DAYS: 3` para a rotina diária.
7. Clique em **Autorizar** e aceite as permissões solicitadas pelo Google.
8. Execute **Visualizar/Preview** primeiro e examine os logs.
9. Depois clique em **Executar/Run**.

O mesmo arquivo identifica automaticamente se está em uma conta individual ou
em uma MCC. Em MCC ele usa processamento paralelo e, por segurança, limita a
execução inicial a 50 contas.

## 5. Conferir a primeira carga

No log do Google Ads, procure:

```text
AdsPilot sincronizado: {"status":"ok"...}
```

No Supabase, confira as tabelas:

- `google_ads_campaign_daily`
- `google_ads_search_terms_daily`
- `google_ads_segments_daily`
- `google_ads_change_events`
- `google_ads_sync_runs`

## 6. Fazer uma carga histórica inicial

Depois que a carga de 3 dias funcionar, altere temporariamente:

```javascript
LOOKBACK_DAYS: 30
```

Execute uma vez. Em seguida, volte imediatamente para:

```javascript
LOOKBACK_DAYS: 3
```

## 7. Agendar

Na página de Scripts, configure a frequência **Diariamente**. O script sempre
reprocessa os últimos três dias; o banco usa upsert e não duplica registros.

## Diagnóstico rápido

- HTTP 401: a chave do script não é igual à variável do Railway.
- HTTP 500: confira a migração e as três variáveis do Supabase.
- Consulta específica falhou: os demais conjuntos ainda são enviados; veja o
  nome da consulta no log.
- MCC com mais de 50 contas: a V1.2 exige filtros/lotes antes de aumentar o
  limite.

