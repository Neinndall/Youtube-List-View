# YouTube Subscriptions List View

Extensión de Chrome/Edge que recupera la vista de lista clásica en la página de suscripciones de YouTube.

## 🎯 Características

- ✅ **Vista de lista horizontal** con miniaturas a la izquierda
- ✅ **Descripciones de videos** automáticas
- ✅ **Diseño fiel** a la vista LIST original de YouTube
- ✅ **Shorts mantienen su diseño original** en grid horizontal
- ✅ **Optimizado** para rendimiento (cache, debouncing, límite de peticiones)
- ✅ **Hover effects** y diseño responsive
- ✅ **Compatible** con Chrome, Edge, Brave y otros navegadores basados en Chromium

## 📦 Instalación

### Método 1: Instalación Manual (Desarrollo)

1. **Descarga los archivos** de la extensión
2. **Abre tu navegador** (Chrome/Edge)
3. **Ve a extensiones**:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
4. **Activa el "Modo de desarrollador"** (toggle en la esquina superior derecha)
5. **Haz clic en "Cargar extensión sin empaquetar"**
6. **Selecciona la carpeta** donde descargaste los archivos
7. ✅ ¡Listo! La extensión está instalada

## 🚀 Uso

1. Ve a **YouTube** → **Suscripciones**: `https://www.youtube.com/feed/subscriptions`
2. La vista LIST se aplicará **automáticamente**
3. Las descripciones se cargarán progresivamente

### Popup de la Extensión

Haz clic en el icono de la extensión para:
- 🔄 **Actualizar la página** actual
- 📺 **Ir a Suscripciones** directamente

## 📁 Estructura de Archivos

```
youtube-list-view/
├── manifest.json       # Configuración de la extensión
├── content.js          # Script principal (inyecta descripciones)
├── styles.css          # Estilos de la vista LIST
├── popup.html          # Interfaz del popup
├── popup.js            # Lógica del popup
├── icon-generator.html # Generador de iconos (opcional)
└── icons/              # Carpeta de iconos
    ├── icon16.png      # Icono 16x16
    ├── icon48.png      # Icono 48x48
    └── icon128.png     # Icono 128x128
```

## 🎨 Características Técnicas

### Optimizaciones de Rendimiento

- **Cache de descripciones**: Evita re-fetch de videos ya cargados (30 min)
- **Debouncing**: Reduce ejecuciones innecesarias del observer
- **Límite de concurrencia**: Máximo 3 fetches simultáneos
- **Retry logic**: 2 intentos en caso de fallo
- **Observer optimizado**: Solo observa cambios relevantes

### Diseño CSS

- **Layout horizontal**: Miniatura izquierda + info derecha
- **Responsive**: Ajusta tamaños según ancho de pantalla
- **Hover effects**: Feedback visual al pasar el mouse
- **Typography**: Tamaños fieles a YouTube original
- **Dark mode**: Optimizado para tema oscuro de YouTube

## 🔧 Configuración Avanzada

Puedes modificar la configuración en `content.js`:

```javascript
const CONFIG = {
    maxConcurrentFetches: 3,      // Fetches simultáneos
    debounceDelay: 300,            // Delay del debounce (ms)
    retryAttempts: 2,              // Reintentos en fallo
    cacheExpiration: 1000 * 60 * 30 // Expiración cache (30 min)
};
```

### Comportamiento con Shorts

Los **Shorts** mantienen su diseño original en grid horizontal y **NO** se les aplica:
- ❌ Vista LIST horizontal
- ❌ Inyección de descripciones
- ❌ Estilos de hover

Esto asegura que los Shorts se vean correctamente en formato vertical como están diseñados.

## 📝 Notas Importantes

### Permisos

La extensión requiere:
- `storage`: Para guardar preferencias (futuro)
- `host_permissions`: Para hacer fetch de descripciones de YouTube

### Compatibilidad

- ✅ Chrome 88+
- ✅ Edge 88+
- ✅ Brave
- ✅ Opera
- ❌ Firefox (requiere adaptación del manifest a v2)

## 🐛 Solución de Problemas

### La vista no se aplica

1. Asegúrate de estar en `/feed/subscriptions`
2. Recarga la página (F5)
3. Verifica que la extensión esté activada en `chrome://extensions/`

### Las descripciones no cargan

1. Verifica tu conexión a internet
2. YouTube puede estar limitando peticiones (espera unos minutos)
3. Abre la consola (F12) y verifica errores

### La extensión está lenta

1. Reduce `maxConcurrentFetches` en la configuración
2. Aumenta `debounceDelay` a 500ms
3. Limpia el cache del navegador

## 🔄 Actualizaciones Futuras

Ideas para próximas versiones:
- [ ] Opción para toggle ON/OFF desde el popup
- [ ] Personalización de número de líneas de descripción
- [ ] Soporte para otras páginas de YouTube
- [ ] Modo compacto/expandido
- [ ] Exportar/importar configuración

## 📄 Licencia

Este proyecto es de código abierto. Siéntete libre de modificarlo y mejorarlo.

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Si encuentras bugs o tienes ideas:
1. Reporta issues
2. Propón mejoras
3. Envía pull requests

---

**Creado con ❤️ para recuperar la vista LIST de YouTube**
