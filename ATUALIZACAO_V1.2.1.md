# Atualização AdsPilot V1.2.1

Esta atualização corrige erros intermitentes observados durante a carga pela
MCC.

## O que mudou

- Termos de pesquisa repetidos são agregados antes do envio e novamente no servidor.
- Segmentos repetidos também são agregados defensivamente.
- Campanhas e alterações são deduplicadas antes do upsert.
- Cada conjunto é gravado de maneira independente.
- Uma falha em termos não impede a gravação de campanhas e alterações.
- O webhook faz até quatro tentativas em falhas temporárias.
- Os intervalos entre tentativas possuem atraso aleatório para reduzir rajadas da MCC.
- Os erros do script agora mostram o ID da conta.
- A carga histórica aceita apenas janelas de até sete dias.

Não existe nova migração SQL. Se a migração `002_google_ads_scripts.sql` já foi
executada, não é necessário executá-la novamente.

## Publicar

Substitua os arquivos do projeto e envie ao GitHub:

```bash
npm install
npm run build
git add .
git commit -m "Corrige sincronização Google Ads na V1.2.1"
git push
```

Confirme no healthcheck:

```text
https://adsanalytics.up.railway.app/api/health
```

O campo `version` deve retornar `1.2.1`.

## Atualizar o Google Ads Script

Substitua todo o script atual pelo conteúdo de:

```text
google-ads-scripts/adspilot-v1.2.js
```

Depois de colar, configure novamente `WEBHOOK_SECRET`. Não publique nem envie
essa chave.

Para a rotina diária, mantenha:

```javascript
LOOKBACK_DAYS: 3,
HISTORICAL_START_DATE: "",
HISTORICAL_END_DATE: "",
```

## Recuperar os 30 dias em janelas

Não use mais `LOOKBACK_DAYS: 30`. Preencha uma janela de no máximo sete dias:

```javascript
HISTORICAL_START_DATE: "2026-07-05",
HISTORICAL_END_DATE: "2026-07-11",
```

Execute e confirme o resultado. Depois avance para a janela seguinte. Para o
período de 5 de julho a 3 de agosto de 2026, use:

1. `2026-07-05` até `2026-07-11`
2. `2026-07-12` até `2026-07-18`
3. `2026-07-19` até `2026-07-25`
4. `2026-07-26` até `2026-08-01`
5. `2026-08-02` até `2026-08-03`

Ao terminar, apague as datas e volte ao modo diário:

```javascript
HISTORICAL_START_DATE: "",
HISTORICAL_END_DATE: "",
```

Como o banco utiliza upsert, períodos parcialmente carregados podem ser
executados novamente sem duplicar registros.

