# Ganamos API (multi-tenant)

Un solo backend para Royal, Kova y Fantastico. Railway: `apimanualroyal`.

## Local

`npm run dev` en `http://127.0.0.1:8787`

Tokens de Meta en `.dev.vars`, nunca en GitHub.

## Railway

Queda **un** deploy: `apimanualroyal-production.up.railway.app`

No borres las variables actuales de Royal. Agregá las de Kova y Fantastico.

Royal (ya deberían estar):

- `META_ACCESS_TOKEN`
- `META_ACCESS_TOKEN_2`
- `PIXEL_ID`
- `PIXEL_ID_2`
- `PURCHASE_SEND_KEY`
- `LANDING_URL`

Kova (copiar del Railway viejo de Kova **antes** de apagarlo):

- `KOVA_PIXEL_ID` = `1612969067103162`
- `KOVA_PIXEL_ID_2` = `936629336158894`
- `KOVA_META_ACCESS_TOKEN`
- `KOVA_META_ACCESS_TOKEN_2`
- `KOVA_LANDING_URL` = `https://landing-kovaagency.vercel.app`

Fantastico:

- `FANTASTICO_PIXEL_ID`
- `FANTASTICO_PIXEL_ID_2`
- `FANTASTICO_META_ACCESS_TOKEN`
- `FANTASTICO_META_ACCESS_TOKEN_2`
- `FANTASTICO_LANDING_URL` (URL de Vercel de esa landing)

Volume en `/data`. En cada deploy el API aplica `migrations/*.sql` pendientes sobre ese archivo. Las landings y paneles usan `VITE_API_URL=https://apimanualroyal-production.up.railway.app` (sin barra al final).

## Schema

Cambios de tablas van en un archivo nuevo `migrations/0007_lo_que_sea.sql`. No edites una migración vieja. No corras `schema.sql` contra la base de Railway.
