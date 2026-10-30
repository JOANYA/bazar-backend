# API del Bazar de Barrio

Backend (Node.js + Express + MySQL) para inventario, ventas rápidas, fiados ("el cuaderno digital"),
entrada de mercadería y cierre de caja. Arquitectura en capas, igual que el backend de referencia:
`routes → controllers → services → repositories`.

## Puesta en marcha

```bash
# 1. Base de datos (MySQL 8.0.16+). En Workbench, ejecuta en este orden:
#    db/01_inventarioTienda.sql   (tu script original, sin cambios)
#    db/02_extensiones.sql        (migración: UNA sola vez)

# 2. Configuración
cp .env.example .env             # completa DB_*, JWT_SECRET y ADMIN_*
npm install

# 3. Primer administrador y arranque
npm run sembrar:admin
npm run dev                      # http://localhost:3000

# Pruebas (necesitan la base cargada y el .env)
npm test
```

## Cómo se usa (quién es quién)

| Rol | Cómo entra | Qué puede |
|---|---|---|
| **Administrador** (tú) | `POST /api/auth/admin/login` con correo | Crear, suspender y reactivar tiendas |
| **Tendera** (la dueña del bazar) | `POST /api/auth/login` con `usuario_login` | Todo lo de su bazar. Solo ve **sus** datos |

Todas las rutas (salvo login y `/api/salud`) exigen `Authorization: Bearer <token>`.
Los errores siempre salen como `{ "status": "error", "message": "texto en español para mostrar" }`.

## Endpoints

### Sesión
- `POST /api/auth/login` `{usuario_login, password}` → `{token, tienda}`
- `POST /api/auth/admin/login` `{correo, password}`
- `GET /api/auth/me` · `PUT /api/auth/password` `{password_actual, password_nueva}`

### Administrador
- `GET /api/admin/tiendas` · `POST` `{nombre_tienda, telefono, usuario_login, password}`
- `PATCH /api/admin/tiendas/:id` `{nombre_tienda?, telefono?, estado?}` — `SUSPENDIDO` corta el acceso al instante
- `POST /api/admin/tiendas/:id/restablecer-password` `{password}`

### Pantalla principal y ventas ("Un Toque")
- `GET /api/reportes/inicio` — ventas de hoy, agotados, cuánto le deben
- `GET /api/productos/rapidos?limite=15` — la cuadrícula: favoritos fijados + lo más vendido de 30 días (sin configurar nada)
- `GET /api/productos?q=coc` — búsqueda predictiva (por nombre o código de barras)
- `GET /api/productos/codigo/:codigo` — lector de código de barras (404 → ofrecer "crear producto")
- `POST /api/ventas`
  ```json
  { "items": [{"id_producto": 1, "cantidad": 2}],
    "metodo_pago": "Efectivo | Yape/Plin | Fiado | Tarjeta",
    "id_cliente": 7,
    "uuid_cliente": "generado por la app" }
  ```
  El precio **siempre** lo toma el servidor. `uuid_cliente` (opcional, recomendado en la PWA): si el internet
  se cae y la app reenvía, la venta no se duplica (responde `200` con `repetida: true` en vez de `201`).
- `GET /api/ventas?fecha=AAAA-MM-DD` (por defecto hoy; también `desde`, `hasta`, `metodo_pago`, `estado`)
- `GET /api/ventas/:id` · `POST /api/ventas/:id/anular` `{motivo?}`

### Fiados
- `GET /api/clientes?q=don car` (autocompletar) · `?con_deuda=true` (quién me debe, de mayor a menor)
- `POST /api/clientes` — **solo `nombre` es obligatorio**
- `GET /api/clientes/:id` — ficha + historial de deudas y pagos · `PATCH /api/clientes/:id`
- `POST /api/clientes/:id/pagos` `{monto, metodo_pago?, observacion?}`

### Inventario
- `POST /api/productos` — obligatorios: `nombre`, `precio_venta`
- `GET /api/productos/alertas` — agotados (rojo) y por agotarse (amarillo)
- `GET /api/productos?nivel=rojo|amarillo|verde&favoritos=true&estado=...`
- `PATCH /api/productos/:id` · `PATCH /api/productos/:id/favorito` · `DELETE /api/productos/:id` (desactiva) · `POST /api/productos/:id/reactivar`
- `POST /api/productos/:id/ajuste-stock` `{stock_nuevo, motivo?}` — "conté y hay 12"
- `GET /api/productos/:id/movimientos` — historial de entradas y salidas
- `POST /api/productos/:id/presentaciones` `{nombre: "Caja", unidades: 24}`

Cada producto trae `nivel_stock`: `verde` (hay), `amarillo` (`stock <= stock_minimo`), `rojo` (agotado).

### Entrada de mercadería ("Carga Rápida de Factura")
- `POST /api/compras`
  ```json
  { "proveedor": "Distribuidora Lima",
    "items": [
      {"id_producto": 3, "cantidad": 2, "id_presentacion": 1, "costo": 90, "precio_venta": 10.5},
      {"id_producto": 1, "cantidad": 6, "costo": 2.1} ] }
  ```
  `cantidad` y `costo` se refieren a lo que compró (2 **cajas** a 90 **la caja**); el sistema convierte a
  unidades (2×12 = 24), calcula el costo unitario y actualiza stock, costo y (si lo envía) precio de venta.
- `GET /api/compras` · `GET /api/compras/:id`

### Cierre de caja
- `GET /api/reportes/dia?fecha=` — el cierre visual en vivo:
  `ventas {efectivo, yape_plin, tarjeta, fiado}`, `total_vendido`, `cobros_deuda`, `efectivo_en_gaveta`,
  `ganancia_estimada`, `producto_estrella`, `top_productos`
- `POST /api/reportes/cierre` `{fecha?}` — "Cerrar Día y Guardar Reporte" (si se cierra otra vez, recalcula)
- `GET /api/reportes/cierres` — historial

## Decisiones que conviene conocer

- **Se mantuvo tu base de datos**; `02_extensiones.sql` solo agrega. Dos correcciones a lo existente:
  `codigo_barras` pasó de único global a único **por tienda** (si no, dos bazares no podrían vender la misma gaseosa),
  y se agregaron `CHECK` para que nunca haya stock ni precios negativos.
- **No se usan los procedimientos almacenados** (`sp_RegistrarVentaBazar`, etc.): leían el stock y luego lo
  descontaban sin bloquear, así que dos ventas simultáneas podían vender la misma última unidad. Ahora la venta
  completa es una transacción con bloqueo de filas (hay una prueba que lanza 10 ventas a la vez por 5 unidades).
  Tampoco `sp_LoginTendera`, que comparaba la contraseña en texto plano; ahora se guarda con bcrypt.
- `vw_StockCritico` omitía los productos `Agotado` (justo los más críticos); las alertas se consultan directo.
- **Hora del negocio**: `DB_TIMEZONE=-05:00`. Sin esto "hoy" lo decide el reloj del servidor (UTC) y desde las
  7 p.m. en Lima las ventas caerían en el día siguiente.
- **Fiado**: `limite_credito = 0` significa *sin límite* (para no frenar al vecino recién anotado).
  Una venta anulada que ya estaba pagada deja saldo negativo (= saldo a favor del vecino).
- **Stock**: una venta se rechaza (409) si no hay unidades suficientes según el sistema. Si en la práctica el
  inventario aún no está al día, la dueña puede corregirlo con `ajuste-stock`.
- **Costo**: al comprar, el costo del producto pasa a ser el de la última compra (no un promedio ponderado).
  La ganancia usa el costo vigente al momento de cada venta.
- No hay endpoint para borrar clientes: borrarlos eliminaría su historial de deudas (la base lo cascadea).
