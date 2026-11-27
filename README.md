# GeoVisor Manrique

Visor 2D y escenario 3D para el área de estudio de cuatro barrios de la Comuna 3, Manrique, Medellín.

## Abrir localmente

Sirve la carpeta con un servidor HTTP local, por ejemplo Live Server de Visual Studio Code, y abre index.html. El navegador necesita HTTP para leer los shapefiles y los GeoTIFF. vista-3d.html abre el escenario tridimensional.

## Capas del área de estudio

Las rutas vigentes están dentro de data: límite de los cuatro barrios, manzanas, predios, construcciones, amenaza, riesgo, curvas de nivel, DEM de 5 m, pendiente y teselas GeoTIFF de ortofoto. Los archivos DBF y CPG usan las mayúsculas exactas registradas en Git para funcionar también en GitHub Pages (Linux).

Las capas voluminosas de predios y construcciones se cargan al activarlas. El escenario 3D usa el DEM de 5 m y las teselas locales de ortofoto.


## Tablero territorial

Abre dashboard.html desde el mismo servidor para consultar indicadores por barrio, riesgo, amenaza, destino predial y número de pisos. Los filtros se cruzan entre mapa, gráficos y tabla; también se puede descargar la selección como CSV/XLSX o imprimirla como PDF desde el navegador. Las áreas corresponden a Shape_Area en m² y el número de pisos no se interpreta como altura.

El tablero usa atributos derivados permitidos y geometrías de los shapefiles existentes. Agrupa polígonos con geometría idéntica para evitar duplicar áreas y recuentos; los atributos discordantes entre filas unidas se omiten de sus resúmenes. No carga nombres ni documentos de propietarios. Si se reemplazan las capas de predios o construcciones, regenera data/dashboard_attributes.json con tools/build-dashboard-attributes.ps1 para alinear atributos y huellas geométricas.

El sitio es estático y las bibliotecas de gráficos y exportación se cargan desde CDN, por lo que esas funciones requieren conexión a internet.
