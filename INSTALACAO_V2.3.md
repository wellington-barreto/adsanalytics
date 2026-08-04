# Atualização do AdsPilot Analytics para V2.3

Esta atualização preserva os dados existentes. A ordem recomendada é banco,
Railway e, por último, Google Ads Scripts.

## 1. Supabase

No SQL Editor, execute integralmente:

`supabase/migrations/006_dashboard_v2_3.sql`

Ela adiciona as preferências dos ciclos e cria a tabela append-only
`google_ads_campaign_config_history`. A primeira configuração observada de cada
campanha é salva como baseline e não gera nota; mudanças posteriores de
orçamento, CPA desejado ou estratégia geram nota automática com data e hora.

## 2. Railway

Publique o projeto atualizado. Não é necessário criar novas variáveis de
ambiente. Depois do deploy, confirme:

```text
GET /api/health
```

Resposta esperada: `version: 2.3.0`.

## 3. Google Ads Scripts

Substitua o conteúdo do job diário pelo arquivo:

`google-ads-scripts/adspilot-v1.2.js`

Substitua o conteúdo do job por hora pelo arquivo:

`google-ads-scripts/adspilot-hourly-v1.0.js`

Recoloque em ambos apenas o mesmo `WEBHOOK_SECRET` já usado no Railway.

- Job por hora: coleta leve do dia atual.
- Job diário: coleta completa de termos, públicos, locais, URLs e alterações.
- Ambos continuam somente leitura no Google Ads.

## 4. Primeira execução após a atualização

Execute primeiro o script diário em **Visualizar**. Depois confirme no log um
resultado `status: ok` ou `status: partial` sem erro em `config_history`.
Em seguida, execute o script por hora uma vez.

Não é necessário refazer toda a carga histórica. O histórico exato de
orçamento/CPA começa a ser confiável a partir do primeiro baseline da V2.3; o
sistema não inventa valores anteriores que não tenham sido coletados.

## 5. Validação funcional

1. Abra o dashboard e teste os temas claro e escuro.
2. Passe o mouse nos gráficos e confirme que os tooltips não são cortados.
3. Abra uma campanha e configure comissão, meta e escopo em **Configurações**.
4. Teste Ciclo da Comissão e Ciclo do CPA.
5. Teste `Todo o período` e o calendário personalizado.
6. Exporte as duas grids para XLSX.
7. Confira Público e Locais nos modos tabela e gráfico.

## Observação sobre moeda

Os dados permanecem armazenados na moeda original. USD, BRL e EUR são
convertidos exclusivamente no frontend para visualização e exportação.
