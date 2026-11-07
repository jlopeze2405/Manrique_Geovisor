# Informe técnico de auditoría y cambios locales

**Proyecto:** GeoVisor de investigación UVA La Armonía, Manrique  
**Base revisada:** commit local `5a182c6`  
**Estado:** cambios sin publicar; revisar y probar localmente antes de desplegar.

## Auditoría inicial

- La aplicación es estática y compatible con GitHub Pages. La vista 2D usa `index.html`, `scripts.js` y `styles.css`; el escenario 3D tiene su propio `vista-3d.html` y `vista-3d.js`.
- El mapa 2D usa Leaflet 1.9.4 y Leaflet Rotate 0.3.0; las capas Esri se conectan con Esri Leaflet 3.0.19. La lectura de shapefiles usa shpjs; los GeoTIFF se procesan con georaster y GeoRasterLayer. La vista 3D utiliza Three.js 0.180.0 y GeoTIFF.js 2.1.3.
- Las capas vectoriales institucionales se leen desde shapefiles y sus `.prj` declaran MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377). shpjs entrega sus geometrías a Leaflet en WGS 84. La visualización 2D se realiza en el CRS de mapa de Leaflet (EPSG:3857); no se reescribieron archivos fuente.
- Ya existían filtros de riesgo, barrio, uso e identificadores, consulta predial, ficha, tabla paginada, estadísticas, leyenda de riesgo, escala gráfica, orientación, impresión y dibujo/medición. El CSV de salida ya estaba presente.
- La tabla original no tenía ordenamiento ni selección múltiple. La consulta espacial existente no ofrecía relación de contención ni un listado de sus resultados. El dibujo no tenía edición de vértices, historial administrable o previsualización fluida. La carga de archivos del usuario no existía.
- La vista 3D es independiente. Durante esta intervención no se modificaron ni los datos ni el código del escenario 3D.

## Cambios hechos

- **Vista inicial:** se ajusta a la extensión derivada de la ortofoto existente y, al cargarse, al buffer del área de estudio, conservando el botón de vista inicial.
- **Capas:** controles existentes ampliados con grupos temáticos, orden por arrastre, opacidad, color, grosor, restauración de estilo, metadatos y eliminación de capas temporales. Las capas institucionales no tienen botón de eliminación.
- **Carga local temporal:** GeoJSON/JSON, KML, KMZ, GPX, CSV con selección de columnas y CRS, ZIP de shapefile y GeoTIFF. Los archivos quedan en memoria del navegador y no reemplazan datasets del repositorio. El shapefile debe incluir `.shp`, `.shx`, `.dbf` y `.prj`. El GeoTIFF se muestra solo si su CRS es EPSG:4326 o EPSG:3857; otras proyecciones se rechazan para evitar una ubicación incorrecta. Hay un límite de 150 MB por archivo.
- **Dibujo y medición:** previsualización mientras se mueve el cursor, prioridad de los eventos de dibujo, finalización por doble clic, historial de sesión, selección, ocultar/mostrar, renombrar, edición de vértices y eliminación individual. Distancias, áreas, perímetros y hectáreas se presentan con unidades.
- **Exportación:** se conserva el CSV filtrado; se añade CSV de filas seleccionadas, GeoJSON para resultados actuales/consulta espacial con transformación efectiva entre EPSG:4326, 3116 y 9377, y exportación de dibujos en GeoJSON, KML o KMZ (WGS 84). Los dibujos también pueden descargarse como XLSX en dos hojas (Resumen y Coordenadas, incluidos anillos interiores). Los archivos incluyen nombre, tipo, ID, vértices y medidas aplicables.
- **Consulta y tabla:** relación de intersección o contención geométrica, listado de resultados consultables, orden por encabezados, selección múltiple, paginación, búsqueda y sincronización de filtros. Los enlaces `?predio=...` y `?construccion=...` intentan abrir una entidad por coincidencia exacta de identificador.
- **CRS y protección de datos:** indicador de CRS en el mapa; validación de rangos de coordenadas durante las transformaciones; GeoTIFF proyectados no compatibles no se renderizan. Se retiró el script Leaflet Shapefile que no se utilizaba.

## Librerías nuevas o fijadas

- Proj4js 2.22.0: transformación local de coordenadas EPSG:3116, EPSG:9377 y EPSG:3857 a WGS 84.
- JSZip 3.10.2: lectura de ZIP de shapefile y empaquetado de KML en KMZ.
- shpjs quedó fijada en 6.2.0 en vez de utilizar `@latest`.
- SheetJS 0.20.3 se carga bajo demanda desde el CDN oficial al solicitar XLSX; no aumenta la carga inicial.

Las dependencias se referencian desde CDN, como el resto de la aplicación. Cargar archivos del usuario requiere que el CDN correspondiente esté disponible; los archivos no se envían a un servidor del proyecto.

## Validación realizada

- `scripts.js` pasó análisis sintáctico de JavaScript con Node.
- No hay IDs duplicados en `index.html` y las llamadas estáticas a `getElementById` tienen elemento correspondiente.
- `git diff --check` no reportó errores de espacios. Git muestra avisos de conversión LF/CRLF, no errores de contenido.
- Se probaron las funciones de contención con geometrías dentro/fuera, cruces de segmentos en una concavidad y polígonos dentro de huecos; los cinco casos dieron el resultado esperado.
- No se completó una prueba visual integral de navegador: el canal de automatización de escritorio devolvió que su conexión nativa no está disponible. Por ello no se certifican todavía los flujos de carga, exportación, eventos de dibujo, filtros ni regresión visual 2D/3D en una sesión real.

SheetJS se incorpora siguiendo su guía oficial de [script autónomo](https://docs.sheetjs.com/docs/getting-started/installation/standalone/) y [escritura de libros](https://docs.sheetjs.com/docs/api/write-options/). Se evaluó [@mapbox/shp-write](https://github.com/mapbox/shp-write), pero su documentación advierte límite de 10 caracteres para campos y problemas de compresión; por eso no se conectó al flujo final.

## Limitaciones pendientes

- No se añadió exportación de shapefile. Se evitó incluir un escritor cuya documentación advierte límites en los nombres de campos y problemas con la compresión; se requiere validar una alternativa en QGIS/ArcGIS. KML/KMZ de dibujos se exportan en WGS 84. CSV y GeoJSON admiten el CRS de salida seleccionado; las coordenadas XLSX están en EPSG:4326 y se etiquetan como tales.
- GeoPackage no se carga. La leyenda automática existente cubre las capas de riesgo/amenaza; la leyenda de todas las capas vectoriales simples aún no se consolida en un panel único. TIFF sin georreferenciación y GeoTIFF en EPSG:3116/EPSG:9377 se rechazan; reproyectarlos en el navegador requeriría reproyección por píxel o una canalización distinta.
- Los dibujos y las capas temporales se conservan solo durante la sesión actual; no hay persistencia en IndexedDB/localStorage.
- La fila de la entidad enfocada se resalta en la tabla cuando está en la página renderizada. La selección múltiple de tabla se conserva solo mientras la tabla está abierta y no hay persistencia entre sesiones.
- No se cambió la impresión actual ni se implementó el generador PDF propuesto para una fase posterior.

## Viabilidad futura de planos PDF

Es viable en GitHub Pages, pero no conviene capturar la pantalla del mapa. La opción más controlable es una página de composición que tome la extensión y capas elegidas, dibuje la salida en SVG/Canvas con una proyección explícita y genere el PDF con una librería como PDFKit o jsPDF. La composición tendría que recalcular escala, grilla, norte, rótulo y leyenda desde el mapa, conservar atribuciones de los servicios y gestionar teselas CORS. A4/A3 pueden ser razonables en cliente; A1 y ortofotos de alta resolución conviene procesarlos en un servicio o limitar resolución. El prototipo debe contrastarse con QGIS mediante escala, extensión, coordenadas y fuentes antes de sustituir la impresión existente.

## Cómo revisar localmente

Abrir `index.html` mediante un servidor web local (por ejemplo, Live Server) y comprobar carga de capas, dibujo, tabla, CSV y descargas. Los protocolos `file://` pueden bloquear solicitudes de capas por CORS. Validar GeoTIFF y capas transformadas en QGIS. Abrir `vista-3d.html` y verificar orientación, terreno y superposición; no se hicieron cambios 3D.

No se publicó ni se hizo push al repositorio remoto, siguiendo la instrucción del prompt adjunto.
