# Fase 2A — SQL com LF no Windows

Base: `e46d15d`, branch `codex/tenant-permissions-phase-2a`.

## Causa e correção

A política anterior, `* text=auto`, normalizava o conteúdo versionado, mas não
fixava as quebras de linha no checkout. Com `core.autocrlf=true`, 14 das 17
migrations e os três runbooks de recuperação estavam materializados com CRLF.
As definições SQL participam dos digests dos recovery seals; a execução desses
arquivos bloqueava quatro suítes com SQLSTATE `55000`,
`RECOVERY_UNREVIEWED_SCHEMA`.

A regra versionável `*.sql text eol=lf` em `.gitattributes` fixa LF para SQL,
inclusive quando o Git do Windows usa `core.autocrlf=true`. Nenhuma configuração
Git local ou global foi alterada. Novos clones recebem essa política quando a
alteração for publicada; clones do commit antigo conservam a política anterior.

Antes de regravar arquivos, todos os 24 SQL foram comparados com os blobs do
commit inicial e do índice. Não havia alterações locais de conteúdo. Seus bytes
originais foram preservados fora do repositório; apenas os 17 arquivos com CRLF
foram regravados, substituindo CRLF por LF. Não houve renormalização global.

## Verificação

- Os 24 SQL do checkout usam LF e são byte a byte idênticos aos blobs de `e46d15d`.
- Os SHA256 das 17 migrations versionadas permanecem idênticos antes/depois.
  Os hashes físicos dos 14 arquivos antes em CRLF mudaram somente porque suas
  quebras de linha passaram a corresponder aos bytes LF já armazenados no Git.
- Recovery seals v1/v2, digests, invariantes e código de testes permanecem intactos.
- O filtro de checkout dos 24 SQL foi validado com `core.autocrlf=true` e
  `core.eol=crlf`: a regra específica preservou LF e os hashes originais.
- `node --test --test-reporter=tap`, executado no checkout normal do projeto:
  antes, 67 aprovados e quatro suítes bloqueadas; depois, **108 aprovados,
  nenhuma falha**, incluindo as quatro suítes anteriormente bloqueadas.
- Os testes usam PGlite em memória e mocks; não houve acesso a banco remoto.

Esta correção trata somente das quebras de linha. Não altera validação hospedada,
backups, integração do modelo normalizado ou as demais pendências da Fase 2A.
Não houve instalação de dependências, commit ou push nesta execução.
