# Desplegar Aerocamo — www.aerocamo.cl / app.aerocamo.cl

Guía para dejar la plataforma en producción, en el nivel gratuito de cada
servicio: Neon (base de datos), Render (backend) y Vercel (frontend).

Todo lo que exige entrar una contraseña, clave o token lo haces tú directamente
en cada consola — nunca lo pegues en el chat.

---

## 1. Base de datos — Neon

1. Crea una cuenta en [neon.tech](https://neon.tech) y un proyecto nuevo.
2. En el panel del proyecto, copia la **cadena de conexión con pooler**
   (el switch "Pooled connection", no la directa). Se ve así:
   ```
   postgresql://usuario:contraseña@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```
   Guárdala — es tu `DATABASE_URL`.
3. No crees tablas a mano: el paso 3 las crea todas.

## 2. Backend — Render

1. Crea una cuenta en [render.com](https://render.com) y conecta tu repositorio
   de GitHub (`earruez/aerocamo`).
2. **New → Web Service**, elige el repo, y configura:
   | Campo | Valor |
   |---|---|
   | Root Directory | `backend` |
   | Runtime | Node |
   | Build Command | `npm install && npm run build` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

3. En **Environment**, agrega las variables (usa `backend/.env.example` como
   referencia de cuáles existen):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | la cadena pooled de Neon |
   | `JWT_SECRET` | genera uno nuevo — ver abajo, **no reutilices el de desarrollo** |
   | `CORS_ORIGIN` | `https://www.aerocamo.cl,https://app.aerocamo.cl` |
   | `EMAIL_FROM_ADDRESS` | p. ej. `noreply@aerocamo.cl` |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | de tu proveedor de correo (opcional al inicio) |

   Para `JWT_SECRET`, genera un valor aleatorio largo. En tu terminal:
   ```bash
   openssl rand -base64 48
   ```
   Pega el resultado directamente en el campo de Render — no lo compartas en el chat.

4. Crea el servicio. Render construye y lo deja corriendo en una URL como
   `https://aerocamo-api.onrender.com`. Guarda esa URL, la usas en el paso 4.

5. **Aplica las migraciones una sola vez.** En la pestaña **Shell** del
   servicio ya desplegado (Render te da una consola en el navegador):
   ```bash
   npx tsx prisma/apply_all_migrations.ts
   ```
   Corre las 24 migraciones en orden. Es seguro volver a ejecutarlo si algo
   se corta a medio camino — cada una es reentrante.

6. **Importa los datos**, si vas a partir con los datos de Tecnicopters ya
   cargados en vez de reimportar desde el Access en producción. La forma más
   simple es volcar tu base local y restaurarla en Neon:
   ```bash
   # en tu máquina, contra tu Postgres local
   pg_dump -d griselle_db --no-owner --no-privileges -f dump.sql

   # restaurar en Neon (usa la cadena DIRECTA, no la pooled, para esto)
   psql "postgresql://usuario:contraseña@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" -f dump.sql
   ```
   Si prefieres partir limpio y reimportar el Access directamente en
   producción, usa los scripts `import:access:*` del `package.json`, apuntando
   `DATABASE_URL` a Neon.

## 3. Frontend — Vercel

Ya tienes sesión abierta (`earruez-5574`).

1. **New Project** → importa `earruez/aerocamo`.
2. Configura:
   | Campo | Valor |
   |---|---|
   | Root Directory | `frontend` |
   | Framework Preset | Vite (Vercel lo detecta solo) |

   El `vercel.json` del proyecto ya trae el build command, el output
   directory y la regla de rewrites para que las rutas de React Router no den
   404 al refrescar.

3. En **Environment Variables**:
   | Variable | Valor |
   |---|---|
   | `VITE_API_URL` | `https://aerocamo-api.onrender.com/api/v1` (la URL de Render del paso 2.4, con `/api/v1` al final) |

4. Deploy. Vercel te da una URL tipo `aerocamo.vercel.app` — con eso ya puedes
   probar que todo funciona antes de tocar el dominio.

5. **Dominios**: en el proyecto, **Settings → Domains**, agrega
   `app.aerocamo.cl` y `www.aerocamo.cl`. Vercel te muestra los registros DNS
   exactos a crear (normalmente un `CNAME` a `cname.vercel-dns.com`).

## 4. DNS — en tu proveedor de dominio (donde compraste aerocamo.cl)

Agrega los registros que Vercel indique en el paso 3.5. Suele ser:

| Tipo | Nombre | Valor |
|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` |
| CNAME | `www` | `cname.vercel-dns.com` |

La propagación puede tardar de minutos a un par de horas.

## 5. Verificación final

- [ ] `https://app.aerocamo.cl` carga y el login funciona
- [ ] Crear/editar una aeronave persiste (confirma que el backend habla con Neon)
- [ ] Descargar el PDF de una ST funciona (confirma que Render generó el archivo)
- [ ] Si configuraste SMTP: enviar una ST por correo llega de verdad

---

## Qué esperar del nivel gratuito

- **Render (free)** duerme el backend tras ~15 min sin tráfico. La primera
  petición después de eso tarda 30–60 s en responder mientras despierta; luego
  va normal.
- El job diario que arma las ST automáticamente (`WorkRequestAutoJob`) solo
  corre mientras el proceso está despierto — con el backend dormido parte del
  día, puede saltarse corridas. Si necesitas forzarlo, hay un endpoint:
  `POST /api/v1/work-requests/jobs/run-daily` (rol ADMIN).
- **Neon (free)** también se suspende por inactividad, pero despierta en
  segundos con la siguiente consulta — mucho menos molesto que Render.

Si en algún momento decides pasar a producción real con más de una empresa,
subir el plan de Render (~$7/mes) elimina el sleep sin tocar nada de esto.
