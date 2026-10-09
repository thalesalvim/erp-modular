# HandyHub — plano de rollback de Production

Preparado em 08/10/2026. **NÃO EXECUTADO.** Exige aprovação posterior e os
pré-requisitos do [plano de cutover](camada-1c-production-cutover-plan.md).

Modelo de onboarding fechado: rollback não habilita signup público nem retorna
ao cadastro/login caseiro. O candidato de retorno precisa preservar o convite
administrativo, Owner/Membership, ativação `/auth/activate`, recuperação distinta
e validação do contexto de senha. Para onboarding parcial, revisar tenant e
membership inativa; nunca reapresentar cadastro parcial como sucesso.
Rotação futura da chave server-side invalida contextos de senha assinados ainda
pendentes: oferecer novo fluxo de recuperação apropriado, sem reutilizar tokens
ou afrouxar a validação de sessão.

## Regra de preservação

O cutover altera permissões, não transforma os payloads empresariais. Uma falha
de login normalmente não exige restaurar dados. Preservar todas as escritas
legítimas posteriores, Auth e memberships; nunca usar reset, truncate, drop,
restauração cega de snapshot antigo ou desabilitar RLS como tentativa de reparo.

Antes da janela, registrar deployment Current, SHA, variáveis/configs anteriores
privadamente, ACL/policies e backup consistente. Preparar um deployment anterior
COMPATÍVEL com Auth e banco fechado, e uma manutenção que suspenda escritores.
A main legada não é automaticamente compatível. Sem esse candidato e sem prova
de restauração, não iniciar o cutover.

## Se login parar depois do COMMIT

1. Recolocar a aplicação em manutenção e suspender jobs/escritores; preservar o
   banco fechado. Registrar horário, SHA, ref e códigos de erro, sem tokens.
2. Conferir ambiente/URL/chave pública, cookie SSR, callbacks, SMTP e confirmação
   Auth. Conferir membership ativa, tenant_id e role; admin no registro confiável.
3. Se a regressão for de código/config, retornar ao deployment preparado e
   compatível com RLS/Auth. Validar sessão/owner/admin e manter banco e dados.
4. Se a associação estiver incorreta, revisar UUID e empresa com o responsável
   e corrigir somente a associação específica pelo caminho privilegiado aprovado;
   não conceder acesso geral a authenticated ou promover por metadata.
5. Repetir smoke de anon/A→B/roles antes de retirar manutenção.

Isso retorna à versão compatível anterior sem substituir o banco por dados
antigos. Retornar ao login caseiro exigiria reabrir permissões incompatíveis:
não é o rollback automático autorizado por este plano.

## Se RLS bloquear uma operação legítima

1. Distinguir falta de grant (ex.: 42501), rejeição por WITH CHECK e zero linhas
   por USING. HTTP 200 com UPDATE de zero linhas não prova sucesso.
2. Verificar JWT por `getUser`, UUID, membership ativa, tenant_id, role, coluna
   solicitada e USING/WITH CHECK. Consultar dados apenas pelo operador autorizado.
3. Comparar policy/ACL com o manifest aprovado e com a operação realmente
   prevista. Employee escrever o JSON inteiro não é uma operação autorizada.
4. Ajustar código/associação específicos ou propor policy restrita revisada;
   reproduzir e testar em staging antes de qualquer aplicação em Production.
5. Para policy/grant incorreto após COMMIT, aplicar uma nova transação revisada
   que mantenha isolamento, usando o snapshot de metadados como referência.
   Não restaurar ACL aberta da main para fazer uma tela funcionar.

Se o script de ativação falhar ANTES do COMMIT, a transação reverte RLS/grants
daquela execução; confirmar o estado real e não continuar trechos manualmente.
Essa atomicidade não reverte mudanças externas anteriores de Auth/Vercel/SMTP.

## Se o deploy falhar

- Antes de ativar RLS e atribuir domínio: abortar candidato, manter manutenção
  e deployment anterior; não ativar o banco até existir código compatível.
- Depois de ativar RLS: retornar somente ao deployment compatível preparado.
  Manter schema, dados, Auth e grants finais. Testar o retorno antes do domínio.
- Conferir se a conta/plano permite o mecanismo de rollback escolhido. Se não,
  preparar redeploy do SHA compatível com configuração Production privada.
  Nada disso foi executado ou contratado nesta passagem.

Vercel rollback retorna um build/deployment; não restaura banco, Auth, SMTP
nem o estado atual das variáveis do projeto. Mudanças de env exigem build/deploy
apropriado. Não promover diretamente o Preview com credenciais staging.
Referências: [Vercel — Instant Rollback](https://vercel.com/docs/instant-rollback)
e [variáveis](https://vercel.com/docs/environment-variables).

## Recuperação de desastre ou retorno exato ao legado

Restaurar um backup anterior inteiro perderia escritas posteriores. Antes de
qualquer restauração, suspender escritores e exportar também o estado pós-falha;
determinar o delta por IDs e timestamps e revisar conflitos. Validar o restore
isolado e a reconciliação antes de substituir dados. Preservar Auth/identities
e objetos de Storage conforme o manifest; não recriar pessoas com novos UUIDs
quebrando memberships. Nunca testar o restore contra handyhub-db.

Não há garantia de delta automático nem PITR contratado no Free. Se não houver
prova de recuperação sem perda, manter manutenção e corrigir para frente.

Retorno EXATO ao estado legado aberto, caso o responsável o escolha futuramente,
requer uma autorização separada e explícita para o risco: congelar escritores,
guardar estado pós-cutover, restaurar SOMENTE os metadados/ACL/config aprovados
do snapshot e deployment legado correspondente, preservando dados aditivos e
escritas; repetir checks de integridade. Este plano não contém nem autoriza SQL
para abrir RLS ou grants. A decisão não deve ser confundida com retorno seguro.

## Critério para encerrar incidente

Owner/admin conseguem entrar; memberships conferidas; anon e A→B continuam
negados; escrita legítima prevista funciona; Master/Equipe seguros; convite e
recuperação entregues; dados preservados; deployment/ref/env registrados.
Somente então retirar manutenção e registrar o resultado para revisão.
