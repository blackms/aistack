> **Nota.** Le affermazioni sui competitor provengono da una mappa competitiva esterna (mag-2026) e NON sono verificate contro il codice; solo i claim su aistack sono verificati sull'inventario del repo.

# aistack vs Claude Code nudo — Report strategico di posizionamento

*Basato esclusivamente su: inventario repo `aistack` v1.6.1, capacità native Claude Code (stato 2026), mappa competitiva maggio 2026. Nessun claim oltre questi materiali.*

> **Domanda centrale**: perché un utente dovrebbe usare aistack invece di Claude Code nudo, che è già potentissimo?
> **Risposta in una riga**: per quasi tutti gli use-case *single-machine, single-sessione, single-repo* non c'è motivo. aistack diventa difendibile solo quando servono **durabilità dello stato, cross-machine/federazione, governance & evidence enterprise** — esattamente i tre gap che Claude Code dichiara di NON coprire.

---

## 1. VALORE REALE — dove aistack aggiunge valore concreto e difendibile oggi

Filtro applicato: una feature porta valore reale solo se (a) esiste e è matura in `main`, **e** (b) copre un gap che Claude Code esplicita di non coprire o che i competitor enterprise fanno pagare caro. Le feature che esistono ma duplicano il nativo sono declassate alla sezione 2.

### A. Durabilità dello stato di orchestrazione *(gap nativo #2)*
Claude Code dichiara stato dei team **effimero** (no resume teammate), task list persi su interruzione, memory **machine-local**. aistack ha l'infrastruttura di persistenza che manca:

- **Durable execution / checkpointer** — `src/persistence/checkpointer.ts` (434 righe, gzip, replay deterministico, migrazione 004). *Completo.* È ciò che permette di riprendere un'orchestrazione interrotta, cosa che i teammate nativi non sanno fare.
- **HITL primitives persistenti** — `src/coordination/interrupt.ts` con `interrupt()`/`resumeInterrupt`, persistenza pluggable su Checkpointer, notify console/slack, path CLI+Web+REST. *Completo.* Il plan-mode nativo dà HITL ma effimero entro la sessione; qui il pause/resume sopravvive a riavvii.
- **Consensus service durevole** — `src/tasks/consensus-service.ts`: checkpoint lifecycle pending→approved/rejected/expired, audit integration, risk-gating. *Completo.* Gate di approvazione con stato persistito e tracciato.

### B. Cross-machine / federazione *(gap nativo #1 — il più difendibile)*
Tutto il nativo (subagents, Agent Teams, Agent View) è **esplicitamente single-machine/local**. Questo è l'unico spazio dove aistack offre una capacità che Claude Code *non ha affatto*:

- **Multi-machine federation** — `src/federation/` completo: discovery mDNS/static/registry con beacon signer, transport mTLS con CN/SAN pinning, sanitizzazione egress (solo metadata task, nessun codice/memory). Test inclusi `integration/federation-3node.test.ts`. *Completo.* Tra i competitor solo claude-flow la rivendica (enforcement contestato) e Devin via "multi-Devin" (cloud chiuso). Per un orchestratore Claude-Code-native self-hostable è una dimensione rara.

### C. Governance & evidence enterprise *(gap nativo #3 + gate d'acquisto competitivo)*
Claude Code consuma quota 1:1, nessun budget cap, nessuna spend attribution. Lato competitivo, SSO/SCIM e compliance sono lo spartiacque enterprise-vs-hobby (Factory/Devin sì; claude-flow/Aider/runner no). aistack ha qui il suo pacchetto più solido **e già in main**:

- **SSO (SAML/OIDC) + SCIM 2.0** — `src/auth/sso/` maturità alta: SAML hardened (replay cache, preflight XXE, assertion signing), OIDC con PKCE/state/nonce, SCIM RFC 7644 con bearer+rate-limit+409. Dipendenze reali (`@node-saml/node-saml`, `openid-client`). *Completo.* Questo è precisamente ciò che separa le piattaforme enterprise dai progetti hobby nella mappa competitiva, e Claude Code non lo offre a livello di orchestrazione.
- **Audit log tamper-evident** — `src/audit/chain.ts`: hash-chain SHA-256, HMAC, append-only, integrato in consensus/identity/memory. *Completo.* Pensato per evidence SOC2/ISO27001/HIPAA. È la base di credibilità compliance.
- **Multi-tenancy** — `src/multitenancy/service.ts`: tenant+workspace+membership/RBAC, opt-in. *Completo (base layer, dichiarato tale).* Più team/org isolati nello stesso deployment — assente nei runner singolo-utente, rilevante per piattaforme.
- **Deploy self-host completo** — Dockerfile multistage (<200MB) + `charts/aistack/` (11 template K8s: deployment, networkpolicy, PDB, secret, pvc, ingress…) + `docs/DEPLOY.md`. *Completo.* Abilita on-prem/air-gapped/VPC: sovranità del dato che il cloud Claude (Routines, Claude Code on web) non dà.

### D. Differenziatori di prodotto reali (mappati al "massimo differenziatore" competitivo)
- **Review loop coder+adversarial** — `src/coordination/review-loop.ts` (481 righe), itera fino a APPROVED/REJECTED con maxIterations, semaforo concorrenza, **con enforcement reale e testato** (unit+integration). Nella mappa competitiva il review/consensus adversariale è *il massimo differenziatore*, ed è esattamente il punto debole pubblico di claude-flow (success auto-dichiarato senza enforcement). aistack ha enforcement vero, non self-reported. *Completo.*
- **OpenTelemetry observability** — `src/observability/tracing.ts`: spans per agent/LLM/MCP/memory/consensus/review-loop, privacy-by-default, opt-in. *Completo.* Abilita la spend/cost-attribution che il nativo non dà (anche se il backend Jaeger/collector resta da gestire).
- **MCP battle pack** — `src/integrations/`: bridge-sync che genera `.mcp.json` per Postgres/GitHub/Sentry/Playwright/Slack, no process spawning. *Completo.* Nota: questo *fornisce* MCP server, coerente con la raccomandazione "non rimpiazzare il client MCP nativo, ma offrire server".
- **Portable agent file** — `src/agents/portable.ts` + schema, export verso `.claude/agents/*.md`. *Completo.* Interoperabilità nel mondo AGENTS.md/MCP-standard.
- **Memory tiers OS-style** — `src/memory/tiers/`: working/recall/archival con gzip e auto-paging, migrazione 009. *Completo.* La auto-memory nativa è machine-local e flat; il tiering + (combinato con federazione) la persistenza condivisa è un'estensione genuina.

**In sintesi sezione 1**: il valore reale e difendibile di aistack si concentra in **tre cluster** — durabilità, cross-machine, governance/evidence — più due differenziatori di prodotto credibili (review-loop con enforcement reale, observability). Tutto questo esiste e è maturo in `main`.

---

## 2. RIDONDANZE — dove aistack duplica o è inferiore al nativo

Onestà richiesta: per gli use-case sotto, **non c'è motivo di usare aistack invece di Claude Code nudo**. Reimplementarli è spreco di effort e superficie d'attacco.

| Capacità aistack | Equivalente nativo Claude Code | Verdetto |
|---|---|---|
| Spawn/delega sub-agent isolati (review-loop come *meccanismo di spawn*, A2A intra-host) | **Subagents** (context isolato, tools allowlist, model, worktree isolation) | **Ridondante** per fan-out di task indipendenti single-sessione. Il *valore* del review-loop resta l'enforcement adversariale, non lo spawn. |
| Coordinamento multi-agente single-machine (A2A `src/a2a/`, routing intra-host) | **Agent Teams** (shared task list + mailbox `SendMessage` + dependency graph, file-locking) | **Ridondante single-machine.** Claude Code copre nativamente proprio ciò che molti orchestratori vendevano. A2A si difende solo come trasporto *cross-machine* (cfr. federazione), non come coordinamento locale. |
| Dispatch + monitoring sessioni parallele (daemon/web UI) | **Agent View** + supervisor per-utente + git worktrees automatici | **Ridondante per il control-plane locale.** Non costruire un dashboard di sessioni locali: il nativo persiste, riconnette, isola su worktree. Lo spazio è solo cross-machine/multi-repo. |
| **Guardrails framework** (`src/guardrails/`) | **Hooks** (PreToolUse blocca+modifica input, ~25 eventi, enforcement deterministico, 6 scope) | **Doppiamente debole.** (1) Gli Hook nativi sono il modo canonico per policy/quality-gate. (2) Peggio: i guardrails aistack sono **codice orfano** — non wired in review-loop/spawner, non esportati da `src/index.ts`. Oggi non danno valore a nessuno. Da agganciare-via-hook o deprecare. |
| Workflow DSL YAML + slash-command-like | **Skills + Slash Commands unificati** (progressive disclosure, model-invoked, bundle, standard aperto) | **Ridondante per packaging di workflow riusabili.** Un orchestratore che "definisce workflow riusabili" è ridondante: distribuirsi *come* Skill/Plugin, non reinventare. |
| MCP tool registry interno ("46 tools" dichiarati, 7 set registrati) | **MCP client maturo** (Tool Search, OAuth/DCR, channels, auto-reconnect, `mcp serve`) | **Non competere sul client MCP.** Fornire server (battle pack) è ok; un tool-bus proprio no. Nota: discrepanza README→codice (46 dichiarati vs 7 set registrati) erode credibilità. |
| Plan/approve intra-sessione | **Plan Mode** (read-only → ExitPlanMode → approval, HITL nativo) | **Ridondante** per plan→approve→execute entro sessione. Il valore HITL aistack è solo la *persistenza* del pause/resume oltre la sessione. |
| Scheduling locale (eventuale "cron per Claude Code") | **Routines** (compute Anthropic, cron senza macchina locale accesa) + `/loop` | **Ridondante.** Non vendere "cron per Claude Code". Resta valore solo nell'orchestrazione durevole multi-step/multi-repo *attorno* alle routine. |
| IDE extension JetBrains (scaffold) / VS Code (parziale) | **IDE Integration nativa** (inline diff, plan review, checkpoint/rewind UI, MCP `ide`) | **Ridondante e inferiore.** VS Code aistack è parziale, JetBrains è solo scaffold Gradle senza Kotlin. Il nativo è enormemente più avanti. Non competere sulla UX IDE. |

Inoltre, problematiche di credibilità **interne** che indeboliscono il pitch e vanno sistemate prima di vendere:
- **SOC2 compliance pack (AIG-648)**: ASSENTE in main (solo branch). In main c'è *solo* l'audit log "SOC2-ready" + `docs/AUDIT.md`. Niente mapping CC6, policy, evidence CLI. **Non rivendicare "compliance pack" finché non è mergiato.**
- **Plugin bundle Claude Code (AIG-629 → shipped via AIG-866)**: ✅ in main, sotto `plugin/` (manifest + skills + slash-commands + MCP server bundled). aistack ora si distribuisce *come* plugin Claude Code — la strada raccomandata. Install one-command via marketplace catalog richiede ancora la pubblicazione del catalog root (owner-approval); l'install locale `claude --plugin-dir ./plugin` è già funzionante.
- **SWE-bench harness**: auto-dichiarato STUB, nessun run reale (solo EXAMPLE_OUTPUT). **Non citare numeri SWE-bench** (sarebbe lo stesso peccato di claude-flow).
- **Vector WASM**: funziona solo con optionalDependencies installate; cap memoria dichiarato ma non enforced.

**Verdetto sezione 2**: per single-machine / single-sessione / single-repo, Claude Code nudo (+ subagents + teams + agent view + hooks + skills) è sufficiente e spesso superiore. aistack lì non ha motivo d'essere.

---

## 3. GAP & PROPOSTE — funzioni che né Claude Code né i competitor hanno

Criterio: ogni proposta deve (a) attaccare un gap che Claude Code dichiara di non coprire **o** una debolezza pubblica dei competitor, **e** (b) poggiare su asset *già esistenti* in `main` (massimizza impatto/effort). Ordinate per **rapporto impatto/effort decrescente**.

| # | Proposta | Problema utente risolto | Impatto | Effort | Razionale (asset esistenti + gap mercato) |
|---|---|---|---|---|---|
| 1 | ✅ **SHIPPED — Distribuire aistack come plugin Claude Code** (AIG-629 → AIG-866: manifest + skills + commands, sotto `plugin/`) | "Voglio durabilità/federazione/governance senza abbandonare il flusso Claude Code" | Alto | **Basso** | Bundle mergiato in main (`plugin/`). Sblocca distribuzione/versioning nativi (Plugins/Marketplace) ed è la strada esplicitamente raccomandata: distribuirsi *come* plugin, non costruire un package manager. Install locale via `claude --plugin-dir ./plugin`; one-command marketplace al publish del catalog root. |
| 2 | **Cost/budget governance + spend attribution** (dashboard su OTel esistente: budget cap per team/progetto/agent-pattern, kill-switch a soglia) | "Claude Code consuma quota 1:1, non so quanto spende ogni team/progetto e non posso mettere un tetto" | Alto | **Medio** | È il **gap più citato anche da fonti terze** e Claude Code *non lo copre*. aistack ha già spans OTel per agent/LLM/MCP/consensus e multi-tenancy per attribuire la spesa: manca lo strato budget-cap+report. Nessun competitor OSS Claude-native lo offre. |
| 3 | **Wire dei guardrails nel review-loop + esporli come Hook** (agganciare `src/guardrails/` a review-loop/spawner; esportare da `index.ts`; offrirli come hook PreToolUse) | "Voglio gate PII/secrets/prompt-injection deterministici nel flusso multi-agente durevole" | Medio | **Basso** | Il *motore* guardrails è già completo e testato — è solo orfano. Wirearlo trasforma codice morto in differenziatore, integrandosi con il sistema Hook nativo invece di duplicarlo. Quick win di pura integrazione. |
| 4 | **Resume/rewind durevole dei teammate cross-sessione** (esporre checkpointer+interrupt come backend di persistenza per team di sub-agent) | "I teammate nativi sono effimeri: se interrompo, perdo lo stato del team" | Alto | Medio | Gap nativo esplicito ("no resume/rewind teammate in-process, stato effimero"). aistack ha già checkpointer (replay deterministico) + interrupt persistente. Serve l'adapter verso il modello team. |
| 5 | **Memory federata cross-machine** (combinare memory tiers + federation per recall condiviso tra host/team) | "La auto-memory nativa è machine-local: i miei agenti su macchine diverse non condividono memoria" | Alto | Medio | Gap nativo esplicito (memory machine-local). Esistono già *separatamente* memory tiers (working/recall/archival) e federation con egress sanitizzato; manca il ponte memory↔federazione. Capacità che nessun competitor mappato offre. |
| 6 | **Completare SOC2 compliance pack come evidence-as-code** (mergiare AIG-648: mapping CC6, policy, `compliance.ts` CLI che genera evidence dall'audit-chain) | "Devo superare un audit SOC2/ISO e mi serve evidence riproducibile, non solo log" | Alto | Medio | L'audit-chain tamper-evident in main è la base; il pack (mapping+policy+evidence CLI) è già scritto sul branch `aig-648`. Trasformerebbe aistack nell'unico OSS Claude-native con evidence-as-code (Factory ha SOC2/ISO ma è chiuso e a pagamento; OpenHands non ha SOC2 confermato). |
| 7 | **Coordinamento cross-repo / governance attorno alle Routine cloud** (orchestrare task durevoli multi-repo su federation, con audit+budget) | "Ho N repository e voglio un'orchestrazione governata che il nativo (single-repo, no governance) non dà" | Medio | Alto | Gap nativo (Agent View no multi-repo centralizzato; Routine cloud senza governance enterprise). Richiede però comporre federation+multitenancy+audit in un layer nuovo: effort alto. |

**Quick wins (alto impatto/effort): #1, #2, #3.** Sono le tre mosse da fare per prime: rendono distribuibile il prodotto (1), aprono il differenziatore di mercato più richiesto (2) e recuperano codice già scritto ma morto (3).

---

## 4. POSIZIONAMENTO

### Tagline
> **aistack — il control-plane durevole, cross-machine e governato per agenti Claude Code. Costruito SOPRA l'Agent SDK, non contro Claude Code.**

*(Difendibile perché ogni parola mappa a un gap nativo esplicito — "durevole" → stato effimero; "cross-machine" → tutto-è-local; "governato" → no budget/SSO/audit a livello orchestrazione — e a feature reali in main: checkpointer, federation, SSO+SCIM+audit.)*

### Tre bullet di valore (ognuno supportato da feature reale in `main`)

- **Lo stato non muore quando chiudi il terminale.** Checkpointer con replay deterministico (`src/persistence/checkpointer.ts`) + HITL pause/resume persistente (`src/coordination/interrupt.ts`) + consensus con lifecycle tracciato: riprendi un'orchestrazione interrotta — cosa che i teammate nativi, effimeri per design, non sanno fare.

- **I tuoi agenti escono dalla singola macchina, in sicurezza.** Federazione multi-host con mTLS e CN/SAN pinning ed egress sanitizzato (`src/federation/`, testata su 3 nodi): l'unica dimensione dove Claude Code — single-machine per design su subagents, teams e agent-view — semplicemente non arriva.

- **Pronto per l'enterprise, e self-hostable.** SSO SAML/OIDC + SCIM 2.0 hardened (`src/auth/sso/`), audit log hash-chain tamper-evident (`src/audit/chain.ts`), multi-tenancy RBAC e Helm chart K8s completo per on-prem/air-gapped (`charts/aistack/`): lo spartiacque enterprise (SSO+SCIM+compliance+deploy sovrano) che il nativo non offre a livello di orchestrazione e che tra i competitor solo le piattaforme chiuse a pagamento (Factory, Devin) coprono.

> **Onestà finale, da dire ad alta voce**: se lavori da solo, su una macchina, in un repo, dentro una sessione — usa Claude Code nudo. aistack inizia ad avere senso quando aggiungi *durabilità*, *più macchine* o *requisiti di governance/compliance*. Vendere oltre questo perimetro (specialmente review-loop come "spawn", guardrails non wired, o numeri SWE-bench da uno stub) replicherebbe esattamente il problema di credibilità che la mappa competitiva imputa a claude-flow.
