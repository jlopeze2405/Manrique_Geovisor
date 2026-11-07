# Edicion y publicacion automatica

Este repositorio publica el geovisor en GitHub Pages. La tarea de VS Code configurada en `.vscode/tasks.json` inicia el vigilante de `.vscode/auto-publish.ps1`: despues de guardar archivos y dejar de editarlos por unos segundos, crea un commit y lo envia a `main`. GitHub Pages actualiza el sitio despues de recibir el push.

## Para cada companero

1. El propietario del repositorio debe darle permiso de escritura en GitHub a la cuenta del companero. Tener una copia de la carpeta, por si solo, no concede acceso de publicacion.
2. Instalar Git para Windows y Visual Studio Code.
3. Clonar `https://github.com/jlopeze2405/Manrique_Geovisor.git` (o abrir el repositorio clonado en VS Code).
4. Iniciar sesion en GitHub desde Git Credential Manager cuando Git lo solicite. La cuenta debe tener el permiso de escritura anterior.
5. Confiar en la carpeta al abrirla en VS Code. La tarea de publicacion automatica esta configurada para ejecutarse al abrir el espacio de trabajo. Si VS Code pregunta si se permite iniciar la tarea, aceptarlo.
6. Editar y guardar los archivos. El vigilante los agrega, confirma y publica automaticamente; no se debe crear otra tarea de publicacion en paralelo.

## Trabajo simultaneo

La publicacion automatica escribe directamente en `main`. Para evitar que dos personas publiquen a la vez, coordinen el turno de edicion. Si Git informa que `main` avanzo en GitHub, primero hay que sincronizar el clon antes de seguir editando. No compartan contrasenas ni tokens; cada persona usa su propia sesion autorizada de GitHub.

## Comprobar la publicacion

El vigilante guarda su registro local en `%TEMP%\ManriqueGeovisorAutoPublish\watcher.log`. GitHub Pages puede tardar un poco en mostrar el ultimo commit; la URL publica es <https://jlopeze2405.github.io/Manrique_Geovisor/>.

La automatizacion solo funciona en un clon local con Git, VS Code y credenciales de una cuenta con permiso de escritura. No puede publicar desde una copia enviada por correo o descargada como ZIP.
