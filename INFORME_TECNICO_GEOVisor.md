# Ficha técnica del GeoVisor de cuatro barrios

**Proyecto:** GeoVisor Manrique, Comuna 3 de Medellín
**Alcance:** Área de estudio de cuatro barrios
**Vistas:** Mapa 2D y escenario 3D con DEM de 5 m

## Datos publicados

Las capas vigentes se sirven desde data: BARRIOS_INFLUENCIA, Manzanas_Barrios_Estudio, Predios_Barrios_Estudio, Construcciones_Barrios_Estudio, Amenaza_Mov_Masa, RIESGO_MOV_MASA, Curva_Nivel y los rásteres del DEM, pendiente y ortofoto.

## Diagnóstico del escenario 3D

La página oficial reportó que no podía cargar el DBF/CPG de riesgo. El proyecto conservaba rutas con mayúsculas distintas de las rutas rastreadas por Git (RIESGO_MOV_MASA/RIESGO_MOV_MASA.*). GitHub Pages distingue mayúsculas y minúsculas, aunque Windows no; el código ahora apunta a los nombres exactos del repositorio tanto en 2D como en 3D.

## Uso local

Abrir index.html o vista-3d.html desde un servidor HTTP local. No usar file://, porque el navegador bloquea la lectura de las capas. Para revisar una publicación, esperar el despliegue de GitHub Pages y recargar la página.
