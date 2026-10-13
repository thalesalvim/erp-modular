# Fase 2A — infraestrutura PostgreSQL local e descartável

Base: `2f448bb`, branch `codex/tenant-permissions-phase-2a`.
Esta entrega modifica somente infraestrutura/testes locais e documentação.
Não instala Docker/WSL2 nem executa os harnesses PostgreSQL reais.

## Causas e proteção do destino

Os dez entrypoints herdavam o contexto e as variáveis de conexão do Docker,
sem comprovar o destino. Agora compartilham `scripts/postgres_harness.py`.

Antes de acessar um daemon, a infraestrutura rejeita overrides `DOCKER_HOST`,
`DOCKER_CONTEXT`, `DOCKER_CONFIG`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`,
`DOCKER_CUSTOM_HEADERS` e `DOCKER_API_VERSION`, inclusive valores vazios.
Lê apenas os metadados locais do contexto e valida o endpoint, além do nome:

| Plataforma/contexto | Endpoint permitido |
|---|---|
| Windows, `desktop-linux` ou `default` | `npipe:////./pipe/dockerDesktopLinuxEngine` |
| Linux, `default` | `unix:///var/run/docker.sock` |
| Linux, `desktop-linux` | `unix://<home>/.docker/desktop/docker.sock` |

Unix exige um socket local existente. TCP, SSH, pipes em outra máquina,
contextos não listados, endpoints diferentes e plataformas não cobertas são
recusados. O nome `desktop-linux` sozinho não autoriza qualquer endpoint.
No Windows, o pipe genérico `docker_engine` não está autorizado.

Após a validação, todos os comandos de daemon incluem o mesmo `--host` explícito.
O ambiente dos subprocessos é uma cópia filtrada e imutável; remove configurações
Docker e credenciais Supabase/PostgreSQL/aplicação sem alterar `os.environ`.
Confere engine Linux e identidade do daemon; verifica novamente essa identidade
antes de preparar recursos e de removê-los. Não baixa imagens automaticamente.

## Propriedade, inicialização e encerramento

A limpeza antiga era registrada antes de `docker run` e removia pelo nome baseado
em PID. Uma colisão poderia remover um container preexistente.

Cada execução/recurso agora possui UUID e labels próprios. `docker create`
usa a imagem já fixada por digest, `--pull=never`, `--rm`, `--network none`,
`--tmpfs /var/lib/postgresql/data` e nenhuma porta, bind mount ou volume externo.
Somente uma criação bem-sucedida com ID completo e inspeção coincidente de ID,
nome e labels estabelece propriedade. Confere imagem e isolamento antes de
iniciar e novamente antes de executar programas/SQL.

Inicialização é uma operação separada. Falha após propriedade comprovada,
timeout de prontidão e interrupção acionam limpeza por ID, nunca pelo nome.
Antes da remoção, revalida propriedade. Uma falha de inspeção não é tratada
automaticamente como ausência: exige listagem bem-sucedida que prove ausência.
Não há prune, remoção por prefixo ou descoberta de recursos para exclusão.
O cluster auxiliar de lifecycle segue a mesma infraestrutura.

## Bytes SQL e compatibilidade Windows

`subprocess.run(..., input=sql, text=True)` convertia LF em CRLF no Windows.
O recorder Node e a leitura dos arquivos usam bytes com UTF-8 explícito.
Todo SQL entra em `docker exec` como bytes UTF-8, sem modo texto ou conversão
de quebras de linha. A conexão de teste `seal_pool_probe` também usa esse caminho.
Resultados são decodificados explicitamente para manter a interface das asserções.

Não há alteração de migrations, runbooks SQL, schemas, selos, digests ou regras
de negócio. Preparações históricas anteriores a v1/v2 continuam filtrando as
migrations respectivas; a atualização não cria um bypass de integridade.

## Validação offline

```powershell
python -B tests/test_postgres_harness.py
node --test --test-reporter=tap
git diff --check
```

As regressões usam um Docker simulado em memória. O único subprocesso real na
suíte nova é um eco Python local para comprovar bytes LF/UTF-8 no Windows.
Importar os dez entrypoints é verificado sem permitir subprocessos.
Cobrem endpoints/contextos, identidade do daemon, colisões/falhas parciais,
propriedade, isolamento, remoção por ID, interrupções, codificação e diagnósticos
sem valores sensíveis. O inventário dos cenários PostgreSQL anteriores permanece.

Resultado nesta execução: **38 regressões offline aprovadas**, **108 testes
Node/PGlite aprovados**, sintaxe dos dez harnesses e dos dois arquivos Python
novos validada, `git diff --check` aprovado. As 17 migrations continuam byte a
byte idênticas a `e46d15d`; arquivos de ambiente, evidências e RAR foram preservados.

## Limites

- Compatibilidade operacional com Docker Desktop/WSL2 e PostgreSQL real ainda
  precisa de ensaio autorizado; Docker e WSL2 não estão instalados neste computador.
- A proteção pressupõe uma instalação confiável do Docker CLI e daemon local.
  Não pretende neutralizar administrador local ou daemon malicioso.
- Contextos rootless/customizados e macOS não são autorizados automaticamente.
- Criação ambígua ou inspeção sem prova de propriedade deixa o recurso sem
  remoção, deliberadamente. Perda do processo/daemon pode deixar recurso órfão;
  não existe limpeza automática de recursos de outra execução.
- Aprovação offline não certifica Supabase hospedado, recuperação de backup,
  durabilidade física de tmpfs ou as demais pendências da Fase 2A.

Nenhuma credencial real é carregada pelos testes novos. Não houve instalação,
container real, acesso a banco remoto, commit ou push nesta entrega.
