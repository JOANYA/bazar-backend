/**
 * Prueba de punta a punta contra MySQL real (la base db_bazar_vecino ya cargada con
 * db/01 y db/02). Crea sus propias tiendas con nombres únicos y las borra al final.
 */
process.env.NODE_ENV = 'test';
require('dotenv').config();
const crypto = require('crypto');
const request = require('supertest');
const app = require('../app');
const pool = require('../src/config/db');

const sufijo = crypto.randomBytes(3).toString('hex');
const servidor = app.listen(0); // un solo servidor para todas las peticiones
const api = request(servidor);
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let admin; let A; let B; // tokens
let idA; let idB;
let coca; let arroz; let aceite; let cliente;

const crearProducto = (t, d) => api.post('/api/productos').set(auth(t)).send(d);
const vender = (t, d) => api.post('/api/ventas').set(auth(t)).send(d);
const stockDe = async (t, id) => (await api.get(`/api/productos/${id}`).set(auth(t))).body.stock_actual;

beforeAll(async () => {
  const r = await api.post('/api/auth/admin/login').send({ correo: process.env.ADMIN_CORREO, password: process.env.ADMIN_PASSWORD });
  expect(r.status).toBe(200);
  admin = r.body.token;
});

afterAll(async () => {
  const ids = [idA, idB].filter(Boolean);
  if (ids.length) {
    await pool.query('DELETE FROM Compra WHERE id_usuario IN (?)', [ids]);
    await pool.query('DELETE FROM Venta WHERE id_usuario IN (?)', [ids]);
    await pool.query('DELETE FROM Usuario WHERE id_usuario IN (?)', [ids]);
  }
  await new Promise((r) => servidor.close(r));
  await pool.end();
});

describe('1. Administración y sesión', () => {
  test('admin crea dos tiendas y ellas inician sesión', async () => {
    for (const [k, nombre] of [['a', 'Bazar Doña Rosa'], ['b', 'Bodega Don Pepe']]) {
      const c = await api.post('/api/admin/tiendas').set(auth(admin))
        .send({ nombre_tienda: nombre, telefono: '999 888 777', usuario_login: `${k}${sufijo}`, password: 'clave123' });
      expect(c.status).toBe(201);
      expect(c.body.password_hash).toBeUndefined();
      const l = await api.post('/api/auth/login').send({ usuario_login: `${k.toUpperCase()}${sufijo}`, password: 'clave123' });
      expect(l.status).toBe(200);
      if (k === 'a') { A = l.body.token; idA = c.body.id_usuario; } else { B = l.body.token; idB = c.body.id_usuario; }
    }
  });
  test('login con clave mala -> 401 genérico; usuario inexistente igual', async () => {
    const m = await api.post('/api/auth/login').send({ usuario_login: `a${sufijo}`, password: 'mala' });
    const n = await api.post('/api/auth/login').send({ usuario_login: 'noexiste', password: 'mala' });
    expect(m.status).toBe(401);
    expect(n.status).toBe(401);
    expect(m.body.message).toBe(n.body.message);
  });
  test('usuario de acceso duplicado -> 409', async () => {
    const r = await api.post('/api/admin/tiendas').set(auth(admin))
      .send({ nombre_tienda: 'Otra', telefono: '999888777', usuario_login: `a${sufijo}`, password: 'clave123' });
    expect(r.status).toBe(409);
  });
  test('sin token -> 401; roles cruzados -> 403', async () => {
    expect((await api.get('/api/productos')).status).toBe(401);
    expect((await api.get('/api/productos').set(auth(admin))).status).toBe(403);
    expect((await api.get('/api/admin/tiendas').set(auth(A))).status).toBe(403);
    expect((await api.get('/api/productos').set({ Authorization: 'Bearer basura' })).status).toBe(401);
  });
  test('ruta inexistente y JSON roto devuelven JSON de error', async () => {
    expect((await api.get('/api/nada')).status).toBe(404);
    const r = await api.post('/api/auth/login').set('Content-Type', 'application/json').send('{"x":');
    expect(r.status).toBe(400);
  });
});

describe('2. Productos', () => {
  test('crear con stock inicial y nivel de semáforo', async () => {
    coca = (await crearProducto(A, { nombre: 'Coca Cola 500ml', precio_venta: 3.5, precio_costo: 2, stock_actual: 10, stock_minimo: 3, codigo_barras: `775${sufijo}` })).body;
    arroz = (await crearProducto(A, { nombre: 'Arroz Costeño 1kg', precio_venta: 4.2, stock_actual: 2, stock_minimo: 5 })).body;
    aceite = (await crearProducto(A, { nombre: 'Aceite Primor 1L', precio_venta: 9.9, precio_costo: 7, stock_actual: 0 })).body;
    expect(coca.nivel_stock).toBe('verde');
    expect(arroz.nivel_stock).toBe('amarillo');
    expect(aceite.nivel_stock).toBe('rojo');
    expect(aceite.estado).toBe('Agotado');
    expect(coca.precio_costo).toBe(2); // número, no texto
  });
  test('validaciones: precio con 3 decimales y sin nombre', async () => {
    expect((await crearProducto(A, { nombre: 'X', precio_venta: 1 })).status).toBe(400);
    expect((await crearProducto(A, { nombre: 'Algo', precio_venta: 1.999 })).status).toBe(400);
    expect((await crearProducto(A, { precio_venta: 1 })).status).toBe(400);
  });
  test('código de barras: único por tienda, repetible entre tiendas', async () => {
    expect((await crearProducto(A, { nombre: 'Coca clon', precio_venta: 1, codigo_barras: coca.codigo_barras })).status).toBe(409);
    expect((await crearProducto(B, { nombre: 'Coca de Pepe', precio_venta: 3, codigo_barras: coca.codigo_barras })).status).toBe(201);
  });
  test('búsqueda predictiva, por código y alertas', async () => {
    const q = await api.get('/api/productos?q=coc').set(auth(A));
    expect(q.body.map((p) => p.nombre)).toEqual(['Coca Cola 500ml']);
    const q2 = await api.get('/api/productos?q=a').set(auth(A)); // empiezan con "a" primero
    expect(q2.body[0].nombre).toMatch(/^A/);
    const inj = await api.get('/api/productos?q=%25').set(auth(A)); // "%" literal: no es comodín
    expect(inj.body).toEqual([]);
    expect((await api.get(`/api/productos/codigo/${coca.codigo_barras}`).set(auth(A))).body.id_producto).toBe(coca.id_producto);
    expect((await api.get('/api/productos/codigo/000').set(auth(A))).status).toBe(404);
    const al = await api.get('/api/productos/alertas').set(auth(A));
    expect(al.body.map((p) => p.nombre)).toEqual(['Aceite Primor 1L', 'Arroz Costeño 1kg']); // agotado primero
  });
  test('aislamiento: la tienda B no ve ni toca productos de A', async () => {
    expect((await api.get(`/api/productos/${coca.id_producto}`).set(auth(B))).status).toBe(404);
    expect((await api.patch(`/api/productos/${coca.id_producto}`).set(auth(B)).send({ precio_venta: 0.01 })).status).toBe(404);
    expect((await api.post(`/api/productos/${coca.id_producto}/ajuste-stock`).set(auth(B)).send({ stock_nuevo: 999 })).status).toBe(404);
    expect((await vender(B, { items: [{ id_producto: coca.id_producto, cantidad: 1 }] })).status).toBe(404);
    expect(await stockDe(A, coca.id_producto)).toBe(10);
  });
  test('favoritos y pantalla "Un Toque" (fijados + más vendidos)', async () => {
    const f = await api.patch(`/api/productos/${arroz.id_producto}/favorito`).set(auth(A)).send({});
    expect(f.body.es_favorito).toBe(true);
    const r = await api.get('/api/productos/rapidos').set(auth(A));
    expect(r.body.map((p) => [p.nombre, p.origen])).toEqual([['Arroz Costeño 1kg', 'fijado']]); // coca aún sin ventas; aceite sin stock
  });
});

describe('3. Ventas, stock y fiado', () => {
  test('cliente rápido: solo nombre', async () => {
    cliente = (await api.post('/api/clientes').set(auth(A)).send({ nombre: 'Don Carlos', limite_credito: 20 })).body;
    expect(cliente.saldo_deudor).toBe(0);
    expect((await api.post('/api/clientes').set(auth(A)).send({ nombre: 'Doña Luz' })).status).toBe(201);
    const q = await api.get('/api/clientes?q=don car').set(auth(A));
    expect(q.body.map((c) => c.nombre)).toEqual(['Don Carlos']);
    expect((await api.get(`/api/clientes/${cliente.id_cliente}`).set(auth(B))).status).toBe(404);
  });
  test('venta en efectivo: total desde la base (ignora precios del cliente) y descuenta stock', async () => {
    const r = await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 2, precio: 0.01 }], metodo_pago: 'Efectivo' });
    expect(r.status).toBe(201);
    expect(r.body.monto_total).toBe(7);
    expect(r.body.items[0]).toMatchObject({ cantidad: 2, precio_unitario: 3.5, subtotal: 7 });
    expect(await stockDe(A, coca.id_producto)).toBe(8);
  });
  test('stock insuficiente -> 409 y no cambia nada (ni agotados)', async () => {
    const r = await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 1 }, { id_producto: arroz.id_producto, cantidad: 3 }] });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Arroz/);
    expect(await stockDe(A, coca.id_producto)).toBe(8); // la coca NO se descontó: transacción revertida
    expect((await vender(A, { items: [{ id_producto: aceite.id_producto, cantidad: 1 }] })).body.message).toMatch(/agotado/);
  });
  test('fiado: suma deuda; respeta límite; exige vecino', async () => {
    expect((await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 1 }], metodo_pago: 'Fiado' })).status).toBe(400);
    const ok = await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 3 }], metodo_pago: 'Fiado', id_cliente: cliente.id_cliente });
    expect(ok.status).toBe(201);
    expect(ok.body.cliente.saldo_deudor).toBe(10.5);
    globalThis.ventaFiada = ok.body.id_venta;
    const exceso = await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 3 }], metodo_pago: 'Fiado', id_cliente: cliente.id_cliente });
    expect(exceso.status).toBe(409);
    expect(exceso.body.message).toMatch(/límite/);
    expect(await stockDe(A, coca.id_producto)).toBe(5);
    // el vecino de otra tienda no sirve
    const otro = (await api.post('/api/clientes').set(auth(B)).send({ nombre: 'Vecino de B' })).body;
    expect((await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 1 }], metodo_pago: 'Fiado', id_cliente: otro.id_cliente })).status).toBe(404);
  });
  test('Yape/Plin y tarjeta', async () => {
    expect((await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 1 }], metodo_pago: 'Yape/Plin' })).status).toBe(201);
    expect((await vender(A, { items: [{ id_producto: coca.id_producto, cantidad: 1 }], metodo_pago: 'Cripto' })).status).toBe(400);
    expect(await stockDe(A, coca.id_producto)).toBe(4);
  });
  test('idempotencia: el mismo uuid no duplica la venta ni el descuento', async () => {
    const uuid = crypto.randomUUID();
    const d = { items: [{ id_producto: coca.id_producto, cantidad: 1 }], uuid_cliente: uuid };
    const [x, y] = await Promise.all([vender(A, d), vender(A, d)]); // además, simultáneos
    expect([x.status, y.status].sort()).toEqual([200, 201]);
    expect(x.body.id_venta).toBe(y.body.id_venta);
    expect(await stockDe(A, coca.id_producto)).toBe(3);
    const z = await vender(A, d);
    expect(z.status).toBe(200);
    expect(z.body.repetida).toBe(true);
  });
  test('concurrencia: 10 clientes a la vez por 5 unidades -> exactamente 5 ventas, nunca stock negativo', async () => {
    const p = (await crearProducto(A, { nombre: 'Último pan', precio_venta: 0.5, stock_actual: 5 })).body;
    const rs = await Promise.all(Array.from({ length: 10 }, () => vender(A, { items: [{ id_producto: p.id_producto, cantidad: 1 }] })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    const f = (await api.get(`/api/productos/${p.id_producto}`).set(auth(A))).body;
    expect(f.stock_actual).toBe(0);
    expect(f.estado).toBe('Agotado');
    expect(f.nivel_stock).toBe('rojo');
    const mov = (await api.get(`/api/productos/${p.id_producto}/movimientos`).set(auth(A))).body;
    expect(mov.filter((m) => m.tipo === 'VENTA')).toHaveLength(5);
  });
  test('"Un Toque": ahora la coca aparece como más vendida', async () => {
    const r = await api.get('/api/productos/rapidos').set(auth(A));
    expect(r.body.map((p) => [p.nombre, p.origen])).toEqual([['Arroz Costeño 1kg', 'fijado'], ['Coca Cola 500ml', 'mas_vendido']]);
  });
});

describe('4. Cobro de fiados', () => {
  test('abono parcial, sobrepago rechazado, y abono digital', async () => {
    const id = cliente.id_cliente;
    const p1 = await api.post(`/api/clientes/${id}/pagos`).set(auth(A)).send({ monto: 5, metodo_pago: 'Efectivo' });
    expect(p1.status).toBe(201);
    expect(p1.body.saldo_deudor).toBe(5.5);
    expect((await api.post(`/api/clientes/${id}/pagos`).set(auth(A)).send({ monto: 6 })).status).toBe(409);
    expect((await api.post(`/api/clientes/${id}/pagos`).set(auth(A)).send({ monto: -1 })).status).toBe(400);
    const p2 = await api.post(`/api/clientes/${id}/pagos`).set(auth(A)).send({ monto: 1.5, metodo_pago: 'Yape/Plin' });
    expect(p2.body.saldo_deudor).toBe(4);
    const ficha = (await api.get(`/api/clientes/${id}`).set(auth(A))).body;
    expect(ficha.movimientos.map((m) => [m.tipo_movimiento, m.monto, m.saldo_nuevo])).toEqual([['PAGO', 1.5, 4], ['PAGO', 5, 5.5], ['DEUDA', 10.5, 10.5]]);
    const deudores = (await api.get('/api/clientes?con_deuda=true').set(auth(A))).body;
    expect(deudores.map((c) => c.nombre)).toEqual(['Don Carlos']);
  });
  test('abonos concurrentes no pisan el saldo', async () => {
    const id = cliente.id_cliente;
    const rs = await Promise.all([1, 1, 1, 1].map(() => api.post(`/api/clientes/${id}/pagos`).set(auth(A)).send({ monto: 1 })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect((await api.get(`/api/clientes/${id}`).set(auth(A))).body.saldo_deudor).toBe(0);
    expect((await api.post(`/api/clientes/${id}/pagos`).set(auth(A)).send({ monto: 1 })).status).toBe(409); // ya no debe nada
  });
});

describe('5. Compras (entrada de mercadería)', () => {
  test('presentación Caja x12: 2 cajas = 24 unidades, costo y precio actualizados', async () => {
    const pr = await api.post(`/api/productos/${aceite.id_producto}/presentaciones`).set(auth(A)).send({ nombre: 'Caja', unidades: 12 });
    expect(pr.status).toBe(201);
    const idPres = pr.body[0].id_presentacion;
    expect((await api.post(`/api/productos/${aceite.id_producto}/presentaciones`).set(auth(A)).send({ nombre: 'Caja', unidades: 6 })).status).toBe(409);

    const c = await api.post('/api/compras').set(auth(A)).send({
      proveedor: 'Distribuidora Lima',
      items: [
        { id_producto: aceite.id_producto, cantidad: 2, id_presentacion: idPres, costo: 90, precio_venta: 10.5 }, // 90 por caja -> 7.50 c/u
        { id_producto: coca.id_producto, cantidad: 6, costo: 2.1 }
      ]
    });
    expect(c.status).toBe(201);
    expect(c.body.total_costo).toBe(192.6); // 2*90 + 6*2.10
    expect(c.body.items.find((i) => i.nombre.startsWith('Aceite'))).toMatchObject({ unidades_ingresadas: 24, costo_unitario: 7.5, presentacion: 'Caja' });

    const a = (await api.get(`/api/productos/${aceite.id_producto}`).set(auth(A))).body;
    expect(a).toMatchObject({ stock_actual: 24, estado: 'Disponible', precio_costo: 7.5, precio_venta: 10.5, nivel_stock: 'verde' });
    expect(await stockDe(A, coca.id_producto)).toBe(9);
  });
  test('presentación ajena o producto de otra tienda -> rechazado', async () => {
    const otro = (await crearProducto(B, { nombre: 'Leche B', precio_venta: 4 })).body;
    expect((await api.post('/api/compras').set(auth(A)).send({ items: [{ id_producto: otro.id_producto, cantidad: 1 }] })).status).toBe(404);
    const pres = (await api.get(`/api/productos/${aceite.id_producto}`).set(auth(A))).body.presentaciones[0].id_presentacion;
    expect((await api.post('/api/compras').set(auth(A)).send({ items: [{ id_producto: coca.id_producto, cantidad: 1, id_presentacion: pres }] })).status).toBe(400);
  });
  test('listado de compras', async () => {
    const l = await api.get('/api/compras').set(auth(A));
    expect(l.body).toHaveLength(1);
    expect(l.body[0]).toMatchObject({ proveedor: 'Distribuidora Lima', lineas: 2 });
  });
  test('ajuste de inventario deja historial', async () => {
    const r = await api.post(`/api/productos/${coca.id_producto}/ajuste-stock`).set(auth(A)).send({ stock_nuevo: 7, motivo: 'Conté en el estante' });
    expect(r.body.stock_actual).toBe(7);
    const m = (await api.get(`/api/productos/${coca.id_producto}/movimientos`).set(auth(A))).body;
    expect(m[0]).toMatchObject({ tipo: 'AJUSTE', cantidad: -2, stock_resultante: 7 });
  });
});

describe('6. Anulación', () => {
  test('anular venta fiada devuelve stock y descuenta la deuda; no se anula dos veces', async () => {
    // deuda actual 0 (pagada). Anular la fiada de 10.50 deja saldo a favor -10.50: el cuaderno cuadra matemáticamente
    const antes = await stockDe(A, coca.id_producto);
    const r = await api.post(`/api/ventas/${globalThis.ventaFiada}/anular`).set(auth(A)).send({ motivo: 'Error de digitación' });
    expect(r.status).toBe(200);
    expect(r.body.estado_venta).toBe('Anulada');
    expect(await stockDe(A, coca.id_producto)).toBe(antes + 3);
    expect((await api.post(`/api/ventas/${globalThis.ventaFiada}/anular`).set(auth(A)).send({})).status).toBe(409);
    expect((await api.post(`/api/ventas/${globalThis.ventaFiada}/anular`).set(auth(B)).send({})).status).toBe(404);
    const c = (await api.get(`/api/clientes/${cliente.id_cliente}`).set(auth(A))).body;
    expect(c.saldo_deudor).toBe(-10.5);
    expect(c.movimientos[0]).toMatchObject({ tipo_movimiento: 'PAGO', metodo_pago: null, monto: 10.5 });
  });
});

describe('7. Reporte y cierre de caja (tienda limpia para números exactos)', () => {
  let T; let idT;
  test('escenario controlado', async () => {
    const c = await api.post('/api/admin/tiendas').set(auth(admin)).send({ nombre_tienda: 'Cierre', telefono: '999888777', usuario_login: `c${sufijo}`, password: 'clave123' });
    idT = c.body.id_usuario;
    T = (await api.post('/api/auth/login').send({ usuario_login: `c${sufijo}`, password: 'clave123' })).body.token;

    const gaseosa = (await crearProducto(T, { nombre: 'Gaseosa', precio_venta: 3, precio_costo: 2, stock_actual: 50 })).body;
    const pan = (await crearProducto(T, { nombre: 'Pan', precio_venta: 0.5, precio_costo: 0.3, stock_actual: 100 })).body;
    const vecino = (await api.post('/api/clientes').set(auth(T)).send({ nombre: 'Vecina Ana' })).body;

    await vender(T, { items: [{ id_producto: gaseosa.id_producto, cantidad: 100 / 10 }], metodo_pago: 'Efectivo' });          // 10 x 3 = 30.00  (ganancia 10)
    await vender(T, { items: [{ id_producto: pan.id_producto, cantidad: 20 }], metodo_pago: 'Efectivo' });                    // 20 x 0.5 = 10.00 (ganancia 4)
    await vender(T, { items: [{ id_producto: gaseosa.id_producto, cantidad: 5 }], metodo_pago: 'Yape/Plin' });                // 15.00 (ganancia 5)
    await vender(T, { items: [{ id_producto: gaseosa.id_producto, cantidad: 2 }, { id_producto: pan.id_producto, cantidad: 3 }], metodo_pago: 'Fiado', id_cliente: vecino.id_cliente }); // 6 + 1.5 = 7.50 (ganancia 2+0.6)
    const anulada = (await vender(T, { items: [{ id_producto: gaseosa.id_producto, cantidad: 1 }] })).body;                    // se anula: no debe contar
    await api.post(`/api/ventas/${anulada.id_venta}/anular`).set(auth(T)).send({});
    await api.post(`/api/clientes/${vecino.id_cliente}/pagos`).set(auth(T)).send({ monto: 2.5, metodo_pago: 'Efectivo' });   // cobro en efectivo

    const dia = (await api.get('/api/reportes/dia').set(auth(T))).body;
    expect(dia.ventas).toEqual({ efectivo: 40, yape_plin: 15, tarjeta: 0, fiado: 7.5 });
    expect(dia.total_vendido).toBe(62.5);
    expect(dia.num_ventas).toBe(4);
    expect(dia.cobros_deuda).toEqual({ efectivo: 2.5, digital: 0, total: 2.5 });
    expect(dia.efectivo_en_gaveta).toBe(42.5);
    expect(dia.ganancia_estimada).toBe(21.6);
    expect(dia.producto_estrella).toMatchObject({ nombre: 'Gaseosa', unidades: 17, ganancia: 17 });
    expect(dia.cerrado).toBe(false);

    const cierre = await api.post('/api/reportes/cierre').set(auth(T)).send({});
    expect(cierre.status).toBe(201);
    expect(cierre.body.cerrado).toBe(true);

    // vender de nuevo y volver a cerrar: reemplaza (no duplica) la foto del día
    await vender(T, { items: [{ id_producto: pan.id_producto, cantidad: 2 }] });
    const re = (await api.post('/api/reportes/cierre').set(auth(T)).send({})).body;
    expect(re.total_vendido).toBe(63.5);
    const hist = (await api.get('/api/reportes/cierres').set(auth(T))).body;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ total_vendido: 63.5, efectivo_en_gaveta: 43.5, producto_estrella: 'Gaseosa' });

    const inicio = (await api.get('/api/reportes/inicio').set(auth(T))).body;
    expect(inicio.fiados).toEqual({ total_por_cobrar: 5, vecinos_con_deuda: 1 });
    expect(inicio.hoy.fecha).toBe(dia.fecha);
  });
  test('"hoy" respeta la hora del negocio y fechas inválidas/futuras se rechazan', async () => {
    const [[{ hoyLocal }]] = await pool.query(`SELECT CURDATE() AS hoyLocal`);
    const dia = (await api.get('/api/reportes/dia').set(auth(T))).body;
    expect(dia.fecha).toBe(hoyLocal);
    expect((await api.get('/api/reportes/dia?fecha=2026-02-31').set(auth(T))).status).toBe(400);
    expect((await api.post('/api/reportes/cierre').set(auth(T)).send({ fecha: '2999-01-01' })).status).toBe(400);
    const sin = (await api.get('/api/reportes/dia?fecha=2020-01-01').set(auth(T))).body;
    expect(sin).toMatchObject({ total_vendido: 0, num_ventas: 0, producto_estrella: null });
    const ventas = (await api.get('/api/ventas').set(auth(T))).body;
    expect(ventas).toHaveLength(6);
    expect((await api.get('/api/ventas?estado=Anulada').set(auth(T))).body).toHaveLength(1);
  });
  afterAll(async () => {
    if (idT) {
      await pool.query('DELETE FROM Venta WHERE id_usuario = ?', [idT]);
      await pool.query('DELETE FROM Usuario WHERE id_usuario = ?', [idT]);
    }
  });
});

describe('8. Suspensión inmediata', () => {
  test('al suspender una tienda, su token deja de servir y no puede volver a entrar', async () => {
    expect((await api.get('/api/productos').set(auth(B))).status).toBe(200);
    expect((await api.patch(`/api/admin/tiendas/${idB}`).set(auth(admin)).send({ estado: 'SUSPENDIDO' })).status).toBe(200);
    expect((await api.get('/api/productos').set(auth(B))).status).toBe(403);
    expect((await api.post('/api/auth/login').send({ usuario_login: `b${sufijo}`, password: 'clave123' })).status).toBe(403);
    expect((await api.post('/api/auth/login').send({ usuario_login: `b${sufijo}`, password: 'otra' })).status).toBe(401); // no revela estado sin clave correcta
    await api.patch(`/api/admin/tiendas/${idB}`).set(auth(admin)).send({ estado: 'ACTIVO' });
    expect((await api.get('/api/productos').set(auth(B))).status).toBe(200);
  });
  test('cambiar contraseña', async () => {
    expect((await api.put('/api/auth/password').set(auth(A)).send({ password_actual: 'mala', password_nueva: 'nueva123' })).status).toBe(401);
    expect((await api.put('/api/auth/password').set(auth(A)).send({ password_actual: 'clave123', password_nueva: '123' })).status).toBe(400);
    expect((await api.put('/api/auth/password').set(auth(A)).send({ password_actual: 'clave123', password_nueva: 'nueva123' })).status).toBe(200);
    expect((await api.post('/api/auth/login').send({ usuario_login: `a${sufijo}`, password: 'nueva123' })).status).toBe(200);
  });
});
