# ARIA API Editor

Extensao para navegar e editar projetos ARIA usando API HTTP.

Endpoints usados:

- GET /v1/aria-vscode/custom/projetos-endpoints para montar a arvore
- GET /v1/aria-vscode/custom/gerar-json para carregar JSON completo
- POST /v1/aria-vscode/custom/importar-json para persistir alteracoes

## Configuracao

Configure no VS Code:

- ariaApi.baseUrl: URL base da API
- ariaApi.fetchProjectPath (opcional): filtro por caminho do projeto
- ariaApi.ignoreSslErrors (padrao: true): ignora erros SSL/TLS
- ariaApi.requireEntraLogin (padrao: true)
- ariaApi.allowedEmailDomains (opcional)

Quando ariaApi.requireEntraLogin estiver habilitado, a extensao exige autenticacao com Microsoft Entra ID.
O tenant aceito e fixo: b5661350-c2e4-43dc-bce8-f003ddf8a3c4.

## Fluxo

1. Execute ARIA: Conectar na API.
2. Abra a view Projetos ARIA na activity bar.
3. Clique com botao direito no projeto ou endpoint e use Editar ...
4. Edite o JSON gerado e execute ARIA: Salvar Alteracoes via API no editor.

## Observacoes

- O arquivo editado termina com .aria.json e e gerado na pasta .aria-edit do workspace.
- No salvamento, a extensao atualiza o JSON completo em memoria e envia para importar-json.
