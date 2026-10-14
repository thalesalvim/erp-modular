# Backlog oficial de melhorias — HandyHub

**Proprietário das decisões:** proprietário do produto HandyHub.

**Consolidação:** 14/10/2026.

**Branch auditada:** `fix/convites-autorizacao-atomica`.

**Referência do código:** `700c93c5e9976b90b6062d1d6864a197b02372dc`.

**Escopo aprovado:** as 26 melhorias enumeradas pelo proprietário nesta consolidação.

Este documento registra decisões funcionais, diagnóstico do código e propostas de execução. Não implementa funcionalidades nem autoriza operações em produção. Foi criado para posterior versionamento; nesta tarefa não houve staging, commit, push, PR, deploy ou alteração de banco.

## 1. Decisões prevalecentes e limites

- Empresa contratante: CNPJ obrigatório e CPF do sócio majoritário. O primeiro Owner do sistema não deve ser presumido como sócio majoritário sem identificação explícita.
- Cliente titular: nome completo, CPF, data de nascimento e telefone obrigatórios. Propostas antigas com CPF opcional ficam superadas **para titulares**.
- Dependente: pessoa com identidade, histórico e fidelidade próprios, relacionada a um responsável. Não presumir que deve usar o CPF do responsável ou que está sujeito aos mesmos campos obrigatórios do titular; regras específicas ainda precisam ser definidas.
- Dono (`owner`), Gestor (`manager`) e Colaborador (`employee`) são papéis de autorização. Função profissional e qualificação não concedem esses papéis. Master/administrador da plataforma não equivale a Dono empresarial.
- Finalização de atendimento: profissional responsável, com exceções autorizadas para Dono e Gestor. A exceção futura do Gestor precisa de comando e política revisados; não ampliar permissões atuais indiscriminadamente.
- Downgrade: somente no término da vigência contratada, que pode diferir do próximo mês ou vencimento da fatura.
- Cadastro provisório de colaborador: duração máxima de 24 horas. Não confundir com o ticket de autorização de convite v5, cuja validade é de dez minutos.
- Contatos oficiais aprovados: **+55 37 9855-8658** e **[adm.handyhub@gmail.com](mailto:adm.handyhub@gmail.com)**.

Detalhes operacionais não definidos são registrados como decisões pendentes. Critérios técnicos abaixo são recomendações para cumprir essas decisões; não representam aprovação de módulos extras, meios de pagamento, regras de fidelidade ou políticas comerciais novas.

## 2. Método, evidências e significado dos estados

Esta revisão foi uma inspeção estática de `src/`, migrations, contratos e documentação/testes versionados. Não executou suíte funcional, Docker, browser, SMTP, Auth ou PostgREST nesta tarefa; não consultou ambientes hospedados nem arquivos de credenciais. A auditoria visual da tarefa anterior é contexto complementar, não uma nova validação.

| Estado | Significado nesta consolidação |
| --- | --- |
| Implementado | A regra completa está conectada ao fluxo real, com garantias na camada responsável e evidência verificável de aceitação. Tela ou botão não bastam. |
| Parcial | Há tela, contrato ou mecanismo de banco pertinente, mas falta parte da regra, integração ou comprovação de ponta a ponta. |
| Ausente | O mecanismo específico aprovado não foi encontrado no código versionado examinado. Exemplos e rascunhos não contam como implementação. |
| Não verificado | A conclusão exige ensaio específico não realizado; a inspeção estática não prova correção ou ausência do defeito. |

**Resultado: 26 melhorias; 0 implementadas integralmente, 14 parciais, 11 ausentes e 1 não verificada.** Isso não significa ausência de trabalho: a fundação SQL e diversas telas existem. Significa que nenhuma das 26 regras completas recebe aprovação de ponta a ponta nesta auditoria.

Prioridades propostas: **P0** segurança e integridade que bloqueiam uso confiável; **P1** regras funcionais dependentes dessas bases; **P2** experiência e ajustes independentes; **P3** instalação PWA após revisão do cache e da sessão. Prioridade não autoriza execução.

### Fontes principais

- [Persistência atual](../src/lib/dbService.ts): leitura em `tenant_data` na linha 50 e upsert de coleções na linha 38.
- [Tela principal](../src/app/page.tsx) e [área da equipe](../src/app/equipe/page.tsx): componentes com módulos por `activeTab`, controles locais e gravação do agregado legado.
- [Contratos empresariais Master](../src/lib/master/contracts.ts), [provisionamento do Owner](../src/lib/master/onboarding.ts) e [tela Master](../src/app/master/page.tsx).
- [Política TypeScript](../src/lib/permissions/policy.ts): explicitamente especificação não integrada. [Leitura própria da agenda](../src/lib/permissions/appointment-read.ts), [postagem histórica](../src/lib/permissions/history-posting.ts) e [lifecycle](../src/lib/permissions/employee-lifecycle.ts) também declaram contratos SQL sem integração às páginas.
- [Permissões Fase 2A](tenant-permissions-phase-2a.md), [concorrência de produtos](product-concurrency-phase-2a.md), [históricos](historical-snapshots-phase-2a.md), [lifecycle](employee-lifecycle-recovery-phase-2a.md), [revogação](membership-revocation-phase-2a.md) e [recuperação coordenada](coordinated-recovery-and-integrity-phase-2a.md).
- [Integridade v4](recovery-integrity-v4-phase-2a.md) e [convites/lifecycle v5](invitation-lifecycle-v5.md): resultados locais documentados; não certificam Auth/SMTP/PostgREST hospedados nem o frontend empresarial.

### Diagnóstico transversal

1. O frontend ainda lê e substitui `all_data` com coleções completas. Filtrar nomes ou esconder menus no navegador não é autorização e pode causar perda de atualizações, vazamento de campos e identidades ambíguas.
2. O modelo normalizado tem UUIDs, FKs por tenant, RLS, projeções e comandos específicos. Várias escritas e estruturas permanecem fechadas deliberadamente. A rota de convite já chama RPCs; isso não integra os demais módulos. Não reabrir GRANTs para fazer as telas antigas funcionarem.
3. A DRE atual calcula receitas menos despesas pagas; não demonstra CMV histórico nem separação entre competência e caixa. Os mecanismos SQL de snapshot são uma base diferente e ainda não alimentam o relatório.
4. A agenda compara igualdade de data, hora e nome do profissional em memória; não garante ausência de sobreposição nem concorrência multi-backend.
5. As 17 migrations históricas foram comparadas byte a byte a `e46d15d`, sem diferenças. As migrations v3/v4/v5 foram comparadas ao HEAD, também sem diferenças. Evoluções futuras devem ser aditivas, preservar referências e passar pelo mecanismo versionado de integridade.

## 3. Inventário resumido

| ID | Melhoria aprovada | Estado | Prioridade |
| --- | --- | --- | --- |
| HH-01 | CNPJ empresarial e CPF do sócio majoritário | Parcial | P1 |
| HH-02 | Cadastro obrigatório e inteligente de titulares | Parcial | P1 |
| HH-03 | Duplicidades com autorização por perfil | Ausente | P1 |
| HH-04 | Responsáveis, dependentes, históricos e fidelidade individuais | Ausente | P1 |
| HH-05 | Unificação segura e auditada | Ausente | P1 |
| HH-06 | Observações de cliente, agenda e finalização | Parcial | P1 |
| HH-07 | Disponibilidade, jornada e qualificação profissional | Parcial | P1 |
| HH-08 | Bloqueio de conflito de agenda, inclusive concorrente | Parcial | P0 |
| HH-09 | Notificação do funcionário designado | Ausente | P1 |
| HH-10 | Faltas e remarcação após 15 minutos | Ausente | P1 |
| HH-11 | Integração transacional agenda/atendimento | Parcial | P0 |
| HH-12 | Finalização pelo responsável; exceção Dono/Gestor | Parcial | P0 |
| HH-13 | Promoção com validade real e desconto automático | Parcial | P1 |
| HH-14 | DRE, CMV, estoque e fluxo de caixa corretos | Parcial | P0 |
| HH-15 | Downgrade ao término da vigência | Ausente | P1 |
| HH-16 | Permissões individuais e padrões por cargo | Parcial | P0 |
| HH-17 | Colaborador provisório por até 24 horas | Ausente | P1 |
| HH-18 | Bloqueio e revogação seguros | Parcial | P0 |
| HH-19 | Substituição progressiva de `tenant_data` | Parcial | P0 |
| HH-20 | Mostrar/ocultar senha | Ausente | P2 |
| HH-21 | Rolagem de Meus Planos no modo claro | Não verificado | P2 |
| HH-22 | Responsividade celular/tablet/desktop | Parcial | P2 |
| HH-23 | PWA instalável | Ausente | P3 |
| HH-24 | Menu por categorias | Parcial | P2 |
| HH-25 | Sobre Nós e instruções de instalação | Ausente | P2 |
| HH-26 | Contatos oficiais | Ausente | P2 |

## 4. Regras, evidências e aceitação por melhoria

### HH-01 — Identificação empresarial

- **Regra:** exigir CNPJ da empresa e CPF do sócio majoritário; distinguir esse sócio do usuário Owner quando forem pessoas diferentes.
- **Estado/evidência:** **Parcial**. Cadastro de empresa e convite do primeiro Owner existem, mas `newTenantData` não envia documentos ([Master](../src/app/master/page.tsx), linhas 571–585). A allowlist de [contratos](../src/lib/master/contracts.ts), linha 71, não contém CNPJ ou CPF. `document` em interfaces/exemplos não garante persistência real.
- **Módulos/dependências:** Master, onboarding, cadastro empresarial, contratos API e armazenamento protegido de documentos. Definir representação, validação e preenchimento dos registros antigos.
- **Segurança/dados:** restringir CPF e seus logs/exportações; documento não é prova de identidade nem fator de autenticação. Não fabricar documentos no backfill.
- **Aceitação:** criar/editar via API exige documentos válidos segundo regra revisada; frontend e servidor concordam; empresa antiga sem documento fica identificada para saneamento, sem exclusão; sócio e Owner são preservados separadamente.
- **Testes:** validação unitária; bypass da UI; leitura por perfil/tenant; upgrade com cadastros incompletos e rollback.
- **Prioridade:** **P1**, após HH-19/16. Pendente: tratamento de sociedades sem sócio único majoritário e política de unicidade entre empresas.

### HH-02 — Clientes titulares

- **Regra:** nome completo, CPF, nascimento e telefone obrigatórios para titulares; cadastro inteligente auxilia preenchimento sem inventar dados nem substituir consentimento/validação.
- **Estado/evidência:** **Parcial**. [Home](../src/app/page.tsx), linhas 2561–2580, salva `name`, `phone`, `notes`; [Equipe](../src/app/equipe/page.tsx), linha 2287, faz o mesmo. `erp_customers`/`erp_customer_contacts` no [modelo normalizado](../supabase/migrations/20261010060100_erp_domains.sql), linhas 3–27, não possuem CPF/nascimento.
- **Módulos/dependências:** clientes, agenda, atendimentos; HH-19, contrato de titular/dependente e HH-03. Não acrescentar integração de consulta externa não aprovada.
- **Segurança/dados:** campos identificadores separados de projeções operacionais mínimas; logs e caches não devem distribuir CPF/nascimento. Saneamento do legado precisa preservar registros incompletos.
- **Aceitação:** não criar titular incompleto por UI ou chamada direta; persistir data válida e telefone normalizado; preencher e revisar candidato já cadastrado sem sobrescrever automaticamente; identidade por UUID, não por nome.
- **Testes:** entradas inválidas/incompletas, datas futuras, caracteres e formatação; duas pessoas de mesmo nome; isolamento; upgrade com dados legados.
- **Prioridade:** **P1**. Pendente: comportamento exato de sugestões e normalização, sem tornar CPF opcional para titulares.

### HH-03 — Duplicidades e autorização por perfil

- **Regra:** detectar possíveis duplicidades e exigir autorização apropriada para tratar exceções; nunca decidir somente pela igualdade de nome.
- **Estado/evidência:** **Ausente**. O cadastro em [Home](../src/app/page.tsx), linha 2570, gera ID por timestamp e insere sem busca/constraint de identidade. A [política atual](../src/lib/permissions/policy.ts) não define resolução de duplicidade.
- **Módulos/dependências:** clientes, HH-02/04/16/19; contrato de unicidade e resolução de candidatos.
- **Segurança/dados:** detecção restrita ao tenant; não revelar se CPF existe em outra empresa. Exceções e decisão do ator devem ser auditadas e autorizadas no servidor.
- **Aceitação:** submissões simultâneas respeitam a política de duplicidade; candidatos ambíguos exigem decisão; ator sem perfil permitido não cria exceção; regra não confunde titular com dependente.
- **Testes:** CPF formatado de modos diferentes; telefone compartilhado e homônimos; disputa de duas conexões; exceção negada, autorizada e auditada; tenant estrangeiro.
- **Prioridade:** **P1**. Pendente: chaves bloqueantes, sinais apenas informativos e perfis que podem autorizar cada exceção.

### HH-04 — Responsáveis e dependentes

- **Regra:** relacionar responsável e dependentes, mantendo históricos e fidelidade de cada pessoa atendida.
- **Estado/evidência:** **Ausente**. O [modelo de clientes](../supabase/migrations/20261010060100_erp_domains.sql) e os formulários atuais não têm vínculo de dependência nem saldo individual de fidelidade. Históricos SQL de venda/atendimento existem, mas não implementam essa regra familiar.
- **Módulos/dependências:** HH-02/03/19, agenda, históricos e fidelidade; definir campos de dependentes, multiplicidade de responsáveis e transferência de responsabilidade.
- **Segurança/dados:** telefone/CPF compartilhados não podem fundir pessoas; vínculos devem validar tenant e preservar a pessoa efetivamente atendida. Definir acesso e retenção de dados de dependentes.
- **Aceitação:** atendimento de dependente permanece em seu histórico, não no do responsável; fidelidade não se mistura; mudança de responsável não reescreve o passado; vínculo estrangeiro é recusado.
- **Testes:** irmãos com telefone comum, troca de responsável, exclusão/bloqueio, concorrência de edição e segregação de saldos/históricos.
- **Prioridade:** **P1**. A fórmula de fidelidade não está aprovada neste documento; não criar pontos, vencimentos ou resgates arbitrários.

### HH-05 — Unificação auditada de cadastros

- **Regra:** unificar cadastros autorizados com rastreabilidade, preservando referências, históricos e fidelidade.
- **Estado/evidência:** **Ausente**. Formulários de clientes apenas criam/editam/excluem; não há comando de unificação em `src/` ou nas migrations. As FKs compostas e snapshots de [históricos](historical-snapshots-phase-2a.md) precisam ser respeitados.
- **Módulos/dependências:** HH-02/03/04/16/19; planejamento de referências e mecanismo transacional específico.
- **Segurança/dados:** risco de perda de histórico, fusão de pessoas distintas, alteração retroativa e dupla contagem. Não editar snapshots imutáveis para apagar a origem.
- **Aceitação:** prévia de impactos; origem/destino pertencem ao mesmo tenant; decisão registra ator, motivo e mapeamento; repetição não duplica saldos; falha reverte o conjunto; histórico original continua explicável.
- **Testes:** homônimos não unificáveis automaticamente, dependentes distintos, vínculos financeiros, unificação simultânea, tentativa entre tenants, rollback e repetição.
- **Prioridade:** **P1**, depois de HH-04. Pendente: perfis autorizados e tratamento de conflitos de campos/fidelidade.

### HH-06 — Observações em três momentos

- **Regra:** registrar observações no cadastro, agendamento e finalização, com distinção entre esses contextos.
- **Estado/evidência:** **Parcial**. Campos e exibição existem em [Home](../src/app/page.tsx), linhas 1038, 2227, 2252 e 2580. O banco separa `erp_customer_notes`, `erp_appointment_notes` e `erp_attendance_notes`; as telas ainda usam o JSON conjunto.
- **Módulos/dependências:** clientes, agenda, atendimento, HH-11/12/16/19 e revisão das permissões de notas.
- **Segurança/dados:** notas podem conter dados privados; o catálogo atual mantém notas privadas restritas. Aprovar projeções por perfil antes de permitir que o profissional leia/escreva tudo.
- **Aceitação:** salvar cada nota no contexto correto; mostrar somente campos autorizados; preservar versão e autoria; finalizar não perde observação de agenda nem a confunde com nota do atendimento.
- **Testes:** persistência após recarga, edição concorrente, HTML/texto hostil, limites de tamanho, negação de leitura e associação cruzada de notas.
- **Prioridade:** **P1**; permissões adicionais ainda precisam de revisão, sem tornar notas públicas.

### HH-07 — Jornada, disponibilidade e qualificação

- **Regra:** agendar somente profissional disponível, dentro da jornada e qualificado para o serviço.
- **Estado/evidência:** **Parcial**. Escala e funções existem em [Home](../src/app/page.tsx), linhas 83–98 e 2347–2375; em [Equipe](../src/app/equipe/page.tsx), linhas 1129–1199, há edição pelo próprio usuário. O banco possui escalas/funções, mas suas estruturas estão fechadas ([RLS](../supabase/migrations/20261010060200_erp_domain_rls.sql), linha 98). O formulário de agenda não valida essas condições no servidor.
- **Módulos/dependências:** equipe, serviços, agenda, HH-08/16/19; contrato de escala, intervalos, exceções e qualificação por UUID.
- **Segurança/dados:** autoedição da função profissional não pode conceder privilégios de sistema nem certificar qualificação. Alterações de jornada precisam ter autorização e efeito consistente em reservas existentes.
- **Aceitação:** recusar folga, turno incompatível e serviço sem qualificação; validar duração e intervalo; mudanças são versionadas; mesma pessoa de nome igual não herda a escala de outra.
- **Testes:** bordas de turno, intervalos, serviço longo, profissional inativo, mudança concorrente e vínculos de tenant estrangeiro.
- **Prioridade:** **P1**, pré-requisito de HH-08. Pendente: jornada noturna, exceções e quem pode modificar escala/qualificação.

### HH-08 — Conflitos de agenda

- **Regra:** impedir sobreposição para o mesmo profissional, também com requisições simultâneas.
- **Estado/evidência:** **Parcial**. [Home](../src/app/page.tsx), linhas 2272–2279, e [Equipe](../src/app/equipe/page.tsx), perto da linha 1983, verificam igualdade de horário/nome em memória. `erp_appointments` tem data/hora e FKs, sem constraint de intervalos ([modelo](../supabase/migrations/20261010060100_erp_domains.sql), linhas 191–207). Concorrência de produtos/convites não prova concorrência da agenda.
- **Módulos/dependências:** agenda, HH-07/19, comando atômico, duração persistida e política temporal/fuso da empresa.
- **Segurança/dados:** evitar dupla reserva, lost update e disputa com suspensão/revogação; recusar no banco mesmo que o navegador omita a validação.
- **Aceitação:** reservar intervalos reais; duas reservas conflitantes têm no máximo uma confirmação; reagendamento valida novo intervalo atomicamente; erro não deixa reserva parcial; adjacência segue regra documentada.
- **Testes:** duas conexões sincronizadas, inícios diferentes com sobreposição, bordas iguais, edição concorrente, profissional diferente, erro/rollback e manutenção.
- **Prioridade:** **P0**. Pendente: política de buffers, turnos que cruzam dia e estados que liberam ocupação.

### HH-09 — Notificação ao designado

- **Regra:** notificar o funcionário efetivamente designado quando o evento aprovado de agenda ocorrer.
- **Estado/evidência:** **Ausente**. Agendamento grava listas sem evento de entrega. [saasNotifications](../src/lib/saasNotifications.ts) só faz `console.log` de eventos SaaS; [/api/whatsapp](../src/app/api/whatsapp/route.ts) simula disponibilidade e não envia notificação de designação.
- **Módulos/dependências:** HH-07/08/11/18; identidade Auth vinculada ao profissional, canal e política de entrega definidos pelo produto.
- **Segurança/dados:** emitir somente após confirmação da transação; evitar divulgação a ex-funcionário ou outro tenant. Não enviar CPF, notas privadas ou tokens em notificações.
- **Aceitação:** destinatário por UUID autorizado; falha de envio não cria/cancela reserva indevidamente; reentrega não duplica a mensagem lógica; mudança de designado segue regra explícita e auditável.
- **Testes:** rollback sem envio, erro de provedor, repetição, troca de designado, revogação entre enfileiramento e entrega, payload mínimo.
- **Prioridade:** **P1**. Pendente: canal, eventos e destinatários de alteração/cancelamento; não presumir WhatsApp real aprovado.

### HH-10 — Faltas e janela de 15 minutos

- **Regra:** controlar falta/remarcação considerando 15 minutos após o horário previsto.
- **Estado/evidência:** **Ausente**. A agenda atual não tem transição de falta ou regra temporal correspondente. Os timers de 15 minutos em [Home](../src/app/page.tsx), linha 424, e [Equipe](../src/app/equipe/page.tsx), linha 229, são logout por inatividade, não controle de faltas.
- **Módulos/dependências:** HH-08/11/12; relógio do servidor, fuso, estados explícitos e comando de remarcação.
- **Segurança/dados:** não apagar histórico nem liberar uma vaga erroneamente; impedir conflito entre chegada, finalização e marcação de falta.
- **Aceitação:** regra aplicada no servidor; comportamento antes/em/depois dos 15 minutos documentado; remarcação valida disponibilidade; histórico conserva horário original, ator e motivo.
- **Testes:** fronteira temporal com relógio controlado, browser adulterado, operações concorrentes, tenant/fuso e repetição.
- **Prioridade:** **P1**. Pendente: ação automática ou manual, perfis autorizados e liberação da vaga; não presumir cancelamento automático aprovado.

### HH-11 — Agenda e atendimentos integrados

- **Regra:** transformar agendamento em atendimento de maneira consistente, preservando origem e sem duplicar operações.
- **Estado/evidência:** **Parcial**. [Home](../src/app/page.tsx), linhas 2213–2238, retira o agendamento e adiciona atendimento por **duas gravações do agregado**, sem esperar confirmação conjunta; [Equipe](../src/app/equipe/page.tsx), linhas 1919–1948, repete o fluxo. `erp_post_attendance` é base de postagem histórica, não conversão integrada de appointment.
- **Módulos/dependências:** HH-08/12/14/19; comando único com UUID de origem, idempotência e histórico de transições.
- **Segurança/dados:** risco de perder a reserva, gravar só um dos lados ou cobrar duas vezes. Não representar falha/negação como lista vazia bem-sucedida.
- **Aceitação:** confirmação atômica com vínculo de origem; reserva continua rastreável; chamada repetida confirma o resultado existente ou rejeita conflito, sem novo atendimento; falha reverte tudo.
- **Testes:** falha entre etapas, duas finalizações, recarga/reenvio, timeout com resposta perdida, revalidação após lock e integridade financeira.
- **Prioridade:** **P0**, junto de HH-12.

### HH-12 — Finalização autorizada

- **Regra:** somente profissional responsável finaliza; Dono e Gestor têm exceções explícitas e auditadas.
- **Estado/evidência:** **Parcial**. Há filtro por `professionalName` em [Home](../src/app/page.tsx), linhas 524–536, mas também acesso amplo por perfil de recepção/caixa e botão Finalizar para itens visíveis, linha 1056. `erp_post_attendance` usa `attendances.create`, hoje não delegável ([política](../src/lib/permissions/policy.ts)); não implementa a exceção funcional nova nem a finalização pessoal.
- **Módulos/dependências:** HH-11/16/18/19; associação profissional/Auth, permissão específica e auditoria no servidor.
- **Segurança/dados:** nome não é identidade; interface não pode decidir autorização. Revalidar membership, empresa e atribuição na operação efetiva; impedir alteração do responsável para contornar a regra.
- **Aceitação:** responsável ativo confirma; outro funcionário/recepção/caixa é negado sem concessão aprovada; Dono/Gestor autorizados deixam auditoria da exceção; revogação durante espera impede conclusão conforme contrato transacional.
- **Testes:** homônimos, chamada direta, troca de responsável, papéis, tenant estrangeiro, revogação concorrente e rollback.
- **Prioridade:** **P0**. Aprovar o teto da exceção do Gestor antes de alterar catálogo/selos.

### HH-13 — Promoções efetivas

- **Regra:** prazo real de validade e desconto automaticamente calculado no agendamento elegível.
- **Estado/evidência:** **Parcial**. `Promotion.duration` é texto ([Home](../src/app/page.tsx), linhas 101–108); o cadastro mantém desconto/alvos. A tabela `erp_promotions` também armazena `duration` texto ([modelo](../supabase/migrations/20261010060100_erp_domains.sql), linha 166). Agendamento usa preço do serviço e finalização define `discount: 0`, linhas 2288 e 2224.
- **Módulos/dependências:** serviços, agenda, HH-08/11/14/19; início/fim tipados, alvos estruturados, cálculo monetário e snapshot da oferta aplicada.
- **Segurança/dados:** desconto calculado pelo servidor, sem aceitar preço forjado; valor histórico não deve mudar quando a promoção é editada.
- **Aceitação:** oferta válida/elegível reduz o preço automaticamente; vencida não se aplica; bruto/desconto/líquido são reconciliáveis; alteração posterior não recalcula histórico silenciosamente.
- **Testes:** início/fim exatos, 0/100%, arredondamento, alvos incorretos, edição concorrente e validação de valores na postagem.
- **Prioridade:** **P1**. Pendente: promoções simultâneas, cumulatividade e validade na reserva versus execução; não escolher regra comercial implicitamente.

### HH-14 — Integridade financeira

- **Regra:** DRE, CMV, estoque e fluxo de caixa consistentes, com separação entre resultado por competência e entradas/saídas de caixa.
- **Estado/evidência:** **Parcial**. [Home](../src/app/page.tsx), linhas 580–592, subtrai despesas pagas de receitas por data e não desconta CMV; CSV chama esse valor de lucro líquido real. Estoque agrega por nome nas linhas 470–474. Há snapshots de preço/custo e postagens SQL ([históricos](historical-snapshots-phase-2a.md)), mas não alimentam telas nem um fluxo de caixa reconciliado.
- **Módulos/dependências:** vendas, atendimentos, compras/movimentos existentes, despesas, DRE, HH-11/13/19; custo histórico, saldos, pagamentos e contratos monetários. Não inventar métodos de custeio/estorno aprovados.
- **Segurança/dados:** separar custo/financeiro por permissão; usar precisão decimal; preservar custo da operação e incerteza de dados legados. Não assumir custo desconhecido como zero nem recalcular passado pelo cadastro atual.
- **Aceitação:** fixture reconciliada produz totais esperados de receita, CMV, resultado, estoque e caixa; mudança de custo atual não muda CMV histórico; operação/estorno não duplica movimento; relatórios distinguem dados completos de incompletos.
- **Testes:** centavos/arredondamento, custo desconhecido, crédito versus recebimento, pagamento parcial se aprovado, edição do produto, estoque negativo, concorrência, estorno e rollback conforme regras aprovadas.
- **Prioridade:** **P0**. Pendente: método de custeio, competência, estornos, obrigações futuras e regularização financeira do legado. Integridade de snapshots não certifica DRE pronta.

### HH-15 — Downgrade contratual

- **Regra:** reduzir plano apenas no término da vigência contratada, mantendo direitos já contratados até essa data.
- **Estado/evidência:** **Ausente** para a regra. [Home](../src/app/page.tsx), linhas 2092–2096, permite selecionar plano e tenta aplicar imediatamente; linhas 2103–2105 apenas registram log/alerta de alteração futura. A [allowlist empresarial](../src/lib/master/contracts.ts) não contém vigência ou alteração pendente. A confirmação visual não prova alteração persistida.
- **Módulos/dependências:** Meus Planos, Master, faturamento, HH-16/19; contrato com data efetiva, solicitação pendente persistida e processamento idempotente.
- **Segurança/dados:** não retirar acesso antecipado nem alterar cobrança sem efeito financeiro rastreável. Servidor deve aplicar a regra mesmo em chamada direta.
- **Aceitação:** pedido não reduz módulos antes do término; data deriva do contrato; aplicação ocorre uma vez; direitos e faturas permanecem coerentes; falha não exibe sucesso fictício.
- **Testes:** contrato mensal/anual, fronteira da vigência, reenvio, solicitação concorrente, perfil negado e execução atrasada.
- **Prioridade:** **P1**. Pendente: upgrade, cancelamento/reversão da solicitação e contratos sem vigência confiável; não criar cálculo proporcional novo.

### HH-16 — Permissões por pessoa e cargo

- **Regra:** padrões por cargo e permissões individuais dentro dos limites aprovados, sem confundir cargo profissional com papel Auth.
- **Estado/evidência:** **Parcial**. SQL implementa grants por `manager`/`employee` com revisão/auditoria ([permissões](../supabase/migrations/20261010060000_erp_permissions.sql), linhas 145–187). Restauração possui restrições por usuário, mas não é editor geral de permissões individuais. Telas usam `moduleRoles`/visibilidade; [política TS](../src/lib/permissions/policy.ts) declara não estar integrada.
- **Módulos/dependências:** equipe, configurações, todos os comandos, HH-18/19; catálogo e composição de padrão/exceção revisados.
- **Segurança/dados:** impedir escalada por cargo/JSON, wildcard ou cache; aplicar limites por campo e tenant; Master não ganha acesso empresarial automaticamente.
- **Aceitação:** concessão individual autorizada persiste com revisão/auditoria; composição de padrão/exceção é explícita; negação funciona na API/RPC; trocar cargo não amplia acesso inadvertidamente; revogação entra em vigor conforme contrato por operação.
- **Testes:** matriz Dono/Gestor/Colaborador/Master/anon, default deny, campos privados, revisão obsoleta, chamada direta e revogação concorrente.
- **Prioridade:** **P0**. Pendente: precedência de negações/concessões individuais, cargos padrão e quem pode delegar; preservar tetos atuais até evolução revisada.

### HH-17 — Colaborador provisório

- **Regra:** permitir cadastro provisório por no máximo 24 horas, com expiração efetiva e regularização controlada.
- **Estado/evidência:** **Ausente**. Criação de colaborador em [Home](../src/app/page.tsx), linha 2509, não possui prazo/estado provisório. [v5](invitation-lifecycle-v5.md) limita autorizações de convite, não concede acesso provisório de 24 horas.
- **Módulos/dependências:** equipe, convites, HH-16/18/19; estado próprio, relógio do servidor, regularização e retenção auditáveis.
- **Segurança/dados:** cadastro não é login. Definir se há acesso Auth; nenhum acesso provisório pode sobreviver à expiração por sessão antiga, job atrasado ou simples mudança de relógio do navegador.
- **Aceitação:** prazo máximo validado no servidor; após o limite, ações dependentes de autorização provisória são recusadas; regularização exige ator autorizado; histórico é preservado; tentativa nova não renova prazo indevidamente.
- **Testes:** antes/em/depois de 24 horas, espera por locks, reenvio, relógio do cliente, concorrência com regularização e JWT/sessão preexistentes.
- **Prioridade:** **P1**. Pendente: escopo exato do provisório, acesso permitido, requisitos de regularização e tratamento de registros não regularizados.

### HH-18 — Bloqueio e revogação

- **Regra:** bloquear/revogar acesso de forma segura, com restauração explícita, isolamento por tenant e histórico.
- **Estado/evidência:** **Parcial**. `erp_set_employee_active`, `erp_revoke_membership`, `erp_restore_membership` e recuperação coordenada existem; v5 coordena locks. Porém, excluir funcionário na [Home](../src/app/page.tsx), linha 1197, só remove item do JSON; busca em `src/` não encontra chamada aos RPCs de lifecycle/revogação. Bloqueio de empresa no Master é outro mecanismo.
- **Módulos/dependências:** Auth, membership, equipe, HH-16/19 e comandos de negócio.
- **Segurança/dados:** excluir linha visual não revoga credencial. JWT ainda válido não pode autorizar ação empresarial revogada; restaurar não deve reintegrar privilégios implicitamente nem apagar histórico.
- **Aceitação:** comando e UI refletem o bloqueio confirmado; novas operações sob sessão antiga são negadas; restauração exige decisão e conjunto de permissões revisado; banco e interface convergem sem sucesso otimista falso.
- **Testes:** RPCs históricos mais fluxo API real, sessões anteriores, outra empresa do mesmo usuário, concorrência com convite/atendimento, manutenção e rollback.
- **Prioridade:** **P0**. Não prometer cancelamento retroativo de instruções já concluídas; documentar o limite transacional.

### HH-19 — Retirada progressiva de `tenant_data`

- **Regra:** substituir o agregado legado por domínios normalizados com autorização no servidor e transição reconciliada.
- **Estado/evidência:** **Parcial**. As tabelas e mecanismos de Fase 2A/v3/v4/v5 existem; [dbService](../src/lib/dbService.ts), linhas 23–59, permanece no agregado, chamado pelas duas páginas. O [runbook normalizado](../supabase/recovery/phase-2a-resume-normalized.sql) fecha o legado; não é compatível com conservar esses consumidores como fluxo final.
- **Módulos/dependências:** todos os módulos empresariais, contratos DTO, comandos por registro, mapeamento de IDs e procedimento de corte autorizado.
- **Segurança/dados:** não usar fallback para `all_data`, dual-write sem reconciliação ou substituição de coleção filtrada; limpar caches por usuário/tenant/logout e não carregar campos proibidos no browser.
- **Aceitação:** domínio piloto usa exclusivamente projeção/RPC autenticada; ator/tenant vêm de sessão e vínculos confiáveis; erro 42501 não vira sucesso vazio; dry-run compara relações, contagens e valores; corte preserva dados e referência; reversão segura mantém negação em vez de reabrir o legado.
- **Testes:** matriz RLS real, chamada direta, DTO mínimo, versão obsoleta, cache após troca/revogação, dados incompletos, corte/rollback e integridade v4/v5.
- **Prioridade:** **P0**, base do roadmap. Escritas/criação/exclusão de muitos domínios ainda exigem comandos novos; não ampliar DML direto.

### HH-20 — Mostrar/ocultar senha

- **Regra:** alternar visibilidade sem alterar o valor ou enviar o formulário.
- **Estado/evidência:** **Ausente**. Login em [AuthEntry](../src/components/auth/AuthEntry.tsx), linha 63, e primeira senha/recuperação em [PasswordFlow](../src/components/auth/PasswordFlow.tsx), linhas 38–39, usam `type="password"` fixo; formulários de conta também não possuem alternância de visibilidade.
- **Módulos/dependências:** login, ativação, recuperação e conta; inventariar todos os campos, sem modificar autenticação.
- **Segurança/dados:** manter oculto inicialmente; botão não registra senha, não persiste visibilidade em cache e tem `type="button"`/estado acessível.
- **Aceitação:** mouse/teclado alternam cada campo, valor e foco são preservados, rótulo comunica estado; envio e autocomplete continuam corretos.
- **Testes:** componente, teclado, confirmação independente, loading/erro e verificação de ausência de logs com segredo.
- **Prioridade:** **P2**, lote visual independente de banco.

### HH-21 — Rolagem de Meus Planos no modo claro

- **Regra:** rolar e ler planos/consultorias no tema claro sem conteúdo cortado, contraste inadequado ou controles inacessíveis.
- **Estado/evidência:** **Não verificado**. Há `overflow-y-auto` no conteúdo principal ([Home](../src/app/page.tsx), linha 865) e lista interna com fundo/limite de altura fixos, linha 1601; isso não comprova correção do defeito relatado. Não foi reproduzido neste levantamento.
- **Módulos/dependências:** Meus Planos nas duas páginas, tema e HH-22; reprodução com viewport e conteúdo definidos.
- **Segurança/dados:** ajuste CSS deve preservar botões e condições de acesso; não alterar pagamento/contrato para corrigir rolagem.
- **Aceitação:** reproduzir antes; alcançar último cartão/ação por toque, roda e teclado no claro e escuro; não criar rolagem horizontal indevida ou sobreposição de modal.
- **Testes:** screenshots e navegação em tamanhos definidos, zoom, conteúdo extenso e comparação claro/escuro.
- **Prioridade:** **P2**, independente após reprodução. A navegação vazia do funcionário para upgrade é evidência complementar da auditoria anterior, mas sua correção não está autorizada implicitamente como regra comercial nova.

### HH-22 — Responsividade

- **Regra:** utilizar o sistema em celular, tablet e desktop com navegação e formulários acessíveis.
- **Estado/evidência:** **Parcial**. Home possui menu móvel, `p-4 lg:p-8` e grids responsivos; Equipe mantém `p-8` no corpo, linha 804, e vários modais não limitam altura/rolagem. Breakpoints no código não certificam a experiência em dispositivos.
- **Módulos/dependências:** layout, Home, Equipe, Master e Auth; catálogo de componentes compartilhados e matriz de viewports.
- **Segurança/dados:** não esconder mensagens de erro, consentimento ou ações de saída/revogação; reorganizar layout sem relaxar autorização.
- **Aceitação:** páginas e modais principais operáveis em celular/tablet/desktop, retrato/paisagem; sem cortes e ações inacessíveis; teclado virtual, zoom e foco não bloqueiam o fluxo.
- **Testes:** visual/E2E em pelo menos 360, 768 e 1280 px como matriz inicial proposta; texto longo, listas vazias/extensas, claro/escuro e teclado.
- **Prioridade:** **P2**, por componente/tela, não reescrita global obrigatória.

### HH-23 — PWA instalável

- **Regra:** experiência instalável compatível com os navegadores suportados.
- **Estado/evidência:** **Ausente**. [layout](../src/app/layout.tsx) declara favicon/metadata; não há manifest PWA, service worker ou fluxo de instalação no código versionado. Instalação PWA não implica autorização de operações offline.
- **Módulos/dependências:** shell, assets, HH-22/25, origem segura e política de atualização/cache/logout revisada.
- **Segurança/dados:** não armazenar tokens, respostas privadas ou dados de um tenant para outro; conteúdo autenticado precisa de estratégia explícita. Não habilitar escrita offline ou replay de operações financeiras automaticamente.
- **Aceitação:** instalação e abertura standalone nos navegadores suportados; ícones/escopo corretos; atualização não mantém código inseguro indefinidamente; logout/troca de usuário não revela dados privados; indisponibilidade de rede recebe estado seguro.
- **Testes:** instalação/atualização, cache inspecionado, logout, troca de tenant, conexão perdida e suporte real Android/iOS/desktop.
- **Prioridade:** **P3**. Pendente: navegadores suportados e nível de uso offline, sem promessa adicional.

### HH-24 — Menu por categorias

- **Regra:** agrupar módulos existentes em categorias compreensíveis, preservando acesso por perfil/plano.
- **Estado/evidência:** **Parcial**. Menu existe, mas `allTabs` é lista plana ([Home](../src/app/page.tsx), linhas 687–701; Equipe, linhas 663–677). Não há agrupamento por categorias.
- **Módulos/dependências:** navegação das duas páginas e HH-22; rótulos/grupos propostos devem receber revisão do produto.
- **Segurança/dados:** categoria visível não concede permissão; links não podem expor módulo proibido nem criar rota de bypass.
- **Aceitação:** todos os módulos existentes continuam acessíveis aos mesmos perfis; categoria vazia não aparece; localização atual é clara; teclado/menu móvel funcionam.
- **Testes:** matriz de papel/plano, categorias vazias, seleção, navegação por teclado e telas pequenas.
- **Prioridade:** **P2**, independente. Proposta de agrupamento: Operação, Cadastros, Financeiro e Administração; nomes ainda não são decisão aprovada.

### HH-25 — Sobre Nós e instalação

- **Regra:** página Sobre Nós com instruções reais de instalação e contatos oficiais.
- **Estado/evidência:** **Ausente**. Inventário de `src/app/` contém Home, Equipe, Master e páginas Auth; nenhuma página Sobre Nós. Não há instruções PWA verificadas no frontend.
- **Módulos/dependências:** conteúdo institucional, navegação, HH-26 e HH-23 para instruções finais de instalação.
- **Segurança/dados:** conteúdo público não deve incluir fixtures, credenciais ou contatos pessoais herdados; não divulgar suporte/recursos não existentes.
- **Aceitação:** página acessível no fluxo aprovado, texto revisado e contatos corretos; instruções distinguem plataformas suportadas e só prometem instalação efetivamente disponível.
- **Testes:** navegação, links, acessibilidade, responsividade e reprodução das instruções por plataforma.
- **Prioridade:** **P2** para conteúdo institucional; seção de instalação depende de HH-23. Pendente: texto e caráter público/autenticado da página.

### HH-26 — Contatos oficiais

- **Regra:** exibir **+55 37 9855-8658** e **adm.handyhub@gmail.com** nos pontos institucionais/de suporte aprovados.
- **Estado/evidência:** **Ausente**. Busca desses valores em `src/` não encontrou uso. Exemplos de usuários/empresas em [configuração](../src/config/modules.ts) e [saasConfig](../src/lib/saasConfig.ts) não são os contatos oficiais do produto.
- **Módulos/dependências:** HH-25, suporte e Meus Planos quando aplicável; fonte única de contatos e revisão dos pontos de exposição.
- **Segurança/dados:** separar suporte HandyHub dos contatos de cada tenant; nenhum envio de mensagem automática está autorizado por essa inclusão.
- **Aceitação:** número/e-mail iguais em todos os pontos aprovados; links `tel:`/`mailto:` corretos; eventual link WhatsApp usa número internacional completo e abre somente por ação do usuário.
- **Testes:** consistência de conteúdo, URLs e clique sem despacho automático; ausência de substituição dos contatos dos clientes/empresas.
- **Prioridade:** **P2**, lote independente de dados e serviços.

## 5. Roadmap proposto: lotes pequenos com gates

Cada lote deve conter contrato/regra explícitos, implementação mínima, fixtures sintéticas, teste reprodutível e revisão do diff. Quando alterar objetos protegidos, exige nova migration aditiva e evolução de integridade revisada; não editar selos antigos nem recalcular âncora para aceitar estado arbitrário.

| Lote | Entrega limitada | Dependências | Gate de aceitação |
| --- | --- | --- | --- |
| F0 | Preparação local e contrato do primeiro domínio de leitura | Nenhuma mudança hospedada; esclarecer bloqueios de perfil | Backend descartável, fixture A/B, contrato DTO e comando de reprodução; baseline preservada |
| F1a | Leitura própria da agenda por UUID/projeção mínima; primeiro trecho de HH-19 | F0 e RPC de leitura existente | API/página piloto sem fallback JSON; 42501 distinto de lista vazia; cache não cruza usuários/tenants |
| F1b | Integrar bloqueio/revogação/restauração HH-18 | F1a e contratos existentes | Sessão anterior perde novas ações; fluxo confirmado e auditado; históricos passam |
| F1c | Política por cargo e desenho/aplicação das exceções individuais HH-16 | F1b e decisões de delegação | Matriz de acesso, default deny, revisão e concorrência; sem GRANT amplo |
| F2a | Fontes financeiras normalizadas e CMV histórico HH-14 | HH-19 por domínio; política de custeio aprovada | Receita/custo/estoque reconciliados; histórico imutável e dados desconhecidos explícitos |
| F2b | DRE e caixa separados HH-14 | F2a e regras de competência/pagamento | Fixture financeira auditável, relatório/CSV coerentes; nenhuma perda retroativa |
| F3a | Documentos empresariais e titulares HH-01/02, duplicidades HH-03 | F1c, contratos novos e dry-run do legado | Validação no servidor, campos protegidos, concorrência de cadastro e dados antigos preservados |
| F3b | Responsáveis/dependentes HH-04 | F3a e regras de dependentes/fidelidade | Identidades e históricos individuais, sem usar CPF do responsável como identidade do dependente |
| F3c | Unificação HH-05 | F3b e matriz de autorização | Prévia, rastreabilidade, repetição segura e rollback completo |
| F4a | Jornada/qualificação HH-07 e reservas atômicas HH-08 | F1c/F3a; duração/fuso/estados definidos | Sobreposição/concorrência recusadas no banco; homônimos não interferem |
| F4b | Conversão/finalização HH-11/12 e notas HH-06 | F4a, F2a, identidade/atribuição | Uma transação, responsável autorizado, exceções auditadas e reenvio seguro |
| F5a | Promoções com data e desconto HH-13 | F4b/F2b e regras comerciais | Limites temporais, snapshot monetário e reconciliação |
| F5b | Faltas/remarcação HH-10 | F4b, política de 15 minutos aprovada | Fronteiras temporais e disputa com chegada/finalização verificadas |
| F5c | Notificações HH-09 | F4b e canal aprovado | Evento confirmado, entrega mínima sem duplicação nem destinatário revogado |
| F6a | Vigência e downgrade HH-15 | Contrato persistente e HH-16 | Redução somente na data efetiva; processamento repetido sem efeito duplicado |
| F6b | Cadastro provisório HH-17 | HH-16/18 e regra de acesso provisório | Expiração real em até 24 h; regularização/retenção sem bypass |
| V1 | Mostrar senha e contatos HH-20/26 | Revisão de componentes/conteúdo | Testes de teclado/links e nenhum efeito em autenticação/banco |
| V2 | Reproduzir/corrigir rolagem HH-21 e responsividade HH-22 por tela | Cenário reproduzível e matriz visual | Capturas antes/depois, sem alteração de regras funcionais |
| V3 | Categorias HH-24 e Sobre Nós HH-25 | Agrupamentos/texto aprovados | Mesma matriz de acesso; conteúdo sem promessas de instalação ainda indisponível |
| V4 | PWA HH-23 e completar instruções HH-25 | HH-22 e política de cache/sessão | Instalação/atualização e ausência de vazamento entre usuários/tenants |

F2 prioriza finanças antes de expansões de UX. F3a e contratos de identidade são pré-requisitos do fluxo final da agenda; F4 não deve vincular clientes/profissionais por nomes. F1a é apenas uma leitura piloto, não habilitação de novas escritas. V1/V2 podem avançar separadamente, mediante autorização, sem aguardar migrations ou liberação de produção. Não misturar esses lotes em uma única mudança extensa.

## 6. Dependências, bloqueios e decisões pendentes

### Técnicas e operacionais

- **Integração normalizada incompleta:** faltam adaptadores/projeções/comandos para vários domínios; permissões de estruturas pendentes devem continuar fechadas até contrato revisado.
- **Cutover com dados:** mapa de IDs, relatório de inconsistências, reconciliação financeira/referencial, escrita suspensa no corte autorizado e política de correção adiante. Não excluir legados inválidos nem reabrir acesso JSON como rollback.
- **Integridade e perfil hospedado:** v4/v5 possuem manifesto local revisado. Compatibilidade de owners/ACLs/roles no Supabase hospedado exige certificação independente; este documento não autoriza aplicação remota.
- **Auth/SMTP/PostgREST reais:** testes locais de banco não comprovam links de convite, entrega de e-mail, callbacks, JWT ou cache do schema do provedor. Ambiente de homologação explicitamente seguro e destinatários autorizados são pré-requisitos; produção não é fixture.
- **Tempos e locks:** usar relógio/estado do servidor e revalidação após locks; concorrência deve ser provada em PostgreSQL multi-backend. PGlite e mocks não substituem essa prova.
- **Frontend duplicado:** Home e Equipe replicam muitas regras. Mudanças devem cobrir ambos sem obrigar refatoração global como requisito adicional de produto.
- **Auditoria persistente:** logs de navegador/localStorage não substituem autoria/revisão transacional. Dados pessoais devem ter projeções e retenção definidas antes de expansão de caches/exportações.
- **Serviços de envio:** `saasNotifications` e WhatsApp atuais são simulações; não registrar entrega real a partir de `console.log` ou retorno booleano.

### Decisões do produto que não foram inventadas

1. Campos obrigatórios próprios de dependentes, múltiplos responsáveis, transferência e regras de fidelidade.
2. Política de duplicidade/CPF por tenant, perfis de exceção e campos predominantes na unificação.
3. Jornada, intervalos, turnos noturnos, buffers, qualificação e quem pode alterá-los.
4. Transição de falta aos 15 minutos, liberação de vaga e perfis de remarcação.
5. Validade da promoção na reserva versus atendimento e combinação de ofertas.
6. Método de custeio, competência, estorno e tratamento do histórico incompleto.
7. Composição de permissões individuais/cargos, exceções do Gestor e acesso provisório por até 24 horas.
8. Vigência contratual, solicitações pendentes e operações permitidas antes/depois do término.
9. Canal/eventos de notificação, texto institucional, categorias finais e suporte PWA/offline.

Essas decisões bloqueiam somente o lote dependente. Não impedem leitura segura, auditoria de contratos ou ajustes visuais independentes autorizados.

## 7. Testes e regra de conclusão de um item

Para cada ID, registrar o commit de implementação futuro, teste/comando, ambiente, resultado real e limitações. Não mudar estado para Implementado por existência de tela, teste com mocks ou aprovação de suíte sem cenários correspondentes.

- **Unitário/contrato:** entradas, campos permitidos, precisão, estados, formatação e matriz de decisão.
- **PostgreSQL descartável:** RLS/GRANTs, actor por `auth.uid()`, transações, conflito de versão, locks, expiração, concorrência e rollback. Usar a infraestrutura local validada, imagem fixada, rede `none`, tmpfs, sem portas/volumes externos, limpeza exclusivamente dos próprios IDs.
- **API e frontend local:** sessão real do ambiente de teste, chamada direta, DTO mínimo, erro versus vazio, navegação e mensagens sem sucesso fictício.
- **Dados de upgrade:** fixtures preexistentes, hashes/referências históricas, contagens/somas, vínculos, preservação de incompletos e rollback tardio.
- **Visual/acessibilidade:** viewports definidos, teclado/foco, temas, modais, texto longo e conteúdo vazio.
- **Integração hospedada:** somente homologação identificada/autorizada, sem envio a terceiros ou produção. Distinguir explicitamente simulação, teste local real e teste hospedado.

Referências de regressão existentes a selecionar conforme o lote: `tests/tenant-permissions.test.mjs`, `tests/tenant-domain-rls.test.mjs`, `tests/history-snapshots.test.mjs`, `tests/employee-lifecycle.test.mjs`, `scripts/test-appointment-read.py`, `scripts/test-product-concurrency.py`, `scripts/test-membership-revocation.py`, `scripts/test-membership-restoration.py`, `scripts/test-coordinated-recovery.py`, `scripts/test-recovery-integrity-v4.py` e `scripts/test-invitation-lifecycle-v5.py`. A existência deles não demonstra cobertura de duplicidades, dependentes, agenda concorrente ou DRE nova. Esta tarefa não os executou.

## 8. Primeira etapa segura recomendada

**F0/F1a: leitura própria da agenda no ambiente local descartável**, reutilizando `public.erp_read_own_appointments(p_tenant uuid)` ([definição existente](../supabase/migrations/20261011020000_erp_own_appointments_read.sql), linha 37) e seu contrato mínimo, com fixture de dois tenants e profissionais homônimos.

Antes de escrever código funcional, obter autorização para esse lote. Depois, delimitar uma página/fluxo piloto, validar sessão/membership no servidor, tratar negação separadamente de lista vazia e integrar a projeção por UUID sem consultar `all_data`. Reusar o teste de leitura própria e acrescentar prova de contrato API/DTO/cache por usuário e tenant. Não liberar novas escritas nem mudar GRANTs para acomodar o legado.

Entrega esperada do lote: um fluxo de leitura reproduzível e seguro, critérios de isolamento demonstrados, restante do produto preservado e plano explícito para o próximo domínio. Não representa cutover completo, deploy ou conclusão da Fase 2A.

Alternativa visual independente, se priorizada pelo proprietário: V1, mostrando/ocultando senha e centralizando os dois contatos oficiais, sem alterar autenticação ou dados. Essa alternativa não substitui as prioridades de segurança e integridade.

## 9. Controle desta consolidação

- O único arquivo criado no projeto é `docs/BACKLOG-HANDYHUB.md`.
- Os 22 arquivos não rastreados preexistentes, evidências, backups e rascunhos foram preservados.
- As migrations históricas e v3/v4/v5 permanecem intactas; nenhuma funcionalidade foi modificada.
- As verificações desta tarefa são de conteúdo/preservação do documento e do repositório, não aprovação funcional das melhorias.
- Não houve acesso a banco remoto, alteração de ambiente, execução de serviço de envio, migration, commit, push, PR ou deploy.
- Este backlog mantém 26 IDs estáveis. Pendências técnicas e lotes são decomposição dessas melhorias, não funcionalidades adicionais aprovadas.
