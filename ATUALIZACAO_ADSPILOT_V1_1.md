# AdsPilot V1.1 — atualização de diagnóstico

## Alterações

- Adiciona `GET /api/config/status`, retornando somente indicadores `true` ou `false`.
- Impede que rotas `/api/*` inexistentes abram o dashboard.
- Retorna HTTP 404 para APIs que não existem.
- Não exibe valores de tokens, chaves ou segredos.

## Instalação

1. Substitua o arquivo `server.mjs` da raiz do seu projeto pelo arquivo deste pacote.
2. No Terminal, dentro do projeto, execute:

```bash
npm run build
git add server.mjs
git commit -m "Adiciona diagnóstico seguro das integrações"
git push
```

3. Aguarde o novo deploy do Railway.
4. Abra:

```text
https://adsanalytics.up.railway.app/api/config/status
```

O retorno deve ser JSON e mostrar apenas `true` ou `false` para cada configuração.

## Teste de rota inexistente

Abra:

```text
https://adsanalytics.up.railway.app/api/rota-inexistente
```

O resultado esperado é:

```json
{"error":"Rota de API não encontrada"}
```

