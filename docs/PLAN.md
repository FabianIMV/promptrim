# PromptTrim 2.0 — Plan de mejora por fases

> Documento pensado para ejecutarse en sesiones independientes de Claude Code (una por fase).
> Cada fase indica el modelo recomendado, objetivo, tareas, archivos, criterios de aceptación y verificación.
> Este documento vive en `docs/PLAN.md`; cada sesión lo lee al empezar y actualiza la Sección 6 al terminar.

---

## 0. Contexto y veredicto honesto

### Qué es la app hoy
Dos archivos (`index.html`, `app.js`), sin build, sin tests. Dos modos:
- **Fast mode**: ~80 regex que borran muletillas ("please", "very", "in order to"…).
- **AI mode**: envía el prompt a Gemini con la instrucción "hazlo más corto".

### Lo que está mal (verificado ejecutando el código, no opinión)

| # | Problema | Evidencia |
|---|----------|-----------|
| 1 | **Corrompe contenido.** Las regex se aplican dentro de bloques de código, strings, URLs y variables. | Input con ```` ```js function f(x){ return x.utilize(); } ``` ```` → salida `x.use()`. Un string `"please"` → `""`. Esto rompe prompts reales. |
| 2 | **Los niveles son cosméticos.** Aggressive produce casi lo mismo que Balanced. | En 4 prompts de prueba, 3 dieron salida idéntica entre Balanced y Aggressive. |
| 3 | **Borra instrucciones útiles.** "step by step" (induce razonamiento), "ensure that", "make sure to" se eliminan. | Regla `AGGRESSIVE_EXTRA` y `FILLERS_EXTENDED` en `app.js:100-185`. |
| 4 | **Deja gramática rota.** Frases que empiezan en minúscula tras borrar el inicio ("respond in JSON format. you should never…"). | Salida observada en Balanced. |
| 5 | **Métricas inventadas.** Tokens = chars/4; coste con GPT-4o a $2.50/M (precio de 2024); "70% avg token savings" en el hero sin ningún benchmark. | `app.js:44-46`, `app.js:383-384`, `index.html:628`. |
| 6 | **AI mode es un wrapper.** "Compress this prompt" a Gemini lo hace cualquiera en el chat. No aporta nada propio. | `SYSTEM_PROMPTS` en `app.js:240-244`. |
| 7 | **Promete "preserva el significado" y no lo comprueba.** Este es el defecto central de toda la categoría, y la app lo hereda. | No existe ninguna verificación en el código. |

**Veredicto:** como landing/SEO está bien hecha. Como producto, hoy sí entra en la categoría "AI slop": una lista de regex peligrosa más un wrapper de LLM. No es basura irrecuperable, pero el núcleo hay que rehacerlo desde cero. Lo que sí vale y se conserva: la marca, el dominio y SEO, el pipeline de deploy a Pages, el posicionamiento privacy-first/BYOK (sin backend) y la lógica de descubrimiento de modelos Gemini.

### Qué hace la competencia (investigado)
- **Wrappers web genéricos**: "make it shorter" con un LLM. Cero verificación.
- **tokensift** (CLI): linter de eficiencia de tokens, 20 reglas, tokenizador exacto para OpenAI, estimación calibrada para Claude. Solo reporta, no reescribe, sin UI web, sin verificación semántica.
- **PromptLint** (CLI/Action/VS Code): "ESLint para prompts", proyección de coste, seguridad. Sin compresión verificada, sin web app.
- **llmlingua-2-js**: LLMLingua-2 en navegador (TinyBERT 57 MB+). Compresión a nivel token, experimental, sin diff ni verificación.
- **Gateways** (Kong, Portkey): compresión en middleware para empresas. No es para un usuario que pega un prompt.

**Hueco real que nadie cubre:** un compresor que (a) nunca toca código/variables/ejemplos, (b) **demuestra** con un checklist verificable que ninguna instrucción se perdió, y (c) es honesto con el coste: te dice cuándo comprimir no vale la pena y cachear sí.

---

## 1. Tesis del producto nuevo

> **PromptTrim: el único compresor de prompts que demuestra que no rompió tu prompt.**

Tres pilares diferenciadores (ninguna herramienta actual tiene los tres, y el pilar 2 no lo tiene nadie):

1. **Regiones protegidas.** Bloques de código, código inline, strings entre comillas, URLs, JSON, variables de plantilla (`{{x}}`, `{x}`, `${x}`, `<tag>`), tablas y bloques de ejemplos few-shot son intocables por construcción.
2. **Constraint Ledger (libro de restricciones).** Antes de comprimir se extrae un inventario de todo lo que el prompt exige: imperativos, negaciones ("never", "do not"), formatos de salida (JSON, markdown), números y unidades, entidades, strings citados, variables. Después se verifica una a una que sobreviven. El usuario ve un checklist ✓/✗ y puede restaurar con un clic lo que se perdió. En modo IA, el propio LLM verifica y **repara** el prompt comprimido reinsertando lo perdido.
3. **Cost Advisor honesto.** Tokenizadores reales por proveedor, precios con fecha de verificación, proyección a N llamadas/día, y comparación **"comprimir vs cachear"**: cachear el prefijo estático suele ahorrar 90% del coste de input (lecturas de caché ≈ 10% del precio base en Anthropic, OpenAI y Gemini) frente a 15-30% de comprimir. La app recomienda lo que más ahorra, aunque sea "no comprimas, reordena y cachea".

Complementos que refuerzan: diff visual con "deshacer por cambio", modo IA multi-proveedor BYOK (Gemini, OpenAI, Anthropic), y un corpus de benchmark público que sustituye al "70%" inventado por números reales.

Target: desarrolladores que mantienen **system prompts y plantillas** que se ejecutan miles de veces al día. Ahí una diferencia de 300 tokens sí es dinero; en un prompt de chat de un solo uso no lo es, y la app lo dirá.

---

## 2. Arquitectura objetivo (reescritura)

Se reescribe desde cero manteniendo URL, marca y SEO.

- **Stack:** Vite + TypeScript + Preact (3 KB, suficiente para una UI de un panel con estado) + Vitest. Sin backend. Deploy a GitHub Pages con build en Actions.
- **Principio clave:** todo el motor vive en `src/core/` como funciones puras sin DOM, con tests. Esto permite reutilizarlo después en un CLI/Action (Fase 7).
- **El compresor no devuelve un string: devuelve una lista de cambios** (`Change[]` con `ruleId`, rango, original, reemplazo, `lossy: boolean`). El string final es una proyección. Esto habilita diff, deshacer por cambio y trazabilidad de reglas.

```
promptrim/
├── public/                 # og-image.png, robots.txt, sitemap.xml, favicon
├── src/
│   ├── core/
│   │   ├── segment.ts      # texto → segmentos {text | protected{kind}}
│   │   ├── rules/          # packs de reglas con metadatos y tests
│   │   ├── compress.ts     # aplica reglas solo a segmentos de texto → Change[]
│   │   ├── ledger.ts       # extracción y verificación de restricciones
│   │   ├── tokenizers/     # o200k (js-tiktoken), claude-estimate, gemini-api
│   │   ├── pricing.ts      # lee data/pricing.json (con last_verified)
│   │   └── cache-advisor.ts
│   ├── providers/          # gemini.ts, openai.ts, anthropic.ts (modo IA)
│   ├── ui/                 # componentes Preact
│   └── main.tsx
├── data/pricing.json
├── bench/corpus/           # 30-50 prompts reales para benchmark
├── docs/PLAN.md            # este documento
└── .github/workflows/deploy.yml
```

Política de reglas (aplica a todas las fases):
- Toda regla declara `id`, `level`, `lossy`, descripción legible ("por qué") y ≥3 casos de test (positivos y negativos).
- **Prohibido** borrar frases completas o palabras de instrucción ("step by step", "ensure", "must", "never", "only").
- Sustituciones a nivel de frase, siempre con equivalente semántico ("in order to" → "to"). Capitalización se repara tras cada cambio.
- Light = solo reglas no lossy. Balanced = + lossy suaves. Aggressive = + lossy fuertes, **pero bloqueadas por el ledger**: si un cambio hace perder una restricción, se revierte automáticamente.

---

## 3. Fases

Orden obligatorio 0 → 1 → 2 → 3 → 4 → 5 → 6. Las fases 7 y 8 son opcionales y van al final.
Regla para todas las sesiones: la fase termina con `npm test` en verde, `npm run build` sin errores y un PR contra `main`.

### Modelo recomendado por fase (resumen)

| Fase | Nombre | Modelo | Por qué |
|------|--------|--------|---------|
| 0 | Fundación y núcleo seguro | **Opus 5** | Decisiones de arquitectura que condicionan todo lo demás |
| 1 | Tokens y costes reales | **Sonnet 5** | Integración bien especificada |
| 2 | Constraint Ledger local | **Opus 5** | Es el diferenciador principal; requiere criterio lingüístico |
| 3 | Diff viewer y deshacer | **Sonnet 5** | UI sobre un modelo de datos ya definido |
| 4 | Cost Advisor (comprimir vs cachear) | **Opus 5** | Modelo económico con reglas por proveedor; fácil equivocarse |
| 5 | Modo IA multi-proveedor con verificación y reparación | **Opus 5** | Diseño de prompts, salidas estructuradas y bucle de reparación |
| 6 | Producto, benchmark público y README honesto | **Sonnet 5** | Muchas tareas pequeñas y claras |
| 7 (opc.) | CLI + GitHub Action | **Opus 5** | Extraer paquete core y diseñar la salida en PR |
| 8 (opc.) | Modo ML local (LLMLingua-2) | **Sonnet 5** | Integrar librería existente detrás del ledger |

Criterio general: Opus 5 donde hay que **decidir** (arquitectura, lingüística, economía, prompts); Sonnet 5 donde hay que **ejecutar** una especificación cerrada.

---

### Fase 0 — Fundación y reescritura del núcleo seguro
**Modelo: Opus 5.** Rama sugerida: `feat/fase-0-fundacion`.

**Objetivo:** misma funcionalidad visible que hoy, pero sobre la arquitectura nueva y sin corrupción de contenido.

Tareas:
1. Scaffold: Vite + TypeScript + Preact + Vitest + ESLint/Prettier. `npm run dev|build|test|lint`.
2. Mover `og-image.png`, `robots.txt`, `sitemap.xml` a `public/`. Conservar íntegros todos los meta tags SEO, JSON-LD y la verificación de Search Console en `index.html`.
3. `src/core/segment.ts`: segmentador que marca como protegidos: fences ```` ``` ````, código inline `` ` ``, strings entre comillas dobles/simples/tipográficas, URLs y emails, variables `{{x}}` `{x}` `${x}` `%s` `<tag>`, JSON/YAML detectados por forma, tablas markdown, y bloques marcados como ejemplo (`Example:`, `Input:/Output:`, `<example>`). Devuelve segmentos con offsets.
4. `src/core/rules/`: portar las reglas actuales que sean seguras, **descartar** las que borran instrucciones (lista en Sección 0, fila 3). Cada regla con metadatos y tests. Añadir reglas lossless nuevas: normalización de espacios/saltos, listas markdown, comillas tipográficas → ASCII.
5. `src/core/compress.ts`: aplica reglas solo a segmentos de texto, devuelve `{ output, changes: Change[] }`. Repara capitalización tras cada borrado al inicio de frase.
6. UI Preact con paridad funcional: paneles, niveles, toggle IA (Gemini, portando `getGeminiModels` y el manejo de errores existente en `app.js:246-377`), copiar, limpiar.
7. Tests de regresión obligatorios: el caso ```` x.utilize() ```` y `"please"` en string deben salir intactos; un prompt ya conciso debe salir byte a byte igual en Light.
8. `deploy.yml`: `npm ci && npm run build` y publicar `dist/`.

Aceptación: tests verdes; corpus de 10 prompts con código/JSON produce 0 cambios dentro de regiones protegidas; Pages despliega correctamente; Lighthouse ≥ 90 en rendimiento.

---

### Fase 1 — Tokens y costes reales
**Modelo: Sonnet 5.** Rama: `feat/fase-1-tokens`.

Tareas:
1. `tokenizers/openai.ts`: `js-tiktoken` con `o200k_base`, cargado de forma perezosa (el JSON de ranks pesa varios MB; nunca en el bundle inicial). Cuenta exacta para GPT.
2. `tokenizers/claude.ts`: estimador calibrado (similar al enfoque de tokensift, ~7% de error). Documentar el método. Si el usuario introduce clave de Anthropic (Fase 5), usar `POST /v1/messages/count_tokens`.
3. `tokenizers/gemini.ts`: `models/{model}:countTokens` cuando hay clave; si no, heurística.
4. `data/pricing.json`: modelos por proveedor con `input`, `output`, `cached_input`, `cache_write` (si aplica) y `last_verified` (fecha). **La sesión que implemente debe verificar los precios en las webs oficiales ese día**, no de memoria. Valores de referencia al redactar este plan (sep 2026): Claude Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5, lecturas de caché ≈ 0.1× input y escrituras 1.25× (5 min) / 2× (1 h); OpenAI GPT-5 $1.25/$10 con cached input $0.125; Gemini 2.5 Flash ~$0.30/$2.50 con caché ≈ 10% + almacenamiento por hora.
5. UI: selector de modelo objetivo; badge de tokens por proveedor; campo "llamadas/día" y proyección mensual de ahorro.
6. Eliminar la estadística "70% avg token savings" del hero (se sustituye por el benchmark real en Fase 6).

Aceptación: para 20 textos, la cuenta o200k coincide exactamente con `tiktoken` de referencia (test con fixtures generadas en Python o con valores conocidos); el bundle inicial no crece más de 30 KB gzip.

---

### Fase 2 — Constraint Ledger local (diferenciador principal)
**Modelo: Opus 5.** Rama: `feat/fase-2-ledger`.

Tareas:
1. `core/ledger.ts` — `extractConstraints(text): Constraint[]`. Tipos: `instruction` (frase imperativa), `prohibition` (never/do not/must not/avoid), `requirement` (must/should/always/only), `format` (JSON, markdown, bullet, table, "in N words", idioma), `quantity` (números + unidades, fechas), `entity` (nombres propios, identificadores, rutas), `literal` (strings citados, URLs), `variable` (plantillas), `example` (bloques de ejemplo). Cada constraint guarda el texto ancla y su rango en el original.
2. `verifyConstraints(original, compressed, constraints): LedgerReport` — cada constraint pasa si su ancla (normalizada: minúsculas, espacios, sinónimos definidos por las reglas de sustitución) aparece en la salida. Severidad: `critical` (prohibition, format, literal, variable, quantity) vs `minor`.
3. Integración con `compress.ts`: en Aggressive, cualquier `Change` que haga fallar un constraint `critical` se revierte automáticamente y se registra como "cambio bloqueado por el ledger".
4. Detección de **instrucciones duplicadas** (mismo constraint dos veces con distinta redacción): es el ahorro real más frecuente en system prompts largos y ninguna herramienta lo hace. Proponer fusionar, nunca borrar silenciosamente.
5. UI: panel "Verificación" con checklist ✓/✗ agrupado por tipo, contador "12/12 restricciones preservadas", botón "Restaurar" por constraint perdido (reinserta la frase original en su posición).
6. Corpus de 30 prompts en `bench/corpus/` (system prompts reales de proyectos open source, variados: agentes, RAG, soporte, código) con sus constraints anotados a mano en JSON para medir precisión/recall del extractor.

Aceptación: recall ≥ 90% en constraints `critical` sobre el corpus anotado; 0 falsos "preservado" cuando la frase se borró; tests de cada tipo de constraint.

---

### Fase 3 — Diff viewer y edición guiada
**Modelo: Sonnet 5.** Rama: `feat/fase-3-diff`.

Tareas:
1. Vista diff a nivel palabra (librería `diff`/jsdiff) alimentada por `Change[]`, no por comparar strings, para que cada cambio conserve `ruleId`.
2. Tooltip por cambio: nombre de la regla y "por qué" (de los metadatos). Marcar cambios `lossy` con color distinto.
3. Deshacer por cambio (clic) y "deshacer todos los de la regla X". Tras deshacer, recalcular tokens y ledger.
4. Panel de reglas: activar/desactivar reglas por sesión; persistir en `localStorage`.
5. Vista de "cambios bloqueados por el ledger" (de Fase 2) para que el usuario entienda por qué Aggressive no comprimió más.

Aceptación: deshacer todos los cambios reproduce el original byte a byte (test de propiedad con 50 prompts); accesible con teclado.

---

### Fase 4 — Cost Advisor: comprimir vs cachear
**Modelo: Opus 5.** Rama: `feat/fase-4-cost-advisor`.

Tareas:
1. `core/cache-advisor.ts`: separar el prompt en prefijo estático y sufijo dinámico. Heurísticas: variables de plantilla, marcadores de fecha/hora, secciones "User:", "Context:", "Documents:", contenido tras la última instrucción fija. Detectar "invalidadores silenciosos" (fecha en el system prompt, IDs por petición) tal como los describen las guías de caché de Anthropic.
2. Modelo económico por proveedor (leer `pricing.json`): Anthropic (mínimo cacheable por modelo, escrituras 1.25×/2×, lecturas 0.1×), OpenAI (cached input 10%, automático), Gemini (caché explícita, 10% + almacenamiento/hora). Entradas: llamadas/día, intervalo entre llamadas (decide TTL), tokens del prefijo.
3. Salida: tarjeta con tres escenarios en coste mensual: (a) sin cambios, (b) solo comprimir, (c) reordenar + cachear (+ comprimir el dinámico). Recomendación explícita, incluida "no comprimas: reordena estas 2 secciones y cachea".
4. Botón "Generar versión cache-ready": reordena el prompt con el bloque estático primero y marca con comentario dónde poner el breakpoint de caché (`cache_control` en Anthropic).
5. Sección educativa corta en la landing: "Comprimir ahorra 15-30% una vez. Cachear ahorra ~90% en cada llamada repetida."

Aceptación: tests con escenarios numéricos verificados a mano (p. ej. 3 000 tokens de prefijo, 10 000 llamadas/día, Opus 5: comprimir 20% vs cachear); la fórmula de break-even (2 peticiones con TTL 5 min, 3 con 1 h) coincide con la documentación oficial.

---

### Fase 5 — Modo IA multi-proveedor con verificación y reparación
**Modelo: Opus 5.** Rama: `feat/fase-5-ai-verify`.

Tareas:
1. `providers/`: interfaz común `compress(text, level, ledger) → {output, verification}`. Implementar Gemini (portar lo existente), OpenAI (Chat Completions con `response_format` JSON) y Anthropic (Messages API desde navegador con la cabecera de acceso directo desde navegador; **verificar el nombre exacto de la cabecera y el uso de `output_config.format` para salida estructurada en la documentación oficial durante la implementación**). Modelo Anthropic por defecto `claude-opus-5`, seleccionable (`claude-sonnet-5`, `claude-haiku-4-5`).
2. Pipeline en dos pasos:
   - Paso A, compresión: el prompt del sistema incluye las **reglas de protección** y el **ledger** ("estas 14 restricciones deben sobrevivir literalmente o con equivalente exacto"). Salida estructurada `{compressed, kept:[ids], dropped:[ids]}`.
   - Paso B, verificación independiente: segunda llamada (puede ser modelo más barato) que recibe original, comprimido y ledger y devuelve por constraint `{id, preserved: bool, evidence}`. Se cruza con la verificación local de Fase 2.
   - Reparación: si hay `critical` perdidos, tercera llamada que reinserta solo esos (máximo 2 iteraciones). Si sigue fallando, se muestra el ✗ y se ofrece restaurar manualmente.
3. Claves: solo memoria por defecto; opción explícita "recordar en este navegador" (`sessionStorage`). Nunca en URL ni logs. Mostrar coste estimado de la propia llamada de compresión antes de ejecutarla (la app debe ser coherente con su discurso).
4. UI: proveedor + modelo, estado por paso (comprimiendo → verificando → reparando), y el checklist del ledger con evidencia del verificador.

Aceptación: sobre el corpus de 30 prompts, tasa de restricciones `critical` preservadas ≥ 98% tras reparación; fallos de red/429 con mensajes claros; sin claves en `localStorage` salvo opt-in.

---

### Fase 6 — Producto, benchmark público y README honesto
**Modelo: Sonnet 5.** Rama: `feat/fase-6-producto`.

Tareas:
1. **Benchmark reproducible**: script `npm run bench` que corre el corpus por nivel y produce tabla: reducción media de tokens, restricciones preservadas, cambios bloqueados. Publicar resultados reales en README y landing en lugar de "70%".
2. Compartir por URL (estado comprimido con `lz-string` en el hash; nunca la clave API). Importar/exportar `.txt`, `.md`, `.json`.
3. Modo lote: varios prompts separados por `---`, tabla resumen.
4. PWA básica (offline en Fast mode), atajos de teclado (Ctrl+Enter comprimir).
5. i18n en/es (el autor es hispanohablante; hay espacio SEO en español para "compresor de prompts"). Añadir `hreflang` y URL `/es/`.
6. Reescribir README y landing con la tesis de la Sección 1, capturas nuevas, sección "Qué NO hace PromptTrim" (honestidad como marketing).
7. Actualizar `sitemap.xml`, JSON-LD (`featureList`) y FAQ ("¿Cómo sé que no perdió nada?").

Aceptación: README con tabla de benchmark generada por script; Lighthouse SEO/accesibilidad ≥ 95; compartir URL reproduce el estado exacto.

---

### Fase 7 (opcional) — CLI y GitHub Action
**Modelo: Opus 5.** Rama: `feat/fase-7-cli`.

Convierte el motor en herramienta de equipo. A diferencia de tokensift/PromptLint, ofrece **compresión sugerida y verificada**, no solo diagnóstico.

1. Extraer `src/core` a `packages/core` (workspace npm) sin romper la web.
2. `npx promptrim check "prompts/**/*.md" --budget 2000 --model claude-opus-5`: reporta tokens por archivo, delta contra `main`, restricciones duplicadas, y sugiere una versión comprimida verificada (`--write` para aplicarla).
3. GitHub Action que comenta en el PR: "system_prompt.md: 2 100 → 2 640 tokens (+26%). A 50k llamadas/día ≈ +$X/mes. 3 instrucciones duplicadas detectadas."
4. Documentar en README con ejemplo de workflow.

Aceptación: la Action funciona sobre el propio repo (dogfooding sobre `bench/corpus`).

---

### Fase 8 (opcional, experimental) — Modo ML local con LLMLingua-2
**Modelo: Sonnet 5.** Rama: `feat/fase-8-local-ml`.

1. Integrar `@atjsh/llmlingua-2` (TinyBERT, ~57 MB, descarga bajo demanda, WASM/WebGPU) como tercer modo "ML local, sin API".
2. Pasar siempre su salida por regiones protegidas + ledger local (LLMLingua descarta tokens sin criterio semántico; aquí el ledger es lo que lo hace usable).
3. Marcar como experimental; medir en el benchmark.

---

## 4. Cómo ejecutar cada fase en una sesión nueva

Prompt sugerido para abrir cada sesión (ajustar N):

```
Lee docs/PLAN.md. Ejecuta la Fase N completa en la rama indicada, partiendo de main actualizado.
Respeta la política de reglas de la Sección 2 y los criterios de aceptación de la fase.
Termina con: npm run lint, npm test y npm run build en verde; actualiza docs/PLAN.md marcando la fase como completada
con fecha y notas de desviaciones; abre un PR contra main con resumen y cómo verificar.
No inicies tareas de fases posteriores.
```

Reglas entre sesiones:
- Cada fase actualiza `docs/PLAN.md` (estado, decisiones, deuda pendiente) para que la siguiente sesión tenga contexto.
- Si una fase descubre que una decisión anterior estaba mal, se anota en el plan y se corrige en la fase actual; no se acumula.
- Precios y nombres de modelo se verifican en fuentes oficiales el día de la implementación, nunca de memoria.

---

## 5. Verificación global (fin de la Fase 6)

1. `npm test` verde, cobertura del núcleo ≥ 85%.
2. `npm run bench` genera la tabla del README y muestra 0 cambios en regiones protegidas y ≥ 98% de restricciones críticas preservadas.
3. Prueba manual en el sitio publicado: pegar un system prompt real con código, JSON y variables; comprimir en Aggressive; comprobar checklist completo, diff con deshacer, recomendación del Cost Advisor y modo IA con los tres proveedores.
4. Lighthouse: rendimiento ≥ 90, SEO ≥ 95, accesibilidad ≥ 95.

---

## 6. Estado de las fases

Cada sesión actualiza esta tabla al terminar su fase (fecha, PR, desviaciones y deuda pendiente).

| Fase | Estado | Fecha | PR | Notas |
|------|--------|-------|----|-------|
| 0 | ✅ Completada | 2026-09-02 | [#9](https://github.com/FabianIMV/promptrim/pull/9) | Scaffold Vite+TS+Preact+Vitest, segmentador de regiones protegidas, motor de reglas con `Change[]`, UI Preact con paridad. 299 tests. Ver 6.1. |
| 1 | ✅ Completada | 2026-09-02 | [#10](https://github.com/FabianIMV/promptrim/pull/10) | Tokenizador exacto o200k (`js-tiktoken`, lazy), estimador calibrado para Claude, `countTokens` real de Gemini con fallback, `data/pricing.json` verificado hoy en las 3 webs oficiales, UI con selector de modelo objetivo, campo llamadas/día y proyección mensual. 343 tests (+44). Ver 6.2. |
| 2 | ✅ Completada | 2026-09-03 | [#11](https://github.com/FabianIMV/promptrim/pull/11) | `core/ledger/` (extracción, verificación, duplicados, restauración), veto del ledger sobre `compress()` en Aggressive, panel "Verification" en la UI y corpus anotado de 30 prompts en `bench/corpus/phase2/`. Recall 98,8% y precisión 88,1% sobre 327 restricciones críticas anotadas; 0 falsos "preservado". 737 tests (+394). Ver 6.3. |
| 3 | ✅ Completada | 2026-09-03 | [#12](https://github.com/FabianIMV/promptrim/pull/12) | Diff construido desde `Change[]` (`src/core/diff.ts`, sin librería de diff de strings), deshacer por cambio y por regla con recálculo de tokens/ledger, panel de reglas persistido en `localStorage`, y los cambios bloqueados por el ledger integrados en la propia vista de diff. 896 tests (+159). Ver 6.4. |
| 4 | Pendiente | | | |
| 5 | Pendiente | | | |
| 6 | Pendiente | | | |
| 7 (opc.) | Pendiente | | | |
| 8 (opc.) | Pendiente | | | |

### 6.1 Fase 0 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-02): `npm run lint` ✅, `npm test` ✅ (299 tests, 5 archivos), `npm run build` ✅.
Cobertura de `src/core/**`: 97,4% de sentencias. Lighthouse sobre el build (`vite preview`, Chrome headless):
rendimiento **100**, SEO **100**, buenas prácticas **100**, accesibilidad **91**.
Corpus de 10 prompts en `bench/corpus/phase0/`: **0 cambios dentro de regiones protegidas** en los tres niveles.

**Decisiones de arquitectura tomadas en esta fase** (condicionan las siguientes):

1. **Las reglas se evalúan contra el texto completo y después se descartan las coincidencias que tocan una
   región protegida**, en lugar de evaluarlas segmento a segmento. El borde de un segmento no es un borde de
   línea: en `escribe "please"` el espacio previo a la comilla queda al final de un segmento de texto pero en
   mitad de su línea, y una regla anclada con `^`/`$` lo borraba. Fases 2-3 deben mantener este orden.
2. **`compress()` devuelve `Change[]` con offsets sobre el original** y la salida es `applyChanges()`. La
   reparación de mayúsculas se incorpora dentro del propio `Change` (extendiendo su rango), no como un pase
   posterior, para que deshacer un cambio deshaga también su reparación y "deshacer todo" reproduzca el
   original byte a byte (test ya presente; Fase 3 lo usará).
3. **Semántica de niveles.** "Light = solo reglas no lossy" se implementa como invariante de una dirección,
   verificada por test: *ninguna* regla de nivel `light` es lossy. Las sustituciones de equivalencia exacta
   ("in order to" → "to") son no-lossy pero viven en `balanced`, para que Light siga devolviendo byte a byte
   un prompt ya conciso. Light = normalización de formato; Balanced = + equivalencias exactas y marcos de
   cortesía; Aggressive = + énfasis/hedges.
4. **Registro de reglas descartadas** en `src/core/rules/discarded.ts` (12 entradas con motivo y ejemplo),
   con un test que verifica que ninguna vuelve a colarse: `step by step`, `ensure/make sure to`, `always`,
   `note that`, adjetivos de profundidad, deduplicación de frases, `feel free to`, `if possible`, `Thank you`,
   `in a X manner`, `the following are`, `you are required to`.

**Desviaciones respecto al plan:**

- **Rama.** La sesión venía fijada a `claude/fase-0-fundacion-edku6m`, no a `feat/fase-0-fundacion`. El
  contenido es el de la Fase 0; solo cambia el nombre de la rama.
- **Comillas tipográficas.** La Sección 2 pide a la vez *proteger* los strings entre comillas tipográficas y
  *normalizarlas* a ASCII. Son incompatibles para los delimitadores. Decisión: gana la protección. Solo se
  normalizan el apóstrofo intrapalabra (`don’t` → `don't`) y los espacios no separables. Deuda menor.
- **YAML "por forma" no implementado.** Solo se protege YAML dentro de fences. La heurística por forma
  (`clave: valor` en líneas consecutivas) producía falsos positivos sobre prosa normal del tipo
  `Note: do this`, que es exactamente el contenido que hay que poder comprimir. Deuda para Fase 2.
- **Etiquetas `<tag>`.** Se protege la etiqueta en sí como variable, pero **no el contenido** entre
  `<tag>…</tag>` salvo en `<example>`. El texto dentro de `<document>` sí se comprime. Revisar en Fase 2, donde
  el ledger decidirá si ese contenido es dato del usuario.
- **Aggressive todavía no está bloqueado por el ledger** (depende de la Fase 2). Mientras tanto se mantiene
  seguro por construcción: el set agresivo se limita a intensificadores, hedges y marcos, nunca a palabras de
  instrucción, y está cubierto por el registro de reglas descartadas.
- **Tokens y coste siguen siendo la heurística legada** (`chars/4`, GPT-4o a $2,50/M de 2024). Se aislaron en
  `src/core/estimate.ts`, marcados `@deprecated`, para que la Fase 1 los sustituya en un solo sitio. El dato
  "70% avg token savings" del hero **se deja intacto a propósito**: su eliminación es la tarea 6 de la Fase 1.
- **Extra respecto a las tareas listadas:** se añadió `.github/workflows/ci.yml` (lint + test + build en cada
  PR). `deploy.yml` ahora hace `npm ci`, verifica y publica `dist/`.

**Deuda pendiente que hereda la Fase 1:**

- Accesibilidad 91 en Lighthouse por dos auditorías **preexistentes** de la landing (`color-contrast` y
  `link-in-text-block`). El objetivo ≥95 es de la Fase 6, pero conviene no empeorarlo antes.
- `src/core/index.ts` y `estimate.ts` sin cobertura directa (son reexportes y el placeholder de la Fase 1).
- El corpus de la Fase 0 (10 prompts) está en `bench/corpus/phase0/` para que el corpus anotado de 30 prompts
  de la Fase 2 pueda convivir en `bench/corpus/` sin colisiones.

### 6.2 Fase 1 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-02): `npm run lint` ✅, `npm test` ✅ (343 tests, 10 archivos),
`npm run build` ✅. Bundle inicial: 17,92 kB gzip (`index-*.js`), frente a 16,02 kB gzip en `main` antes de esta
fase — crece +1,9 kB gzip, muy por debajo del límite de +30 kB del criterio de aceptación. El chunk de
`o200k_base` (2,3 MB / 1,14 MB gzip) y el runtime `js-tiktoken/lite` se cargan por `import()` dinámico bajo
demanda y **no** aparecen en `dist/index.html` (verificado leyendo el HTML generado): nunca se descargan a
menos que se cuenten tokens para un modelo OpenAI. Smoke test manual con Playwright + Chromium headless contra
`vite preview`: selector de modelo, conteo exacto al cambiar a GPT-5, compresión, panel de ahorro y proyección
mensual funcionan sin errores de consola (capturas en la sesión, no versionadas).

**Precios verificados hoy, en la página oficial de cada proveedor** (no de memoria; `last_verified` en
`data/pricing.json`):

- Anthropic — `platform.claude.com/docs/en/about-claude/pricing` (redirige desde `docs.claude.com`). Confirma
  exactamente los valores de referencia del plan: Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5; cachés a
  1,25× (5 min) / 2× (1 h) para escritura y 0,1× para lectura. La página también documenta que el precio
  introductorio de Sonnet 5 ($2/$10) pasó a ser el precio estándar (no habrá alza a $3/$15 el 1 de septiembre).
- OpenAI — `developers.openai.com/api/docs/pricing` (versión `.md` cruda, para evitar que el resumen de un
  modelo intermedio alucinara nombres). El primer fetch devolvió modelos "gpt-5.6-sol/terra/luna" que parecían
  sospechosos (no es la convención de nombres habitual de OpenAI); se verificó con una segunda fuente
  independiente (búsqueda web) y con el HTML/Markdown crudo de la propia página oficial antes de aceptarlos — no
  hay señal de inyección, es simplemente una familia de modelos posterior al corte de conocimiento del
  implementador. GPT-5 coincide con la referencia del plan ($1,25/$10, cached $0,125).
- Google Gemini — `ai.google.dev/gemini-api/docs/pricing`. Flash $0,30/$2,50 con caché $0,03 (10% del input) +
  $1/MTok/hora de almacenamiento; coincide con la referencia del plan. Pro tiene tarificación por tramos
  (≤200k vs >200k tokens); se registró el tramo ≤200k como principal y el tramo alto en el campo `notes`.

**Decisiones de arquitectura tomadas en esta fase:**

1. **`data/pricing.json`** usa un array plano `models[]` con `provider`, `input_per_mtok`, `output_per_mtok` y
   campos de caché específicos por proveedor (`cache_write_5m_per_mtok`/`cache_write_1h_per_mtok`/
   `cache_read_per_mtok` en Anthropic; `cached_input_per_mtok` en OpenAI; `cache_write_per_mtok`/
   `cache_storage_per_mtok_hour` en Gemini) porque los tres modelan el caché de forma distinta y forzar un
   esquema común habría perdido información. Cada modelo lleva su propio `last_verified` y `source_url` además
   del `last_verified` global, para poder re-verificar de a uno en fases futuras sin perder trazabilidad.
2. **Selector de modelo único**, no "badge de tokens por proveedor" simultáneo. La Sección 3 menciona ambas
   frases; se interpretó como un selector de modelo objetivo (agrupado por proveedor con `<optgroup>`) que
   decide qué tokenizador y qué precio se usan, en vez de tres conteos en paralelo — más simple y consistente
   con "selector de modelo objetivo" del mismo punto del plan. Puede revisarse en Fase 3/6 si se quiere
   comparación lado a lado.
3. **Estimador de Claude**: promedio de dos ratios que la propia documentación de Anthropic publica para texto
   en inglés (≈4 caracteres o ≈0,75 palabras por token), en vez de una única razón char/N. Calibrado contra los
   20 fixtures de `o200k_base` como proxy (no existe corpus público de referencia de Claude): error absoluto
   medio ≈17% excluyendo casos degenerados (repetición de un carácter, cadenas de solo dígitos o solo
   símbolos) y ≈3-5% en prosa larga natural. El objetivo del plan ("~7% de error, al estilo tokensift") no se
   alcanza en el fixture completo, sobre todo por strings muy cortas (2-3 palabras) donde el error relativo es
   inherentemente alto con cualquier heurística; documentado en el docstring de `claude.ts` y verificado con un
   test de cota (`< 30%` de MAPE sobre el subconjunto de prosa). Gemini sin API key reutiliza el mismo
   estimador en vez de inventar una segunda fórmula sin calibrar.
4. **Conjunto de modelos por proveedor** (10 en total): 3 Anthropic (Opus 5, Sonnet 5, Haiku 4.5 — los tres que
   nombra el plan), 5 OpenAI (el flagship y el económico más recientes — `gpt-5.6-sol`/`gpt-5.6-luna` —, `gpt-5`
   y `gpt-5-mini` por ser la referencia del plan y ampliamente desplegados, y `gpt-4o` por seguir siendo común
   en integraciones existentes) y 2 Gemini (2.5 Pro, 2.5 Flash). Selección editorial para mantener el desplegable
   manejable; ampliable sin cambios de esquema.
5. **`estimate.ts` se elimina** (no se deja como wrapper de compatibilidad) junto con `estimateTokens` /
   `estimateCostSaved`: no había otros consumidores fuera de `App.tsx` y el propio archivo estaba marcado
   `@deprecated` desde la Fase 0 a la espera de este reemplazo.

**Desviaciones respecto al plan:**

- Tarea 2 pedía "~7% de error" para el estimador de Claude; el error real medido es mayor (ver decisión 3).
  Documentado en vez de ocultado; no bloquea la aceptación de la fase porque esa cifra no es un criterio de
  aceptación formal de la Sección 3, solo un objetivo de diseño.
- La FAQ de `index.html` ("How is the token count estimated?") describía la heurística `chars/4` que esta fase
  reemplaza; se reescribió para explicar el comportamiento real (exacto en OpenAI y en Gemini con clave,
  estimado si no) porque dejarla intacta habría sido publicar una afirmación falsa sobre el propio producto —
  el mismo tipo de problema que el plan busca eliminar. El resto del copy de marketing con "70%" (meta tags,
  FAQ de savings, sección "How it works") se deja intacto a propósito: su reemplazo por el benchmark real es
  tarea explícita de la Fase 6.
- Se añadió `chunkSizeWarningLimit` en `vite.config.ts` para silenciar la advertencia esperada de Rollup sobre
  el chunk de `o200k_base` (es grande a propósito y nunca se carga en el bundle inicial).

**Deuda pendiente que hereda la Fase 2:**

- Tramo >200k tokens de Gemini Pro no modelado numéricamente, solo documentado en `notes`.
- Sin corpus de calibración público para Claude/Gemini heurístico; si Fase 5 añade claves de Anthropic/OpenAI,
  conviene sustituir el estimador de Claude por `POST /v1/messages/count_tokens` igual que ya se hizo con
  Gemini.
- El selector de modelo vive en `App.tsx` sin persistencia (no se guarda en `localStorage` como si ocurre con
  el modo IA); evaluar si vale la pena en una fase de UI posterior.

### 6.3 Fase 2 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-03): `npm run lint` ✅, `npm test` ✅ (737 tests, 17 archivos),
`npm run build` ✅. Bundle inicial: 25,21 kB gzip (`index-*.js`), frente a 17,92 kB gzip al cerrar la Fase 1
(+7,3 kB gzip: el ledger entero, sin dependencias nuevas — `package.json` no cambia en esta fase). Smoke test
manual con Playwright + Chromium headless contra `vite preview`: se pega un system prompt con variables,
literales, prohibiciones y límites, se comprime en Aggressive y el panel muestra "16/16 constraints preserved ·
11/11 critical" agrupado por tipo, sin errores de consola (captura en la sesión, no versionada).

**Resultados sobre el corpus anotado** (`bench/corpus/phase2/`, 30 prompts, 327 restricciones críticas
anotadas a mano; tabla por tipo en `bench/corpus/phase2/README.md`):

| Criterio de aceptación de la fase | Objetivo | Medido |
|---|---|---|
| Recall en restricciones `critical` | ≥ 90% | **98,8%** |
| Falsos "preservado" al borrar la frase | 0 | **0** (30 prompts × todas sus críticas, borrando la frase y borrando solo el ancla) |
| Tests por tipo de restricción | uno por tipo | 9 tipos cubiertos en `test/ledger-extract.test.ts` |

Precisión medida: 88,1%. No es criterio de aceptación y se mantiene deliberadamente en segundo plano: una
restricción de más cuesta compresión (puede vetar un cambio legítimo en Aggressive), una de menos cuesta la
promesa entera del producto.

**Decisiones tomadas en esta fase** (condicionan las siguientes):

1. **Vocabulario licenciado en vez de comparación literal.** Verificar comparando el ancla con la salida tal
   cual sería inútil: el compresor tiene permiso para reescribir "in order to" → "to" y para borrar "please".
   `ledger/normalize.ts` reduce ambos lados a tokens ignorando exactamente tres cosas — mayúsculas/puntuación,
   las equivalencias no-lossy de `SUBSTITUTION_RULES`, y una lista cerrada de muletillas (cortesía, marcos de
   petición, intensificadores). **Todo lo demás que falte es un fallo**, aunque el significado sobreviva. La
   asimetría es intencionada: un ✗ de más cuesta compresión, un ✓ de más cuesta la confianza.
   `test/ledger-normalize.test.ts` fija esa lista al conjunto de reglas: **toda** regla de borrado enviada debe
   reducir su entrada y su salida a los mismos tokens. Una regla que borrase algo fuera del vocabulario haría
   fallar ese test — y sería revertida por el ledger en Aggressive.
2. **Conteo de ocurrencias, no presencia.** Una restricción pasa solo si su ancla normalizada aparece en la
   salida **al menos tantas veces** como en la entrada. Si un prompt dice "never reveal the key" dos veces y la
   compresión borra una, la comprobación por presencia seguiría diciendo ✓; el conteo dice ✗.
3. **Las anclas son núcleos, no frases.** El ancla de una prohibición empieza en "never", no en "Please
   remember that you should never". Si el marco entrase en el ancla, cualquier compresión legal se leería como
   pérdida. Por el mismo motivo, un marcador que cae **dentro** de una muletilla licenciada no genera
   restricción: el "should" de "It should be noted that limits apply" pertenece al envoltorio que el compresor
   puede borrar (esto rompía un test de la Fase 0 hasta que se añadió el filtro `fillerRanges`).
4. **`requirement` se clasifica como `critical`**, ampliando la lista de la tarea 2 del plan (que nombra
   prohibition, format, literal, variable y quantity). Perder "reply only in English" corrompe un prompt tanto
   como perder "never reveal the key", y ninguna regla enviada borra palabras de requisito, así que la
   clasificación más estricta no cuesta compresión. El criterio de aceptación se midió con esta lista ampliada,
   es decir, sobre más restricciones de las que el plan exigía.
5. **El veto se aplica sobre la selección cruda de cambios, no sobre la proyectada.** La reparación de
   mayúsculas de la Fase 0 muta los `Change` y puede trasladar una mayúscula al cambio siguiente; revertir un
   cambio ya reparado dejaría esa mayúscula huérfana. `compress()` guarda la selección cruda y la vuelve a
   proyectar (`clonar → reparar → aplicar`) en cada ronda del ledger. Fase 3 debe mantener ese orden.
6. **Cuando ningún cambio explica un fallo, el fallo se muestra.** El veto atribuye la culpa por solapamiento
   (primero los cambios dentro del ancla, si no los de su frase) y como mucho 5 rondas. Si un `critical` sigue
   fallando y no hay cambio al que culpar, no se adivina: se deja el ✗ en el checklist.
7. **`compress()` devuelve `blocked`, `constraints` y `ledger`**, y `constraints`/`ledger` son `null` cuando el
   veto no corrió (por defecto solo corre en Aggressive). La UI puede reutilizar el inventario ya calculado en
   vez de extraerlo dos veces; `buildLedger()` acepta `{ constraints }` para eso.

**Desviaciones respecto al plan:**

- **Rama.** La sesión venía fijada a `claude/fase-2-ledger-t7n1ti`, no a `feat/fase-2-ledger`. Mismo contenido,
  distinto nombre de rama (igual que en las fases 0 y 1).
- **Corpus escrito a mano, no copiado.** La tarea 6 pide "system prompts reales de proyectos open source". Los
  30 prompts están **escritos para este repositorio**, modelados sobre los patrones que usan los system prompts
  públicos de cada oficio; cada anotación declara en `source` sobre qué se modeló. Copiar prompts ajenos
  literalmente metería texto de terceros bajo la licencia de este repo sin ninguna ganancia de medición.
- **Anotación exhaustiva solo en los tipos `critical`.** `instruction`, `entity` y `example` son `minor`, su
  detección es léxica por construcción (no hay etiquetador morfosintáctico en el bundle) y anotarlos de forma
  incompleta mediría la anotación, no el extractor. Están excluidos de la métrica y así se documenta en
  `bench/corpus/phase2/README.md`.
- **Con las reglas enviadas, el ledger no bloquea nada.** Es la consecuencia lógica de la decisión 1 (el
  vocabulario licenciado *es* lo que las reglas borran) y de la política de la Sección 2, y hay un test que lo
  afirma sobre los 30 prompts. Para que el mecanismo de veto no fuese código muerto se ejercita en
  `test/compress-ledger.test.ts` con una regla deliberadamente insegura (`unsafe.drop-never`) inyectada por
  `options.rules`. Donde el veto sí tendrá trabajo real es en el modo IA de la Fase 5 y en las reglas que el
  usuario active en la Fase 3.
- **El botón "Restaurar" está cubierto por tests unitarios, no por el smoke test de navegador.** En modo rápido
  el ledger nunca pierde nada, así que el botón no llega a renderizarse sin una clave de IA; `restoreConstraint`
  tiene 8 tests, incluido uno que parte de una compresión real dañada a propósito.
- **YAML "por forma" sigue sin implementarse** (deuda heredada de la Fase 0 y anotada allí para esta fase). El
  ledger no cambia la decisión: seguir sin protegerlo es correcto mientras la heurística produzca falsos
  positivos sobre prosa (`Note: do this`), y ahora además el inventario de `format`/`literal` cubre buena parte
  de lo que un bloque YAML suelto aportaría. Se mantiene como deuda.
- **Contenido de `<tag>…</tag>`** (otra deuda de la Fase 0): el ledger no lo reclasifica. La etiqueta sigue
  protegida como `variable` y su contenido sigue siendo comprimible, que es lo correcto para
  `<documents>{{passages}}</documents>`: el dato viene de una variable, no del texto entre etiquetas.

**Deuda pendiente que hereda la Fase 3:**

- El panel de verificación crece mucho en prompts largos (un ítem por restricción, sin plegar). La Fase 3, que
  rehace la UI alrededor del diff, debería agrupar/plegar por tipo y enlazar cada ✓/✗ con su posición en el
  diff.
- `blocked` ya se muestra como lista simple; la Fase 3 la pide integrada en la vista de diff ("cambios
  bloqueados por el ledger").
- El extractor es **solo inglés**. Un prompt en español no produce prohibiciones ni requisitos. La Fase 6 añade
  i18n en/es y debería ampliar los léxicos (`PROHIBITION_RE`, `REQUIREMENT_RE`, `IMPERATIVE_VERBS`) o el
  criterio de aceptación de esa fase quedará vacío en español.
- Precisión de `quantity` (62,9%): el patrón genérico "número + sustantivo" recoge cosas como "16 warehouse" de
  "a Postgres 16 warehouse". No rompe nada (una restricción de más solo puede vetar un cambio), pero ensucia el
  checklist.
- `extractConstraints` recorre el texto una vez por patrón (unos 30 `matchAll` sobre el prompt completo) y el
  veto lo re-verifica hasta 5 veces. Es instantáneo en prompts de system (miles de caracteres) y no se optimizó;
  si la Fase 6 añade modo lote, conviene medirlo antes.

### 6.4 Fase 3 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-03): `npm run lint` ✅, `npm test` ✅ (896 tests, 18 archivos,
+159 sobre el cierre de la Fase 2), `npm run build` ✅ (`tsc --noEmit` + `vite build`). Bundle inicial:
26,63 kB gzip (`index-*.js`), frente a 25,21 kB gzip al cerrar la Fase 2 (+1,42 kB gzip por la vista de diff y
el panel de reglas; sin dependencias nuevas — `package.json` no cambia en esta fase). Smoke test manual con
Playwright + Chromium headless contra `vite preview`: se pega un prompt con cortesía, un marco de IA y una
prohibición, se comprime en Aggressive, se deshace un cambio individual (el texto comprimido cambia), se pulsa
"Undo all" de una regla (el texto vuelve a cambiar), se abre el panel de reglas, se desactiva una regla (el
contador pasa de 37/37 a 36/37) y se activa un botón "↺" por teclado (foco + `Enter`) — sin errores de consola
en ningún paso (captura en la sesión, no versionada, igual que en fases anteriores).

**Decisiones tomadas en esta fase:**

1. **El diff se construye desde `Change[]`, sin ninguna librería de comparación de strings.** La tarea 1 de la
   Sección 3 menciona "librería `diff`/jsdiff"; el encargo de esta sesión fue más estricto ("El diff debe
   construirse desde `Change[]`, no comparando strings") y es además la lectura consistente con la arquitectura
   de la Fase 0 (`compress()` ya devuelve offsets exactos y `ruleId` por cambio — recomputar un diff de texto
   sobre `original`/`output` solo perdería esa información). `src/core/diff.ts` añade tres funciones puras sin
   DOM: `changeKey` (identidad estable `ruleId:start:end`, válida porque la selección de `compress()` nunca
   solapa), `buildDiffItems` (interfoliona `original` con `Change[]`/`BlockedChange[]` en una secuencia
   ordenada de segmentos de texto y de cambio) y `projectDiff` (reaplica un subconjunto de `Change[]` con
   `applyChanges`). Viven en `src/core/` y tienen su propio archivo de test (`test/diff.test.ts`), igual que el
   resto del motor.
2. **"Deshacer todos los cambios reproduce el original byte a byte" es una propiedad estructural, no algo que la
   UI deba acertar.** `projectDiff(original, changes, new Set(changes.map(changeKey)))` filtra todos los
   cambios y llama a `applyChanges` con una lista vacía, que por construcción de la Fase 0 devuelve `original`
   sin tocarlo. El test de propiedad (`test/diff.test.ts`) lo verifica sobre 50 prompts — los 10 de
   `bench/corpus/phase0/`, los 30 de `bench/corpus/phase2/` y 10 casos borde nuevos (vacío, un carácter, solo
   espacios, unicode/acentos/emoji, un fence de código) — en los tres niveles, superando el criterio de
   aceptación de la Sección 3.
3. **Los cambios bloqueados por el ledger (Fase 2) se integran en la propia línea de tiempo del diff**, no solo
   en la lista aparte de `LedgerPanel`. `BlockedChange` comparte el mismo sistema de coordenadas que `Change`
   (offsets sobre el original), así que `buildDiffItems` los intercala en su posición real con un marcador ⛔ y
   sin botón de deshacer (nunca llegaron a aplicarse). Esto resuelve la deuda que la Fase 2 le dejó explícitamente
   a esta fase («la Fase 3 la pide integrada en la vista de diff»); `LedgerPanel` conserva además su lista
   separada porque agrupa por restricción perdida, una vista que el diff no puede ofrecer.
4. **El panel de reglas persiste en `localStorage` bajo `promptrim.disabledRules`**, mismo patrón que
   `promptrim.aiMode` de la Fase 0/1 (mismo `try/catch` silencioso para modo privado). `compress()` ya aceptaba
   `disabledRuleIds` desde el diseño de la Fase 2 (`CompressOptions.disabledRuleIds`, sin usar hasta ahora); esta
   fase solo la conecta a la UI. Solo afecta a Fast mode: el modo IA no pasa por `compress()`.
5. **Deshacer por cambio y "deshacer todos los de la regla X" reutilizan el patrón ya existente de `onRestore`**
   (Fase 2): la App recalcula `output`, `ledger` (`buildLedger`) y el ahorro (`refreshSavings`) de forma
   imperativa tras cada toggle, en vez de introducir un `useEffect` derivado. `Run.changes` pasa de ser un
   contador (`number`) a guardar el `Change[]` completo, que es lo que `projectDiff` necesita para recomputar.
6. **Modo IA queda fuera del diff y del panel de reglas.** El proveedor de IA (Fase 1/futura Fase 5) devuelve
   texto plano, no `Change[]`; no hay nada que deshacer por cambio ni reglas que activar/desactivar. `DiffView`
   solo se renderiza cuando `run` viene de Fast mode, siguiendo el mismo precedente que `blocked`/el ledger de
   verificación, que ya eran exclusivos de Fast mode desde la Fase 2.

**Desviaciones respecto al plan:**

- **Rama.** La sesión venía fijada a `claude/fase-3-diff-implementation-fjiiyt`, no a `feat/fase-3-diff`. Mismo
  contenido, distinto nombre de rama (igual que en las fases 0-2).
- **Sin librería `diff`/jsdiff.** Ver decisión 1: el encargo de esta sesión fue explícito en que el diff debía
  construirse desde `Change[]` sin comparar strings, lo que hace innecesaria (y contraproducente, por perder
  `ruleId`) cualquier librería de diffing genérico. No se añadió ninguna dependencia nueva.
- **Artefacto visual en cambios que solo reparan mayúsculas.** La reparación de capitalización de la Fase 0
  (decisión 2 de la Sección 6.1) extiende el `original`/`replacement` de un `Change` un carácter dentro de la
  palabra siguiente. Cuando ese `Change` no borra nada más (p. ej. el marco "your task is to" desaparece justo
  antes de "write"), el diff renderiza "...to w" tachado seguido de "W" insertado y luego "rite" como texto sin
  cambios, en vez de una sustitución limpia de una sola letra. El resultado es correcto — deshacer ese cambio
  restaura exactamente la letra original — pero visualmente más ruidoso que un diff de strings ingenuo. No se
  corrigió en esta fase: fusionar el renderizado de `Change`s adyacentes en la vista arriesgaría ocultar a qué
  regla pertenece cada fragmento, que es justamente lo que la Sección 3 pide mostrar. Deuda menor para una fase
  de pulido de UI.
- **Sin tests de componente/DOM.** El repositorio no tenía infraestructura de testing de componentes antes de
  esta fase (Vitest sin `@testing-library/preact` ni jsdom) y no se añadió: `src/core/diff.ts` tiene cobertura
  completa como función pura, y el comportamiento de `DiffView`/`RulesPanel` se verificó con el smoke test de
  Playwright descrito arriba, siguiendo el mismo criterio que las fases 0 y 1 (captura no versionada).

**Deuda pendiente que hereda la Fase 4:**

- El Cost Advisor de la Fase 4 recalcula ahorro sobre `output`; con deshacer por cambio, `output` ya no es fijo
  tras una compresión — el advisor debe leer el `output` actual (post-toggle), no memorizar el de la primera
  compresión. `refreshSavings` ya se recalcula en cada toggle, así que el patrón está disponible.
- `RulesPanel` lista las 37 reglas activas sin buscador ni agrupación por categoría dentro de un nivel (solo por
  nivel). Es manejable al tamaño actual del catálogo de reglas; revisar si crece mucho en fases futuras.
- El modo IA (Fase 5) no tiene diff ni panel de reglas propio, porque no produce `Change[]`. Si la Fase 5 quiere
  un diff equivalente para IA, necesitará su propio mecanismo de trazabilidad (p. ej. que el proveedor devuelva
  también qué restricciones tocó), no puede reutilizar `src/core/diff.ts` tal cual.
