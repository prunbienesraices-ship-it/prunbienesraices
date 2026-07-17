# Guía de despliegue — Prun Bienes Raíces (versión gratuita en la nube)

Esta guía te lleva de la mano para dejar el sitio funcionando de verdad en internet, gratis, usando **Supabase** (base de datos + almacenamiento de fotos) y **Render** (el servidor).

No hace falta que sepas programar — son todo clics y copiar/pegar.

---

## Antes de arrancar: qué vas a tener al final

- Una base de datos real en la nube (Supabase), donde vivan tus propiedades, consultas, etc.
- Un servidor corriendo 24 horas (Render), con tu backend.
- Una dirección web pública, algo como `https://prun-bienes-raices.onrender.com`, que cualquiera puede visitar.
- El panel de administración en esa misma dirección + `/admin.html`.

**Importante sobre el plan gratis de Render:** si nadie visita el sitio durante 15 minutos, el servidor "se duerme". La próxima persona que entre va a esperar entre 30 y 50 segundos a que arranque de nuevo. Es normal, no es un error.

---

## Paso 1: Crear tu cuenta y proyecto en Supabase

1. Andá a **https://supabase.com** y creá una cuenta (podés entrar con GitHub o con tu email).
2. Hacé clic en **"New Project"**.
3. Completá:
   - **Name**: `prun-bienes-raices`
   - **Database Password**: generá una contraseña segura y **guardala en un lugar seguro** (la vas a necesitar después).
   - **Region**: elegí la más cercana a Argentina (por ejemplo, "South America (São Paulo)").
4. Hacé clic en **"Create new project"** y esperá 1-2 minutos a que se termine de crear.

### Cargar las tablas de la base de datos

1. Adentro de tu proyecto, en el menú de la izquierda, hacé clic en **"SQL Editor"**.
2. Hacé clic en **"New query"**.
3. Abrí el archivo `backend/supabase-schema.sql` que está en esta carpeta, copiá **todo** su contenido, y pegalo en el editor.
4. Hacé clic en **"Run"** (o Ctrl+Enter). Deberías ver un mensaje de éxito. Esto crea todas las tablas y el espacio para guardar fotos.

### Conseguir tus claves de conexión

1. En el menú de la izquierda, andá a **"Project Settings"** (el ícono de engranaje) → **"API"**.
2. Vas a ver dos datos que necesitás copiar y guardar:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`)
   - **service_role key** (una clave larga, en la sección "Project API keys" — **no** uses la "anon" key, usá la que dice "service_role")

⚠️ La **service_role key** es súper sensible — es como la llave maestra de tu base de datos. Nunca la compartas ni la subas a un lugar público.

---

## Paso 2: Subir el código a GitHub

Render necesita que el código esté en GitHub para poder desplegarlo.

1. Si no tenés cuenta, creá una gratis en **https://github.com**.
2. Hacé clic en el botón verde **"New"** (o el **+** de arriba a la derecha → "New repository").
3. Ponele de nombre `prun-bienes-raices` y hacé clic en **"Create repository"**.
4. En la página que se abre, vas a ver un botón **"uploading an existing file"** (o "Add file" → "Upload files").
5. Arrastrá **todas** las carpetas y archivos de este proyecto (`backend/` y `frontend/` completas) a esa ventana.
6. Abajo, hacé clic en **"Commit changes"**.

*(Si en algún momento querés hacerlo con más comodidad usando Git desde la terminal, avisame y te paso los comandos — pero con arrastrar y soltar en la web alcanza para arrancar.)*

---

## Paso 3: Crear el servidor en Render

1. Andá a **https://render.com** y creá una cuenta (podés entrar con tu cuenta de GitHub, así quedan conectadas directo).
2. Hacé clic en **"New +"** → **"Web Service"**.
3. Elegí el repositorio `prun-bienes-raices` que acabás de subir a GitHub (Render te va a pedir autorización para verlo — aceptala).
4. Completá el formulario:
   - **Name**: `prun-bienes-raices`
   - **Region**: la más cercana (Oregon o la que te ofrezca por defecto está bien)
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Bajá hasta **"Environment Variables"** y agregá estas, una por una (con el botón "Add Environment Variable"):

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | (tu Project URL de Supabase) |
   | `SUPABASE_SERVICE_KEY` | (tu service_role key de Supabase) |
   | `JWT_SECRET` | cualquier frase larga inventada, ej: `prun2026clavesecreta` |
   | `ADMIN_EMAIL` | `admin@prunbienes.com` |
   | `ADMIN_PASSWORD` | la contraseña que quieras para el admin |

6. Hacé clic en **"Create Web Service"**.
7. Esperá unos minutos — vas a ver los logs del despliegue en pantalla. Cuando termine, vas a ver una línea como:
   ```
   PRUN BIENES RAICES - Servidor (nube) iniciado
   ```
8. Arriba de la página, Render te muestra la dirección de tu sitio, algo como `https://prun-bienes-raices.onrender.com`. ¡Esa es tu página en internet!

---

## Paso 4: Probarlo

1. Abrí la URL que te dio Render — deberías ver la página principal.
2. Andá a `TU-URL/admin.html` (ej: `https://prun-bienes-raices.onrender.com/admin.html`).
3. Entrá con el email y contraseña que pusiste en `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. Cargá una propiedad de prueba con una foto, y fijate que aparezca en la página principal.

---

## Qué hacer si algo no funciona

- **"Error al conectar con el servidor"**: puede ser que Render todavía esté "despertando" (esperá 40 segundos y recargá), o que falten variables de entorno — revisá el Paso 3.5.
- **No puedo iniciar sesión en el panel**: revisá que `ADMIN_EMAIL` y `ADMIN_PASSWORD` estén bien escritos en Render, y que hayas corrido el `supabase-schema.sql` en el Paso 1.
- **Las fotos no se suben**: confirmá que corriste el script SQL completo (incluye la creación del bucket de Storage al final).
- Para ver qué está pasando del lado del servidor, en Render andá a la pestaña **"Logs"** de tu servicio — ahí se ve cualquier error en detalle.

---

## Qué falta todavía (próximos pasos)

Esta primera versión en la nube cubre lo esencial: sitio público, propiedades, consultas y login de administrador. Los módulos que armamos después en la versión de prueba (inquilinos, contratos, cobranzas, liquidaciones, reparaciones, propietarios, pipeline, tesorería, auditoría, roles detallados, agenda, IA, publicación) **todavía no están en esta versión con backend real** — hay que migrarlos de a uno, siguiendo el mismo patrón que ya armamos acá (tabla en Supabase + rutas en el backend + conexión desde el frontend).

Cuando quieras, seguimos sumando el próximo módulo (te recomendaría Inquilinos y Cobranzas, porque es el corazón operativo del día a día).
