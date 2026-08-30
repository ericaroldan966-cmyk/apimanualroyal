# Ganamos API

Backend de la landing y el panel.

## Local

`npm run dev` en `http://127.0.0.1:8787`

El Access Token de Meta va en `.dev.vars`, nunca en GitHub.

```
META_ACCESS_TOKEN=
PURCHASE_SEND_KEY=
META_TEST_EVENT_CODE=
```

## Railway

1. New Project → Deploy from GitHub → `apimanualroyal`
2. Variables:
   - `META_ACCESS_TOKEN`
   - `PURCHASE_SEND_KEY`
   - `PIXEL_ID` = `1767312904299608`
3. Volume montado en `/data`
4. Settings → Generate Domain
5. En Vercel, en las dos webs, cargar `VITE_API_URL` con esa URL (sin barra al final) y redesplegar
