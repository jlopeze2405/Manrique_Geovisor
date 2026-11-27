# GeoVisor Manrique

Visor 2D y escenario 3D para el área de estudio de cuatro barrios de la Comuna 3, Manrique, Medellín.

## Abrir localmente

Sirve la carpeta con un servidor HTTP local, por ejemplo Live Server de Visual Studio Code, y abre index.html. El navegador necesita HTTP para leer los shapefiles y los GeoTIFF. vista-3d.html abre el escenario tridimensional.

## Capas del área de estudio

Las rutas vigentes están dentro de data: límite de los cuatro barrios, manzanas, predios, construcciones, amenaza, riesgo, curvas de nivel, DEM de 5 m, pendiente y teselas GeoTIFF de ortofoto. Los archivos DBF y CPG usan las mayúsculas exactas registradas en Git para funcionar también en GitHub Pages (Linux).

Las capas voluminosas de predios y construcciones se cargan al activarlas. El escenario 3D usa el DEM de 5 m y las teselas locales de ortofoto.
