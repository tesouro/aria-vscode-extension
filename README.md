
# ARIA API Editor

Extensão para o VS Code que permite navegar, editar e gerenciar projetos e endpoints da plataforma ARIA diretamente do editor.

## Visão Geral

A extensão ARIA API Editor oferece:
- Visualização em árvore dos projetos e endpoints ARIA.
- Edição de endpoints em três modos: código, formulário visual ou JSON.
- Criação de novos endpoints.
- Validação e salvamento direto na API.
- Autenticação via Microsoft Entra ID (Azure AD).
- Mensagens de status e erros integradas ao VS Code.

## Funcionalidades

- Exibe a árvore de projetos e endpoints na Activity Bar.
- Permite editar endpoints em modo código, formulário ou JSON.
- Criação de novos endpoints a partir da interface.
- Validação de código antes do salvamento.
- Sincronização e atualização da árvore de projetos.
- Suporte a autenticação e permissões por tenant e domínio.

## Requisitos

- VS Code 1.80 ou superior.
- Node.js 18+ para desenvolvimento.
- Acesso à API ARIA (URL base configurável).
- Conta Microsoft Entra ID autorizada (tenant: `b5661350-c2e4-43dc-bce8-f003ddf8a3c4`).

## Instalação

1. Clone este repositório:
	```sh
	git clone https://seurepositorio/aria-vscode-extension.git
	cd aria-vscode-extension
	```

2. Instale as dependências:
	```sh
	npm install
	```

3. Compile a extensão:
	```sh
	npm run build
	```

4. Inicie no modo desenvolvimento:
	- Abra a pasta no VS Code.
	- Pressione `F5` para abrir uma nova janela do VS Code com a extensão carregada.

## Configuração

No VS Code, configure as opções em `settings.json`:

```json
{
  "ariaApi.baseUrl": "https://ms-aria.appsdev.ocp.tesouro.gov.br/",
  "ariaApi.fetchProjectPath": "",
  "ariaApi.ignoreSslErrors": true,
  "ariaApi.requireEntraLogin": true,
  "ariaApi.allowedEmailDomains": ["dominio.com.br"]
}
```

- `baseUrl`: URL base da API ARIA.
- `fetchProjectPath`: (opcional) filtro de caminho do projeto.
- `ignoreSslErrors`: ignora erros SSL/TLS (default: true).
- `requireEntraLogin`: exige login Microsoft Entra ID (default: true).
- `allowedEmailDomains`: restringe domínios de e-mail permitidos.

## Como Usar

1. Execute o comando **ARIA: Conectar na API** (Ctrl+Shift+P).
2. Acesse a view "Projetos ARIA" na Activity Bar.
3. Clique com o botão direito em um projeto ou endpoint para editar (código, formulário ou JSON).
4. Após editar, use **ARIA: Salvar Alterações via API** para persistir.
5. Use **ARIA: Validar Código** para validar antes de salvar.

## Comandos Disponíveis

- **ARIA: Conectar na API** — Autentica e carrega os projetos.
- **ARIA: Atualizar Árvore** — Atualiza a árvore de projetos/endpoints.
- **ARIA: Editar Projeto/Endpoint (JSON, Formulário, Código)** — Abre o editor correspondente.
- **ARIA: Salvar Alterações via API** — Salva as alterações no backend.
- **ARIA: Validar Código** — Valida o código do endpoint.
- **ARIA: Criar Novo Endpoint** — Adiciona um endpoint ao projeto selecionado.

## Observações Técnicas

- Arquivos editados são salvos em `.aria-edit/` no workspace.
- O salvamento atualiza o JSON completo do projeto e envia para a API.
- A extensão utiliza autenticação Microsoft Entra ID (Azure AD) quando configurado.

## Desenvolvimento Local

1. Instale as dependências:
	```sh
	npm install
	```

2. Rode o build em modo watch:
	```sh
	npm run watch
	```

3. Inicie o modo de depuração no VS Code (`F5`).

4. Para testes com Docker:
	```sh
	npm run docker-build
	npm run docker-run:debug
	npm run docker-run:release
	```

5. Para empacotar a extensão:
	```sh
	npm install -g vsce
	vsce package
	```

## Estrutura do Projeto

- `src/extension.ts` — Código principal da extensão.
- `resources/` — Recursos estáticos.
- `.aria-edit/` — Arquivos temporários de edição.
- `package.json` — Metadados e comandos da extensão.
- `tsconfig.json` — Configuração TypeScript.
