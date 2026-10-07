# YouTube List View — Especificación del Proyecto

**YouTube List View** es una extensión de navegador de alto rendimiento (Manifest V3) diseñada para transformar la experiencia del feed de Suscripciones de YouTube (`/feed/subscriptions`), permitiendo alternar de forma instantánea entre la cuadrícula nativa por defecto y una vista de lista limpia, profesional y totalmente personalizable.

> Este documento es la fuente de verdad sobre la arquitectura, convenciones, ciclo de vida y alcance técnico del proyecto.

---

## 1. Objetivo y Alcance

El objetivo del proyecto es devolver el control visual y cronológico a los usuarios en la pestaña de Suscripciones de YouTube, eliminando la sobrecarga visual de las cuadrículas masivas y ofreciendo un diseño estructurado fila por fila con metadatos claros y descripciones enriquecidas.

### Características Principales
- **Conmutador Nativo [Cuadrícula / Lista]**: Botones integrados directamente en la cabecera de Suscripciones junto al botón nativo *"Todas las suscripciones"*.
- **Carga Instantánea Zero-FOUC (`document_start`)**: Renderizado sin parpadeos ni deformaciones desde el primer fotograma mediante sincronización síncrona de caché local.
- **Navegación SPA Fluida**: Aislamiento estricto de estilos bajo `ytd-browse[page-subtype="subscriptions"]`, garantizando que la página de Inicio (`/`), canales y vídeos individuales permanezcan 100% nativos e inmunes a estilos de lista.
- **Descripciones Inteligentes Asíncronas**: Extracción y renderizado de resúmenes de vídeo en segundo plano con animaciones *skeleton/shimmer* y sistema de caché persistente con TTL.
- **Feed Cronológico Puro**: Filtro conmutable para ocultar la sección *"Más relevantes"* y restaurar un orden estrictamente temporal.
- **Control Avanzado de Shorts**: Opción para ocultar por completo estantes y vídeos de Shorts o ajustar sus dimensiones y separación en rejilla.
- **Panel de Ajustes en Vivo (Popup)**: Interfaz intuitiva para personalizar en tiempo real tamaños de miniaturas, espaciados entre filas, separación canal ➔ vídeo, separación título ➔ primer vídeo, anchos y fuentes.
- **Compatibilidad Total**: Soporte completo para temas Claro y Oscuro de YouTube.

---

## 2. Arquitectura del Proyecto

```
youtube-list-view_v1.0.0/
├── youtube-list-view/
│   ├── manifest.json        # Configuración Manifest V3 y puntos de entrada
│   ├── content.js           # Content script principal (DOM, ciclo de vida SPA, descripciones)
│   ├── styles.css           # Estilos aislados, variables CSS y animaciones
│   ├── shorts-main.js       # Script inyectado en MAIN world (Polymer shelves)
│   ├── background.js        # Service Worker de ciclo de vida de la extensión
│   ├── popup.html           # Interfaz de usuario del menú de ajustes
│   ├── popup.js             # Lógica de persistencia e interactividad del popup
│   └── icons/               # Iconos de la extensión (16, 48, 128)
├── youtube-list-view.md     # Documento de especificación técnica del proyecto
└── README.md                # Documentación pública y guía de instalación
```

---

## 3. Módulos y Componentes Técnicos

### 3.1 `manifest.json`
- **Manifest Version**: 3
- **Permisos**: `storage` (para persistencia de preferencias de usuario).
- **Host Permissions**: `*://*.youtube.com/*`.
- **Content Scripts**:
  - `content.js` + `styles.css`: Inyectados en `"run_at": "document_start"` en el mundo `ISOLATED`.
  - `shorts-main.js`: Inyectado en `"run_at": "document_start"` en el mundo `MAIN` para engancharse a los componentes Polymer internos de YouTube.

### 3.2 `content.js`
El núcleo de la lógica en tiempo de ejecución:
- **Pre-carga síncrona**: Lee `localStorage` (`yslv_settings_cache_v1`) en `document_start` y aplica atributos iniciales en `<html>` antes del primer renderizado gráfico.
- **Gestión del ciclo de vida SPA**:
  - `yt-navigate-start`: Prepara la activación sin desmontar destructivamente la página previa.
  - `yt-navigate-finish`: Sincroniza el estado activo, monta los botones de cabecera y encola los elementos visibles.
  - `yt-page-data-updated` y `popstate`: Gestiona actualizaciones internas del router de YouTube.
- **Filtrado estricto (`isSubscriptionsCard` & `getActiveSubsBrowse`)**: Todas las mutaciones del DOM y consultas se restringen exclusivamente a `<ytd-browse page-subtype="subscriptions">`.
- **Cola de procesamiento incremental (`scheduleProcess`)**: Utiliza `requestAnimationFrame` y lotes de procesamiento (`maxItemsPerTick = 30`) para evitar bloqueos del hilo principal.
- **Sistema de descripciones (`DESC_STORE`)**:
  - Peticiones asíncronas con limitador de concurrencia (`maxConcurrent = 2`).
  - Almacenamiento local persistente con expiración TTL (7 días).
  - Animación shimmer mediante `requestAnimationFrame` vinculada a la variable CSS `--yslvSkelX`.

### 3.3 `styles.css`
- **Encapsulación estricta**: Todos los selectores de lista están prefijados con `html[data-yslv-subs-view="list"] ytd-browse[page-subtype="subscriptions"]`.
- **Variables CSS dinámicas**:
  - `--yslv-thumb-w`: Ancho de las miniaturas de vídeo (default: `260px`).
  - `--yslv-row-pad-y`: Espaciado vertical entre filas y secciones (default: `18px`).
  - `--yslv-channel-video-gap`: Separación entre cabecera del canal y vídeo (default: `18px`).
  - `--yslv-header-gap`: Separación entre el título *"Más recientes"* y el primer vídeo (default: `12px`).
  - `--yslv-container-w`: Ancho porcentual del contenedor de la lista (default: `100%`).
  - `--yslv-channel-size`: Tamaño de fuente del nombre del canal (default: `20px`).
  - `--yslv-title-size`: Tamaño de fuente del título del vídeo (default: `16px`).
  - `--yslv-shorts-w`: Ancho de las tarjetas de Shorts en cuadrícula (default: `160px`).
  - `--yslv-shorts-gap`: Separación entre tarjetas de Shorts (default: `14px`).

### 3.4 `popup.html` & `popup.js`
- Menú emergente de estilo moderno con fondo de cristal (*glassmorphism*) y gradiente violeta.
- Animación de transición fluida entre la vista principal (estado y conmutadores de visibilidad) y la vista de ajustes avanzados (deslizadores de dimensiones).
- Sincronización bidireccional automática con `chrome.storage.local` y actualización en tiempo real en las pestañas abiertas.

---

## 4. Tabla de Configuración y Claves de Almacenamiento

| Clave (`chrome.storage.local`) | Tipo | Valor por Defecto | Descripción |
|---|---|---|---|
| `hideMostRelevant` | `boolean` | `false` | Oculta la sección *"Más relevantes"* |
| `hideShorts` | `boolean` | `false` | Oculta estantes y vídeos individuales de Shorts |
| `thumbW` | `number` | `260` | Ancho de miniatura en píxeles (`180`–`400px`) |
| `rowPadY` | `number` | `18` | Espaciado vertical de filas y secciones (`10`–`50px`) |
| `channelVideoGap` | `number` | `18` | Separación canal ➔ vídeo (`0`–`40px`) |
| `headerGap` | `number` | `12` | Separación título ➔ 1º vídeo (`0`–`32px`) |
| `containerW` | `number` | `100` | Ancho del contenedor en porcentaje (`50`–`100%`) |
| `channelSize` | `number` | `20` | Tamaño de fuente del canal (`14`–`28px`) |
| `titleSize` | `number` | `16` | Tamaño de fuente del título (`12`–`24px`) |
| `shortsW` | `number` | `160` | Ancho de tarjeta Shorts (`120`–`240px`) |
| `shortsGap` | `number` | `14` | Separación entre Shorts (`4`–`32px`) |

---

## 5. Convenciones de Desarrollo

1. **Nunca degradar el rendimiento**: Cualquier manipulación del DOM debe ser no destructiva y procesarse en lotes asíncronos (`requestAnimationFrame`).
2. **Respetar el aislamiento de páginas**: No aplicar estilos globales a elementos compartidos de YouTube (`ytd-rich-item-renderer`, `ytd-rich-grid-renderer`) sin anteponer el selector de ámbito de Suscripciones.
3. **Persistencia dual**: Toda preferencia guardada en `chrome.storage.local` debe sincronizarse inmediatamente en `localStorage` (`yslv_settings_cache_v1`) para permitir su lectura instantánea síncrona en `document_start`.
