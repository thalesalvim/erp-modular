# HandyHub — Primeiro lote visual

Registro da validação local anterior à publicação, em 14/10/2026, na branch `fix/convites-autorizacao-atomica`, a partir de `95eeed5`. Referência funcional: HH-20, HH-21, HH-22 e HH-24 do backlog aprovado.

## Alterações e resultado

| Melhoria | Resultado deste lote | Evidência / limite |
| --- | --- | --- |
| Mostrar e ocultar senha | Concluída no login | Botão não submete o formulário; nome acessível, estado pressionado, foco visível e alvo de toque. Tab, Enter e Espaço verificados. Uma amostra pública permaneceu visível após a alternância; autenticação real de conta sintética continuou funcionando. Nenhuma persistência ou log de senha acrescentado. |
| Rolagem de Meus Planos | Concluída | Antes: fundo escuro translúcido fixo no tema claro, rolagem `auto`. Depois: superfícies e barras seguem explicitamente o tema da aplicação, inclusive a área externa e o menu. Região de recursos tem foco e rola pelo teclado. |
| Categorias do menu | Concluída nos perfis verificados | Agrupamento recebe somente `visibleTabs`, após o filtro original por cargo/módulo. Dono: 13 itens; Gestor: 12; Funcionário: 7. DRE deixou de aparecer para funcionário: a tela já exigia `isManager`, e o item agora usa a mesma condição. Nenhuma concessão de permissão foi acrescentada. |
| Responsividade | Parcial no conjunto do produto | Corrigidos cabeçalho, fechamento/rolagem do menu, dimensionamento vertical e lista da equipe. Em 390 px, a largura interna da equipe caiu de 492 para 390 px. Medições em 320, 768, 900 e 1280 px sem botões externos nessa tela. Falta verificar todas as telas e listas extensas com dados variados. |

O menu oferece botão próprio de fechamento, Escape, foco inicial, retorno de foco e contenção de Tab. O menu fechado fica inerte; o conteúdo atrás do menu aberto também fica inerte. Categorias vazias não aparecem. Rotas e operações empresariais são preservadas.

## Validações executadas

- TypeScript: aprovado com `--noEmit --incremental false`, sem gerar arquivos no projeto.
- 24 testes direcionados de login, navegação, autorização, callback e contexto de senha: aprovados.
- 30 testes adicionais de permissões e preservação de Meus Agendamentos: aprovados; testes locais com dependências controladas, sem banco remoto.
- Lint geral: reprovado por dívida preexistente, com 73 erros e 41 avisos na execução registrada. A página principal tinha 42 erros e 20 avisos no HEAD, e passou a 41 erros e 20 avisos. Login, novo agrupador e novos testes passaram no lint específico, sem avisos. Não foram desabilitadas regras para obter aprovação.
- `git diff --check`: aprovado.
- Navegador real: login, planos, equipe, formulário de colaborador (somente abrir/fechar), dashboard, agenda vazia, banco de horas e configurações. Temas claro/escuro; desktop e viewports móveis/tablet. Sessões reais das contas sintéticas Dono, Gestor e Funcionário do staging identificado.
- Formulários empresariais não foram submetidos. Nenhum convite, e-mail de recuperação, pagamento ou alteração de cadastro foi solicitado. Apenas autenticação, encerramento de sessões sintéticas e preferências locais de tema foram exercitados.

Os testes de navegação extraem as expressões reais `allTabs`/`visibleTabs` da página para verificar os limites por cargo e as restrições de módulos. O teste do login renderiza o componente real com dependências de autenticação controladas; a interação do botão foi verificada separadamente no navegador. Isso não constitui uma nova certificação de RLS ou dos mecanismos SQL.

## Reprodução

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/components/auth/AuthEntry.tsx src/lib/navigation/groups.ts tests/visual-navigation.test.mjs
npm run lint
node --test tests/visual-navigation.test.mjs tests/auth-authorization.test.mjs tests/auth-callback.test.mjs tests/password-context.test.mjs
node --test tests/tenant-permissions.test.mjs
git diff --check
```

Preview desta execução: `http://localhost:3302/`, em uma cópia local separada, sem arquivos `.env` copiados, utilizando somente URL e chave pública do staging previamente identificado. Não foi passada chave administrativa. O servidor foi iniciado fora do repositório para preservar os arquivos gerados por Next.js e a árvore original. O comando de desenvolvimento é `npm run dev -- --hostname 127.0.0.1 --port 3302`; antes de reproduzi-lo, confirmar porta livre e configuração pública de um ambiente de teste. Não usar a configuração de produção para esta validação.

Verificação manual: login → alternar senha com amostra sem credencial → limpar amostra → autenticar com conta de teste → abrir/fechar menu por teclado → comparar módulos de cada perfil → Dono/Meus Planos/expandir opções → rolar recursos com Home/End → alternar tema em Configurações → repetir em 320/390/768/900/1280 px. Não selecionar planos, salvar formulários ou mudar credenciais.

## Preservação e pendências

Comparação SHA-256 de 213 arquivos preexistentes: somente `src/app/page.tsx`, `src/app/globals.css` e `src/components/auth/AuthEntry.tsx` mudaram. Os 21 arquivos presentes no diretório de migrations (20 SQL e `.gitkeep`), a integração isolada de Meus Agendamentos, o documento v6, evidências, backups e demais arquivos não rastreados permaneceram intactos. As 17 migrations SQL históricas também foram comparadas diretamente aos bytes de `e46d15d`, sem diferenças.

Na consolidação, este lote é separado do seletor/Sobre Nós. Os testes auxiliares de Meus Agendamentos citados no registro anterior permanecem locais e não integram o commit visual; os comandos acima usam somente arquivos versionados deste lote e suas dependências históricas. A dívida preexistente de lint da Home permanece explícita e não foi suprimida.

A cópia isolada do staging visual, sem os arquivos pendentes, passou em 41/41 testes e TypeScript. Lint direcionado: login, agrupador e teste com zero erros/avisos; Home com 41 erros e 20 avisos preexistentes. `git diff --cached --check` aprovado; arquivos staged inspecionados sem credenciais. A cópia reutilizou dependências já instaladas, sem instalar pacotes ou acessar banco.

Capturas antes/depois e registros de geometria/perfis estão no diretório externo de evidências da execução `visual-batch-1792006202957902700`, em `.codex/visualizations`, fora do Git do projeto. Capturas de login não contêm credenciais reais.

Limitações: viewport móvel em navegador desktop não substitui teste em aparelhos físicos; não houve leitor de tela real. Dados sintéticos são pequenos e várias listas estão vazias; escalas preenchidas, listas longas e todas as telas financeiras ainda precisam de inspeção. Permanecem contrastes e estilos legados fora deste lote, assim como a dívida de lint. Meus Agendamentos e a arquitetura gerenciada v6 continuam com seus bloqueios anteriores, sem alterações nesta tarefa. Nenhum acesso a produção, migration, deploy, commit ou push.
