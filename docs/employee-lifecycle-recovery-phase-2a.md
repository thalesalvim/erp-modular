# Fase 2A — desativação, retenção e recuperação segura

Base `f5da3b8a1851fb69ea7126659980e2982b675a34`, branch
`codex/tenant-permissions-phase-2a`. Somente repositório/bancos descartáveis locais;
nenhum usuário real, Supabase remoto, e-mail, deploy, commit ou push nesta entrega.

## Dependências existentes e identidade

Vendas referenciam vendedor, agendamentos/atendimentos referenciam responsável,
escalas/funções/atribuições referenciam colaborador, e auditorias referenciam memberships.
As relações novas usam `(tenant_id,UUID)` com RESTRICT. A associação Auth é privada e
verificada por UUID. Nomes não identificam contas. Não alteramos nenhuma atribuição,
nome histórico, snapshot financeiro, papel, senha ou linha de `auth.users`.

As memberships legadas possuem CASCADE a partir de Auth/tenant, mas vínculos e auditorias
da Fase 2A têm RESTRICT e impedem que essa cascata destrua referências existentes.
Não se afirma que todo usuário sem dependências é impossível de excluir: exclusão física
exige análise de dependências e aprovação próprias, e não é parte deste comando.

## Fluxo Owner e regras de reativação

`erp_set_employee_active(p_tenant uuid,p_employee uuid,p_expected_version bigint,
p_is_active boolean,p_reason text)` retorna `record_id`, `version`, `is_active` e
`membership_active` (null quando não há vínculo Auth verificado).

- Somente Owner ativo, com tenant ativo, pode chamar. Manager/Employee/Master isolado,
  anon e outro tenant são negados. Owner/self e outro colaborador ligado a membership
  Owner são protegidos: transferência/desligamento de proprietários exige outro fluxo.
- Versão esperada é `erp_employees.version`. Lock e comparação impedem mudanças obsoletas;
  a versão incrementa uma vez sem editar nome, UUID ou histórico. No-op não cria evento.
- Estado empresarial está em `private.erp_employee_lifecycle`; ausência de linha significa
  perfil ainda não desativado por este fluxo, sem tornar uma membership inativa ativa.
- Desativação mantém vínculos e história, marca perfil inativo, desativa a membership
  ligada quando ela estava ativa e registra auditoria atômica de ator, estados/versões e
  código de motivo. Motivos: `offboarding`, `temporary_leave`, `authorized_return`, `correction`.
  Não coletamos justificativas médicas, documentos pessoais ou texto legal livre.
- Reativação é explícita do Owner. A membership só volta a ativa se foi desativada por
  este fluxo e sua `activity_revision` ainda corresponde à revisão registrada. Qualquer
  atualização independente, inclusive novo bloqueio com mesmo valor, invalida a autorização
  de restauração (`40001 MEMBERSHIP_CONFLICT`). Não desfazemos bloqueios externos.
- Se a membership já estava inativa antes do desligamento, reativar perfil não ativa essa
  membership. A resposta evidencia isso. Vínculo mudado durante desligamento exige revisão,
  sem restaurar outra conta ou transferir registros automaticamente.
- `42501 ACCESS_DENIED`, `40001 VERSION_CONFLICT/MEMBERSHIP_CONFLICT`, `22023` comando
  inválido e `55000 ERP_MAINTENANCE` devem ser tratados pela integração futura, sem retries
  automáticos ou interpretação como sucesso. Não há tela/API HTTP nova.

O vínculo público de membership recebe contador de atividade incrementado em cada UPDATE.
ACLs de cliente continuam sem UPDATE; somente o papel NOLOGIN de lifecycle ganha colunas
estritamente necessárias. As comparações de ACL legada nos testes preservam tenants/JSON/
admins e verificam separadamente a ausência de UPDATE de memberships para authenticated.

## Revogação e novas operações

`erp_can`, `erp_is_self` e `has_tenant_role` reavaliam membership e estado empresarial.
Não aceitam papel em metadata/JWT do cliente. A atualização de membership para ativa é
negada pelo banco enquanto o perfil ligado permanece inativo, incluindo upserts de fluxos
existentes. Reativação autorizada muda perfil e membership na mesma transação.

Novas vendas, atendimentos e agendamentos atribuídos ao colaborador inativo são negados.
O guard bloqueia o registro de colaborador com SHARE; desligamento usa UPDATE na mesma
linha, de modo que operação em curso e desativação se serializam. Operação confirmada antes
do desligamento permanece histórica; operações posteriores são negadas. Vendas/atendimentos
não são transferidos, cancelados ou apagados. Importação histórica de desligados exige
caminho aprovado posterior; não reativar ou trocar responsável apenas para importar.

Locks seguem actor membership → colaborador → membership-alvo no lifecycle. Provisão
de vínculos também se serializa com o colaborador e recusa novo vínculo de perfil inativo.
Transações externas com vários colaboradores devem ordenar alvos, e devem tratar deadlock/
conflito explicitamente. Não prometemos revogação retroativa de consultas já iniciadas ou
dados já enviados; próximo acesso em READ COMMITTED é reavaliado. Não cachear autorização.

Sem vínculo Auth, o Owner pode desativar o cadastro/proibir novas atribuições, mas não
adivinhamos qual conta bloquear. Memberships Auth-only sem colaborador/vínculo verificado
precisam de provisionamento/gestão de identidade separados antes deste fluxo. Uma conta
com memberships em outras empresas continua sujeita às permissões próprias desses tenants.

**Desativação empresarial não é exclusão, ban ou reset de Supabase Auth.** Login/sessão
global podem continuar válidos, sem autorização empresarial no tenant desativado. Papéis
de plataforma são independentes; um privilégio Master não é revogado por um Owner de empresa.
Revogação global de identidade/plataforma requer autoridade e operação separadas.

## Retenção e pedidos de exclusão pessoal

Não definimos prazo legal arbitrário, nem alegamos que desativação autoriza retenção eterna.
Controlador do tenant deve verificar identidade/escopo do pedido, classificar dados e
finalidades, identificar obrigações/contratos aplicáveis com responsáveis jurídicos/contábeis,
registrar decisão, prazo/base de retenção e restringir acesso durante análise.

Contatos/credenciais desnecessários e dados cadastrais devem ter tratamento específico de
minimização/eliminação/pseudonimização quando autorizado. Nomes/UUIDs em snapshots e audit
também podem ser dados pessoais: não considerá-los automaticamente anônimos. Uma eventual
alteração exigida legalmente precisa de procedimento revisado que preserve fatos monetários,
integridade e evidência; não desabilitar triggers informalmente nem reaplicar nomes atuais.
Não implementamos exclusão/anonymização em massa, prazo, exportação real ou decisão legal.

## Reversão antes e depois de uso

**Antes de COMMIT da instalação sem operações:** rollback transacional pode retirar DDL
tentativo, sem desfazer uma barreira de segurança já aplicada ao JSON. Teste em cluster
novo fecha JSON fora da transação, aplica migrations dentro de transação e faz ROLLBACK;
estruturas desaparecem, dados originais permanecem e Employee continua sem SELECT de payload.
O teste remove BEGIN/COMMIT internos apenas no ensaio para demonstrar atomicidade do lote.
Migrations reais são versionadas/transacionais individualmente: não presumir rollback de
toda a cadeia depois de arquivos já confirmados. Objetos já instalados podem ficar sem uso;
não oferecemos DROP/down migration destrutiva.

**Depois de novas operações:** restaurar dump antigo, apagar tabelas/linhas ou restaurar
ACLs antigas perderia dados/reabriria exposição. Não existe rollback destrutivo seguro.
Usar manutenção, backup/manifesto consistente e recuperação progressiva:

1. Preparar operação explícita, operador DB autorizado, versão revisada e suspensão de
   escritores/jobs. Guardar backup e checksums/contagens de dados/snapshots/auditorias com
   acesso restrito; não imprimir payloads ou segredos em logs.
2. `supabase/recovery/phase-2a-enter-maintenance.sql`: locks/barreira com timeouts, estado
   de manutenção e revogação de grants de tabela **e coluna** do JSON legado. Se houver
   contenção, erro reverte a transação: não repetir sem avaliar escritores em andamento.
3. Normalizados negam acesso de negócio e DML, inclusive RPC de grants; manutenção não
   tem GUC ou parâmetro de cliente para bypass. Operador verifica dados por leitura.
4. `phase-2a-verify.sql`: verifica constraints/FKs validadas, triggers habilitados, quantidades,
   valores monetários, CMV e auditoria de roots postados. Comparar também backup/manifestos:
   invariantes sozinhas não provam igualdade com todos os valores originais.
5. Correção adiante exige plano autorizado e ensaio. Sem reparador genérico de dados,
   desativação de segurança ou retorno ao JSON. DML permanece bloqueado em manutenção;
   reparos excepcionais precisam de procedimento restrito específico, não atalho service_role.
6. Só quando seguro, `phase-2a-resume-normalized.sql`: verifica integridade e recusa qualquer
   grant de JSON restaurado; libera somente acesso SQL normalizado, mantém todos os dados
   e registra operador/revisão. Não recoloca o consumidor legado em funcionamento.

Scripts em `supabase/recovery` **não são migrations automáticas**, não foram executados
remotamente e exigem operador autorizado com privilégios apropriados. Auth/API/service_role
não são operadores. Auditorias de lifecycle e recuperação são imutáveis. Retomada mantém
JSON fechado inclusive para Owner; aplicação atual depende dele, portanto precisa continuar
em manutenção até existir consumidor seguro aprovado. Essa integração não foi iniciada.

## Evidências locais e limites

```sh
python3 scripts/test-employee-lifecycle.py
python3 scripts/test-historical-snapshots.py
python3 scripts/test-product-concurrency.py
python3 scripts/test-appointment-read.py
node --test tests/employee-lifecycle.test.mjs tests/history-snapshots.test.mjs tests/tenant-domain-rls.test.mjs
npx tsc --noEmit --incremental false
npx eslint src/lib/permissions/employee-lifecycle.ts tests/contracts/employee-lifecycle.types.ts tests/employee-lifecycle.test.mjs tests/helpers/tenant-domain-fixture.mjs tests/tenant-domain-rls.test.mjs
```

| Cenário executado | Resultado |
| --- | --- |
| Desativação/revogação, história/UUID/Auth preservados | APROVADO |
| Novas operações e reativação direta/por papel incorreto negadas | APROVADO |
| Bloqueio independente/revisão, Owner protegido, sem vínculo não adivinha conta | APROVADO |
| Outro tenant/same Auth UUID, FK RESTRICT e audit imutável | APROVADO |
| Duas conexões reais, postagem versus desativação | APROVADO |
| Transação incompleta desfaz estados, versão e audit | APROVADO |
| Antes de uso: rollback DDL sem reabrir JSON/perder dados originais | APROVADO |
| Depois de uso: manutenção/retomada conserva histórico, sem restore de JSON | APROVADO |
| Retomada com trigger desabilitado ou grant de JSON reinstalado | NEGADA, como esperado |
| PostgreSQL 17.11 lifecycle/recovery (14 cenários) | APROVADO |
| Regressões PostgreSQL M4 (14), M1/M2 (12), M3 (8) | APROVADO |
| PGlite lifecycle (6 incluindo agregador), M4 (8), RLS (22) | APROVADO |
| TypeScript/lint afetados | APROVADO |
| Supabase/Auth/JWT real, UI/API, produção, dados reais, backup/restauração reais | NÃO TESTADO |

PostgreSQL real em containers descartáveis, sem rede/portas, tmpfs e imagem fixada. Sessões
de aplicação sem superusuário, identidades sintéticas. PGlite PostgreSQL 17.5/WASM não prova
concorrência multi-backend. Fixtures de seed passam escopo Owner sintético explicitamente
ao guard; não são leitura operacional de dados reais. Logs `/tmp/handyhub-lifecycle-postgres.log`,
`/tmp/handyhub-lifecycle-pglite.log`, `/tmp/handyhub-lifecycle-{history,product,agenda}-regression.log`,
`/tmp/handyhub-lifecycle-types.log` e `/tmp/handyhub-lifecycle-lint.log`.

Pendentes: revisão independente, privilégios reais do executor hospedado, gestão Auth-only,
integração dos comandos/UI, política de privacidade/retenção, importação de desligados e
ensaio operacional de backup/recuperação com manifestos completos. Build/suíte completa
não repetidos porque aplicação/dependências não mudaram.

Nota provisória **9,0/10 restrita à entrega local**: revogação, retenção, concorrência e
recuperação sem JSON têm execução real e regressões. Não é aprovação hospedada/legal nem
do ERP inteiro. **A exposição alta do JSON continua aberta no funcionamento normal atual**;
barreira de recuperação não corrige os consumidores. **Camada 1C permanece reprovada.**
