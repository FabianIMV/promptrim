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
| 4 | ✅ Completada | 2026-09-03 | [#13](https://github.com/FabianIMV/promptrim/pull/13) | `core/cache-advisor/` (separación prefijo/sufijo, invalidadores silenciosos, modelo económico por proveedor, versión cache-ready y recomendación), `data/caching.json` con las reglas de caché verificadas hoy en las tres documentaciones oficiales, tarjeta "Cost Advisor" en la UI y sección "Compress or cache?" en la landing. El break-even (2 llamadas con TTL 5 min, 3 con 1 h) se reproduce desde los precios y coincide con la frase literal de la página de precios de Anthropic. 965 tests (+69). Ver 6.5. |
| 5 | ✅ Completada | 2026-09-04 | [#14](https://github.com/FabianIMV/promptrim/pull/14) | `src/providers/` con interfaz común y tres clientes REST (Anthropic con `output_config.format` y la cabecera de acceso directo desde navegador, OpenAI con `response_format` + `max_completion_tokens`, Gemini con `responseSchema`), pipeline comprimir → verificar → reparar con veto local del ledger, claves solo en memoria salvo opt-in a `sessionStorage`, coste de la propia llamada mostrado antes de ejecutarla, y `count_tokens` exacto de Anthropic (deuda de la Fase 1). 1043 tests en total tras fusionar con la Fase 4 (+77 propios). Ver 6.6. |
| 6 | ✅ Completada | 2026-09-04 | [#15](https://github.com/FabianIMV/promptrim/pull/15) | `npm run bench` (dos corpus: 40 prompts de producción + 10 cotidianos nuevos en `bench/corpus/phase6/`) genera las tablas de README/landing en los dos idiomas y verifica sus propios criterios de aceptación (0/426 violaciones de regiones protegidas, 100% de restricciones críticas preservadas). Compartir por URL con `lz-string`, import/export `.txt`/`.md`/`.json`, modo lote (`---`), PWA básica + `Ctrl+Enter`, landing en español en `/es/` con hreflang, y reescritura de README/landing alrededor de la tesis con sección "Qué NO hace PromptTrim". Lighthouse 100/100/100/99 (SEO/accesibilidad/buenas prácticas/rendimiento) en `/` y `/es/`. 1131 tests (+88). Ver 6.7. |
| 7 (opc.) | ✅ Completada | 2026-09-05 | (PR pendiente de enlazar) | Núcleo extraído a `packages/core` (`@promptrim/core`) como workspace npm sin tocar el comportamiento de la web (`npm run bench` reproduce las mismas cifras tras el movimiento), CLI `promptrim check` en `packages/cli` (presupuesto por archivo, delta contra un ref de git, instrucciones duplicadas y una compresión que solo se ofrece si el ledger la verifica; `--write` aplica únicamente esas), y Action compuesta (`action.yml`) que comenta en el PR con un comentario pegajoso y hace dogfooding sobre `bench/corpus` en `.github/workflows/promptrim.yml`. 1232 tests (+101). Ver 6.8. |
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

### 6.5 Fase 4 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-03): `npm run lint` ✅, `npm test` ✅ (965 tests, 23 archivos,
+69 sobre el cierre de la Fase 3), `npm run build` ✅ (`tsc --noEmit` + `vite build`). Bundle inicial:
33,42 kB gzip (`index-*.js`) frente a 26,63 kB al cerrar la Fase 3 (+6,79 kB gzip: el módulo del advisor, la
tarjeta de UI y `data/caching.json`; sin dependencias nuevas — `package.json` no cambia en esta fase).
Cobertura de `src/core/cache-advisor/**`: 98,2% de sentencias (100% en `split.ts`, `economics.ts` y
`cache-ready.ts`). Smoke test manual con Playwright + Chromium headless contra `vite preview`, sin errores de
consola: con un system prompt de ~1 180 tokens y 10 000 llamadas/día en Claude Sonnet 5 la tarjeta recomienda
«Don't just compress — move 2 per-request lines below the breakpoint and cache the 1,174 tokens above it»
(89% de ahorro frente al 0% de comprimir), lista los cuatro invalidadores silenciosos con su línea, genera la
versión cache-ready con el comentario de `cache_control` y, al cambiar a GPT-5 o Gemini 2.5 Flash (mínimo
2 048 tokens), pasa a «Leave it as it is» explicando el mínimo del modelo.

**Reglas de caché verificadas hoy, en la documentación oficial de cada proveedor** (`data/caching.json`, con
`docs_url`, `pricing_url` y `last_verified` por proveedor):

- **Anthropic** — `platform.claude.com/docs/en/build-with-claude/prompt-caching` y la página de precios.
  Multiplicadores confirmados: escritura 1,25× (5 min) y 2× (1 h), lectura 0,1×. Dos hallazgos que el plan no
  anticipaba y que cambian el modelo: (a) **el mínimo cacheable es por modelo y muy distinto entre ellos** —
  512 tokens en Opus 5, 1 024 en Sonnet 5 y **4 096 en Haiku 4.5** —, y por debajo «no error is returned», es
  decir, falla en silencio; (b) **una lectura refresca el TTL sin coste** («The cache is refreshed for no
  additional cost each time the cached content is used»), así que con llamadas más juntas que el TTL basta una
  escritura, no una por ventana.
- **OpenAI** — `developers.openai.com/api/docs/guides/prompt-caching` y la página de precios. Mínimo 1 024
  tokens desde GPT-5.6 y 2 048 antes; TTL de 30 min desde la última escritura o reutilización en GPT-5.6+ y
  ~5-10 min de inactividad antes. **GPT-5.6 cobra escritura de caché a 1,25×** (`$5,00` en Sol y `$0,25` en
  Luna, contra `$4,00`/`$0,20` de input), dato que faltaba en `data/pricing.json` desde la Fase 1 y que se ha
  añadido; los modelos anteriores no tienen cargo de escritura.
- **Google Gemini** — `ai.google.dev/gemini-api/docs/generate-content/caching` y la página de precios. Mínimo
  2 048 tokens en 2.5 Flash/Pro, TTL por defecto de 1 hora, y facturación en dos piezas: los tokens cacheados a
  la tarifa de *context caching* (10% del input) **más almacenamiento por hora** ($1/MTok·h en Flash,
  $4,50/MTok·h en Pro). La documentación no dice en ningún sitio que leer una caché explícita prolongue su
  vida, así que el modelo la recrea una vez por ventana de TTL (asimetría documentada en
  `refresh_quote`).

**El break-even del plan coincide con la documentación.** La tarea 2 pedía comprobar «2 peticiones con TTL
5 min, 3 con 1 h». La página de precios de Anthropic lo dice con esas palabras: «caching pays off after one
cache read for the 5-minute duration (1.25x write), or after two cache reads for the 1-hour duration (2x
write)» — una escritura más una lectura son 2 peticiones; más dos lecturas, 3. `breakEvenCalls()` no codifica
esos números: los deriva de los precios con `n > (write − read) / (input − read)` (1,28 → 2 y 2,11 → 3), y un
test los fija para los tres modelos de Anthropic y para los otros dos proveedores (2 llamadas también en
GPT-5.6, GPT-5, GPT-4o y Gemini).

**Decisiones tomadas en esta fase:**

1. **El prefijo cacheable termina donde termina la coincidencia byte a byte, no donde «empieza lo dinámico».**
   `splitPrompt()` devuelve dos offsets: `boundary` (primera sección por petición: `User:`, `<documents>`,
   `Context:`) y `cacheableEnd`, que es anterior cuando algo variable vive por encima. Todo marcador que no sea
   sección y esté sobre `boundary` es un **invalidador silencioso** (fecha, id de petición, variable de
   plantilla) y se reporta con su línea y su porqué. Es exactamente el «common mistake» que documenta Anthropic
   y la razón por la que un prompt de 3 000 tokens puede estar cacheando 12.
2. **Los marcadores dentro de regiones protegidas de tipo `example` o `code-fence` se ignoran.** Una fecha en un
   ejemplo few-shot es ilustrativa, y los bloques de ejemplo son justo el volumen que interesa dejar *dentro*
   del prefijo cacheado. Reutiliza `findProtectedRanges()` de la Fase 0 en vez de duplicar detección.
3. **Las variables de plantilla cuentan como invalidadores, no como frontera.** `{{company}}` en la primera
   línea rompe la caché igual que una fecha si su valor cambia; si no cambia, la app lo dice («inline it above
   the breakpoint») en vez de decidir por el usuario.
4. **El TTL se elige por coste, no por heurística.** Se tarifican todas las opciones de TTL del modelo *y* la
   opción de no cachear, y gana la más barata. Elegir «el TTL más corto que cubre el intervalo» es correcto en
   Anthropic (el TTL largo encarece la escritura) pero **erróneo en Gemini**, donde la escritura cuesta lo mismo
   con cualquier TTL y uno largo solo significa menos reescrituras: en el escenario de referencia el modelo
   elige 1 h (24 escrituras/día) en vez de 5 min (286 escrituras/día), $65,74 contra $72,09 al mes.
5. **«No cachear» siempre compite.** El escenario (c) es «lo mejor que puedes hacer reordenando», así que nunca
   sale peor que el escenario (b) por culpa de una caché que no compensa. Cuando gana no cachear,
   `cache.ttl` es `null` y la recomendación explica el motivo concreto: mínimo del modelo, intervalo mayor que
   cualquier TTL, o almacenamiento por hora que no se amortiza (en Gemini Flash hacen falta ≥3,7 lecturas/hora;
   en Pro, 4).
6. **Un escenario solo «gana» si mejora la factura actual en más de un 0,5%** (`MEANINGFUL_SAVING_RATIO`).
   Reordenar un prompt cuesta esfuerzo y riesgo; recomendar hacerlo por $0,004 al mes sería el mismo tipo de
   deshonestidad que el «70%» del hero. Con empates, gana el escenario más simple.
7. **`data/caching.json` separado de `data/pricing.json`.** Los precios ya tenían su fichero con
   `last_verified` por modelo; el comportamiento (mínimos, TTLs, refresco, almacenamiento) es otro eje que se
   re-verifica en otras páginas de documentación, y mezclarlo habría hecho imposible saber qué se comprobó
   dónde. Cada proveedor guarda además la **cita literal** que respalda el dato (`break_even_quote`,
   `refresh_quote`, `below_minimum_quote`), para que una re-verificación futura compare texto contra texto.
8. **La versión cache-ready solo mueve líneas.** No reescribe nada: es una transformación de coste, no de
   compresión. El invariante está fijado por un test sobre los 40 prompts de `bench/corpus/` (fases 0 y 2):
   el multiconjunto de líneas no vacías de la salida es idéntico al de la entrada.
9. **El escenario (c) comprime solo la parte dinámica.** Comprimir también el prefijo ahorraría un 10% de un
   coste ya reducido al 10%; en Fast mode la parte dinámica se comprime de verdad (`compress()` es una función
   pura y se puede aplicar a una porción), y en modo IA se escala con la tasa global del propio LLM
   (`scaleCompressedTokens`), documentado como aproximación.

**Correcciones a fases anteriores** (según la regla de la Sección 4: se corrige en la fase que lo descubre):

- **`cache_write_per_mtok` de Gemini estaba mal nombrado.** La fila «Context caching» de la tabla de precios de
  Google es el precio de los tokens *leídos* desde la caché (10% del input), no un recargo por escribir. Se ha
  renombrado a `cache_read_per_mtok`, que es lo que ya usaba Anthropic para lo mismo. La creación de la caché en
  Gemini se factura al precio de input estándar.
- **Faltaba el precio de escritura de caché de GPT-5.6** (1,25× en Sol y Luna). Añadido, junto con el tramo de
  contexto largo de esos dos modelos en `notes`.
- `last_verified` global y de todos los modelos pasa a 2026-09-03: hoy se releyeron las tres páginas de precios
  y ninguna otra cifra cambió respecto a la verificación del 2026-09-02.

**Desviaciones respecto al plan:**

- **Rama.** La sesión venía fijada a `claude/fase-4-cost-advisor-jzpt0o`, no a `feat/fase-4-cost-advisor`.
  Mismo contenido, distinto nombre de rama (igual que en las fases 0-3).
- **`core/cache-advisor.ts` es un directorio, no un archivo** (`split.ts`, `economics.ts`, `cache-ready.ts`,
  `recommend.ts`, `rules.ts`), igual que ocurrió con `core/ledger.ts` en la Fase 2. Cinco responsabilidades con
  cinco archivos de test.
- **La entrada «intervalo entre llamadas» es un desplegable, no un campo numérico.** «Auto (even over 24 h)»
  por defecto, más cuatro formas de tráfico típicas (< 1 min, minutos, ~1 hora, horas). Pedir segundos exactos
  a un usuario que solo sabe «esto corre en ráfagas» habría dado una precisión falsa; el valor efectivo se
  muestra siempre junto al selector.
- **El Cost Advisor solo aparece después de comprimir**, porque el escenario (b) necesita el texto comprimido.
  Consecuencia: en modo IA también se muestra, con la aproximación de la decisión 9.
- **Sin tests de componente/DOM**, igual que en las fases 0-3 (el repositorio sigue sin `@testing-library`);
  `CostAdvisor.tsx` se verificó con el smoke test de Playwright descrito arriba.
- **Lighthouse no se volvió a medir** en esta fase (no es criterio de aceptación de la Fase 4). La tarjeta
  reutiliza los tokens de color existentes y la tabla lleva `caption` en `.sr-only` y `scope` en cada
  cabecera, así que no debería empeorar la auditoría de accesibilidad; conviene re-medirlo en la Fase 6.

**Deuda pendiente que hereda la Fase 5:**

- El modelo asume **llamadas equiespaciadas**. Un tráfico real en ráfagas con huecos largos rompe la cadena de
  refrescos y necesitaría más de una escritura al día; el desplegable de intervalo lo aproxima, pero un modelo
  por ráfagas (llamadas por ráfaga + huecos entre ráfagas) sería más fiel.
- **Solo se modela el coste de input.** El output no entra en ninguno de los tres escenarios porque la
  compresión no lo cambia; si la Fase 5 añade el coste de la propia llamada de compresión (tarea 3 de esa
  fase), ahí sí habrá que sumar output.
- **El tramo >200k tokens de Gemini Pro sigue sin modelarse** (deuda heredada de la Fase 1): un prefijo de más
  de 200k se tarificaría con el precio del tramo bajo. Los mínimos ya están, los tramos no.
- **`splitPrompt` es solo inglés**, como el extractor del ledger: `Usuario:` o `Contexto:` no se detectan. Es la
  misma deuda que la Fase 2 dejó anotada para la i18n de la Fase 6, ahora también en el advisor
  (`SECTION_LABEL_RE`, `DATE_HINT_RE`, `ID_HINT_RE`).
- **La caché implícita de OpenAI y Gemini se modela como si fuese explícita.** En ambos casos el proveedor
  decide si hay acierto y no lo garantiza; el advisor da el mejor caso (prefijo estable, tráfico continuo). La
  frase que acompaña a la tarjeta lo dice, pero un factor de acierto configurable sería más honesto.

### 6.6 Fase 5 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-04, ya fusionada con la Fase 4): `npm run lint` ✅, `npm test` ✅
(**1043 tests, 28 archivos**), `npm run build` ✅ (`tsc --noEmit` + `vite build`). Bundle inicial: 39,96 kB gzip
(`index-*.js`), frente a 33,42 kB al cerrar la Fase 4 y 26,63 kB al cerrar la Fase 3 — es decir **+6,54 kB gzip
atribuibles a esta fase** (los tres clientes, el pipeline, el estimador de coste y el panel de IA); sin
dependencias nuevas — `package.json` no cambia. Antes de fusionar con la Fase 4, la rama daba 973 tests (+77
sobre la Fase 3) y 33,00 kB gzip.

**Smoke test manual** con Playwright + Chromium headless contra `vite preview`, interceptando `api.anthropic.com`
para no gastar tokens reales: se pega un prompt con cortesía y cinco restricciones, se activa el modo IA, se
comprueba que el coste aparece antes de ejecutar (`$0.0087 — 2 llamadas … hasta $0.021 si corren las 5`), que sin
clave **no se hace ninguna llamada**, y con clave falsa que corren las 5 llamadas en el orden esperado
(comprimir → verificar → reparar ×2 → re-verificar), que la cabecera `anthropic-dangerous-direct-browser-access`
viaja en todas, que `effort: medium` se envía a Opus 5 y **no** a Haiku 4.5, que la clave no aparece en el DOM ni
en `localStorage`, que `sessionStorage` solo se llena tras marcar la casilla y se vacía al desmarcarla, y que no
hay errores de consola en ningún paso (captura en la sesión, no versionada, igual que en fases anteriores).

**Verificado en la documentación oficial el 2026-09-03** (antes de escribir cada cliente, como pedía el encargo):

| Proveedor | Cabeceras | Salida estructurada | Modelos | Trampas |
|-----------|-----------|---------------------|---------|---------|
| Anthropic | `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true` | `output_config.format = {type:"json_schema", schema}` — **GA**, sin cabecera beta; `output_format` está obsoleto | `claude-opus-5` (por defecto), `claude-sonnet-5`, `claude-haiku-4-5` (alias de `claude-haiku-4-5-20251001`) | `output_config.effort` **no** existe en Haiku 4.5 ("Default effort: Not supported"); `budget_tokens`, `temperature` y `top_p` devuelven 400 |
| OpenAI | `authorization: Bearer` | `response_format = {type:"json_schema", json_schema:{name, schema, strict:true}}` | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | **`max_completion_tokens`, no `max_tokens`** (la familia GPT-5.x lo rechaza), y tampoco acepta `temperature`/`top_p`/penalizaciones |
| Gemini | `x-goog-api-key` | `generationConfig.responseMimeType: "application/json"` + `responseSchema` | `gemini-3.8-flash` (por defecto), `gemini-2.5-pro`, `gemini-2.5-flash` | El prompt de sistema va en `systemInstruction`, no en `contents` |

Además se comprobó **en el propio cable** que los tres endpoints permiten CORS desde un origen arbitrario (un
preflight `OPTIONS` responde `access-control-allow-origin` en los tres, y Anthropic lista explícitamente
`anthropic-dangerous-direct-browser-access` entre las cabeceras permitidas). Sin eso, la premisa de la fase —
navegador puro, sin backend — no se sostenía, y era la incógnita mayor de OpenAI.

**Decisiones tomadas en esta fase:**

1. **`fetch` contra el REST oficial, sin SDK de ningún proveedor.** La app es una página estática sin backend con
   la clave del propio visitante; empaquetar tres SDK para enviar tres cuerpos JSON costaría bundle inicial (el
   presupuesto que la Fase 1 fijó) a cambio de nada. Los nombres exactos de parámetros quedan fijados por
   `test/providers-request.test.ts`, que es lo que un SDK habría aportado: sin él, un renombrado sería un 400
   silencioso en el navegador de alguien y no hay test de integración posible (no hay claves en CI).
2. **El verificador local (Fase 2) manda sobre la columna ✓/✗; el modelo solo aporta evidencia.** Que un modelo
   diga "preservada" sobre una frase que no está en la salida es exactamente el falso ✓ que el ledger existe para
   impedir (§6.3). Cuando discrepan, la UI muestra el ✗ local y explica la discrepancia en texto. En cambio, para
   **decidir qué reparar se toma la unión de ambos**: cualquier restricción crítica que cualquiera de los dos dé
   por perdida entra en la reparación, que es la lectura estricta.
3. **La reparación se dispara por restricciones `critical`, no por todas.** Es lo que pide la Sección 3, y es lo
   coherente con la clasificación de la Fase 2: reparar `instruction`/`entity` gastaría llamadas en deshacer
   precisamente la compresión que se pidió.
4. **Cinco llamadas como techo, no cuatro.** El plan describe comprimir + verificar + hasta 2 reparaciones. A eso
   se añade **una re-verificación final cuando hubo reparación**: sin ella, la evidencia que se muestra junto a
   cada ✓ describiría un texto que ya no está en pantalla. El coste de esa llamada se muestra en el techo
   (`hasta $X si corren las 5`), no se esconde.
5. **Un fallo del verificador no tira la compresión.** Si la llamada B falla (429, red), el paso queda en ✗ con su
   mensaje y la ejecución sigue con el ledger local. Perder la segunda opinión no es motivo para perder un buen
   resultado. Un fallo de la llamada A sí propaga, porque no hay nada que enseñar.
6. **Claves: `sessionStorage` y solo con opt-in explícito** (`src/providers/keys.ts`, único punto del código
   autorizado a escribir una clave). Tres detalles que hacen cumplible la promesa: el propio flag "recordar" vive
   también en `sessionStorage` (guardarlo en `localStorage` re-armaría la persistencia en una visita futura que el
   usuario no eligió); desmarcar la casilla **borra** lo guardado, incluido lo que una versión anterior hubiera
   dejado en `localStorage`; y `loadKey` devuelve vacío mientras el opt-in esté apagado aunque haya un valor
   residual. `test/providers-keys.test.ts` afirma literalmente que `localStorage` queda vacío.
7. **`effort: 'medium'` en los modelos Anthropic que lo aceptan.** Comprimir es reescribir, no investigar: el
   `high` por defecto gasta tokens de razonamiento que paga el usuario sin ganancia medible. Haiku 4.5 no acepta
   el parámetro, así que `supportsEffort()` lo omite — es la clase de detalle que solo aparece leyendo la tabla de
   modelos y que habría dado un 400 en el modelo más barato, justo el que se usa por defecto como verificador.
8. **Esquemas JSON en la intersección de los tres dialectos** (`src/providers/schemas.ts`): solo `object`,
   `string`, `boolean` y arrays de strings; `additionalProperties: false` y todas las propiedades en `required`
   (lo exige el `strict` de OpenAI); ningún `minLength`/`maximum` (los rechaza Anthropic). Para Gemini se elimina
   `additionalProperties` — su `responseSchema` es un subconjunto de OpenAPI 3.0 donde no aporta nada, porque
   `required` ya lista todas las propiedades. Hay un test que recorre los esquemas y lo comprueba.
9. **`data/pricing.json` crece con dos modelos verificados hoy** (`gpt-5.6-terra`, `gemini-3.8-flash`), porque
   el selector de modelos del modo IA solo ofrece modelos que el archivo sabe tarifar: sin precio no hay
   estimación de coste previa, y ofrecer un modelo sin poder decir lo que cuesta contradice el discurso de la
   app. Los precios de la Fase 1 se releyeron y no cambiaron. `gemini-3.5-flash-lite` se añadió primero y
   **se retiró al fusionar con la Fase 4**: su mínimo cacheable no está publicado (la tabla de la página de
   caché de Gemini no lista ningún Flash-Lite, y hay un hilo abierto en el foro de Google señalando ese hueco),
   y el Cost Advisor exige ese dato para todo modelo con precio. Inventarlo habría violado la regla de la
   Sección 4; debilitar el test de la Fase 4 habría sido peor. El verificador por defecto de Gemini pasa a ser
   `gemini-2.5-flash`, con el mismo precio de input ($0,30/MTok) y mínimo documentado (2 048 tokens).
10. **Se salda la deuda que la Fase 1 dejó apuntada a esta fase**: `countClaudeTokens` llama a
    `POST /v1/messages/count_tokens` cuando hay clave de Anthropic, con caída silenciosa al estimador calibrado
    ante cualquier fallo (un badge de tokens nunca justifica un banner de error). `countTokensForModel` pasa a
    recibir "la clave del proveedor de este modelo" en vez de "la clave de Gemini".

**Desviaciones respecto al plan:**

- **Rama.** El encargo de esta sesión fijó `feat/fase-5-ai-verify` (el nombre de la Sección 3), mientras que la
  sesión venía configurada con `claude/fase-5-ai-verify-bp451h`. Se desarrolló y se abrió el PR desde
  `feat/fase-5-ai-verify`, siguiendo la instrucción explícita del encargo; la rama de la sesión se dejó apuntando
  al mismo commit. Es la primera fase que no usa el nombre `claude/...` de las fases 0-3.
- **Orden de fases: esta fase se desarrolló en paralelo con la Fase 4, no después.** La Sección 3 fija el orden
  0 → … → 6; cuando esta sesión empezó, la Fase 4 estaba pendiente y el encargo pidió la Fase 5 igualmente. La
  Fase 4 se integró en `main` (PR #13) mientras este PR estaba abierto, así que la rama de la Fase 5 se fusionó
  con `main` antes de cerrarse y ambas conviven. No hubo bloqueo real —la Fase 5 no consume nada de la 4— pero sí
  tres puntos de fricción que resolvió esa fusión, anotados aquí porque explican el estado del archivo:
  - **Numeración de secciones.** Las dos fases reclamaron el número 6.5. La Fase 4 llegó antes a `main` y lo
    conserva; esta sección pasó a 6.6.
  - **`App.tsx`.** Ambas añaden estado, efectos y un panel. Se conservan los dos: la tarjeta del Cost Advisor
    sobre el panel "Verification". El único cambio no trivial es que `geminiKeyForCounting` (solo Gemini, Fase 4)
    pasó a ser `countingKey`, que esta fase generalizó a "la clave del proveedor del modelo objetivo" al añadir
    la cuenta exacta de Anthropic.
  - **Aritmética de precios.** No se duplicó: `estimateAiCost` (Fase 5) y `adviseCost` (Fase 4) leen ambas
    `pricing.json` a través de `costForTokens`.
  - **Un fallo de integración que ningún conflicto de git muestra.** La Fase 4 exige, con un test, que *todo*
    modelo con precio tenga mínimo cacheable y TTL en `data/caching.json`; esta fase había añadido modelos a
    `pricing.json` sin esa contrapartida. Se resolvió añadiendo las reglas verificadas de `gpt-5.6-terra`
    (1 024 tokens, por la regla documentada "GPT-5.6 and later") y `gemini-3.8-flash` (4 096 tokens, de la tabla
    por modelo de la página de caché), y retirando `gemini-3.5-flash-lite` — ver la decisión 9.
- **El criterio de aceptación "≥ 98% de restricciones críticas preservadas" se mide contra un proveedor
  simulado, no contra un modelo real.** No hay claves de API en CI y no las hubo en esta sesión, así que
  `test/providers-corpus.test.ts` mide **lo que aporta el pipeline**, no lo que aporta Claude, GPT o Gemini: un
  compresor simulado borra la frase de 1 de cada 15 restricciones críticas y un reparador simulado falla la
  primera restricción de su primer intento y tiene un 5% de restricciones que nunca consigue colocar. Sobre los
  30 prompts del corpus (386 restricciones críticas) el resultado es **99,74% (385/386) tras dos intentos y
  93,01% tras uno**; el test afirma ambos números, de modo que bajar `MAX_REPAIRS` a 1 rompe la suite. **El
  número con modelos reales sigue debiéndose** y es deuda explícita para el benchmark de la Fase 6, que es quien
  puede gastar tokens de verdad.
- **Sin tests de componente/DOM**, igual que en las fases 0-3: el repositorio sigue sin `@testing-library/preact`
  ni jsdom. `AiPanel` y la extensión de `LedgerPanel` se verificaron con el smoke test de Playwright descrito
  arriba.
- **Copia de la landing y del README actualizadas.** No es trabajo de la Fase 6 adelantado: la tarjeta "AI Mode
  (Gemini)", la FAQ de privacidad y la sección "Gemini API Key Setup" pasaban a ser **falsas** con este cambio.
  Se corrigieron solo esos puntos (incluida la afirmación sin benchmark "up to 70% token reduction", que la
  Sección 0 fila 5 ya señalaba como inventada); la reescritura completa sigue siendo de la Fase 6.

**Deuda pendiente que heredan las fases siguientes:**

- **Medir el modo IA con modelos reales.** Es lo único de la Sección 3 que esta fase no puede cerrar sola. La
  Fase 6 (`npm run bench`) debería aceptar claves por variable de entorno y publicar la tasa real de restricciones
  críticas preservadas por proveedor y nivel, junto al coste medido. Hasta entonces, ningún material público debe
  afirmar un porcentaje para el modo IA.
- **El modo IA sigue sin diff.** Se mantiene la deuda que la Fase 3 dejó anotada (§6.4, punto 6): el proveedor
  devuelve texto plano, no `Change[]`. Ahora hay un mecanismo parcial de trazabilidad (`kept`/`dropped` del paso A
  y la evidencia del paso B), pero no offsets; un diff real para IA exigiría comparar strings, con la pérdida de
  `ruleId` que la Fase 3 decidió evitar.
- **Sin reintentos automáticos ante 429.** El error expone `retryAfterSeconds` y el mensaje lo dice ("Retry in
  30s"), pero no hay backoff: la decisión de reintentar —y de gastar— es del usuario. Si una fase futura añade
  reintentos, debe contarlos en la estimación de coste previa, o la cifra deja de ser honesta.
- **La estimación de coste usa el original como cota superior de la salida** (el comprimido aún no existe) y no
  incluye las reparaciones en el mínimo. Es conservadora por diseño y así está etiquetada en la UI, pero si la
  Fase 6 publica cifras de coste debe usar el `usage` real que ya devuelven los tres proveedores, no la
  estimación.
- **`gemini-3.8-flash` tiene precio promocional hasta el 2026-12-31** (input $0.75 → $1.50 el 2027-01-01), anotado
  en `notes` dentro de `pricing.json`. Alguna sesión de 2027 tendrá que re-verificarlo, como manda la Sección 4.

### 6.7 Fase 6 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-04): `npm run lint` ✅, `npm test` ✅ (**1131 tests, 33 archivos**,
+88 sobre el cierre de la Fase 5), `npm run build` ✅ (`tsc --noEmit` + `vite build`, ahora dos entradas:
`dist/index.html` y `dist/es/index.html`). Cobertura de `src/core/**`: **98,89%** de sentencias (objetivo de la
Sección 5: ≥85%). `npm run bench` verifica sus propios criterios de aceptación en cada corrida, no solo la
suite de regresión: **0/426** cambios tocaron una región protegida (dos corpus × tres niveles) y **100,0%**
(1482/1482) de las restricciones críticas se preservaron (objetivo de la Sección 5: ≥98%); el script termina
con código de salida distinto de cero si cualquiera de los dos baja del umbral. Lighthouse (`vite preview`,
Chrome headless, perfil desktop) sobre el build final: **100 SEO / 100 accesibilidad / 100 buenas prácticas /
99 rendimiento** en `/` y **100/100/100/100** en `/es/` (objetivo de la Sección 5: rendimiento ≥90, SEO y
accesibilidad ≥95 — los cuatro números superan su objetivo, no solo los dos que la sección nombra).

**Verificación manual en el sitio construido** (no en el sitio publicado — esta sesión no tiene despliegue; ver
desviaciones): con Playwright + Chromium headless contra `vite preview`, se probó cada feature nueva de punta a
punta — compartir por URL (el hash `#s=...` reproduce el prompt y el nivel exactos al recargar, y nunca
contiene una clave), exportar/importar `.txt`/`.md`/`.json`, modo lote (tres prompts separados por `---`
producen tres filas de resumen y una salida re-unida con el mismo separador), `Ctrl+Enter` para comprimir, el
service worker registrándose en el build de producción, y el selector de idioma navegando entre `/` y `/es/`
sin errores de consola en ningún caso. La prueba manual de la Sección 5 punto 3 sobre "modo IA con los tres
proveedores" no se pudo ejecutar contra proveedores reales: esta sesión no tiene claves de API de Anthropic,
OpenAI ni Google (deuda que se hereda explícitamente más abajo, ya anotada por la Fase 5 en su momento).

**Decisiones tomadas en esta fase:**

1. **El corpus del benchmark se divide en dos grupos, no uno.** La tarea 1 pedía correr "el corpus" por nivel;
   los corpus existentes (`phase0` + `phase2`, 40 prompts) son fixtures de regresión escritas para ser ya
   cuidadosas — `phase0` esconde relleno *dentro* de regiones protegidas a propósito, `phase2` son system
   prompts escritos para medir el extractor del ledger, no para ser verbosos. Publicar solo ese corpus daría
   una reducción media de 0,0-1,6% en Fast mode: honesto, pero engañoso por el motivo opuesto al "70%"
   inventado — parecería que el producto casi no comprime nada. Se añadió `bench/corpus/phase6/` (10 prompts
   escritos a mano, en la voz de una petición de chat típica, con las muletillas y marcos que las reglas de
   Balanced/Aggressive apuntan) para medir el reclamo de ahorro por separado del reclamo de seguridad. Ambos
   grupos se publican siempre, nunca uno solo: los "production-style" dan 0,0-1,6% (esperado: no hay relleno
   que inventar recortar) y los "everyday" dan 0,0-12,3% (donde sí hay algo que cortar). La alternativa —
   publicar un solo número global promediado— habría ocultado exactamente la distinción que la tesis de la
   Sección 1 pide mostrar.
2. **El ledger se aplica en los tres niveles dentro del benchmark**, aunque el producto solo lo aplica por
   defecto en Aggressive (política de la Sección 2). Es una decisión propia del script de medición, no un
   cambio de comportamiento del producto: sin esto, "restricciones preservadas" y "cambios bloqueados" solo
   tendrían dato en una fila de la tabla en vez de tres.
3. **`npm run bench` reescribe HTML, no solo Markdown.** La tarea pedía que las cifras de la landing "salgan
   del script de benchmark, nunca inventadas" con la misma fuerza que las del README. Un bloque de Markdown
   crudo insertado en `index.html` se habría mostrado como texto literal (`**bold**`, tuberías de tabla) en vez
   de renderizarse. `renderHtml()` genera una tabla real reutilizando las clases `.advisor-scroll`/
   `.advisor-table` que ya existían para el Cost Advisor, en vez de inventar CSS paralelo. Se generan y
   reescriben tres bloques marcados (`<!-- BENCHMARK:...:START/END -->`): uno en Markdown para `README.md` y
   dos en HTML — inglés en `index.html`, español en `es/index.html` — para que el número que ve un visitante
   nunca sea distinto del que produjo el script.
4. **Medir el modo IA es opcional y honesto sobre su ausencia**, saldando la deuda que la Fase 5 dejó anotada
   explícitamente para esta fase (§6.6): si `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` están en el
   entorno, `npm run bench` corre el pipeline completo sobre una muestra de 5 prompts del corpus "everyday" en
   Balanced y publica la tasa real de restricciones preservadas y el coste medido; si no, el reporte dice
   explícitamente qué proveedor no se midió y por qué, en vez de omitir la sección o inventar un número. Esta
   sesión no tiene ninguna de las tres claves, así que el número del modo IA **sigue sin publicarse** — ver
   deuda.
5. **El CSS de la landing se extrajo a `src/styles/landing.css`.** Servir `/es/` como una segunda página HTML
   estática (tarea 5) con el `<style>` de ~1300 líneas duplicado habría significado dos copias que divergen en
   la primera edición futura. Ambas páginas cargan la misma hoja de estilos con `<link rel="stylesheet">`; Vite
   la trata como un asset compartido entre las dos entradas del build (`dist/assets/main-*.css` aparece una sola
   vez, no dos).
6. **La localización en español cubre la landing estática, no la herramienta interactiva.** La Sección 3 pide
   "i18n en/es" y "URL `/es/`"; no especifica si el compresor en sí (textareas, botones, paneles) debe
   traducirse. Traducir `src/ui/` completo habría exigido introducir un framework de i18n (claves de traducción
   para cada cadena en `App.tsx`, `AiPanel.tsx`, `CostAdvisor.tsx`, `LedgerPanel.tsx`, `RulesPanel.tsx`,
   `DiffView.tsx`, `BatchView.tsx`) — un cambio arquitectónico propio, no una tarea dentro de esta fase ya
   amplia. Se tradujo el contenido de marketing/SEO completo (hero, "cómo funciona", benchmark, "qué NO hace",
   comprimir-vs-cachear, FAQ, metadatos, JSON-LD) porque es ahí donde está el valor de SEO que la tarea 5
   nombra explícitamente ("hay espacio SEO en español"); la app montada debajo sigue en inglés en ambas
   páginas. Documentado como deuda explícita, no oculta, en el roadmap del README y más abajo.
7. **Se corrigieron dos fallos reales de contraste de Lighthouse**, no solo se verificó que ya estuvieran bien.
   El botón de nivel activo (texto blanco sobre `--accent`) medía 4,46:1, justo por debajo del mínimo AA de
   4,5:1 — un token `--accent-contrast` un poco más oscuro lo sube a 5,86:1 sin cambiar `--accent` en ningún
   otro lugar. Un enlace nuevo dentro del texto de una FAQ heredaba el azul por defecto del navegador (2:1
   sobre el fondo oscuro) por no tener regla propia; el enlace preexistente del footer tenía el mismo problema
   por relojarse solo en el color frente al texto apagado de alrededor. Los tres se corrigieron con
   `--accent-light` y subrayado. Esto cierra la deuda que la Fase 0 dejó anotada explícitamente para esta fase
   (§6.1: "El objetivo ≥95 es de la Fase 6, conviene no empeorarlo antes") — accesibilidad pasó de 92 a 100.
8. **El modo lote es solo Fast mode.** La tarea 3 no especifica si el modo IA debe soportar lotes. Ejecutar el
   pipeline de IA (hasta 5 llamadas por prompt) sobre un número no acotado de prompts pegados de una vez
   dispararía un gasto que el usuario no eligió explícitamente por prompt; si se activa el modo IA con texto en
   formato de lote, la app lo dice y pide desactivarlo en vez de comprimir solo el primer prompt en silencio.

**Desviaciones respecto al plan:**

- **Rama.** Esta sesión se desarrolló en `feat/fase-6-producto`, indicado explícitamente en el encargo (no
  `claude/fase-6-producto-ui1th4`, la rama con la que arrancó la sesión) — mismo patrón que la Fase 5.
- **Sin despliegue real.** Esta sesión no publica en GitHub Pages; toda la verificación de la Sección 5 punto 3
  ("prueba manual en el sitio publicado") se hizo contra `vite preview` sirviendo el build de producción en
  local, no contra `fabianimv.github.io/promptrim`. El pipeline de `deploy.yml` no se modificó y debería
  publicar ambas páginas (`dist/index.html` y `dist/es/index.html`) sin cambios, porque GitHub Pages sirve
  cualquier archivo estático que `vite build` produzca.
- **Sin capturas de pantalla generadas por un diseñador.** La tarea 6 pide "capturas nuevas"; se capturó una
  captura real con Playwright contra la app corriendo (`docs/screenshot.png`, reemplazando el enlace externo
  roto que tenía el README) en vez de un diseño de marketing curado. Es honesta — muestra una corrida real,
  incluido un ✗ real que el ledger capturó — pero no es una pieza de diseño.
- **El número de restricciones críticas preservadas del modo IA sigue sin publicarse**, como ya anotaba la
  deuda de la Fase 5 (§6.6) que esta fase heredaba explícitamente la responsabilidad de resolver. El mecanismo
  para resolverlo (decisión 4) está completo y probado con claves falsas en desarrollo; falta que una sesión
  con acceso real a las tres APIs ejecute `npm run bench` una vez.
- **`data/pricing.json` y `data/caching.json` no se re-verificaron** en esta fase: no se tocó ningún precio ni
  regla de caché, así que `last_verified` se deja en 2026-09-03 en vez de falsificar una re-verificación que no
  ocurrió.

**Deuda pendiente que heredan las fases futuras (7 y 8, opcionales):**

- **Localización completa de `src/ui/`** al español (decisión 6). El texto de la app interactiva sigue en
  inglés en `/es/`; una fase de pulido de i18n debería introducir claves de traducción reales en vez de cadenas
  literales en JSX.
- **Modo IA sin medir con proveedores reales.** Sigue siendo la deuda más importante que arrastra el proyecto:
  ningún material público puede afirmar un porcentaje de restricciones preservadas para el modo IA hasta que
  alguna sesión con las tres claves de API corra `npm run bench` y publique el resultado real.
- **Sin reintentos automáticos ante 429** (deuda de la Fase 5, sin cambios en esta fase).
- **El modo lote no tiene su propia vista de diff** ni pasa por el Cost Advisor por prompt — solo agrega
  ahorro total a través de `refreshSavings` sobre el original completo (incluidos los separadores `---`) contra
  la salida re-unida. Es una aproximación razonable para un resumen, pero un Cost Advisor por fila sería más
  preciso si el modo lote crece.
- **El extractor del ledger sigue siendo solo inglés** (deuda heredada de las Fases 2, 4 y 5). Un prompt en
  español en `/es/` obtiene la protección de regiones protegidas pero no el checklist de restricciones — la
  Sección "Qué NO hace PromptTrim" lo dice explícitamente en vez de ocultarlo, pero sigue siendo trabajo
  pendiente si la Fase 7/8 quiere que el checklist funcione igual de bien en ambos idiomas.
### 6.8 Fase 7 — decisiones, desviaciones y deuda

**Verificación al cerrar la fase** (2026-09-05): `npm run lint` ✅ (ESLint + Prettier sobre el workspace
entero, `packages/**` incluido), `npm test` ✅ (**1232 tests, 39 archivos**, +101 sobre el cierre de la
Fase 6), `npm run build` ✅ — que ahora encadena `npm run build:packages` (`tsc` de `packages/core` y de
`packages/cli`) antes de `tsc --noEmit` y `vite build`. Cobertura de sentencias: **98,90%** en
`packages/core/src/**` (era 98,89% antes de mover el núcleo: el movimiento no cambió una sola línea
ejecutable) y **98,21%** en `packages/cli/src/**`; objetivo de la Sección 5: ≥85%.

**El núcleo se movió sin cambiar de comportamiento, y está comprobado.** `npm run bench` después de la
extracción produce exactamente las mismas cifras que antes (0/426 violaciones de regiones protegidas,
100,0% de restricciones críticas preservadas, 0,0-1,6% de reducción en el corpus de producción y
0,0-12,3% en el cotidiano); el único cambio en `bench/results/` y en las tablas de README/landing es la
fecha de generación. `vite build` sigue emitiendo las dos entradas (`dist/index.html`, `dist/es/index.html`)
y el chunk perezoso de o200k sigue separado, con el mismo tamaño.

**Verificación de la Action** (criterio de aceptación de la fase): los pasos de shell de `action.yml` se
ejecutaron localmente contra este mismo repositorio, con `RUNNER_TEMP`, `GITHUB_OUTPUT` y
`GITHUB_STEP_SUMMARY` simulados, sobre `bench/corpus/phase0|phase2|phase6/*.md` con la configuración exacta
del workflow (`claude-opus-5`, `aggressive`, presupuesto 1200, 50 000 llamadas/día, `fail-on: budget`):
52 archivos, `exit-code=0`, informe Markdown escrito y `jq -Rs` produciendo un cuerpo de comentario válido
que empieza por el marcador pegajoso. La ruta de fallo también se probó (presupuesto 200 → código de salida
1). La corrida real en GitHub Actions ocurre al abrir el PR de esta fase; ver desviaciones.

**Decisiones tomadas en esta fase:**

1. **El paquete raíz pasa a llamarse `promptrim-workspace`; el CLI se queda con el nombre `promptrim`.**
   Un workspace npm no puede tener dos paquetes con el mismo nombre, y el comando que la Sección 3
   documenta es `npx promptrim check`. Renombrar la raíz (privada, nunca publicable) cuesta cero y deja el
   nombre bueno donde tiene que estar; lo contrario habría obligado a documentar `npx @promptrim/cli`, que
   no es lo que el plan promete.
2. **La web y los tests consumen el *código fuente* de `packages/core`, no su `dist`.** `vite.config.ts` y
   `tsconfig.json` alias `@promptrim/core` a `packages/core/src/index.ts`. Así `npm run dev` y `npm test`
   siguen funcionando sin paso de compilación intermedio, el bundle del navegador se sigue tree-shakeando
   desde TypeScript en vez de desde CommonJS emitido, y la cobertura sigue midiendo las fuentes reales. El
   `dist` compilado existe para un único consumidor: el CLI de Node. Es la razón por la que "extraer el
   núcleo" no rompió la web.
3. **Los paquetes compilan a CommonJS.** Las fuentes importan sin extensión (`./compress`) e importan JSON
   directamente; emitir ESM para Node habría exigido añadir `.js` a unos 150 especificadores relativos y
   atributos de importación (`with { type: 'json' }`) a los dos imports de datos — un diff que toca todos
   los archivos del núcleo, justo en la fase en la que hay que poder ver que el núcleo *no* cambió. El único
   consumidor del `dist` es un CLI de Node, donde CommonJS no cuesta nada. Efecto colateral necesario: el
   `import type { Tiktoken } from 'js-tiktoken/lite'` de nivel superior se cambió por inferencia desde el
   `import()` dinámico, porque un type-import estático de un paquete ESM desde un módulo CommonJS exige un
   atributo `resolution-mode` (TS1541); el `import()` resuelve solo a la entrada `.cjs`.
4. **`data/pricing.json` y `data/caching.json` se mudan a `packages/core/src/data/`.** Un paquete tiene que
   traer sus propios datos: dejarlos en la raíz del repositorio los habría dejado fuera de `files` y fuera
   de `rootDir`, y el `dist` habría apuntado a un archivo que no existe en el paquete. Con `rootDir: src`
   el emitido queda limpio (`dist/pricing.js` → `dist/data/pricing.json`). Es una desviación del árbol de la
   Sección 2, anotada abajo.
5. **El CLI tiene exactamente una dependencia en tiempo de ejecución: `@promptrim/core`.** El matcher de
   globs y el parser de argumentos están escritos a mano (unas 180 líneas entre los dos, con 29 tests
   propios) en vez de traer `minimatch` + una librería de argumentos. Meter un árbol de dependencias en el
   CI de otra persona para resolver `prompts/**/*.md` sería exactamente el tipo de coste invisible que el
   Cost Advisor existe para señalar. El subconjunto soportado es `**`, `*`, `?` y `{a,b}`; no hay clases de
   caracteres ni negación (deuda anotada).
6. **El ledger veta las sugerencias en los tres niveles, no solo en Aggressive.** El producto web deja
   Light/Balanced sin veto porque hay una persona mirando el diff; en CI no hay nadie mirando, así que una
   sugerencia que el CLI ofrece —y sobre todo una que `--write` aplica— pasa siempre por la verificación.
   Mismo razonamiento que la decisión 2 de §6.7 para el benchmark. Una compresión que perdería una
   restricción `critical` se reporta como retenida ("blocked by ledger"), nunca se aplica en silencio.
7. **La tercera puerta de `--fail-on` es `duplicates`, no "compresión no verificada".** La primera versión
   consideraba fallar cuando el ledger vetaba la compresión de un archivo; eso es información sobre el
   prompt (no se puede comprimir sin perder algo), no un defecto que un autor pueda arreglar. Una
   instrucción duplicada sí es accionable y es justo lo que el ejemplo de la tarea 3 nombra
   ("3 instrucciones duplicadas detectadas"). Las puertas son `budget`, `regression` y `duplicates`, y por
   defecto la Action no falla ninguna (`fail-on: none`): comenta.
8. **Ningún paquete se publica en npm en esta fase.** `promptrim` no está registrado, así que documentar
   `npx promptrim check` a secas sería una instrucción que devuelve 404 — el mismo tipo de afirmación no
   verificada que la Sección 0 le reprocha a la app vieja. El README documenta la forma `npx` como la
   interfaz que expondrá el paquete publicado y, al lado, la invocación que funciona hoy
   (`npm run cli -- check …`, o la Action, que lo compila sola). Publicar queda como deuda explícita.
9. **Un recuento estimado se marca con `~` en todas las salidas.** Sin `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`
   los modelos de Anthropic y Gemini se cuentan con el estimador calibrado, no con un tokenizador real; el
   informe lo dice en una nota y antepone `~` a cada número afectado, en vez de presentar una estimación
   como una medición. Con modelos de OpenAI el recuento es exacto y offline (`js-tiktoken`, `o200k_base`).
10. **La Action mantiene un solo comentario por PR.** Lo localiza por el marcador `<!-- promptrim-report -->`
    que escribe el propio renderizador de Markdown (hay un test que ata los dos) y lo edita en sitio, para
    que una rama de diez commits no acumule diez informes. Además vuelca el mismo informe en el resumen del
    job, trunca a 60 000 caracteres con nota visible antes de que la API lo rechace, y degrada a un
    `::warning::` —no a un fallo— cuando el token es de solo lectura (PR desde un fork).

**Desviaciones respecto al plan:**

- **Rama.** Esta sesión se desarrolló en `feat/fase-7-cli`, la rama que indica la Sección 3 y que el encargo
  repite (no `claude/fase-7-cli-complete-8aozc2`, la rama con la que arrancó la sesión) — mismo patrón que
  las Fases 5 y 6.
- **`data/` ya no está en la raíz del repositorio**, contra el árbol dibujado en la Sección 2 (decisión 4).
  Todas las referencias en prosa (README, `index.html`, `es/index.html`, comentarios de código y tests) se
  actualizaron a `packages/core/src/data/`; no queda ninguna ruta obsoleta.
- **La Action se verificó ejecutando sus pasos de shell en local, no en un runner de GitHub.** Una corrida
  real necesita un PR abierto, que es el último paso de esta sesión: el workflow queda commiteado y correrá
  sobre el propio PR de la fase. Lo que sí está probado aquí es todo lo que no depende del runner (el CLI,
  el informe, los códigos de salida, el troceado de patrones, el payload del comentario) más 12 tests que
  atan `action.yml` y el workflow al CLI: que cada `--flag` que la Action pasa existe en la ayuda, que el
  marcador del comentario coincide con el del renderizador, que el modelo y el nivel del workflow son
  válidos, que sus globs encuentran archivos y que ningún archivo del corpus supera el presupuesto que el
  propio workflow impone.
- **`data/pricing.json` y `data/caching.json` no se re-verificaron**: esta fase no toca ningún precio ni
  regla de caché, así que `last_verified` sigue en 2026-09-03 en vez de falsificar una re-verificación.
- **`bench/results/`, README, `index.html` y `es/index.html` cambian solo en la fecha** de generación del
  benchmark, por la corrida de comprobación post-extracción descrita arriba.

**Deuda pendiente que hereda la Fase 8 (opcional) o una sesión de pulido:**

- **Publicar `promptrim` en npm** para que `npx promptrim check` funcione sin clonar (decisión 8). Requiere
  quitar `private: true` de los dos paquetes, decidir si `@promptrim/core` se publica por separado y añadir
  un workflow de release.
- **El CLI solo usa el modo rápido.** No ejecuta el pipeline de IA (comprimir → verificar → reparar) sobre
  los archivos: eso gastaría dinero en cada PR sin que nadie lo haya elegido por archivo. Si alguna vez se
  añade, debería ser opt-in explícito con presupuesto de gasto, no una bandera más.
- **El CLI no expone el Cost Advisor.** Proyecta el coste mensual de los tokens de cada archivo, pero no
  dice "no comprimas esto, cachéalo", que es el consejo más valioso de la Fase 4 justo para el tipo de
  archivo que vive en `prompts/` y se ejecuta miles de veces al día.
- **El matcher de globs no soporta clases de caracteres (`[0-9]`) ni negación** (decisión 5). Excluir un
  `README.md` de un directorio de prompts hoy exige listar los patrones a mano.
- **El extractor del ledger sigue siendo solo inglés** (deuda heredada de las Fases 2, 4, 5 y 6). En el CLI
  esto se nota más: un repositorio con prompts en español obtiene presupuesto y delta de tokens, pero la
  columna de duplicados y la verificación de la compresión quedan vacías.
- **Modo IA sin medir con proveedores reales** y **localización completa de `src/ui/`**: sin cambios, siguen
  como las dejó §6.7.
